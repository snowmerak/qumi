import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cancelPageRegion, capturePageRegion, regionPickerInPage } from "./page-region.ts";
import { promptWithSelections, type PageSelection } from "./page-selection.ts";
import type { PageTarget } from "./page-context.ts";

const names = ["chrome", "window", "document", "location", "Node", "NodeFilter", "innerWidth", "innerHeight", "getComputedStyle"] as const;
const originals = Object.fromEntries(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const target: PageTarget = { tabId: 7, windowId: 2, url: "https://example.com/page", title: "Example" };
const region: PageSelection = {
  url: target.url, title: target.title, selector: "p:nth-of-type(1)",
  text: "Hello world", html: "Hello <strong>world</strong>", truncated: false,
};

afterEach(() => {
  for (const name of names) {
    const descriptor = originals[name];
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

function mock(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { configurable: true, value });
}

describe("page region attachment", () => {
  it("captures text and HTML under a drawn rectangle and removes the overlay", async () => {
    const surfaceListeners = new Map<string, (event: Record<string, unknown>) => void>();
    const windowListeners = new Map<string, () => void>();
    const documentListeners = new Map<string, (event: Record<string, unknown>) => void>();
    const box = { style: {} as Record<string, string> };
    const hint = { textContent: "" };
    const surface = {
      addEventListener: (name: string, listener: (event: Record<string, unknown>) => void) => surfaceListeners.set(name, listener),
      setPointerCapture: () => {},
    };
    let removed = false;
    const host = {
      style: { setProperty: () => {} },
      attachShadow: () => ({ innerHTML: "", querySelector: (selector: string) => ({ ".surface": surface, ".box": box, ".hint": hint })[selector as ".surface" | ".box" | ".hint"] }),
      remove: () => { removed = true; },
    };
    const paragraph = {
      nodeType: 1, tagName: "P", parentElement: null as unknown, textContent: "Hello world",
      getBoundingClientRect: () => ({ left: 10, top: 10, right: 140, bottom: 45 }),
      closest: () => null,
    };
    const body = { contains: (element: unknown) => element === paragraph, children: [paragraph] };
    paragraph.parentElement = body;
    const textNode = { textContent: "Hello world", parentElement: paragraph };
    let visited = false;
    const makeRange = () => ({
      commonAncestorContainer: paragraph,
      selectNodeContents: () => {},
      getClientRects: () => [{ left: 10, top: 10, right: 140, bottom: 45 }],
      setStart: () => {},
      setEnd: () => {},
      cloneContents: () => ({ html: region.html }),
      toString: () => region.text,
    });
    mock("Node", { ELEMENT_NODE: 1 });
    mock("NodeFilter", { SHOW_TEXT: 4 });
    mock("innerWidth", 400);
    mock("innerHeight", 300);
    mock("location", { href: target.url });
    mock("getComputedStyle", () => ({ display: "block", visibility: "visible" }));
    mock("window", {
      setTimeout, clearTimeout,
      addEventListener: (name: string, listener: () => void) => windowListeners.set(name, listener),
      removeEventListener: (name: string) => windowListeners.delete(name),
    });
    mock("document", {
      body, title: target.title,
      documentElement: { appendChild: () => {} },
      createElement: () => removed ? { innerHTML: "", append(fragment: { html: string }) { this.innerHTML = fragment.html; } } : host,
      createTreeWalker: () => ({ currentNode: textNode, nextNode: () => !visited && (visited = true) }),
      createRange: makeRange,
      querySelectorAll: (selector: string) => selector === region.selector ? [paragraph] : [],
      addEventListener: (name: string, listener: (event: Record<string, unknown>) => void) => documentListeners.set(name, listener),
      removeEventListener: (name: string) => documentListeners.delete(name),
    });

    const pending = regionPickerInPage("start") as Promise<PageSelection | null>;
    const pointer = (clientX: number, clientY: number) => ({ button: 0, pointerId: 1, clientX, clientY, preventDefault: () => {} });
    surfaceListeners.get("pointerdown")?.(pointer(5, 5));
    surfaceListeners.get("pointermove")?.(pointer(150, 55));
    surfaceListeners.get("pointerup")?.(pointer(150, 55));
    assert.deepEqual(await pending, region);
    assert.equal(removed, true);
    assert.equal(documentListeners.size, 0);
    assert.equal(windowListeners.size, 0);

    removed = false;
    const cancelled = regionPickerInPage("start") as Promise<PageSelection | null>;
    regionPickerInPage("cancel");
    assert.equal(await cancelled, null);
    assert.equal(removed, true);
  });

  it("binds capture to the current tab, supports cancellation, and attaches the region to the prompt", async () => {
    let currentUrl = target.url;
    const actions: string[] = [];
    mock("chrome", {
      tabs: { query: async () => [{ id: target.tabId, url: currentUrl }] },
      scripting: { executeScript: async ({ args }: { args: [string] }) => { actions.push(args[0]); return [{ result: args[0] === "start" ? region : null }]; } },
    });
    assert.deepEqual(await capturePageRegion(target), region);
    await cancelPageRegion(target);
    assert.deepEqual(actions, ["start", "cancel"]);
    const prompt = promptWithSelections("한국어로 번역해 줘", [region]);
    assert.match(prompt, /Attached page regions/);
    assert.match(prompt, /"selector":"p:nth-of-type\(1\)"/);
    assert.match(prompt, /Hello <strong>world<\/strong>/);
    currentUrl = "https://example.org/";
    await assert.rejects(capturePageRegion(target), /페이지가 바뀌었습니다/);
    assert.equal(promptWithSelections("질문", []), "질문");
  });
});
