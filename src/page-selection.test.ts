import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { capturePageSelection, promptWithSelections, watchPageSelection, type PageSelection } from "./page-selection.ts";
import type { PageTarget } from "./page-context.ts";

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
const originalNode = Object.getOwnPropertyDescriptor(globalThis, "Node");
const target: PageTarget = { tabId: 7, windowId: 2, url: "https://example.com/page", title: "Example" };
const selection: PageSelection = {
  url: target.url,
  title: target.title,
  selector: "main:nth-of-type(1) > p:nth-of-type(2)",
  text: "Hello world",
  html: "Hello <strong>world</strong>",
  truncated: false,
};

afterEach(() => {
  for (const [name, descriptor] of [["chrome", originalChrome], ["window", originalWindow], ["document", originalDocument], ["location", originalLocation], ["Node", originalNode]] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

function mockChrome(query: () => Promise<unknown[]>, result: PageSelection | null): void {
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: { tabs: { query }, scripting: { executeScript: async () => [{ result }] } },
  });
}

describe("page selection attachment", () => {
  it("keeps a dragged selection after the page loses focus to the side panel", async () => {
    const listeners = new Map<string, () => void>();
    const body = { tagName: "BODY", children: [] as unknown[], parentElement: null, contains: (element: unknown) => element === paragraph };
    const main = { tagName: "MAIN", children: [] as unknown[], parentElement: body };
    const paragraph = { tagName: "P", nodeType: 1, children: [], parentElement: main };
    main.children.push({ tagName: "P" }, paragraph);
    body.children.push(main);
    let selected = false;
    const selectedRange = { commonAncestorContainer: paragraph, cloneContents: () => ({}) };
    Object.defineProperty(globalThis, "Node", { configurable: true, value: { ELEMENT_NODE: 1 } });
    Object.defineProperty(globalThis, "location", { configurable: true, value: { href: target.url } });
    Object.defineProperty(globalThis, "window", { configurable: true, value: { getSelection: () => selected ? { isCollapsed: false, rangeCount: 1, toString: () => selection.text, getRangeAt: () => selectedRange } : null } });
    Object.defineProperty(globalThis, "document", { configurable: true, value: {
      body, title: target.title,
      addEventListener: (event: string, listener: () => void) => listeners.set(event, listener),
      createElement: () => ({ append: () => {}, innerHTML: selection.html }),
      querySelectorAll: (selector: string) => selector === selection.selector ? [paragraph] : [],
    } });
    Object.defineProperty(globalThis, "chrome", { configurable: true, value: {
      tabs: { query: async () => [{ id: target.tabId, url: target.url }] },
      scripting: { executeScript: async ({ func, args }: { func: (action: "watch" | "capture") => PageSelection | null; args: ["watch" | "capture"] }) => [{ result: func(...args) }] },
    } });

    await watchPageSelection(target);
    listeners.get("pointerdown")?.();
    selected = true;
    listeners.get("mouseup")?.();
    selected = false;
    assert.deepEqual(await capturePageSelection(target), selection);

    listeners.get("pointerdown")?.();
    await assert.rejects(capturePageSelection(target), /텍스트를 드래그/);
  });

  it("captures the selected fragment from the same connected tab", async () => {
    mockChrome(async () => [{ id: target.tabId, url: target.url }], selection);
    assert.deepEqual(await capturePageSelection(target), selection);
    const prompt = promptWithSelections("한국어로 번역해 줘", [selection]);
    assert.match(prompt, /한국어로 번역해 줘/);
    assert.match(prompt, /"annotation":1/);
    assert.match(prompt, /"selector":"main:nth-of-type\(1\) > p:nth-of-type\(2\)"/);
    assert.match(prompt, /Hello <strong>world<\/strong>/);
    assert.equal(promptWithSelections("질문", []), "질문");
  });

  it("rejects an empty selection and a navigation during capture", async () => {
    mockChrome(async () => [{ id: target.tabId, url: target.url }], null);
    await assert.rejects(capturePageSelection(target), /텍스트를 드래그/);

    let reads = 0;
    mockChrome(async () => [{ id: target.tabId, url: ++reads === 1 ? target.url : "https://example.org/" }], selection);
    await assert.rejects(capturePageSelection(target), /페이지가 바뀌었습니다/);
  });
});
