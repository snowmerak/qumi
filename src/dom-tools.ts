import type { AgentTool } from "./agent.ts";
import type { PageTarget } from "./page-context.ts";

type DomAction = "list" | "read" | "scrollAllText" | "describe" | "write" | "readAttribute" | "writeAttribute" | "readText" | "writeText" | "click";

interface DomCommand {
  action: DomAction;
  selector: string;
  offset?: number;
  limit?: number;
  from?: number;
  to?: number;
  afterSelector?: string;
  maxResultBytes?: number;
  textOffset?: number;
  value?: string | boolean | null;
  attribute?: string;
  textNodeIndex?: number;
  expectedAttributeValue?: string | null;
  expectedText?: string;
  fingerprint?: string;
}

interface DomReply {
  ok: boolean;
  url: string;
  result?: Record<string, unknown>;
  error?: string;
}

const pageChanged = "페이지가 바뀌었습니다. 현재 탭을 다시 연결해 주세요.";

// Chrome serializes this function for executeScript. Keep its helpers and data inside it.
export function inspectDom(command: DomCommand): DomReply {
  const pageUrl = location.href;
  const hiddenTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "META", "LINK"]);
  const textPageSize = 10;
  const cleanText = (value: string, max: number) => value.replace(/\s+/g, " ").trim().slice(0, max);

  function allowedAttribute(name: string): boolean {
    return /^(aria|data)-[a-z0-9_-]+$/.test(name)
      || ["id", "class", "title", "role", "lang", "dir", "hidden", "disabled", "readonly", "required", "placeholder", "alt", "tabindex"].includes(name);
  }

  function isVisible(element: Element): boolean {
    if (element.closest("[hidden], [aria-hidden='true']")) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && (style.display === "contents" || element.getClientRects().length > 0);
  }

  function childrenOf(element: Element): Element[] {
    return Array.from(element.children).filter((child) => !hiddenTags.has(child.tagName) && isVisible(child));
  }

  function textNodesOf(element: Element): Text[] {
    return Array.from(element.childNodes).filter((node): node is Text => node.nodeType === 3 && Boolean(node.textContent?.trim()));
  }

  function selectedTextNode(element: Element, index: number | undefined): Text {
    if (!Number.isSafeInteger(index) || index === undefined || index < 0) throw new Error("텍스트 노드 번호가 올바르지 않습니다.");
    if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TEXTAREA", "SELECT", "OPTION"].includes(element.tagName)) throw new Error("이 요소의 본문 텍스트는 변경할 수 없습니다.");
    const node = textNodesOf(element)[index];
    if (!node || (node.textContent || "").length > 4000) throw new Error("읽거나 변경할 수 있는 텍스트 노드를 찾지 못했습니다.");
    return node;
  }

  function selectorFor(element: Element): string {
    if (element === document.body) return "body";
    const parts: string[] = [];
    let current: Element | null = element;
    while (current && current !== document.body) {
      const tag = current.tagName.toLowerCase();
      const siblings = current.parentElement ? Array.from(current.parentElement.children).filter((item) => item.tagName === current?.tagName) : [];
      parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(current) + 1})`);
      current = current.parentElement;
    }
    return `body > ${parts.join(" > ")}`;
  }

  function labelOf(element: Element): string {
    const labelledBy = element.getAttribute("aria-labelledby");
    const labelled = labelledBy ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ") : "";
    const input = element as HTMLInputElement;
    const label = "labels" in input && input.labels ? Array.from(input.labels).map((item) => item.textContent || "").join(" ") : "";
    return cleanText(element.getAttribute("aria-label") || labelled || label || element.getAttribute("alt") || element.getAttribute("title") || "", 120);
  }

  function fingerprintOf(element: Element): string {
    const control = element as HTMLInputElement;
    const source = [element.tagName, element.getAttribute("type"), element.getAttribute("name"), element.getAttribute("href"), labelOf(element), cleanText((element as HTMLElement).innerText || "", 240), "value" in control ? control.value : "", "checked" in control ? control.checked : ""].join("\u001f");
    let hash = 2166136261;
    for (let index = 0; index < source.length; index++) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
    return (hash >>> 0).toString(16);
  }

  function describe(element: Element): Record<string, unknown> {
    return {
      selector: selectorFor(element),
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role") || undefined,
      label: labelOf(element),
      text: cleanText((element as HTMLElement).innerText || "", 160),
      childCount: childrenOf(element).length,
      fingerprint: fingerprintOf(element),
    };
  }

  function uniqueElement(selector: string): Element {
    if (!selector || selector.length > 500) throw new Error("CSS 선택자가 올바르지 않습니다.");
    const matches = Array.from(document.querySelectorAll(selector)).filter((element) => (element === document.body || document.body.contains(element)) && isVisible(element));
    if (matches.length !== 1) throw new Error(`CSS 선택자가 보이는 요소 ${matches.length}개와 일치합니다. 한 요소만 가리키도록 좁혀 주세요.`);
    return matches[0];
  }

  try {
    if (command.action === "scrollAllText") {
      const anchor = command.afterSelector ? uniqueElement(command.afterSelector) : null;
      const items: Array<{ index: number; selector: string; textNodeIndex: number; text: string; truncated: boolean }> = [];
      const maxItems = command.limit ?? ((command.to ?? 30) - (command.from ?? 1) + 1);
      const maxResultBytes = command.maxResultBytes ?? 48_000;
      let resultBytes = 0;
      let total = 0;
      let anchorPassed = anchor === null;
      let anchorEndIndex: number | null = null;
      let outputLimited = false;

      function visit(element: Element, insideAnchor = false): void {
        if (hiddenTags.has(element.tagName) || ["TEXTAREA", "SELECT", "OPTION"].includes(element.tagName) || !isVisible(element)) return;
        const inAnchor = insideAnchor || element === anchor;
        let textNodeIndex = 0;
        for (const child of element.childNodes) {
          if (child.nodeType === 3) {
            const text = child.textContent || "";
            if (!text.trim()) continue;
            const currentTextNodeIndex = textNodeIndex++;
            const index = ++total;
            const inRange = anchor ? anchorPassed && !inAnchor : index >= (command.from ?? 1) && index <= (command.to ?? 30);
            if (!inRange || items.length >= maxItems || outputLimited) continue;
            const item = { index, selector: selectorFor(element), textNodeIndex: currentTextNodeIndex, text: text.slice(0, 4000), truncated: text.length > 4000 };
            const encoder = new TextEncoder();
            let bytes = encoder.encode(JSON.stringify(item)).length;
            if (resultBytes + bytes > maxResultBytes) {
              outputLimited = true;
              if (items.length === 0) {
                let low = 0;
                let high = item.text.length;
                while (low < high) {
                  const middle = Math.ceil((low + high) / 2);
                  const candidate = { ...item, text: item.text.slice(0, middle), truncated: true };
                  if (encoder.encode(JSON.stringify(candidate)).length <= maxResultBytes) low = middle;
                  else high = middle - 1;
                }
                if (low > 0) items.push({ ...item, text: item.text.slice(0, low), truncated: true });
              }
              continue;
            }
            items.push(item);
            resultBytes += bytes;
          } else if (child.nodeType === 1) {
            visit(child as Element, inAnchor);
          }
        }
        if (element === anchor) {
          anchorPassed = true;
          anchorEndIndex = total;
        }
      }

      visit(document.body);
      const from = anchor ? (anchorEndIndex ?? total) + 1 : command.from ?? 1;
      const lastIndex = items.at(-1)?.index;
      return { ok: true, url: pageUrl, result: {
        from, total, nextIndex: lastIndex !== undefined && lastIndex < total ? lastIndex + 1 : null,
        outputLimited, items,
      } };
    }

    const element = uniqueElement(command.selector);
    const summary = describe(element);
    if (command.action === "describe") return { ok: true, url: pageUrl, result: summary };

    if (command.action === "list") {
      const children = childrenOf(element);
      const offset = command.offset || 0;
      const limit = command.limit || 20;
      return { ok: true, url: pageUrl, result: { selector: command.selector, total: children.length, offset, nextOffset: offset + limit < children.length ? offset + limit : null, children: children.slice(offset, offset + limit).map(describe) } };
    }

    if (command.action === "read") {
      const attributes: Record<string, string> = {};
      for (const name of ["id", "class", "role", "type", "name", "placeholder", "title", "alt", "href", "aria-label", "aria-expanded", "aria-checked"]) {
        const value = element.getAttribute(name);
        if (value !== null) attributes[name] = value.slice(0, 300);
      }
      const input = element as HTMLInputElement;
      const isPassword = element instanceof HTMLInputElement && input.type === "password";
      const value = isPassword ? "[redacted]" : element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement ? input.value.slice(0, 4000) : undefined;
      const checked = element instanceof HTMLInputElement && (input.type === "checkbox" || input.type === "radio") ? input.checked : undefined;
      const textNodes = textNodesOf(element);
      const textOffset = command.textOffset ?? 0;
      if (!Number.isSafeInteger(textOffset) || textOffset < 0) throw new Error("텍스트 노드 목록 범위가 올바르지 않습니다.");
      return { ok: true, url: pageUrl, result: { ...summary, attributes, text: cleanText((element as HTMLElement).innerText || "", 8000), textNodeCount: textNodes.length, textNodes: textNodes.slice(textOffset, textOffset + textPageSize).map((node, index) => ({ index: textOffset + index, text: (node.textContent || "").slice(0, 4000), truncated: (node.textContent || "").length > 4000 })), nextTextOffset: textOffset + textPageSize < textNodes.length ? textOffset + textPageSize : null, value, checked } };
    }

    if (command.action === "readText") {
      const node = selectedTextNode(element, command.textNodeIndex);
      return { ok: true, url: pageUrl, result: { ...summary, textNodeIndex: command.textNodeIndex, text: node.textContent || "" } };
    }

    if (command.action === "readAttribute") {
      if (!command.attribute || !allowedAttribute(command.attribute)) throw new Error("변경할 수 없는 속성입니다.");
      return { ok: true, url: pageUrl, result: { ...summary, attribute: command.attribute, value: element.getAttribute(command.attribute) } };
    }

    if (!command.fingerprint || command.fingerprint !== fingerprintOf(element)) throw new Error("승인 후 요소가 바뀌었습니다. 다시 확인해 주세요.");
    if (command.action === "writeText") {
      if (typeof command.value !== "string" || command.value.length > 4000 || typeof command.expectedText !== "string") throw new Error("본문 텍스트 변경 인수가 올바르지 않습니다.");
      const node = selectedTextNode(element, command.textNodeIndex);
      if (node.textContent !== command.expectedText) throw new Error("승인 후 본문 텍스트가 바뀌었습니다. 다시 확인해 주세요.");
      node.textContent = command.value;
      return { ok: true, url: pageUrl, result: { selector: command.selector, textNodeIndex: command.textNodeIndex, written: true } };
    }
    if (command.action === "writeAttribute") {
      const name = command.attribute;
      if (!name || !allowedAttribute(name) || (typeof command.value !== "string" && command.value !== null) || (typeof command.value === "string" && command.value.length > 4000)) throw new Error("속성 변경 인수가 올바르지 않습니다.");
      const previousValue = element.getAttribute(name);
      if (previousValue !== command.expectedAttributeValue) throw new Error("승인 후 속성 값이 바뀌었습니다. 다시 확인해 주세요.");
      if (command.value === null) element.removeAttribute(name);
      else element.setAttribute(name, command.value);
      return { ok: true, url: pageUrl, result: { selector: command.selector, attribute: name, previousValue, value: command.value, written: true } };
    }
    if (command.action === "write") {
      if (element instanceof HTMLInputElement) {
        if (element.disabled || element.readOnly || element.type === "password" || element.type === "hidden" || element.type === "file") throw new Error("이 입력란은 변경할 수 없습니다.");
        if (element.type === "checkbox" || element.type === "radio") {
          if (typeof command.value !== "boolean") throw new Error("체크 상태는 true 또는 false로 지정해 주세요.");
          element.checked = command.value;
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          if (!["text", "search", "email", "url", "tel", "number"].includes(element.type)) throw new Error("이 입력란은 변경할 수 없습니다.");
          if (typeof command.value !== "string") throw new Error("문자열 값이 필요합니다.");
          element.value = command.value;
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } else if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        if (element.disabled || (element instanceof HTMLTextAreaElement && element.readOnly) || typeof command.value !== "string") throw new Error("이 요소는 문자열로 변경할 수 없습니다.");
        if (element instanceof HTMLSelectElement && !Array.from(element.options).some((option) => option.value === command.value && !option.disabled)) throw new Error("선택 목록에 해당 값이 없습니다.");
        element.value = command.value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (element instanceof HTMLElement && element.isContentEditable) {
        if (typeof command.value !== "string") throw new Error("문자열 값이 필요합니다.");
        element.textContent = command.value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
      } else throw new Error("이 요소는 값을 쓸 수 없습니다.");
      return { ok: true, url: pageUrl, result: { selector: command.selector, written: true } };
    }

    if (command.action === "click") {
      if (!(element instanceof HTMLElement) || element.matches(":disabled")) throw new Error("이 요소는 클릭할 수 없습니다.");
      setTimeout(() => element.click(), 0);
      return { ok: true, url: pageUrl, result: { selector: command.selector, clicked: true } };
    }
    throw new Error("지원하지 않는 DOM 작업입니다.");
  } catch (error) {
    return { ok: false, url: pageUrl, error: error instanceof Error ? error.message : "DOM 작업에 실패했습니다." };
  }
}

async function assertCurrentTarget(target: PageTarget): Promise<void> {
  const [active] = await chrome.tabs.query({ active: true, windowId: target.windowId });
  if (!active || active.id !== target.tabId || active.url !== target.url) throw new Error(pageChanged);
}

async function runDom(target: PageTarget, command: DomCommand, signal: AbortSignal): Promise<Record<string, unknown>> {
  signal.throwIfAborted();
  await assertCurrentTarget(target);
  let reply: DomReply | undefined;
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: target.tabId }, func: inspectDom, args: [command] });
    reply = injection?.result;
  } catch {
    throw new Error("이 페이지의 DOM에 접근할 수 없습니다.");
  }
  signal.throwIfAborted();
  if (!reply || reply.url !== target.url) throw new Error(pageChanged);
  if (!reply.ok || !reply.result) throw new Error(reply.error || "DOM 작업에 실패했습니다.");
  if (command.action !== "click" && command.action !== "write" && command.action !== "writeAttribute" && command.action !== "writeText") await assertCurrentTarget(target);
  return reply.result;
}

function parseArgs(value: unknown, allowed: string[], required: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("DOM 도구 인수가 올바르지 않습니다.");
  const args = value as Record<string, unknown>;
  if (Object.keys(args).some((key) => !allowed.includes(key)) || required.some((key) => !(key in args))) throw new Error("DOM 도구 인수가 올바르지 않습니다.");
  return args;
}

function parseSelector(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 500) throw new Error("CSS 선택자가 올바르지 않습니다.");
  return value;
}

function parseAttribute(value: unknown): string {
  if (typeof value !== "string" || !(/^(aria|data)-[a-z0-9_-]+$/.test(value) || ["id", "class", "title", "role", "lang", "dir", "hidden", "disabled", "readonly", "required", "placeholder", "alt", "tabindex"].includes(value))) throw new Error("변경할 수 없는 속성입니다.");
  return value;
}

export function domListTool(target: PageTarget): AgentTool {
  return {
    definition: { type: "function", function: {
      name: "dom_list",
      description: "List visible direct children under a CSS selector, like listing a directory. Start at body. Returned selectors can be used for further list, read, write or click operations.",
      parameters: { type: "object", properties: { selector: { type: "string" }, offset: { type: "integer" }, limit: { type: "integer" } }, additionalProperties: false },
    } },
    execute: async (value, signal) => {
      const args = parseArgs(value, ["selector", "offset", "limit"]);
      const selector = parseSelector(args.selector === undefined ? "body" : args.selector);
      const offset = args.offset === undefined ? 0 : args.offset;
      const limit = args.limit === undefined ? 20 : args.limit;
      if (!Number.isSafeInteger(offset) || Number(offset) < 0 || !Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 30) throw new Error("목록 범위가 올바르지 않습니다.");
      return JSON.stringify(await runDom(target, { action: "list", selector, offset: Number(offset), limit: Number(limit) }, signal));
    },
  };
}

export function domReadTool(target: PageTarget): AgentTool {
  return {
    definition: { type: "function", function: {
      name: "dom_read",
      description: "Read one visible DOM element by a unique CSS selector. Includes text, selected attributes, editable value, and direct textNodes with indices. Use nextTextOffset to page through text nodes. Pass a text node index to dom_write to replace visible page body text while preserving nested elements. Password values are redacted.",
      parameters: { type: "object", properties: { selector: { type: "string" }, textOffset: { type: "integer" } }, required: ["selector"], additionalProperties: false },
    } },
    execute: async (value, signal) => {
      const args = parseArgs(value, ["selector", "textOffset"], ["selector"]);
      const textOffset = args.textOffset === undefined ? 0 : args.textOffset;
      if (!Number.isSafeInteger(textOffset) || Number(textOffset) < 0) throw new Error("텍스트 노드 목록 범위가 올바르지 않습니다.");
      return JSON.stringify(await runDom(target, { action: "read", selector: parseSelector(args.selector), textOffset: Number(textOffset) }, signal));
    },
  };
}

export function scrollAllTextTool(target: PageTarget, maxResultBytes = 48_000): AgentTool {
  return {
    definition: { type: "function", function: {
      name: "scroll_all_text",
      description: "Read visible text nodes from the connected page in document order, including text below the viewport. Use 1-based inclusive from/to (at most 50 entries), or afterSelector plus limit (at most 50) to read after that element's entire subtree. Each item includes its unique CSS selector and 0-based direct textNodeIndex for dom_write. nextIndex can be passed as from for the next batch. Does not physically scroll or load more content.",
      parameters: { type: "object", properties: { from: { type: "integer" }, to: { type: "integer" }, afterSelector: { type: "string" }, limit: { type: "integer" } }, additionalProperties: false },
    } },
    execute: async (value, signal) => {
      const args = parseArgs(value, ["from", "to", "afterSelector", "limit"]);
      const rangeMode = args.from !== undefined || args.to !== undefined;
      const anchorMode = args.afterSelector !== undefined || args.limit !== undefined;
      if (rangeMode && anchorMode) throw new Error("텍스트 범위와 CSS 선택자 뒤 읽기 중 한 방식만 지정해 주세요.");
      if (anchorMode) {
        const afterSelector = parseSelector(args.afterSelector);
        const limit = args.limit;
        if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 50) throw new Error("읽을 텍스트 개수는 1~50이어야 합니다.");
        return JSON.stringify(await runDom(target, { action: "scrollAllText", selector: "body", afterSelector, limit: Number(limit), maxResultBytes }, signal));
      }
      const from = rangeMode ? args.from : 1;
      const to = rangeMode ? args.to : 30;
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || Number(from) < 1 || Number(to) < Number(from) || Number(to) - Number(from) >= 50) throw new Error("텍스트 범위는 1부터 시작하는 최대 50개의 연속 번호여야 합니다.");
      return JSON.stringify(await runDom(target, { action: "scrollAllText", selector: "body", from: Number(from), to: Number(to), maxResultBytes }, signal));
    },
  };
}

type DomApproval = (title: string, detail: string, signal: AbortSignal) => Promise<boolean>;

export function domWriteTool(target: PageTarget, approve: DomApproval): AgentTool {
  return {
    definition: { type: "function", function: {
      name: "dom_write",
      description: "Write to one visible element selected by a unique CSS selector. To edit ordinary page body text or translate it in place, first use dom_read, then pass its direct textNodes[].index as textNodeIndex with a new string value; nested links and markup remain intact. With attribute, set a permitted HTML attribute using a string or remove it using null. Without either field, set an input/textarea/select/editable value. Confirmation follows the browser work setting. URL, event handler, style and arbitrary HTML attributes are excluded.",
      parameters: { type: "object", properties: { selector: { type: "string" }, attribute: { type: "string" }, textNodeIndex: { type: "integer" }, value: { type: ["string", "boolean", "null"] } }, required: ["selector", "value"], additionalProperties: false },
    } },
    execute: async (input, signal) => {
      const args = parseArgs(input, ["selector", "attribute", "textNodeIndex", "value"], ["selector", "value"]);
      const selector = parseSelector(args.selector);
      const value = args.value;
      if (args.attribute !== undefined && args.textNodeIndex !== undefined) throw new Error("속성과 본문 텍스트는 한 번에 하나만 변경해 주세요.");
      if (args.textNodeIndex !== undefined) {
        const textNodeIndex = args.textNodeIndex;
        if (!Number.isSafeInteger(textNodeIndex) || Number(textNodeIndex) < 0 || typeof value !== "string" || value.length > 4000) throw new Error("본문 텍스트 변경 인수가 올바르지 않습니다.");
        const element = await runDom(target, { action: "readText", selector, textNodeIndex: Number(textNodeIndex) }, signal);
        const previousText = String(element.text);
        const detail = `${target.url}\n${selector}\n${element.tag} ${element.label || ""}\n텍스트 노드: ${textNodeIndex}\n기존 텍스트: ${JSON.stringify(previousText)}\n새 텍스트: ${JSON.stringify(value)}`;
        if (!await approve("페이지 본문 텍스트 변경", detail, signal)) return JSON.stringify({ approved: false, selector, textNodeIndex });
        return JSON.stringify(await runDom(target, { action: "writeText", selector, textNodeIndex: Number(textNodeIndex), value, expectedText: previousText, fingerprint: String(element.fingerprint) }, signal));
      }
      if (args.attribute !== undefined) {
        const attribute = parseAttribute(args.attribute);
        if ((typeof value !== "string" && value !== null) || (typeof value === "string" && value.length > 4000)) throw new Error("속성 값은 문자열 또는 제거를 뜻하는 null이어야 합니다.");
        const element = await runDom(target, { action: "readAttribute", selector, attribute }, signal);
        const previousValue = element.value as string | null;
        const detail = `${target.url}\n${selector}\n${element.tag} ${element.label || element.text || ""}\n속성: ${attribute}\n기존 값: ${JSON.stringify(previousValue)}\n새 값: ${JSON.stringify(value)}${value === null ? " (속성 제거)" : ""}`;
        if (!await approve("엘리먼트 속성 변경", detail, signal)) return JSON.stringify({ approved: false, selector, attribute });
        return JSON.stringify(await runDom(target, { action: "writeAttribute", selector, attribute, value, expectedAttributeValue: previousValue, fingerprint: String(element.fingerprint) }, signal));
      }
      if ((typeof value !== "string" && typeof value !== "boolean") || (typeof value === "string" && value.length > 4000)) throw new Error("쓸 값이 올바르지 않습니다.");
      const element = await runDom(target, { action: "describe", selector }, signal);
      const detail = `${target.url}\n${selector}\n${element.tag} ${element.label || element.text || ""}\n새 값: ${JSON.stringify(value)}`;
      if (!await approve("엘리먼트 값 변경", detail, signal)) return JSON.stringify({ approved: false, selector });
      return JSON.stringify(await runDom(target, { action: "write", selector, value, fingerprint: String(element.fingerprint) }, signal));
    },
  };
}

export function domClickTool(target: PageTarget, approve: DomApproval): AgentTool {
  return {
    definition: { type: "function", function: {
      name: "dom_click",
      description: "Click one visible DOM element selected by unique CSS selector. Confirmation follows the browser work setting. The page may change afterward.",
      parameters: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"], additionalProperties: false },
    } },
    execute: async (input, signal) => {
      const selector = parseSelector(parseArgs(input, ["selector"], ["selector"]).selector);
      const element = await runDom(target, { action: "describe", selector }, signal);
      if (!await approve("엘리먼트 클릭", `${target.url}\n${selector}\n${element.tag} ${element.label || element.text || ""}`, signal)) return JSON.stringify({ approved: false, selector });
      return JSON.stringify(await runDom(target, { action: "click", selector, fingerprint: String(element.fingerprint) }, signal));
    },
  };
}
