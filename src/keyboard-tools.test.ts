import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { sendKeyTool, sendKeysTool } from "./keyboard-tools.ts";
import type { PageTarget } from "./page-context.ts";

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
const target: PageTarget = { tabId: 7, windowId: 2, url: "https://docs.google.com/document/d/example/edit", title: "Document" };

afterEach(() => {
  if (originalChrome) Object.defineProperty(globalThis, "chrome", originalChrome);
  else Reflect.deleteProperty(globalThis, "chrome");
});

function mockChrome(events: Array<{ action: string; value?: unknown }>, active = target, failCommand = 0): void {
  let commands = 0;
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: {
    tabs: { query: async () => [{ id: active.tabId, windowId: active.windowId, url: active.url, status: "complete" }] },
    debugger: {
      attach: async (debuggee: unknown) => { events.push({ action: "attach", value: debuggee }); },
      sendCommand: async (_debuggee: unknown, method: string, params: unknown) => {
        if (++commands === failCommand) throw new Error("dispatch failed");
        events.push({ action: method, value: params });
      },
      detach: async (debuggee: unknown) => { events.push({ action: "detach", value: debuggee }); },
    },
  } });
}

const signal = new AbortController().signal;

describe("send_key", () => {
  it("inserts Unicode text through the connected tab and detaches", async () => {
    const events: Array<{ action: string; value?: unknown }> = [];
    mockChrome(events);
    const tool = sendKeyTool(target, async () => true);
    assert.deepEqual(JSON.parse(await tool.execute({ text: "한글 문장" }, signal)), { dispatched: true, characters: 5 });
    assert.deepEqual(events, [
      { action: "attach", value: { tabId: 7 } },
      { action: "Input.insertText", value: { text: "한글 문장" } },
      { action: "detach", value: { tabId: 7 } },
    ]);
  });

  it("dispatches a shortcut with modifier down, key down and up, then modifier up", async () => {
    const events: Array<{ action: string; value?: unknown }> = [];
    mockChrome(events);
    const tool = sendKeyTool(target, async () => true);
    assert.deepEqual(JSON.parse(await tool.execute({ key: "a", modifiers: ["Control"] }, signal)), { dispatched: true, key: "a", modifiers: ["Control"] });
    assert.deepEqual(events.map((event) => event.action), ["attach", "Input.dispatchKeyEvent", "Input.dispatchKeyEvent", "Input.dispatchKeyEvent", "Input.dispatchKeyEvent", "detach"]);
    assert.deepEqual(events.slice(1, 5).map((event) => event.value), [
      { type: "rawKeyDown", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17, modifiers: 2 },
      { type: "rawKeyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 },
      { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 },
      { type: "keyUp", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17, modifiers: 0 },
    ]);
  });

  it("does not attach after denial, bad input, or a changed tab", async () => {
    const events: Array<{ action: string; value?: unknown }> = [];
    mockChrome(events);
    const denied = sendKeyTool(target, async () => false);
    assert.deepEqual(JSON.parse(await denied.execute({ key: "Enter" }, signal)), { approved: false });
    await assert.rejects(denied.execute({ key: "Unknown" }, signal), /지원하지 않는 키/);
    await assert.rejects(denied.execute({ key: "a", modifiers: ["Control", "Control"] }, signal), /중복 없이/);
    assert.deepEqual(events, []);
    mockChrome(events, { ...target, tabId: 8 });
    await assert.rejects(sendKeyTool(target, async () => true).execute({ text: "hello" }, signal), /페이지가 바뀌었습니다/);
    assert.deepEqual(events, []);
  });

  it("releases a held modifier and detaches if a key command fails", async () => {
    const events: Array<{ action: string; value?: unknown }> = [];
    mockChrome(events, target, 2);
    await assert.rejects(sendKeyTool(target, async () => true).execute({ key: "a", modifiers: ["Control"] }, signal), /dispatch failed/);
    assert.deepEqual(events.map((event) => event.action), ["attach", "Input.dispatchKeyEvent", "Input.dispatchKeyEvent", "Input.dispatchKeyEvent", "detach"]);
    assert.deepEqual(events[3].value, { type: "keyUp", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17, modifiers: 0 });
  });
});

describe("send_keys", () => {
  it("sends dependent inputs in order with one approval and debugger session", async () => {
    const events: Array<{ action: string; value?: unknown }> = [];
    mockChrome(events);
    let approvals = 0;
    const tool = sendKeysTool(target, async () => { approvals++; return true; });
    assert.deepEqual(JSON.parse(await tool.execute({ steps: [
      { key: "a", modifiers: ["Control"] },
      { text: "새 문장" },
      { key: "Enter" },
    ] }, signal)), { dispatched: true, steps: 3, characters: 4 });
    assert.equal(approvals, 1);
    assert.deepEqual(events.map((event) => event.action), [
      "attach", "Input.dispatchKeyEvent", "Input.dispatchKeyEvent", "Input.dispatchKeyEvent", "Input.dispatchKeyEvent",
      "Input.insertText", "Input.dispatchKeyEvent", "Input.dispatchKeyEvent", "detach",
    ]);
    assert.deepEqual(events[5].value, { text: "새 문장" });
    assert.equal((events[6].value as { key: string }).key, "Enter");
  });

  it("stops after the failing step and reports that earlier input may have applied", async () => {
    const events: Array<{ action: string; value?: unknown }> = [];
    mockChrome(events, target, 5);
    const tool = sendKeysTool(target, async () => true);
    await assert.rejects(tool.execute({ steps: [
      { key: "a", modifiers: ["Control"] },
      { text: "replacement" },
      { key: "Enter" },
    ] }, signal), /send_keys 2\/3단계 실패.*앞선 1단계/);
    assert.equal(events.some((event) => event.action === "Input.insertText"), false);
    assert.equal(events.some((event) => (event.value as { key?: string } | undefined)?.key === "Enter"), false);
    assert.equal(events.at(-1)?.action, "detach");
  });

  it("validates every step before approval and respects a denied sequence", async () => {
    const events: Array<{ action: string; value?: unknown }> = [];
    mockChrome(events);
    let approvals = 0;
    const tool = sendKeysTool(target, async () => { approvals++; return false; });
    await assert.rejects(tool.execute({ steps: [{ text: "valid" }, { key: "invalid" }] }, signal), /지원하지 않는 키/);
    await assert.rejects(tool.execute({ steps: [{ text: "a".repeat(8000) }, { text: "b".repeat(8000) }, { text: "c" }] }, signal), /16,000자/);
    assert.deepEqual(JSON.parse(await tool.execute({ steps: [{ key: "Enter" }] }, signal)), { approved: false, steps: 1 });
    assert.equal(approvals, 1);
    assert.deepEqual(events, []);
  });
});
