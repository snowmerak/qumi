import type { AgentTool } from "./agent.ts";
import type { ApprovalPrompt } from "./browser-approval.ts";
import type { PageTarget } from "./page-context.ts";

export interface ScreenshotFrame {
  tabId: number;
  url: string;
  imageWidth: number;
  imageHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

const pageChanged = "페이지가 바뀌었습니다. 새 스크린샷을 찍은 뒤 다시 요청해 주세요.";

async function assertCurrentTarget(target: PageTarget): Promise<void> {
  const [active] = await chrome.tabs.query({ active: true, windowId: target.windowId });
  if (!active || active.id !== target.tabId || active.url !== target.url || active.status === "loading") throw new Error(pageChanged);
}

async function withDebugger<T>(target: PageTarget, signal: AbortSignal, run: (debuggee: chrome.debugger.Debuggee) => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  await assertCurrentTarget(target);
  if (!chrome.debugger?.attach || !chrome.debugger?.sendCommand) throw new Error("이 브라우저에서 화면 조작 도구를 사용할 수 없습니다.");
  const debuggee = { tabId: target.tabId };
  await chrome.debugger.attach(debuggee, "0.1");
  try {
    signal.throwIfAborted();
    await assertCurrentTarget(target);
    return await run(debuggee);
  } finally {
    try { await chrome.debugger.detach(debuggee); } catch { /* The tab may have closed. */ }
  }
}

function pngSize(data: string): { width: number; height: number } {
  const header = atob(data.slice(0, 44));
  if (!header.startsWith("\x89PNG\r\n\x1a\n") || header.slice(12, 16) !== "IHDR") throw new Error("스크린샷 PNG 형식이 올바르지 않습니다.");
  const integer = (offset: number) => (((header.charCodeAt(offset) << 24) >>> 0) + (header.charCodeAt(offset + 1) << 16) + (header.charCodeAt(offset + 2) << 8) + header.charCodeAt(offset + 3)) >>> 0;
  return { width: integer(16), height: integer(20) };
}

function emptyArgs(value: unknown, name: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length) throw new Error(`${name}에는 인수가 필요하지 않습니다.`);
}

function coordinates(value: unknown, keys: string[]): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("마우스 좌표가 올바르지 않습니다.");
  const args = value as Record<string, unknown>;
  if (Object.keys(args).length !== keys.length || Object.keys(args).some((key) => !keys.includes(key))) throw new Error("마우스 도구 인수가 올바르지 않습니다.");
  for (const key of keys) if (typeof args[key] !== "number" || !Number.isFinite(args[key])) throw new Error(`${key} 좌표가 올바르지 않습니다.`);
  return args as Record<string, number>;
}

function viewportPoint(frame: ScreenshotFrame, x: number, y: number): { x: number; y: number } {
  if (x < 0 || y < 0 || x >= frame.imageWidth || y >= frame.imageHeight) throw new Error("마우스 좌표가 스크린샷 범위 밖입니다.");
  return { x: x * frame.viewportWidth / frame.imageWidth, y: y * frame.viewportHeight / frame.imageHeight };
}

async function mouseEvent(debuggee: chrome.debugger.Debuggee, type: string, point: { x: number; y: number }, pressed = false): Promise<void> {
  await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
    type, x: point.x, y: point.y, button: pressed || type === "mouseReleased" ? "left" : "none", buttons: pressed ? 1 : 0,
    ...(type === "mousePressed" || type === "mouseReleased" ? { clickCount: 1 } : {}),
  });
}

function currentFrame(target: PageTarget, getFrame: () => ScreenshotFrame | null): ScreenshotFrame {
  const frame = getFrame();
  if (!frame || frame.tabId !== target.tabId || frame.url !== target.url) throw new Error("먼저 capture_screenshot으로 현재 페이지를 찍어 주세요.");
  return frame;
}

