import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { browserTurnTools } from "./browser-turn-tools.ts";
import type { AgentTool } from "./agent.ts";
import type { BrowserTabTarget } from "./page-context.ts";

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
const signal = new AbortController().signal;

afterEach(() => {
  if (originalChrome) Object.defineProperty(globalThis, "chrome", originalChrome);
  else Reflect.deleteProperty(globalThis, "chrome");
});

function find(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((item) => item.definition.function.name === name);
  assert.ok(tool, `missing ${name}`);
  return tool;
}

function fixture(startUrl: string, permitted = true) {
  let activeId = 7;
  let loadingChecks = 0;
  let newTabInternalChecks = 0;
  const tabs = new Map<number, { id: number; windowId: number; url: string; title: string; status: string; active: boolean }>([
    [7, { id: 7, windowId: 2, url: startUrl, title: "Initial", status: "complete", active: true }],
    [8, { id: 8, windowId: 2, url: "https://other.example/", title: "Other", status: "complete", active: false }],
  ]);
  const injections: string[] = [];
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: {
    tabs: {
      query: async (options: { active?: boolean }) => {
        if (options.active) {
          const active = tabs.get(activeId)!;
          if (activeId === 9 && newTabInternalChecks > 0) {
            newTabInternalChecks--;
            return [{ ...active, url: "chrome://newtab/", status: "complete" }];
          }
          if (active.status === "loading" && loadingChecks > 0) {
            loadingChecks--;
            if (loadingChecks === 0) active.status = "complete";
          }
          return [active];
        }
        return [...tabs.values()];
      },
      update: async (tabId: number, options: { url?: string; active?: boolean }) => {
        const tab = tabs.get(tabId)!;
        if (options.url) { tab.url = options.url; tab.title = "Loaded"; tab.status = loadingChecks ? "loading" : "complete"; }
        if (options.active) { tabs.get(activeId)!.active = false; activeId = tabId; tab.active = true; }
        return tab;
      },
      create: async (options: { url: string; active: boolean }) => {
        const tab = { id: 9, windowId: 2, url: options.url, title: "New", status: "complete", active: options.active };
        tabs.get(activeId)!.active = false;
        tabs.set(9, tab);
        activeId = 9;
        return tab;
      },
    },
    permissions: { request: async () => false, contains: async () => permitted },
    scripting: { executeScript: async ({ func }: { func: Function }) => {
      injections.push(func.name);
      const active = tabs.get(activeId)!;
      if (func.name === "pageMetadata") return [{ result: { url: active.url, title: active.title } }];
      if (func.name === "extractPage") return [{ result: { url: active.url, title: active.title, selection: "", text: "Destination content", links: [] } }];
      if (func.name === "inspectDom") return [{ result: { ok: true, url: active.url, result: { items: [{ index: 1, selector: "body > p", textNodeIndex: 0, text: "Destination content" }] } } }];
      throw new Error(`Unexpected script: ${func.name}`);
    } },
  } });
  const initialTab: BrowserTabTarget = { tabId: 7, windowId: 2, url: startUrl, title: "Initial" };
  let navigationNotices = 0;
  const tools = browserTurnTools(initialTab, startUrl.startsWith("https:") ? initialTab : null, {
    approvalPolicy: "none",
    approveRead: async () => true,
    approveChange: async () => true,
    approveNavigation: async () => true,
    onNavigated: () => { navigationNotices++; },
    maxResultBytes: 48_000,
  });
  return { tools, tabs, injections, setLoadingChecks: (count: number) => { loadingChecks = count; }, setNewTabInternalChecks: (count: number) => { newTabInternalChecks = count; }, notices: () => navigationNotices };
}

describe("browser tools within one agent turn", () => {
  it("continues reading and listing tabs after navigation without using the old URL", async () => {
    const { tools, notices } = fixture("https://old.example/");
    const moved = JSON.parse(await find(tools, "navigate_to_url").execute({ url: "https://sooplive.com/", disposition: "current_tab" }, signal));
    assert.equal(moved.pageChanged, true);
    assert.equal(notices(), 1);
    const tabs = JSON.parse(await find(tools, "list_open_tabs").execute({}, signal));
    assert.equal(tabs[0].url, "https://sooplive.com/");
    const page = JSON.parse(await find(tools, "get_current_page").execute({}, signal));
    assert.equal(page.url, "https://sooplive.com/");
    assert.equal(page.text, "Destination content");
    const text = JSON.parse(await find(tools, "scroll_all_text").execute({ from: 1, limit: 1 }, signal));
    assert.equal(text.items[0].text, "Destination content");
  });

  it("offers page tools on a start page and waits for an opened website to finish loading", async () => {
    const { tools, setLoadingChecks } = fixture("vivaldi://startpage/");
    await assert.rejects(find(tools, "get_current_page").execute({}, signal), /HTTP\(S\) 웹페이지/);
    setLoadingChecks(3);
    await find(tools, "navigate_to_url").execute({ url: "https://sooplive.com/", disposition: "current_tab" }, signal);
    const page = JSON.parse(await find(tools, "get_current_page").execute({}, signal));
    assert.equal(page.url, "https://sooplive.com/");
  });

  it("continues on a switched or newly opened tab", async () => {
    const switched = fixture("vivaldi://startpage/");
    await find(switched.tools, "switch_to_tab").execute({ tabId: 8 }, signal);
    assert.equal(JSON.parse(await find(switched.tools, "get_current_page").execute({}, signal)).url, "https://other.example/");

    const opened = fixture("vivaldi://startpage/");
    opened.setNewTabInternalChecks(2);
    await find(opened.tools, "navigate_to_url").execute({ url: "https://sooplive.com/", disposition: "new_tab" }, signal);
    assert.equal(JSON.parse(await find(opened.tools, "get_current_page").execute({}, signal)).url, "https://sooplive.com/");
  });

  it("follows a navigation redirect but rejects an unrelated tab change", async () => {
    const { tools, tabs } = fixture("https://old.example/");
    tabs.get(7)!.url = "https://unexpected.example/";
    await assert.rejects(find(tools, "get_current_page").execute({}, signal), /페이지가 바뀌었습니다/);

    const redirected = fixture("https://old.example/");
    await find(redirected.tools, "navigate_to_url").execute({ url: "https://sooplive.com/", disposition: "current_tab" }, signal);
    redirected.tabs.get(7)!.url = "https://www.sooplive.com/";
    assert.equal(JSON.parse(await find(redirected.tools, "get_current_page").execute({}, signal)).url, "https://www.sooplive.com/");
  });

  it("does not read a destination without site permission", async () => {
    const { tools, injections } = fixture("vivaldi://startpage/", false);
    await find(tools, "navigate_to_url").execute({ url: "https://sooplive.com/", disposition: "current_tab" }, signal);
    await assert.rejects(find(tools, "get_current_page").execute({}, signal), /사이트 접근 권한이 없어/);
    assert.deepEqual(injections, []);
  });
});
