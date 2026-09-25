import type { AgentTool } from "./agent.ts";
import type { PageTarget } from "./page-context.ts";

type Approval = (title: string, detail: string, signal: AbortSignal) => Promise<boolean>;
type Modifier = "Control" | "Alt" | "Shift" | "Meta";
type Key = { key: string; code: string; keyCode: number; text?: string };
type KeyRequest = { key: Key; modifiers: Modifier[] } | { text: string };

const changedPage = "페이지가 바뀌었습니다. 새 페이지 연결을 확인한 뒤 다시 요청해 주세요.";
const modifierBits: Record<Modifier, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
const modifierCodes: Record<Modifier, Key> = {
  Alt: { key: "Alt", code: "AltLeft", keyCode: 18 },
  Control: { key: "Control", code: "ControlLeft", keyCode: 17 },
  Meta: { key: "Meta", code: "MetaLeft", keyCode: 91 },
  Shift: { key: "Shift", code: "ShiftLeft", keyCode: 16 },
};
const namedKeys: Record<string, Key> = {
  Enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  Delete: { key: "Delete", code: "Delete", keyCode: 46 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  Home: { key: "Home", code: "Home", keyCode: 36 },
  End: { key: "End", code: "End", keyCode: 35 },
  PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  Space: { key: " ", code: "Space", keyCode: 32, text: " " },
};

function parseKey(value: unknown): Key {
  if (typeof value !== "string") throw new Error("지원하지 않는 키입니다.");
  if (namedKeys[value]) return namedKeys[value];
  if (/^[a-z]$/i.test(value)) {
    const letter = value.toUpperCase();
    return { key: value, code: `Key${letter}`, keyCode: letter.charCodeAt(0), text: value };
  }
  if (/^[0-9]$/.test(value)) return { key: value, code: `Digit${value}`, keyCode: value.charCodeAt(0), text: value };
  throw new Error("지원하지 않는 키입니다. 문자 한 개 또는 Enter, Tab, 방향키 같은 키 이름을 사용해 주세요.");
}

function parseRequest(value: unknown): KeyRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("send_key 인수가 올바르지 않습니다.");
  const args = value as Record<string, unknown>;
  if (Object.keys(args).some((name) => !["key", "modifiers", "text"].includes(name))) throw new Error("지원하지 않는 send_key 인수입니다.");
  if (typeof args.text === "string" && args.key === undefined && args.modifiers === undefined) {
    if (!args.text.length || args.text.length > 8000) throw new Error("입력할 텍스트는 1~8000자여야 합니다.");
    return { text: args.text };
  }
  if (args.text !== undefined || args.key === undefined) throw new Error("key 또는 text 중 하나만 지정해 주세요.");
  const key = parseKey(args.key);
  const modifiers = args.modifiers ?? [];
  if (!Array.isArray(modifiers) || modifiers.some((item) => typeof item !== "string" || !Object.hasOwn(modifierBits, item)) || new Set(modifiers).size !== modifiers.length) {
    throw new Error("modifiers에는 Control, Alt, Shift, Meta를 중복 없이 지정해 주세요.");
  }
  return { key, modifiers: modifiers as Modifier[] };
}

async function assertCurrentTarget(target: PageTarget): Promise<void> {
  const [active] = await chrome.tabs.query({ active: true, windowId: target.windowId });
  if (!active || active.id !== target.tabId || active.url !== target.url || active.status === "loading") throw new Error(changedPage);
}

async function dispatchKey(target: chrome.debugger.Debuggee, type: "rawKeyDown" | "keyDown" | "keyUp", key: Key, modifiers: number, text?: string): Promise<void> {
  await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
    type, key: key.key, code: key.code,
    windowsVirtualKeyCode: key.keyCode, nativeVirtualKeyCode: key.keyCode,
    modifiers,
    ...(text ? { text, unmodifiedText: key.text ?? text } : {}),
  });
}

async function dispatchRequest(debuggee: chrome.debugger.Debuggee, request: KeyRequest, signal: AbortSignal): Promise<void> {
  if ("text" in request) {
    await chrome.debugger.sendCommand(debuggee, "Input.insertText", { text: request.text });
    return;
  }
  const held: Key[] = [];
  let modifiers = 0;
  try {
    for (const modifier of request.modifiers) {
      signal.throwIfAborted();
      const key = modifierCodes[modifier];
      modifiers |= modifierBits[modifier];
      held.push(key);
      await dispatchKey(debuggee, "rawKeyDown", key, modifiers);
    }
    signal.throwIfAborted();
    const hasCommandModifier = !!(modifiers & (modifierBits.Control | modifierBits.Alt | modifierBits.Meta));
    const shiftedLetter = !!(modifiers & modifierBits.Shift) && /^[a-z]$/i.test(request.key.key);
    const key = shiftedLetter ? { ...request.key, key: request.key.key.toUpperCase() } : request.key;
    const text = hasCommandModifier ? undefined : shiftedLetter ? key.key : key.text;
    held.push(key);
    await dispatchKey(debuggee, text ? "keyDown" : "rawKeyDown", key, modifiers, text);
    await dispatchKey(debuggee, "keyUp", key, modifiers);
    held.pop();
  } finally {
    // A failed command must not leave a modifier pressed in the target tab.
    for (const key of held.reverse()) {
      if (key === modifierCodes.Alt) modifiers &= ~modifierBits.Alt;
      else if (key === modifierCodes.Control) modifiers &= ~modifierBits.Control;
      else if (key === modifierCodes.Meta) modifiers &= ~modifierBits.Meta;
      else if (key === modifierCodes.Shift) modifiers &= ~modifierBits.Shift;
      try { await dispatchKey(debuggee, "keyUp", key, modifiers); } catch { /* The tab or debugger may have closed. */ }
    }
  }
}

