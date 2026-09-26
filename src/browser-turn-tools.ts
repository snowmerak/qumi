import type { AgentTool } from "./agent.ts";
import { withReadApproval, type ApprovalPolicy, type ApprovalPrompt } from "./browser-approval.ts";
import { domClickTool, domListTool, domReadTool, domWriteManyTool, domWriteTool, scrollAllTextTool } from "./dom-tools.ts";
import { sendKeyTool, sendKeysTool } from "./keyboard-tools.ts";
import { captureScreenshotTool, mouseTools, type ScreenshotFrame } from "./visual-tools.ts";
import {
  capturePageTarget, hasPageAccess, listOpenTabsTool, navigationTool, pageContextTool, switchTabTool,
  type BrowserTabTarget, type PageTarget, type TabAction,
} from "./page-context.ts";

const pageChanged = "페이지가 바뀌었습니다. 새 페이지 연결을 확인한 뒤 다시 요청해 주세요.";
const pageWaitMs = 20_000;

function isWebUrl(url: string): boolean {
  try { return ["http:", "https:"].includes(new URL(url).protocol); }
  catch { return false; }
}

type Transition = { kind: "navigation" | "new_tab" | "switch"; sourceUrl: string; requestedUrl: string };

class BrowserTurnSession {
  private target: BrowserTabTarget;
  private pageTarget: PageTarget | null;
  private transition: Transition | null = null;
  private screenshot: ScreenshotFrame | null = null;

  constructor(target: BrowserTabTarget, pageTarget: PageTarget | null) {
    this.target = target;
    this.pageTarget = pageTarget;
  }

  private async activeTab(signal: AbortSignal): Promise<chrome.tabs.Tab> {
    signal.throwIfAborted();
    const [tab] = await chrome.tabs.query({ active: true, windowId: this.target.windowId });
    signal.throwIfAborted();
    if (!tab || tab.id !== this.target.tabId || (!this.transition && (tab.url ?? "") !== this.target.url)) throw new Error(pageChanged);
    return tab;
  }

  async browserTab(signal: AbortSignal): Promise<BrowserTabTarget> {
    const tab = await this.activeTab(signal);
    return { tabId: this.target.tabId, windowId: this.target.windowId, url: tab.url ?? "", title: tab.title || tab.url || "새 탭" };
  }

  afterNavigation(tabId: number, url: string, sourceUrl: string, newTab: boolean): void {
    this.target = { tabId, windowId: this.target.windowId, url, title: url };
    this.pageTarget = null;
    this.screenshot = null;
    this.transition = { kind: newTab ? "new_tab" : "navigation", sourceUrl: newTab ? "" : sourceUrl, requestedUrl: url };
  }

  afterSwitch(tabId: number, url: string): void {
    this.target = { tabId, windowId: this.target.windowId, url, title: url };
    this.pageTarget = null;
    this.screenshot = null;
    this.transition = { kind: "switch", sourceUrl: "", requestedUrl: url };
  }

  setScreenshot(frame: ScreenshotFrame): void { this.screenshot = frame; }
  getScreenshot(): ScreenshotFrame | null { return this.screenshot; }
  clearScreenshot(): void { this.screenshot = null; }

  async page(signal: AbortSignal): Promise<PageTarget> {
    const deadline = Date.now() + pageWaitMs;
    for (;;) {
      const tab = await this.activeTab(signal);
      const url = tab.url ?? "";
      const leavingSource = !this.transition || this.transition.kind === "switch" || url !== this.transition.sourceUrl || this.transition.requestedUrl === this.transition.sourceUrl;
      if ((!this.transition || this.transition.kind === "switch") && !isWebUrl(url)) throw new Error("현재 탭의 본문에 접근할 수 없습니다. 먼저 HTTP(S) 웹페이지로 이동해 주세요.");
      if (tab.status !== "loading" && leavingSource && isWebUrl(url)) {
        if (this.pageTarget?.url === url && this.pageTarget.tabId === tab.id) return this.pageTarget;
        const candidate = { tabId: this.target.tabId, windowId: this.target.windowId, url, title: tab.title || url };
        if (!await hasPageAccess(candidate)) throw new Error(`사이트 접근 권한이 없어 ${url} 페이지를 읽을 수 없습니다. Qumi의 사이트 접근을 허용하거나 현재 페이지에서 연결을 눌러 주세요.`);
        const captured = await capturePageTarget(candidate);
        this.target = captured;
        this.pageTarget = captured;
        this.transition = null;
        return captured;
      }
      if (Date.now() >= deadline) throw new Error("새 페이지 로딩을 기다리는 시간이 초과되었습니다. 페이지 연결을 확인한 뒤 다시 요청해 주세요.");
      await new Promise((resolve) => setTimeout(resolve, 150));
      signal.throwIfAborted();
    }
  }
}