export function captureScreenshotTool(target: PageTarget, setFrame: (frame: ScreenshotFrame) => void): AgentTool {
  let pendingImage: { text: string; imageDataUrl: string } | null = null;
  return {
    definition: { type: "function", function: {
      name: "capture_screenshot",
      description: "Capture the visible viewport of the connected browser tab. The image is sent to the vision model in the next message; the tool result gives image pixel dimensions. Use those image pixel coordinates for mouse tools. Capture again after clicks, drags, or scrolling.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    } },
    execute: async (args, signal) => {
      pendingImage = null;
      emptyArgs(args, "capture_screenshot");
      const captured = await withDebugger(target, signal, async (debuggee) => {
        const layout = await chrome.debugger.sendCommand(debuggee, "Page.getLayoutMetrics") as { cssVisualViewport?: { clientWidth: number; clientHeight: number } };
        const viewportWidth = layout.cssVisualViewport?.clientWidth;
        const viewportHeight = layout.cssVisualViewport?.clientHeight;
        if (!viewportWidth || !viewportHeight) throw new Error("페이지 화면 크기를 확인하지 못했습니다.");
        const screenshot = await chrome.debugger.sendCommand(debuggee, "Page.captureScreenshot", { format: "png", captureBeyondViewport: false }) as { data?: string };
        if (!screenshot.data || screenshot.data.length > 8_000_000) throw new Error("스크린샷이 너무 크거나 비어 있습니다.");
        const size = pngSize(screenshot.data);
        if (!size.width || !size.height) throw new Error("스크린샷 크기가 올바르지 않습니다.");
        return { data: screenshot.data, viewportWidth, viewportHeight, ...size };
      });
      signal.throwIfAborted();
      await assertCurrentTarget(target);
      setFrame({ tabId: target.tabId, url: target.url, imageWidth: captured.width, imageHeight: captured.height, viewportWidth: captured.viewportWidth, viewportHeight: captured.viewportHeight });
      const text = `Screenshot of ${target.url}. Image size: ${captured.width} × ${captured.height} pixels. Mouse tools take coordinates in these image pixels.`;
      pendingImage = { text, imageDataUrl: `data:image/png;base64,${captured.data}` };
      return text;
    },
    takeImage: () => { const image = pendingImage; pendingImage = null; return image; },
  };
}

export function mouseTools(target: PageTarget, getFrame: () => ScreenshotFrame | null, clearFrame: () => void, approve: ApprovalPrompt): AgentTool[] {
  const execute = async (name: string, args: unknown, keys: string[], signal: AbortSignal, run: (debuggee: chrome.debugger.Debuggee, frame: ScreenshotFrame, values: Record<string, number>) => Promise<void>, invalidates = false): Promise<string> => {
    const values = coordinates(args, keys);
    const frame = currentFrame(target, getFrame);
    for (const index of [0, 2]) {
      const x = values[keys[index]];
      const y = values[keys[index + 1]];
      if (x !== undefined && y !== undefined) viewportPoint(frame, x, y);
    }
    if (name === "mouse_scroll" && (Math.abs(values.deltaY) > 2_000 || values.deltaY === 0)) throw new Error("스크롤 크기는 0이 아닌 ±2,000 이하여야 합니다.");
    signal.throwIfAborted();
    await assertCurrentTarget(target);
    if (!await approve("페이지 마우스 조작", `${target.url}\n${name}: ${JSON.stringify(values)}`, signal)) return JSON.stringify({ approved: false, tool: name });
    try {
      await withDebugger(target, signal, (debuggee) => run(debuggee, frame, values));
    } finally {
      if (invalidates) clearFrame();
    }
    return JSON.stringify({ dispatched: true, tool: name, ...values });
  };

  const pointProperties = { x: { type: "number" }, y: { type: "number" } };
  const tool = (
    name: string,
    description: string,
    properties: Record<string, { type: string }>,
    required: string[],
    run: (debuggee: chrome.debugger.Debuggee, frame: ScreenshotFrame, values: Record<string, number>, signal: AbortSignal) => Promise<void>,
    invalidates = false,
  ): AgentTool => ({
    definition: { type: "function", function: {
      name, description,
      parameters: { type: "object", properties, required, additionalProperties: false },
    } },
    execute: (args, signal) => execute(name, args, required, signal, (debuggee, frame, values) => run(debuggee, frame, values, signal), invalidates),
  });

  return [
    tool("mouse_move", "Move the page pointer to image pixel coordinates from the latest capture_screenshot, triggering hover. Does not move the operating system cursor.", pointProperties, ["x", "y"], async (debuggee, frame, values) => {
      await mouseEvent(debuggee, "mouseMoved", viewportPoint(frame, values.x, values.y));
    }),
    tool("mouse_click", "Left click image pixel coordinates from the latest capture_screenshot. Capture again before further coordinate actions.", pointProperties, ["x", "y"], async (debuggee, frame, values) => {
      const point = viewportPoint(frame, values.x, values.y);
      await mouseEvent(debuggee, "mouseMoved", point);
      await mouseEvent(debuggee, "mousePressed", point, true);
      try { await mouseEvent(debuggee, "mouseReleased", point); }
      catch (error) {
        try { await mouseEvent(debuggee, "mouseReleased", point); } catch { /* The tab may have closed. */ }
        throw error;
      }
    }, true),
    tool("mouse_drag", "Drag from one image pixel point to another with the left button. Capture again afterward.", {
      fromX: { type: "number" }, fromY: { type: "number" }, toX: { type: "number" }, toY: { type: "number" },
    }, ["fromX", "fromY", "toX", "toY"], async (debuggee, frame, values, signal) => {
      const start = viewportPoint(frame, values.fromX, values.fromY);
      const end = viewportPoint(frame, values.toX, values.toY);
      await mouseEvent(debuggee, "mouseMoved", start);
      await mouseEvent(debuggee, "mousePressed", start, true);
      try {
        for (let step = 1; step <= 8; step++) {
          signal.throwIfAborted();
          await mouseEvent(debuggee, "mouseMoved", {
            x: start.x + (end.x - start.x) * step / 8,
            y: start.y + (end.y - start.y) * step / 8,
          }, true);
        }
      } finally {
        await mouseEvent(debuggee, "mouseReleased", end);
      }
    }, true),
    tool("mouse_scroll", "Scroll the page at image pixel coordinates with a wheel deltaY; positive scrolls down. Capture again afterward to see newly loaded content.", {
      ...pointProperties, deltaY: { type: "number" },
    }, ["x", "y", "deltaY"], async (debuggee, frame, values) => {
      const point = viewportPoint(frame, values.x, values.y);
      await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
        type: "mouseWheel", x: point.x, y: point.y, deltaX: 0, deltaY: values.deltaY,
      });
    }, true),
  ];
}