async function sendInputs(target: PageTarget, requests: KeyRequest[], signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await assertCurrentTarget(target);
  if (!chrome.debugger?.attach || !chrome.debugger?.sendCommand) throw new Error("이 브라우저에서 키 입력 도구를 사용할 수 없습니다.");
  const debuggee = { tabId: target.tabId };
  await chrome.debugger.attach(debuggee, "0.1");
  let completed = 0;
  try {
    for (const request of requests) {
      try {
        signal.throwIfAborted();
        await assertCurrentTarget(target);
        await dispatchRequest(debuggee, request, signal);
        completed++;
      } catch (error) {
        if (requests.length === 1) throw error;
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`send_keys ${completed + 1}/${requests.length}단계 실패. 앞선 ${completed}단계가 전달되었고 현재 단계도 일부 실행됐을 수 있습니다: ${reason}`);
      }
    }
  } finally {
    try { await chrome.debugger.detach(debuggee); } catch { /* The browser may have already detached. */ }
  }
}

function requestDetail(request: KeyRequest): string {
  return "text" in request ? `텍스트 ${request.text.length}자: ${JSON.stringify(request.text)}` : `키: ${[...request.modifiers, request.key.key].join("+")}`;
}

const keyParameters = {
  type: "object",
  properties: {
    key: { type: "string", description: "One letter or digit, or Enter, Tab, Escape, Backspace, Delete, ArrowLeft/Up/Right/Down, Home, End, PageUp, PageDown, Space" },
    modifiers: { type: "array", items: { type: "string", enum: ["Control", "Alt", "Shift", "Meta"] } },
    text: { type: "string", description: "Plain Unicode text to insert instead of a key press, up to 8000 characters" },
  },
  additionalProperties: false,
} as const;

export function sendKeyTool(target: PageTarget, approve: Approval): AgentTool {
  return {
    definition: { type: "function", function: {
      name: "send_key",
      description: "Dispatch a browser key press or plain text to the focused element in the connected tab. Use {key:'a',modifiers:['Control']} for Ctrl+A, {key:'Enter'} for Enter, or {text:'...'} for Unicode text. Focus the intended editor first. This dispatches input but does not prove that the application saved it. Confirmation follows the browser work setting.",
      parameters: keyParameters,
    } },
    execute: async (value, signal) => {
      const request = parseRequest(value);
      signal.throwIfAborted();
      await assertCurrentTarget(target);
      if (!await approve("페이지에 키 입력", `${target.url}\n${requestDetail(request)}`, signal)) return JSON.stringify({ approved: false });
      await sendInputs(target, [request], signal);
      return JSON.stringify({ dispatched: true, ...("text" in request ? { characters: request.text.length } : { key: request.key.key, modifiers: request.modifiers }) });
    },
  };
}

export function sendKeysTool(target: PageTarget, approve: Approval): AgentTool {
  return {
    definition: { type: "function", function: {
      name: "send_keys",
      description: "Dispatch a sequence of key presses and text insertions to the focused element of the connected tab, in array order. Use one call for several dependent keystrokes, such as Ctrl+A, replacement text, then Enter. The whole sequence uses one browser confirmation and debugger session. Stop at the first failure; earlier steps may already have applied. Verify the application result before claiming success.",
      parameters: { type: "object", properties: {
        steps: { type: "array", minItems: 1, maxItems: 30, items: keyParameters },
      }, required: ["steps"], additionalProperties: false },
    } },
    execute: async (value, signal) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("send_keys 인수가 올바르지 않습니다.");
      const args = value as Record<string, unknown>;
      if (Object.keys(args).some((name) => name !== "steps") || !Array.isArray(args.steps) || args.steps.length < 1 || args.steps.length > 30) {
        throw new Error("send_keys에는 1~30개의 steps가 필요합니다.");
      }
      const requests = args.steps.map(parseRequest);
      const textLength = requests.reduce((total, request) => total + ("text" in request ? request.text.length : 0), 0);
      if (textLength > 16_000) throw new Error("한 번에 입력할 텍스트는 총 16,000자 이하여야 합니다.");
      signal.throwIfAborted();
      await assertCurrentTarget(target);
      const detail = requests.map((request, index) => `${index + 1}. ${requestDetail(request)}`).join("\n");
      if (!await approve("페이지에 연속 키 입력", `${target.url}\n${detail}`, signal)) return JSON.stringify({ approved: false, steps: requests.length });
      await sendInputs(target, requests, signal);
      return JSON.stringify({ dispatched: true, steps: requests.length, characters: textLength });
    },
  };
}
