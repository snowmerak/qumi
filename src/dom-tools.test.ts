import { it } from "node:test";
import assert from "node:assert/strict";
import { inspectDom } from "./dom-tools.ts";

it("builds unique CSS paths and applies reviewed writes and clicks", async () => {
  class FakeText {
    nodeType = 3;
    textContent: string;
    constructor(textContent: string) { this.textContent = textContent; }
  }
  class FakeElement {
    children: FakeElement[] = [];
    childNodes: Array<FakeElement | FakeText> = [];
    parentElement: FakeElement | null = null;
    innerText = "";
    clicks = 0;
    attributes = new Map<string, string>();
    tagName: string;
    constructor(tagName: string) { this.tagName = tagName; }
    add(child: FakeElement): FakeElement { child.parentElement = this; this.children.push(child); this.childNodes.push(child); return child; }
    addText(value: string): FakeText { const node = new FakeText(value); this.childNodes.push(node); return node; }
    getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
    setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
    removeAttribute(name: string): void { this.attributes.delete(name); }
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
  const buttonText = first.addText("Go");
  const nested = first.add(new FakeElement("STRONG"));
  nested.addText(" now");
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
    assert.deepEqual(inspectDom({ action: "read", selector: buttonSelector }).result?.textNodes, [{ index: 0, text: "Go", truncated: false }]);
    const beforeText = inspectDom({ action: "readText", selector: buttonSelector, textNodeIndex: 0 }).result;
    assert.equal(beforeText?.text, "Go");
    assert.equal(inspectDom({ action: "writeText", selector: buttonSelector, textNodeIndex: 0, value: "가자", expectedText: "Go", fingerprint: String(beforeText?.fingerprint) }).result?.written, true);
    assert.equal(buttonText.textContent, "가자");
    assert.equal(first.children[0], nested);
    assert.match(inspectDom({ action: "writeText", selector: buttonSelector, textNodeIndex: 0, value: "다시", expectedText: "Go", fingerprint: String(beforeText?.fingerprint) }).error || "", /본문 텍스트가 바뀌었습니다/);
    assert.match(inspectDom({ action: "readText", selector: buttonSelector, textNodeIndex: 1 }).error || "", /텍스트 노드/);
    assert.match(inspectDom({ action: "read", selector: "button" }).error || "", /2개/);
    assert.match(inspectDom({ action: "click", selector: buttonSelector, fingerprint: "stale" }).error || "", /바뀌었습니다/);
    const beforeWrite = String(inspectDom({ action: "describe", selector: inputSelector }).result?.fingerprint);
    assert.equal(inspectDom({ action: "write", selector: inputSelector, value: "Hello", fingerprint: beforeWrite }).result?.written, true);
    assert.equal(input.value, "Hello");
    assert.match(inspectDom({ action: "write", selector: inputSelector, value: "Again", fingerprint: beforeWrite }).error || "", /바뀌었습니다/);
    const beforeAttribute = inspectDom({ action: "readAttribute", selector: buttonSelector, attribute: "aria-label" }).result;
    assert.equal(beforeAttribute?.value, null);
    assert.equal(inspectDom({ action: "writeAttribute", selector: buttonSelector, attribute: "aria-label", value: "Continue", expectedAttributeValue: null, fingerprint: String(beforeAttribute?.fingerprint) }).result?.written, true);
    assert.equal(first.getAttribute("aria-label"), "Continue");
    const updatedAttribute = inspectDom({ action: "readAttribute", selector: buttonSelector, attribute: "aria-label" }).result;
    assert.match(inspectDom({ action: "writeAttribute", selector: buttonSelector, attribute: "aria-label", value: "Wrong", expectedAttributeValue: null, fingerprint: String(updatedAttribute?.fingerprint) }).error || "", /속성 값이 바뀌었습니다/);
    assert.equal(inspectDom({ action: "writeAttribute", selector: buttonSelector, attribute: "aria-label", value: null, expectedAttributeValue: "Continue", fingerprint: String(updatedAttribute?.fingerprint) }).result?.written, true);
    assert.equal(first.getAttribute("aria-label"), null);
    assert.match(inspectDom({ action: "readAttribute", selector: buttonSelector, attribute: "onclick" }).error || "", /변경할 수 없는 속성/);
    assert.match(inspectDom({ action: "readAttribute", selector: buttonSelector, attribute: "href" }).error || "", /변경할 수 없는 속성/);
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
