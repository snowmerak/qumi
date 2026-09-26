import { afterEach, it } from "node:test";
import assert from "node:assert/strict";
import { captureScreenshotTool, mouseTools, type ScreenshotFrame } from "./visual-tools.ts";
import type { PageTarget } from "./page-context.ts";

const target: PageTarget = { tabId: 7, windowId: 2, url: "https://example.com/", title: "Example" };
const originalChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");

afterEach(() => {
  if (originalChrome) Object.defineProperty(globalThis, "chrome", originalChrome);
  else Reflect.deleteProperty(globalThis, "chrome");
});

function pngHeader(width: number, height: number): string {
  const header = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
  header.write("IHDR", 12);
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header.toString("base64");
}

function fixture() {
  const commands: Array<{ method: string; params: Record<string, unknown> }> = [];
  let attached = 0;
  let detached = 0;
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: {
    tabs: { query: async () => [{ id: target.tabId, url: target.url, status: "complete" }] },
    debugger: {
      attach: async () => { attached++; },
      detach: async () => { detached++; },
      sendCommand: async (_debuggee: unknown, method: string, params: Record<string, unknown> = {}) => {
        commands.push({ method, params });
        if (method === "Page.getLayoutMetrics") return { cssVisualViewport: { clientWidth: 100, clientHeight: 50 } };
        if (method === "Page.captureScreenshot") return { data: pngHeader(200, 100) };
        return {};
      },
    },
  } });
  return { commands, counts: () => ({ attached, detached }) };
}

it("captures a viewport image and maps screenshot pixels to CSS mouse coordinates", async () => {
  const { commands, counts } = fixture();
  let frame: ScreenshotFrame | null = null;
  const screenshot = captureScreenshotTool(target, (value) => { frame = value; });
  const result = await screenshot.execute({}, new AbortController().signal);
  assert.match(result, /200 × 100/);
  assert.equal(screenshot.takeImage?.()?.imageDataUrl, `data:image/png;base64,${pngHeader(200, 100)}`);
  assert.equal(screenshot.takeImage?.(), null);
  assert.deepEqual(frame, { tabId: 7, url: target.url, imageWidth: 200, imageHeight: 100, viewportWidth: 100, viewportHeight: 50 });

  const tools = mouseTools(target, () => frame, () => { frame = null; }, async () => true);
  const tool = (name: string) => {
    const found = tools.find((item) => item.definition.function.name === name);
    assert.ok(found);
    return found;
  };
  await tool("mouse_move").execute({ x: 80, y: 40 }, new AbortController().signal);
  await tool("mouse_click").execute({ x: 80, y: 40 }, new AbortController().signal);
  assert.deepEqual(commands.filter((item) => item.method === "Input.dispatchMouseEvent").map((item) => ({ type: item.params.type, x: item.params.x, y: item.params.y })), [
    { type: "mouseMoved", x: 40, y: 20 },
    { type: "mouseMoved", x: 40, y: 20 },
    { type: "mousePressed", x: 40, y: 20 },
    { type: "mouseReleased", x: 40, y: 20 },
  ]);
  assert.equal(frame, null);
  await assert.rejects(tool("mouse_click").execute({ x: 80, y: 40 }, new AbortController().signal), /capture_screenshot/);
  assert.deepEqual(counts(), { attached: 3, detached: 3 });
});

it("dispatches drag and wheel input, rejecting coordinates outside the screenshot", async () => {
  const { commands } = fixture();
  const frame: ScreenshotFrame = { tabId: 7, url: target.url, imageWidth: 200, imageHeight: 100, viewportWidth: 100, viewportHeight: 50 };
  let current: ScreenshotFrame | null = frame;
  const tools = mouseTools(target, () => current, () => { current = null; }, async () => true);
  const drag = tools.find((item) => item.definition.function.name === "mouse_drag")!;
  await assert.rejects(drag.execute({ fromX: 10, fromY: 10, toX: 200, toY: 20 }, new AbortController().signal), /범위 밖/);
  assert.equal(commands.length, 0);
  await drag.execute({ fromX: 20, fromY: 20, toX: 100, toY: 60 }, new AbortController().signal);
  const events = commands.filter((item) => item.method === "Input.dispatchMouseEvent");
  assert.equal(events.length, 11);
  assert.equal(events[1].params.type, "mousePressed");
  assert.deepEqual([events.at(-1)?.params.type, events.at(-1)?.params.x, events.at(-1)?.params.y], ["mouseReleased", 50, 30]);
  current = frame;
  await tools.find((item) => item.definition.function.name === "mouse_scroll")!.execute({ x: 100, y: 50, deltaY: 500 }, new AbortController().signal);
  assert.deepEqual(commands.at(-1), { method: "Input.dispatchMouseEvent", params: { type: "mouseWheel", x: 50, y: 25, deltaX: 0, deltaY: 500 } });
});