export function browserTurnTools(
  initialTab: BrowserTabTarget,
  initialPage: PageTarget | null,
  options: {
    approvalPolicy: ApprovalPolicy;
    approveRead: ApprovalPrompt;
    approveChange: ApprovalPrompt;
    approveNavigation: (url: string, disposition: TabAction, signal: AbortSignal) => Promise<boolean>;
    onNavigated: () => void;
    maxResultBytes: number;
  },
): AgentTool[] {
  const session = new BrowserTurnSession(initialTab, initialPage);
  const pageTool = (create: (target: PageTarget) => AgentTool, read: boolean): AgentTool => {
    const definition = create(initialPage ?? initialTab).definition;
    let pendingImage: { text: string; imageDataUrl: string } | null = null;
    return {
      definition,
      execute: async (args, signal) => {
        const target = await session.page(signal);
        const tool = create(target);
        const selected = read ? withReadApproval(tool, target, options.approvalPolicy, options.approveRead) : tool;
        const result = await selected.execute(args, signal);
        pendingImage = selected.takeImage?.() ?? null;
        if (["dom_write", "dom_write_many", "dom_click", "send_key", "send_keys"].includes(definition.function.name)) {
          session.clearScreenshot();
        }
        return result;
      },
      takeImage: () => { const image = pendingImage; pendingImage = null; return image; },
    };
  };

  const listTool: AgentTool = {
    definition: listOpenTabsTool(initialTab).definition,
    execute: async (args, signal) => {
      const target = await session.browserTab(signal);
      return withReadApproval(listOpenTabsTool(target), target, options.approvalPolicy, options.approveRead).execute(args, signal);
    },
  };

  const navigateTool: AgentTool = {
    definition: navigationTool(initialTab, options.approveNavigation, () => {}).definition,
    execute: async (args, signal) => {
      const target = await session.browserTab(signal);
      const result = await navigationTool(target, options.approveNavigation, () => {}).execute(args, signal);
      const outcome = JSON.parse(result) as { approved?: boolean; tabId?: number; url?: string; pageChanged?: boolean };
      if (outcome.approved && outcome.pageChanged && outcome.url) {
        const newTab = (args as { disposition: string }).disposition === "new_tab";
        let tabId = outcome.tabId ?? target.tabId;
        if (newTab && outcome.tabId === undefined) {
          const [active] = await chrome.tabs.query({ active: true, windowId: target.windowId });
          if (!active?.id || active.id === target.tabId) throw new Error("새 탭은 열렸지만 탭 ID를 확인하지 못했습니다. 탭 목록을 확인해 주세요.");
          tabId = active.id;
        }
        session.afterNavigation(tabId, outcome.url, target.url, newTab);
        options.onNavigated();
      }
      return result;
    },
  };

  const switchTool: AgentTool = {
    definition: switchTabTool(initialTab, options.approveNavigation, () => {}).definition,
    execute: async (args, signal) => {
      const target = await session.browserTab(signal);
      const result = await switchTabTool(target, options.approveNavigation, () => {}).execute(args, signal);
      const outcome = JSON.parse(result) as { approved?: boolean; tabId?: number; url?: string; pageChanged?: boolean };
      if (outcome.approved && outcome.pageChanged && outcome.tabId !== undefined) {
        session.afterSwitch(outcome.tabId, outcome.url ?? "");
        options.onNavigated();
      }
      return result;
    },
  };

  const visualMouseTool = (name: string) => pageTool((target) => {
    const tool = mouseTools(target, () => session.getScreenshot(), () => session.clearScreenshot(), options.approveChange)
      .find((candidate) => candidate.definition.function.name === name);
    if (!tool) throw new Error(`Unknown mouse tool: ${name}`);
    return tool;
  }, false);

  return [
    pageTool(pageContextTool, true),
    pageTool(domListTool, true),
    pageTool(domReadTool, true),
    pageTool((target) => scrollAllTextTool(target, options.maxResultBytes), true),
    pageTool((target) => domWriteTool(target, options.approveChange), false),
    pageTool((target) => domWriteManyTool(target, options.approveChange), false),
    pageTool((target) => domClickTool(target, options.approveChange), false),
    pageTool((target) => sendKeyTool(target, options.approveChange), false),
    pageTool((target) => sendKeysTool(target, options.approveChange), false),
    pageTool((target) => captureScreenshotTool(target, (frame) => session.setScreenshot(frame)), true),
    ...["mouse_move", "mouse_click", "mouse_drag", "mouse_scroll"].map(visualMouseTool),
    listTool, navigateTool, switchTool,
  ];
}
