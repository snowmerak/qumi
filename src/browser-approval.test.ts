import { it } from "node:test";
import assert from "node:assert/strict";
import { approvalPolicyFrom, requiresBrowserApproval, withReadApproval } from "./browser-approval.ts";
import { loadState, saveState } from "./storage.ts";
import type { AgentTool } from "./agent.ts";
import type { PageTarget } from "./page-context.ts";

const target: PageTarget = { tabId: 1, windowId: 1, url: "https://example.com/", title: "Example" };

it("applies all, changes-only, and no-confirmation browser policies", async () => {
  assert.equal(approvalPolicyFrom(undefined), "changes");
  assert.equal(approvalPolicyFrom("invalid"), "changes");
  assert.deepEqual(["all", "changes", "none"].map((policy) => [
    requiresBrowserApproval(approvalPolicyFrom(policy), "read"),
    requiresBrowserApproval(approvalPolicyFrom(policy), "change"),
  ]), [[true, true], [false, true], [false, false]]);

  let reads = 0;
  let prompts = 0;
  const tool: AgentTool = {
    definition: { type: "function", function: { name: "dom_read", description: "Read", parameters: { type: "object" } } },
    execute: async () => { reads++; return "page"; },
  };
  const signal = new AbortController().signal;
  const denied = withReadApproval(tool, target, "all", async (title, detail) => {
    prompts++;
    assert.equal(title, "브라우저 정보 읽기");
    assert.match(detail, /https:\/\/example\.com/);
    assert.match(detail, /dom_read/);
    return false;
  });
  assert.match(await denied.execute({ selector: "p" }, signal), /"approved":false/);
  assert.equal(reads, 0);
  assert.equal(prompts, 1);

  const approved = withReadApproval(tool, target, "all", async () => true);
  assert.equal(await approved.execute({ selector: "p" }, signal), "page");
  for (const policy of ["changes", "none"] as const) {
    assert.equal(await withReadApproval(tool, target, policy, async () => { throw new Error("unexpected prompt"); }).execute({}, signal), "page");
  }
  assert.equal(reads, 3);
});

it("keeps the old confirmation behavior and persists an updated choice", async () => {
  const previousChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  let saved: Record<string, unknown> = { qumiState: { settings: { baseUrl: "http://127.0.0.1:1234/v1", apiKey: "", model: "test" } } };
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: {
    storage: { local: {
      get: async () => saved,
      set: async (value: Record<string, unknown>) => { saved = value; },
    } },
  } });
  try {
    const state = await loadState();
    assert.equal(state.settings.approvalPolicy, "changes");
    await saveState({ ...state, settings: { ...state.settings, approvalPolicy: "none" } });
    assert.equal((await loadState()).settings.approvalPolicy, "none");
  } finally {
    if (previousChrome) Object.defineProperty(globalThis, "chrome", previousChrome);
    else Reflect.deleteProperty(globalThis, "chrome");
  }
});
