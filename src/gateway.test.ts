import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { completeChat, listModelDetails, listModels, normalizeGatewayUrl, requestModel, type GatewaySettings } from "./gateway.ts";

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

  it("reads every model ID with the configured bearer key", async () => {
    let request: { input?: RequestInfo | URL; init?: RequestInit } = {};
    globalThis.fetch = async (input, init) => {
      request = { input, init };
      return new Response(JSON.stringify({ data: [{ id: "provider/model", context_length: 128000 }, { id: "provider/fast" }, { id: "provider/reasoning", context_length: 64000 }] }), { status: 200 });
    };

    assert.deepEqual(await listModels(settings), ["provider/model", "provider/fast", "provider/reasoning"]);
    assert.deepEqual(await listModelDetails(settings), [
      { id: "provider/model", contextLength: 128000 },
      { id: "provider/fast", contextLength: 0 },
      { id: "provider/reasoning", contextLength: 64000 },
    ]);
    assert.equal(request.input, "http://127.0.0.1:53124/v1/models");
    assert.equal((request.init?.headers as Record<string, string>).Authorization, "Bearer test-key");
  });

  it("assembles streamed text, tool-call fragments, usage, and conversation ID", async () => {
    const events = [
      'data: {"conversation_id":"cache_2","choices":[{"delta":{"content":"안","tool_calls":[{"index":0,"id":"call_1","function":{"name":"lookup","arguments":"{\\"key\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"녕","tool_calls":[{"index":0,"function":{"arguments":"\\"value\\"}"}}]}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":42,"prompt_tokens_details":{"cached_tokens":12}}}\n\n',
      'data: [DONE]\n\n',
    ].join("");
    const bytes = new TextEncoder().encode(events);
    globalThis.fetch = async () => new Response(new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 7) controller.enqueue(bytes.slice(offset, offset + 7));
        controller.close();
      },
    }), { headers: { "Content-Type": "text/event-stream" } });
    const deltas: string[] = [];
    const reply = await requestModel(settings, [{ role: "user", content: "hi" }], [], "", new AbortController().signal, (delta) => { if (delta.kind === "response") deltas.push(delta.text); });
    assert.equal(reply.message.content, "안녕");
    assert.deepEqual(deltas, ["안", "녕"]);
    assert.deepEqual(reply.message.tool_calls, [{ id: "call_1", type: "function", function: { name: "lookup", arguments: '{"key":"value"}' } }]);
    assert.equal(reply.conversationId, "cache_2");
    assert.equal(reply.promptTokens, 42);
    assert.equal(reply.cachedTokens, 12);
  });

  it("streams thinking separately from the final answer", async () => {
    const events = [
      'data: {"choices":[{"phase":"commentary","delta":{"content":"계획 "}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":"확인 "}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning":"다음 ","content":"답"}}]}\n\n',
      'data: {"choices":[{"delta":{"thinking":"단계","content":"변"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join("");
    globalThis.fetch = async () => new Response(events, { headers: { "Content-Type": "text/event-stream" } });
    const deltas: Array<{ kind: string; text: string }> = [];
    const reply = await requestModel(settings, [{ role: "user", content: "hi" }], [], "", new AbortController().signal, (delta) => deltas.push(delta));
    assert.deepEqual(deltas, [
      { kind: "thinking", text: "계획 " },
      { kind: "thinking", text: "확인 " },
      { kind: "thinking", text: "다음 " },
      { kind: "response", text: "답" },
      { kind: "thinking", text: "단계" },
      { kind: "response", text: "변" },
    ]);
    assert.equal(reply.message.content, "답변");
  });

  it("retries without streaming when the gateway rejects stream options", async () => {
    const bodies: Array<{ stream: boolean; stream_options?: unknown }> = [];
    globalThis.fetch = async (_, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return bodies.length === 1
        ? new Response(JSON.stringify({ error: { message: "stream_options is not supported" } }), { status: 400 })
        : new Response(JSON.stringify({ choices: [{ message: { content: "일반 응답" } }] }), { status: 200 });
    };
    const reply = await requestModel(settings, [{ role: "user", content: "안녕" }], [], "", new AbortController().signal, () => {});
    assert.equal(reply.message.content, "일반 응답");
    assert.deepEqual(bodies.map((body) => body.stream), [true, false]);
    assert.equal(bodies[1].stream_options, undefined);
  });

  it("rebuilds a missing Codex rollout once with full history and no conversation ID", async () => {
    const requests: Array<{ conversation_id?: string; messages: unknown[] }> = [];
    globalThis.fetch = async (_, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      return requests.length === 1
        ? new Response(JSON.stringify({ error: { message: "codex: JSON-RPC error -32600: no rollout found for thread id stale" } }), { status: 502 })
        : new Response(JSON.stringify({ conversation_id: "fresh", choices: [{ message: { content: "복구됨" } }] }), { status: 200 });
    };
    const messages = [{ role: "user" as const, content: "이전 질문" }, { role: "assistant" as const, content: "이전 답" }, { role: "user" as const, content: "다음 질문" }];
    const reply = await requestModel(settings, messages, [], "stale", new AbortController().signal);
    assert.equal(reply.message.content, "복구됨");
    assert.equal(reply.conversationId, "fresh");
    assert.deepEqual(requests.map((request) => request.conversation_id), ["stale", undefined]);
    assert.deepEqual(requests[1].messages, messages);
  });

  it("recovers a streamed missing rollout before any response chunk", async () => {
    const requests: Array<{ conversation_id?: string }> = [];
    globalThis.fetch = async (_, init) => {
      requests.push(JSON.parse(String(init?.body)));
      const events = requests.length === 1
        ? 'data: {"error":{"message":"codex: JSON-RPC error -32600: no rollout found for thread id stale"}}\n\n'
        : 'data: {"conversation_id":"fresh","choices":[{"delta":{"content":"복구됨"}}]}\n\ndata: [DONE]\n\n';
      return new Response(events, { headers: { "Content-Type": "text/event-stream" } });
    };
    const deltas: string[] = [];
    const reply = await requestModel(settings, [{ role: "user", content: "질문" }], [], "stale", new AbortController().signal, (delta) => { if (delta.kind === "response") deltas.push(delta.text); });
    assert.equal(reply.message.content, "복구됨");
    assert.deepEqual(deltas, ["복구됨"]);
    assert.deepEqual(requests.map((request) => request.conversation_id), ["stale", undefined]);
  });

  it("does not replay after stream output or on unrelated errors", async () => {
    let requests = 0;
    globalThis.fetch = async () => {
      requests++;
      return new Response('data: {"choices":[{"delta":{"content":"부분"}}]}\n\ndata: {"error":{"message":"codex: JSON-RPC error -32600: no rollout found for thread id stale"}}\n\n', { headers: { "Content-Type": "text/event-stream" } });
    };
    await assert.rejects(requestModel(settings, [{ role: "user", content: "질문" }], [], "stale", new AbortController().signal, () => {}), /no rollout found/);
    assert.equal(requests, 1);
    globalThis.fetch = async () => {
      requests++;
      return new Response(JSON.stringify({ error: { message: "unrelated provider error" } }), { status: 502 });
    };
    await assert.rejects(requestModel(settings, [{ role: "user", content: "질문" }], [], "stale", new AbortController().signal), /unrelated provider error/);
    assert.equal(requests, 2);
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
