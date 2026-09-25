import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { completeChat, listModels, normalizeGatewayUrl, type GatewaySettings } from "./gateway.ts";

const settings: GatewaySettings = {
  baseUrl: "http://127.0.0.1:53124/v1",
  apiKey: "test-key",
  model: "provider/model",
};
const originalFetch = globalThis.fetch;

afterEach(() => { globalThis.fetch = originalFetch; });

describe("Q Gateway client", () => {
  it("accepts the local address printed by q gateway and normalizes its base path", () => {
    assert.equal(normalizeGatewayUrl("http://127.0.0.1:53124/v1/"), settings.baseUrl);
    assert.equal(normalizeGatewayUrl("http://localhost:53124"), "http://localhost:53124/v1");
    assert.throws(() => normalizeGatewayUrl("https://example.com/v1"), /로컬 Q Gateway/);
  });

  it("reads model IDs with the configured bearer key", async () => {
    let request: { input?: RequestInfo | URL; init?: RequestInit } = {};
    globalThis.fetch = async (input, init) => {
      request = { input, init };
      return new Response(JSON.stringify({ data: [{ id: "provider/model" }] }), { status: 200 });
    };

    assert.deepEqual(await listModels(settings), ["provider/model"]);
    assert.equal(request.input, "http://127.0.0.1:53124/v1/models");
    assert.equal((request.init?.headers as Record<string, string>).Authorization, "Bearer test-key");
  });

  it("sends prior messages and conversation_id for the next cache-aware turn", async () => {
    let request: { input?: RequestInfo | URL; init?: RequestInit } = {};
    globalThis.fetch = async (input, init) => {
      request = { input, init };
      return new Response(JSON.stringify({
        conversation_id: "cache_123",
        choices: [{ message: { content: "응답" } }],
        usage: { prompt_tokens_details: { cached_tokens: 128 } },
      }), { status: 200 });
    };

    const result = await completeChat(settings, [
      { role: "user", content: "첫 질문" },
      { role: "assistant", content: "첫 응답" },
      { role: "user", content: "후속 질문" },
    ], "cache_123");

    const body = JSON.parse(request.init?.body as string);
    assert.equal(request.input, "http://127.0.0.1:53124/v1/chat/completions");
    assert.equal(body.model, "provider/model");
    assert.equal(body.conversation_id, "cache_123");
    assert.equal(body.stream, false);
    assert.equal(body.messages.length, 3);
    assert.deepEqual(result, { message: { role: "assistant", content: "응답", cachedTokens: 128 }, conversationId: "cache_123" });
  });
});
