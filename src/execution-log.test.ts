import { it } from "node:test";
import assert from "node:assert/strict";
import { clearExecutionLog, createExecutionLog, readExecutionLog } from "./execution-log.ts";

it("persists bounded execution events separately from conversation content", async () => {
  const previousChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  let stored: Record<string, unknown> = {};
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: {
    storage: { local: {
      get: async () => stored,
      set: async (value: Record<string, unknown>) => { stored = { ...stored, ...value }; },
    } },
  } });
  try {
    const logger = createExecutionLog("codex/test", true, "changes");
    logger.record({ event: "turn_started", availableTools: 8 });
    logger.record({ event: "model_requested", round: 1 });
    logger.record({ event: "tool_completed", round: 1, tool: "dom_read", argumentKeys: ["selector"], outcome: "ok", durationMs: 12 });
    logger.record({ event: "turn_failed", round: 1, stage: "model", reason: "request_failed" });
    await logger.finish();
    const events = await readExecutionLog();
    assert.deepEqual(events.map((event) => event.event), ["turn_started", "model_requested", "tool_completed", "turn_failed"]);
    assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3, 4]);
    assert.ok(events.every((event) => event.turnId === logger.turnId && event.model === "codex/test"));
    assert.equal(JSON.stringify(events).includes("API key"), false);

    const longRun = createExecutionLog("codex/test", false, "none");
    for (let index = 0; index < 10_005; index++) longRun.record({ event: "model_requested", round: index + 1 });
    await longRun.finish();
    const retained = await readExecutionLog();
    assert.equal(retained.length, 10_000);
    assert.equal(retained[0].sequence, 6);
    await clearExecutionLog();
    assert.deepEqual(await readExecutionLog(), []);
  } finally {
    if (previousChrome) Object.defineProperty(globalThis, "chrome", previousChrome);
    else Reflect.deleteProperty(globalThis, "chrome");
  }
});
