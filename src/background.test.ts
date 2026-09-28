import { it } from "node:test";
import assert from "node:assert/strict";
import { addJob, alarmName, createJob, loadJob, saveJob } from "./jobs.ts";
import { addSession, loadSession, newSession } from "./sessions.ts";
import { emptyState, saveState } from "./storage.ts";

it("runs a due alarm in the background and persists its answer in a job session", async () => {
  const oldChrome = globalThis.chrome;
  const oldFetch = globalThis.fetch;
  const values = new Map<string, unknown>();
  const alarms = new Map<string, { name: string; scheduledTime: number }>();
  let onAlarm: ((alarm: { name: string }) => void) | undefined;
  globalThis.chrome = {
    storage: { local: {
      get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, values.get(key)])),
      set: async (items: Record<string, unknown>) => { for (const [key, value] of Object.entries(items)) values.set(key, value); },
      remove: async (key: string) => { values.delete(key); },
    } },
    alarms: {
      create: async (name: string, info: { when: number }) => { alarms.set(name, { name, scheduledTime: info.when }); },
      get: async (name: string) => alarms.get(name),
      clear: async (name: string) => alarms.delete(name),
      onAlarm: { addListener: (listener: typeof onAlarm) => { onAlarm = listener; } },
    },
    sidePanel: { setPanelBehavior: async () => {} },
    runtime: { onStartup: { addListener: () => {} }, onInstalled: { addListener: () => {} }, getPlatformInfo: async () => ({}) },
    tabs: { query: async () => [] },
  } as unknown as typeof chrome;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Scheduled answer" } }], usage: { prompt_tokens: 20 } }), { headers: { "Content-Type": "application/json" } });
  try {
    const settings = { ...emptyState.settings, baseUrl: "http://127.0.0.1:8080/v1", model: "test/model" };
    await saveState({ ...emptyState, settings });
    const session = newSession(settings, "job", "Daily check", 16_000);
    await addSession(session);
    const job = createJob(session.id, "Daily check", "Check status", { type: "once", at: Date.now() + 60_000 });
    await addJob(job);
    await import("./background.ts");
    assert.ok(onAlarm);
    await saveJob({ ...job, nextRunAt: Date.now() - 1 });
    onAlarm({ name: alarmName(job.id) });
    let finished = await loadJob(job.id);
    for (let attempt = 0; attempt < 100 && finished?.status !== "completed"; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      finished = await loadJob(job.id);
    }
    assert.equal(finished?.status, "completed", finished?.error ?? "Job did not complete");
    const persisted = await loadSession(session.id);
    assert.deepEqual(persisted?.messages.map((message) => message.content), ["Check status", "Scheduled answer"]);
    assert.ok(persisted?.agent.context.some((message) => message.content === "Scheduled answer"));
  } finally {
    globalThis.chrome = oldChrome;
    globalThis.fetch = oldFetch;
  }
});
