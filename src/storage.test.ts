import { it } from "node:test";
import assert from "node:assert/strict";
import { emptyState, loadState, saveMcpServers, saveState } from "./storage.ts";

it("keeps MCP registrations across reload even when the main settings snapshot is stale", async () => {
  const oldChrome = globalThis.chrome;
  const values = new Map<string, unknown>();
  globalThis.chrome = {
    storage: { local: {
      get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, values.get(key)])),
      set: async (items: Record<string, unknown>) => { for (const [key, value] of Object.entries(items)) values.set(key, value); },
    } },
  } as unknown as typeof chrome;
  try {
    const oldServer = { id: "old", url: "https://old.example/mcp", headers: {} };
    const newServer = { id: "notion", url: "https://mcp.notion.com/mcp", headers: {}, auth: { type: "oauth" as const } };
    const oldState = { ...emptyState, settings: { ...emptyState.settings, mcpServers: [oldServer] } };
    values.set("qumiState", oldState);
    assert.deepEqual((await loadState()).settings.mcpServers, [oldServer]);

    await saveMcpServers([newServer]);
    await saveState(oldState);
    assert.deepEqual((await loadState()).settings.mcpServers, [newServer]);

    values.delete("qumiState");
    assert.deepEqual((await loadState()).settings.mcpServers, [newServer]);

    await saveMcpServers([]);
    assert.deepEqual((await loadState()).settings.mcpServers, []);
  } finally {
    globalThis.chrome = oldChrome;
  }
});
