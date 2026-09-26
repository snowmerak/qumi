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
  it("sends screenshot images as vision content in both API modes", async () => {
    const requests: Array<Record<string, any>> = [];
    globalThis.fetch = async (_, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      return new Response(JSON.stringify(requests.length === 1
        ? { choices: [{ message: { content: "Q" } }] }
        : { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "Q" }] }] }), { status: 200 });
    };
    const messages = [{ role: "user" as const, content: "What is shown?", imageDataUrl: "data:image/png;base64,AA==" }];
    await requestModel(settings, messages, [], "", new AbortController().signal);
    await requestModel({ ...settings, apiMode: "responses" }, messages, [], "", new AbortController().signal);
    assert.deepEqual(requests[0].messages[0].content, [
      { type: "text", text: "What is shown?" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } },
    ]);
    assert.deepEqual(requests[1].input[0].content, [
      { type: "input_text", text: "What is shown?" },
      { type: "input_image", image_url: "data:image/png;base64,AA==" },
    ]);
  });
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

  it("cancels an open Chat Completions stream when the turn is stopped", async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let cancelled = false;
    globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
      },
      cancel() { cancelled = true; },
    }), { headers: { "Content-Type": "text/event-stream" } });
    const controller = new AbortController();
    const pending = requestModel(settings, [{ role: "user", content: "hi" }], [], "", controller.signal, () => controller.abort(new Error("stopped")));
    const outcome = await Promise.race([
      pending.then(() => "resolved", () => "rejected"),
      new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 150)),
    ]);
    if (outcome === "hung") streamController?.close();
    assert.equal(outcome, "rejected");
    assert.equal(cancelled, true);
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

  it("replays Responses function calls and tool outputs in the next stateless request", async () => {
    const requests: Array<{ input: Array<Record<string, unknown>>; tools: Array<Record<string, unknown>>; store: boolean; include: string[] }> = [];
    globalThis.fetch = async (input, init) => {
      assert.equal(input, "http://127.0.0.1:53124/v1/responses");
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(requests.length === 1 ? {
        status: "completed",
        output: [
          { type: "reasoning", id: "rs_1", encrypted_content: "opaque" },
          { type: "function_call", id: "fc_1", call_id: "call_1", name: "lookup", arguments: '{"key":"x"}' },
        ],
        usage: { input_tokens: 42, input_tokens_details: { cached_tokens: 12 } },
      } : {
        status: "completed",
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "찾았습니다" }] }],
      }), { status: 200 });
    };
    const responsesSettings = { ...settings, apiMode: "responses" as const };
    const tool = { type: "function" as const, function: { name: "lookup", description: "Look up a key", parameters: { type: "object", properties: { key: { type: "string" } } } } };
    const first = await requestModel(responsesSettings, [{ role: "user", content: "조회" }], [tool], "old-chat-id", new AbortController().signal);
    assert.equal(first.conversationId, "");
    assert.equal(first.promptTokens, 42);
    assert.equal(first.cachedTokens, 12);
    assert.equal(first.message.tool_calls?.[0].id, "call_1");
    const second = await requestModel(responsesSettings, [
      { role: "user", content: "조회" },
      first.message,
      { role: "tool", tool_call_id: "call_1", content: "결과" },
    ], [tool], "", new AbortController().signal);
    assert.equal(second.message.content, "찾았습니다");
    assert.deepEqual(requests[1].input, [
      { role: "user", content: "조회" },
      { type: "reasoning", id: "rs_1", encrypted_content: "opaque" },
      { type: "function_call", id: "fc_1", call_id: "call_1", name: "lookup", arguments: '{"key":"x"}' },
      { type: "function_call_output", call_id: "call_1", output: "결과" },
    ]);
    assert.equal(requests[0].tools[0].strict, false);
    assert.equal(requests[0].store, false);
    assert.deepEqual(requests[0].include, ["reasoning.encrypted_content"]);
  });

  it("reads Responses streaming text, thinking, tool calls, and usage", async () => {
    const events = [
      { type: "response.reasoning_summary_text.delta", delta: "살펴보는 중" },
      { type: "response.output_text.delta", delta: "검" },
      { type: "response.output_text.delta", delta: "색" },
      { type: "response.output_item.done", output_index: 0, item: { type: "message", role: "assistant", content: [{ type: "output_text", text: "검색" }] } },
      { type: "response.output_item.done", output_index: 1, item: { type: "function_call", call_id: "call_2", name: "lookup", arguments: "{}" } },
      { type: "response.completed", response: { status: "completed", usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 25 } } } },
    ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
    globalThis.fetch = async () => new Response(events, { headers: { "Content-Type": "text/event-stream" } });
    const deltas: Array<{ kind: string; text: string }> = [];
    const reply = await requestModel({ ...settings, apiMode: "responses" }, [{ role: "user", content: "조회" }], [], "", new AbortController().signal, (delta) => deltas.push(delta));
    assert.deepEqual(deltas, [
      { kind: "thinking", text: "살펴보는 중" },
      { kind: "response", text: "검" },
      { kind: "response", text: "색" },
    ]);
    assert.equal(reply.message.content, "검색");
    assert.equal(reply.message.tool_calls?.[0].id, "call_2");
    assert.equal(reply.promptTokens, 100);
    assert.equal(reply.cachedTokens, 25);
  });

  it("cancels an open Responses stream when the turn is stopped", async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let cancelled = false;
    globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"partial"}\n\n'));
      },
      cancel() { cancelled = true; },
    }), { headers: { "Content-Type": "text/event-stream" } });
    const controller = new AbortController();
    const pending = requestModel({ ...settings, apiMode: "responses" }, [{ role: "user", content: "hi" }], [], "", controller.signal, () => controller.abort(new Error("stopped")));
    const outcome = await Promise.race([
      pending.then(() => "resolved", () => "rejected"),
      new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 150)),
    ]);
    if (outcome === "hung") streamController?.close();
    assert.equal(outcome, "rejected");
    assert.equal(cancelled, true);
  });

  it("keeps Codex on Chat Completions until its Responses adapter can continue tools", async () => {
    await assert.rejects(requestModel(
      { ...settings, model: "codex/gpt-6-luna", apiMode: "responses" },
      [{ role: "user", content: "조회" }], [], "", new AbortController().signal,
    ), /Codex Responses 어댑터/);
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
