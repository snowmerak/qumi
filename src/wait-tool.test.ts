import assert from "node:assert/strict";
import test from "node:test";
import { waitTool } from "./wait-tool.ts";

test("wait accepts seconds and reports elapsed time", async () => {
  const result = JSON.parse(await waitTool.execute({ time: 0.01 }, new AbortController().signal));
  assert.equal(typeof result.elapsedSeconds, "number");
  assert.ok(result.elapsedSeconds >= 0.01);
});

test("wait rejects invalid or excessive durations", async () => {
  for (const args of [{ time: 0 }, { time: 121 }, { time: "1" }, { time: Number.NaN }, { time: 1, extra: true }, null]) {
    await assert.rejects(waitTool.execute(args, new AbortController().signal), /wait/);
  }
});

test("wait stops immediately when the request is cancelled", async () => {
  const controller = new AbortController();
  const started = performance.now();
  const pending = waitTool.execute({ time: 120 }, controller.signal);
  controller.abort(new Error("cancelled"));
  await assert.rejects(pending, /cancelled/);
  assert.ok(performance.now() - started < 1_000);
});
