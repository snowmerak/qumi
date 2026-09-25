import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { capturePageTarget, getActiveBrowserTab, getActivePageCandidate, hasPageAccess, requestPageAccess, listOpenTabsTool, navigationTool, readPageContext, switchTabTool, type PageTarget } from "./page-context.ts";
import { domClickTool, domListTool, domReadTool, domWriteManyTool, domWriteTool } from "./dom-tools.ts";

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");

afterEach(() => {
  if (originalChrome) Object.defineProperty(globalThis, "chrome", originalChrome);
  else Reflect.deleteProperty(globalThis, "chrome");
});

function mockChrome(value: unknown): void {
  Object.defineProperty(globalThis, "chrome", { configurable: true, value });
}

const target: PageTarget = { tabId: 7, windowId: 2, url: "https://example.com/page", title: "Example" };

describe("Chrome page tools", () => {
  it("binds the active tab only after script access succeeds", async () => {
    mockChrome({
      tabs: { query: async () => [{ id: 7, windowId: 2, url: target.url, title: target.title }] },
      scripting: { executeScript: async () => [{ result: { url: target.url, title: "Live title" } }] },
      permissions: { request: async () => true },
    });
    assert.deepEqual(await capturePageTarget(), { ...target, title: "Live title" });
  });

  it("requests access to the selected site's origin before connecting", async () => {
    const order: string[] = [];
    mockChrome({
      tabs: { query: async () => { order.push("query"); return [{ id: 7, windowId: 2, url: target.url, title: target.title }]; } },
      permissions: {
        contains: async () => false,
        request: async ({ origins }: { origins: string[] }) => { order.push(`request:${origins[0]}`); return true; },
      },
      scripting: { executeScript: async () => { order.push("inject"); return [{ result: { url: target.url, title: target.title } }]; } },
    });
    const candidate = await getActivePageCandidate();
    assert.deepEqual(candidate, target);
    order.length = 0;
    assert.deepEqual(await requestPageAccess(candidate!), target);
    assert.deepEqual(order, ["request:https://example.com/*", "query", "inject"]);
  });

  it("connects without another permission request when browser site access is already granted", async () => {
    let requests = 0;
    mockChrome({
      tabs: { query: async () => [{ id: 7, windowId: 2, url: target.url, title: target.title }] },
      permissions: {
        contains: async () => true,
        request: async () => { requests++; return true; },
      },
      scripting: { executeScript: async () => [{ result: { url: target.url, title: target.title } }] },
    });
    assert.deepEqual(await requestPageAccess(target), target);
    assert.equal(requests, 0);
  });

  it("auto-connects only after loading and when site permission already exists", async () => {
    const origins: string[] = [];
    let loading = true;
    let granted = false;
    mockChrome({
      tabs: { query: async () => [{ id: 7, windowId: 2, url: target.url, title: target.title, status: loading ? "loading" : "complete" }] },
      permissions: {
        request: async () => true,
        contains: async ({ origins: patterns }: { origins: string[] }) => { origins.push(...patterns); return granted; },
      },
      scripting: { executeScript: async () => [{ result: { url: target.url, title: target.title } }] },
    });
    const pending = await getActivePageCandidate();
    assert.equal(pending?.loading, true);
    await assert.rejects(capturePageTarget(pending!), /페이지가 바뀌었습니다/);
    loading = false;
    const candidate = await getActivePageCandidate();
    assert.deepEqual(candidate, target);
    assert.equal(await hasPageAccess(candidate!), false);
    granted = true;
    assert.equal(await hasPageAccess(candidate!), true);
    assert.deepEqual(origins, ["https://example.com/*", "https://example.com/*"]);
    assert.deepEqual(await capturePageTarget(candidate!), target);
  });

  it("does not inject when site permission is declined or the tab changes", async () => {
    let injected = false;
    mockChrome({
      tabs: { query: async () => [{ id: 8, windowId: 2, url: "https://example.org/" }] },
      permissions: { request: async () => true },
      scripting: { executeScript: async () => { injected = true; return []; } },
    });
    await assert.rejects(requestPageAccess(target), /페이지가 바뀌었습니다/);
    assert.equal(injected, false);
    mockChrome({
      tabs: { query: async () => [{ id: 7, windowId: 2, url: target.url }] },
      permissions: { request: async () => false },
      scripting: { executeScript: async () => { injected = true; return []; } },
    });
    await assert.rejects(requestPageAccess(target), /거부되었습니다/);
    assert.equal(injected, false);
  });

  it("rejects stale page data when the tab navigates during extraction", async () => {
    let queries = 0;
    mockChrome({
      tabs: { query: async () => [{ id: 7, windowId: 2, url: ++queries === 1 ? target.url : "https://example.org" }] },
      scripting: { executeScript: async () => [{ result: { url: target.url, title: target.title, text: "Old page", selection: "", links: [] } }] },
    });
    await assert.rejects(readPageContext(target, new AbortController().signal), /페이지가 바뀌었습니다/);
  });

  it("requires approval and rejects non-web navigation", async () => {
    const updates: Array<{ tabId: number; url: string }> = [];
    const creates: Array<{ windowId: number; url: string; active: boolean }> = [];
    mockChrome({
      tabs: {
        query: async () => [{ id: 7, windowId: 2, url: target.url }],
        update: async (tabId: number, options: { url: string }) => { updates.push({ tabId, url: options.url }); return { id: tabId }; },
        create: async (options: { windowId: number; url: string; active: boolean }) => { creates.push(options); return { id: 8 }; },
      },
      scripting: { executeScript: async () => [] },
    });
    const denied = navigationTool(target, async () => false, () => {});
    const signal = new AbortController().signal;
    assert.match(await denied.execute({ url: "https://example.org", disposition: "current_tab" }, signal), /"approved":false/);
    assert.equal(updates.length, 0);
    await assert.rejects(denied.execute({ url: "javascript:alert(1)", disposition: "current_tab" }, signal), /http 또는 https/);
    let navigated = false;
    const allowed = navigationTool(target, async () => true, () => { navigated = true; });
    assert.match(await allowed.execute({ url: "https://example.org", disposition: "current_tab" }, signal), /"pageChanged":true/);
    assert.deepEqual(updates, [{ tabId: 7, url: "https://example.org/" }]);
    assert.equal(navigated, true);
    assert.match(await allowed.execute({ url: "https://example.net", disposition: "new_tab" }, signal), /"tabId":8/);
    assert.deepEqual(creates, [{ windowId: 2, url: "https://example.net/", active: true }]);
  });

  it("lists every tab in the same window and confirms an existing-tab switch", async () => {
    const updates: number[] = [];
    mockChrome({
      tabs: {
        query: async (options: { active?: boolean }) => options.active
          ? [{ id: 7, windowId: 2, url: target.url }]
          : [
            { id: 7, windowId: 2, url: target.url, title: "Current", active: true },
            { id: 8, windowId: 2, url: "https://example.org/", title: "Other", active: false },
            { id: 9, windowId: 2, url: "chrome://settings", title: "Settings", active: false },
          ],
        update: async (tabId: number) => { updates.push(tabId); return { id: tabId }; },
      },
      scripting: { executeScript: async () => [] },
    });
    const signal = new AbortController().signal;
    const tabs = JSON.parse(await listOpenTabsTool(target).execute({}, signal));
    assert.deepEqual(tabs.map((tab: { tabId: number }) => tab.tabId), [7, 8, 9]);
    const approvals: string[] = [];
    const switched = switchTabTool(target, async (url, action) => {
      approvals.push(url);
      assert.equal(action, "existing_tab");
      return true;
    }, () => {});
    assert.match(await switched.execute({ tabId: 8 }, signal), /"pageChanged":true/);
    assert.deepEqual(updates, [8]);
    assert.match(await switched.execute({ tabId: 9 }, signal), /"pageChanged":true/);
    assert.deepEqual(updates, [8, 9]);
    assert.deepEqual(approvals, ["https://example.org/", "chrome://settings"]);
  });

  it("allows navigation and tab switching from a Vivaldi start page without DOM access", async () => {
    const startPage: PageTarget = { tabId: 7, windowId: 2, url: "vivaldi://startpage/", title: "Start Page" };
    const updates: Array<{ tabId: number; options: { url?: string; active?: boolean } }> = [];
    mockChrome({ tabs: {
      query: async (options: { active?: boolean }) => options.active
        ? [{ id: 7, windowId: 2, url: startPage.url, title: startPage.title }]
        : [{ id: 7, windowId: 2, url: startPage.url, title: startPage.title }, { id: 8, windowId: 2, url: "chrome://settings/", title: "Settings" }],
      update: async (tabId: number, options: { url?: string; active?: boolean }) => { updates.push({ tabId, options }); return { id: tabId }; },
    } });
    assert.deepEqual(await getActiveBrowserTab(), startPage);
    assert.equal(await getActivePageCandidate(), null);
    const signal = new AbortController().signal;
    const tabs = JSON.parse(await listOpenTabsTool(startPage).execute({}, signal));
    assert.deepEqual(tabs.map((tab: { tabId: number }) => tab.tabId), [7, 8]);
    assert.match(await navigationTool(startPage, async () => true, () => {}).execute({ url: "https://example.com", disposition: "current_tab" }, signal), /"pageChanged":true/);
    assert.match(await switchTabTool(startPage, async () => true, () => {}).execute({ tabId: 8 }, signal), /"pageChanged":true/);
    assert.deepEqual(updates, [
      { tabId: 7, options: { url: "https://example.com/" } },
      { tabId: 8, options: { active: true } },
    ]);
  });

  it("uses CSS selectors for DOM traversal and reads", async () => {
    const commands: Array<{ action: string; selector: string }> = [];
    mockChrome({
      tabs: { query: async () => [{ id: 7, url: target.url }] },
      scripting: { executeScript: async ({ args }: { args: Array<{ action: string; selector: string }> }) => {
        const command = args[0];
        commands.push(command);
        return [{ result: { ok: true, url: target.url, result: command.action === "list"
          ? { children: [{ selector: "body > main:nth-of-type(1)", tag: "main" }] }
          : { selector: command.selector, text: "Hello" } } }];
      } },
    });
    const signal = new AbortController().signal;
    const listed = JSON.parse(await domListTool(target).execute({}, signal));
    assert.equal(listed.children[0].selector, "body > main:nth-of-type(1)");
    const read = JSON.parse(await domReadTool(target).execute({ selector: listed.children[0].selector }, signal));
    assert.equal(read.text, "Hello");
    assert.deepEqual(commands.map(({ action, selector }) => ({ action, selector })), [
      { action: "list", selector: "body" },
      { action: "read", selector: "body > main:nth-of-type(1)" },
    ]);
  });

  it("requires approval and preserves the reviewed element fingerprint for write and click", async () => {
    const commands: Array<{ action: string; selector: string; fingerprint?: string }> = [];
    mockChrome({
      tabs: { query: async () => [{ id: 7, url: target.url }] },
      scripting: { executeScript: async ({ args }: { args: Array<{ action: string; selector: string; fingerprint?: string }> }) => {
        const command = args[0];
        commands.push(command);
        return [{ result: { ok: true, url: target.url, result: command.action === "describe"
          ? { tag: "button", label: "Submit", fingerprint: "abc123" }
          : { selector: command.selector, done: true } } }];
      } },
    });
    const signal = new AbortController().signal;
    const selector = "body > button:nth-of-type(1)";
    const denied = domClickTool(target, async () => false);
    assert.match(await denied.execute({ selector }, signal), /"approved":false/);
    assert.deepEqual(commands.map((command) => command.action), ["describe"]);

    const approved = domWriteTool(target, async (_title, detail) => {
      assert.match(detail, /button:nth-of-type\(1\)/);
      assert.match(detail, /"new"/);
      return true;
    });
    await approved.execute({ selector, value: "new" }, signal);
    await domClickTool(target, async () => true).execute({ selector }, signal);
    assert.deepEqual(commands.map((command) => command.action), ["describe", "describe", "write", "describe", "click"]);
    assert.equal(commands[2].fingerprint, "abc123");
    assert.equal(commands[4].fingerprint, "abc123");
  });

  it("reviews attribute changes before setting or removing them", async () => {
    const commands: Array<{ action: string; selector: string; attribute?: string; value?: string | null; expectedAttributeValue?: string | null; fingerprint?: string }> = [];
    mockChrome({
      tabs: { query: async () => [{ id: 7, url: target.url }] },
      scripting: { executeScript: async ({ args }: { args: Array<(typeof commands)[number]> }) => {
        const command = args[0];
        commands.push(command);
        return [{ result: { ok: true, url: target.url, result: command.action === "readAttribute"
          ? { tag: "button", label: "Submit", value: "old", fingerprint: "abc123" }
          : { selector: command.selector, attribute: command.attribute, written: true } } }];
      } },
    });
    const selector = "body > button:nth-of-type(1)";
    const signal = new AbortController().signal;
    const denied = domWriteTool(target, async (_title, detail) => {
      assert.match(detail, /속성: class/);
      assert.match(detail, /기존 값: "old"/);
      assert.match(detail, /새 값: "new"/);
      return false;
    });
    assert.match(await denied.execute({ selector, attribute: "class", value: "new" }, signal), /"approved":false/);
    assert.deepEqual(commands.map((command) => command.action), ["readAttribute"]);
    await assert.rejects(denied.execute({ selector, attribute: "onclick", value: "alert(1)" }, signal), /변경할 수 없는 속성/);
    assert.deepEqual(commands.map((command) => command.action), ["readAttribute"]);

    const approved = domWriteTool(target, async (_title, detail) => {
      assert.match(detail, /새 값: null \(속성 제거\)/);
      return true;
    });
    await approved.execute({ selector, attribute: "class", value: null }, signal);
    assert.deepEqual(commands.map((command) => command.action), ["readAttribute", "readAttribute", "writeAttribute"]);
    assert.equal(commands[2].expectedAttributeValue, "old");
    assert.equal(commands[2].fingerprint, "abc123");
    assert.equal(commands[2].value, null);
  });

  it("reviews page text replacement and keeps the selected text node", async () => {
    const commands: Array<{ action: string; selector: string; textNodeIndex?: number; value?: string; expectedText?: string; fingerprint?: string }> = [];
    mockChrome({
      tabs: { query: async () => [{ id: 7, url: target.url }] },
      scripting: { executeScript: async ({ args }: { args: Array<(typeof commands)[number]> }) => {
        const command = args[0];
        commands.push(command);
        return [{ result: { ok: true, url: target.url, result: command.action === "readText"
          ? { tag: "p", text: "Original text", fingerprint: "text123" }
          : { selector: command.selector, textNodeIndex: command.textNodeIndex, written: true } } }];
      } },
    });
    const selector = "body > p:nth-of-type(1)";
    const signal = new AbortController().signal;
    const denied = domWriteTool(target, async (_title, detail) => {
      assert.match(detail, /기존 텍스트: "Original text"/);
      assert.match(detail, /새 텍스트: "번역된 문장"/);
      return false;
    });
    assert.match(await denied.execute({ selector, textNodeIndex: 0, value: "번역된 문장" }, signal), /"approved":false/);
    assert.deepEqual(commands.map((command) => command.action), ["readText"]);
    const approved = domWriteTool(target, async () => true);
    await approved.execute({ selector, textNodeIndex: 0, value: "번역된 문장" }, signal);
    assert.deepEqual(commands.map((command) => command.action), ["readText", "readText", "writeText"]);
    assert.equal(commands[2].expectedText, "Original text");
    assert.equal(commands[2].fingerprint, "text123");
    assert.equal(commands[2].value, "번역된 문장");
  });

  it("reviews a text batch once and writes all nodes in one injection", async () => {
    const commands: Array<{ action: string; writes: Array<{ selector: string; textNodeIndex: number; value: string; expectedText?: string; fingerprint?: string }> }> = [];
    mockChrome({
      tabs: { query: async () => [{ id: 7, url: target.url }] },
      scripting: { executeScript: async ({ args }: { args: Array<(typeof commands)[number]> }) => {
        const command = args[0];
        commands.push(command);
        return [{ result: { ok: true, url: target.url, result: command.action === "readTextMany"
          ? { items: command.writes.map((write, index) => ({ selector: write.selector, textNodeIndex: write.textNodeIndex, text: `Old ${index}`, fingerprint: `fingerprint${index}` })) }
          : { written: command.writes.length } } }];
      } },
    });
    const writes = [
      { selector: "body > p:nth-of-type(1)", textNodeIndex: 0, value: "새 문장 1" },
      { selector: "body > p:nth-of-type(2)", textNodeIndex: 0, value: "새 문장 2" },
    ];
    const signal = new AbortController().signal;
    const denied = domWriteManyTool(target, async () => false);
    assert.match(await denied.execute({ writes }, signal), /"approved":false/);
    assert.deepEqual(commands.map((command) => command.action), ["readTextMany"]);
    commands.length = 0;
    let approvals = 0;
    const tool = domWriteManyTool(target, async (_title, detail) => {
      approvals++;
      assert.match(detail, /Old 0/);
      assert.match(detail, /새 문장 2/);
      return true;
    });
    assert.equal(JSON.parse(await tool.execute({ writes }, signal)).written, 2);
    assert.equal(approvals, 1);
    assert.deepEqual(commands.map((command) => command.action), ["readTextMany", "writeTextMany"]);
    assert.deepEqual(commands[1].writes.map((write) => [write.expectedText, write.fingerprint]), [["Old 0", "fingerprint0"], ["Old 1", "fingerprint1"]]);
    await assert.rejects(tool.execute({ writes: [writes[0], writes[0]] }, signal), /두 번 변경/);
    assert.equal(commands.length, 2);
  });

  it("reports ambiguous selectors from the page instead of acting on multiple elements", async () => {
    mockChrome({
      tabs: { query: async () => [{ id: 7, url: target.url }] },
      scripting: { executeScript: async () => [{ result: { ok: false, url: target.url, error: "CSS 선택자가 보이는 요소 2개와 일치합니다." } }] },
    });
    await assert.rejects(domReadTool(target).execute({ selector: "button" }, new AbortController().signal), /요소 2개/);
  });
});
