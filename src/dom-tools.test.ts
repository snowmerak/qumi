import { it } from "node:test";
import assert from "node:assert/strict";
import { inspectDom } from "./dom-tools.ts";

it("builds unique CSS paths and applies reviewed writes and clicks", async () => {
  class FakeElement {
    children: FakeElement[] = [];
    parentElement: FakeElement | null = null;
    innerText = "";
    clicks = 0;
    tagName: string;
    constructor(tagName: string) { this.tagName = tagName; }
    add(child: FakeElement): FakeElement { child.parentElement = this; this.children.push(child); return child; }
    getAttribute(): null { return null; }
    closest(): null { return null; }
    getClientRects(): number[] { return [1]; }
    matches(): boolean { return false; }
    click(): void { this.clicks++; }
    dispatchEvent(): boolean { return true; }
    contains(other: FakeElement): boolean {
      for (let current: FakeElement | null = other; current; current = current.parentElement) if (current === this) return true;
      return false;
    }
  }
  class FakeInput extends FakeElement {
    type = "text";
    value = "";
    disabled = false;
    readOnly = false;
    constructor() { super("INPUT"); }
  }

  const body = new FakeElement("BODY");
  const main = body.add(new FakeElement("MAIN"));
  body.add(new FakeElement("MAIN"));
  const first = main.add(new FakeElement("BUTTON"));
  main.add(new FakeElement("BUTTON"));
  const input = main.add(new FakeInput()) as FakeInput;
  first.innerText = "Go";
  const buttonSelector = "body > main:nth-of-type(1) > button:nth-of-type(1)";
  const inputSelector = "body > main:nth-of-type(1) > input:nth-of-type(1)";
  const globals: Record<string, unknown> = {
    location: { href: "https://example.com/" },
    document: {
      body,
      getElementById: () => null,
      querySelectorAll: (selector: string) => ({
        body: [body],
        "body > main:nth-of-type(1)": [main],
        [buttonSelector]: [first],
        [inputSelector]: [input],
        button: main.children.filter((child) => child.tagName === "BUTTON"),
      })[selector] || [],
    },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    HTMLInputElement: FakeInput,
    HTMLTextAreaElement: class {},
    HTMLSelectElement: class {},
    HTMLElement: FakeElement,
  };
  const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  try {
    const root = inspectDom({ action: "list", selector: "body" });
    assert.equal((root.result?.children as Array<{ selector: string }>)[0].selector, "body > main:nth-of-type(1)");
    assert.equal((root.result?.children as Array<{ selector: string }>)[1].selector, "body > main:nth-of-type(2)");
    const children = inspectDom({ action: "list", selector: "body > main:nth-of-type(1)" });
    assert.equal((children.result?.children as Array<{ selector: string }>)[0].selector, buttonSelector);
    assert.equal(inspectDom({ action: "read", selector: buttonSelector }).result?.text, "Go");
    assert.match(inspectDom({ action: "read", selector: "button" }).error || "", /2개/);
    assert.match(inspectDom({ action: "click", selector: buttonSelector, fingerprint: "stale" }).error || "", /바뀌었습니다/);
    const beforeWrite = String(inspectDom({ action: "describe", selector: inputSelector }).result?.fingerprint);
    assert.equal(inspectDom({ action: "write", selector: inputSelector, value: "Hello", fingerprint: beforeWrite }).result?.written, true);
    assert.equal(input.value, "Hello");
    assert.match(inspectDom({ action: "write", selector: inputSelector, value: "Again", fingerprint: beforeWrite }).error || "", /바뀌었습니다/);
    const beforeClick = String(inspectDom({ action: "describe", selector: buttonSelector }).result?.fingerprint);
    assert.equal(inspectDom({ action: "click", selector: buttonSelector, fingerprint: beforeClick }).result?.clicked, true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(first.clicks, 1);
  } finally {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
