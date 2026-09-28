import { it } from "node:test";
import assert from "node:assert/strict";
import { emptyAgentState } from "./agent.ts";
import { loadSessions, newSession, addSession, saveSession, setActiveSession } from "./sessions.ts";
import { emptyState } from "./storage.ts";

it("migrates the existing conversation once and restores multiple sessions", async () => {
  const oldChrome = globalThis.chrome;
  const values = new Map<string, unknown>();
  globalThis.chrome = { storage: { local: {
    get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, values.get(key)])),
    set: async (items: Record<string, unknown>) => { for (const [key, value] of Object.entries(items)) values.set(key, value); },
  } } } as unknown as typeof chrome;
  try {
    const legacy = { ...emptyState, messages: [{ role: "user" as const, content: "Old request" }], agent: emptyAgentState() };
    const migrated = await loadSessions(legacy);
    assert.equal(migrated.sessions[0].messages[0].content, "Old request");
    const second = newSession(legacy.settings);
    second.messages = [{ role: "user", content: "New request" }];
    await addSession(second);
    await setActiveSession(second.id);
    await saveSession({ ...second, title: "New request" });
    const restored = await loadSessions(legacy);
    assert.equal(restored.activeId, second.id);
    assert.equal(restored.sessions.length, 2);
    assert.equal(restored.sessions[0].messages[0].content, "Old request");
    assert.equal(restored.sessions[1].title, "New request");
  } finally { globalThis.chrome = oldChrome; }
});
