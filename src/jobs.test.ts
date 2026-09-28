import { it } from "node:test";
import assert from "node:assert/strict";
import { createJob, nextRunAt, upsertJob } from "./jobs.ts";

it("schedules one-time jobs only in the future", () => {
  const now = Date.now();
  assert.equal(nextRunAt({ type: "once", at: now + 60_000 }, now), now + 60_000);
  assert.equal(nextRunAt({ type: "once", at: now }, now), null);
  assert.throws(() => createJob("session", "title", "prompt", { type: "once", at: now - 1 }), /미래/);
});

it("repeats at a local wall-clock time instead of drifting by elapsed hours", () => {
  const after = new Date(2026, 8, 28, 9, 30).getTime();
  const daily = nextRunAt({ type: "daily", hour: 9, minute: 0 }, after)!;
  assert.equal(new Date(daily).getDate(), 29);
  assert.equal(new Date(daily).getHours(), 9);
  const weekly = nextRunAt({ type: "weekly", day: 1, hour: 9, minute: 0 }, after)!;
  assert.equal(new Date(weekly).getDay(), 1);
  assert.equal(new Date(weekly).getDate(), 5);
});

it("keeps one visible entry when storage refresh and local creation return the same job", () => {
  const job = createJob("session", "title", "prompt", { type: "once", at: Date.now() + 60_000 });
  const updated = { ...job, status: "paused" as const };
  const jobs = upsertJob([job, job], updated);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0], updated);
});
