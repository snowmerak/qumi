export interface GatewaySettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  apiMode?: "chat_completions" | "responses";
  contextWindowOverride?: number;
}

export interface GatewayModel {
  id: string;
  contextLength: number;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  responseOutput?: ResponseOutputItem[];
}

type ResponseOutputItem = Record<string, unknown>;

export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ModelReply {
  message: ModelMessage & { role: "assistant" };
  conversationId: string;
  promptTokens: number;
  cachedTokens: number;
}

export interface StreamDelta {
  kind: "thinking" | "response";
  text: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  cachedTokens?: number;
}

export interface ChatResult {
  message: ChatMessage;
  conversationId: string;
}

export function normalizeGatewayUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Gateway URL을 확인해 주세요.");
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["/", "/v1", "/v1/"].includes(url.pathname)
  ) {
    throw new Error("로컬 Q Gateway 주소를 입력해 주세요. 예: http://127.0.0.1:8080/v1");
  }

  return `${url.origin}/v1`;
}

function headers(settings: GatewaySettings): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(settings.apiKey.trim() ? { Authorization: `Bearer ${settings.apiKey.trim()}` } : {}),
  };
}

async function readJson(response: Response): Promise<unknown> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Gateway가 JSON 응답을 반환하지 않았습니다. (${response.status})`);
  }

  if (!response.ok) {
    const detail = body as { error?: { message?: string } };
    throw new Error(detail?.error?.message || `Gateway 요청에 실패했습니다. (${response.status})`);
  }
  return body;
}

export async function listModelDetails(settings: GatewaySettings): Promise<GatewayModel[]> {
  const baseUrl = normalizeGatewayUrl(settings.baseUrl);
  const response = await fetch(`${baseUrl}/models`, {
    headers: headers(settings),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await readJson(response)) as { data?: Array<{ id?: unknown; context_length?: unknown }> };
  if (!Array.isArray(body.data)) {
    throw new Error("Gateway 모델 목록 형식이 올바르지 않습니다.");
  }
  return body.data.filter((entry): entry is { id: string; context_length?: unknown } => typeof entry.id === "string")
    .map((entry) => ({
      id: entry.id,
      contextLength: typeof entry.context_length === "number" && Number.isSafeInteger(entry.context_length) && entry.context_length > 0
        ? entry.context_length : 0,
    }));
}

export async function listModels(settings: GatewaySettings): Promise<string[]> {
  return (await listModelDetails(settings)).map((model) => model.id);
}

function parseModelReply(body: unknown, previousConversationId: string): ModelReply {
  const value = body as {
    choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown } }>;
    conversation_id?: unknown;
    usage?: { prompt_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } };
  };
  const raw = value?.choices?.[0]?.message;
  const content = typeof raw?.content === "string" ? raw.content : "";
  const toolCalls = Array.isArray(raw?.tool_calls) ? raw.tool_calls.map(parseToolCall) : [];
  if (!content && toolCalls.length === 0) throw new Error("Gateway가 빈 응답을 반환했습니다.");
  return {
    message: { role: "assistant", content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
    conversationId: typeof value?.conversation_id === "string" ? value.conversation_id : previousConversationId,
    promptTokens: typeof value?.usage?.prompt_tokens === "number" ? value.usage.prompt_tokens : 0,
    cachedTokens: typeof value?.usage?.prompt_tokens_details?.cached_tokens === "number" ? value.usage.prompt_tokens_details.cached_tokens : 0,
  };
}

function parseToolCall(value: unknown): ToolCall {
  const call = value as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
  if (typeof call?.id !== "string" || !call.id || typeof call.function?.name !== "string" || !call.function.name || typeof call.function.arguments !== "string") {
    throw new Error("Gateway 도구 호출 형식이 올바르지 않습니다.");
  }
  return { id: call.id, type: "function", function: { name: call.function.name, arguments: call.function.arguments } };
}

async function readStreamedReply(response: Response, previousConversationId: string, onDelta: (delta: StreamDelta) => void, onChunk: () => void): Promise<ModelReply> {
  if (!response.body) throw new Error("Gateway 스트림을 읽을 수 없습니다.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventData: string[] = [];
  let content = "";
  let conversationId = previousConversationId;
  let promptTokens = 0;
  let cachedTokens = 0;
  const calls = new Map<number, ToolCall>();

  function consumeEvent() {
    if (eventData.length === 0) return;
    const data = eventData.join("\n");
    eventData = [];
    if (data === "[DONE]") return;
    const chunk = JSON.parse(data) as {
      error?: { message?: string };
      conversation_id?: string;
      usage?: { prompt_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
      choices?: Array<{ phase?: string; delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null; thinking?: string | null; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> } }>;
    };
    if (chunk.error) throw new Error(chunk.error.message || "Gateway 스트림이 실패했습니다.");
    onChunk();
    if (chunk.conversation_id) conversationId = chunk.conversation_id;
    if (typeof chunk.usage?.prompt_tokens === "number") promptTokens = chunk.usage.prompt_tokens;
    if (typeof chunk.usage?.prompt_tokens_details?.cached_tokens === "number") cachedTokens = chunk.usage.prompt_tokens_details.cached_tokens;
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta;
      const thinking = choice.phase === "commentary" && typeof delta?.content === "string"
        ? delta.content
        : [delta?.reasoning_content, delta?.reasoning, delta?.thinking].find((value): value is string => typeof value === "string" && value.length > 0);
      if (thinking) onDelta({ kind: "thinking", text: thinking });
      if (choice.phase !== "commentary" && typeof delta?.content === "string") {
        content += delta.content;
        onDelta({ kind: "response", text: delta.content });
      }
      for (const fragment of delta?.tool_calls ?? []) {
        const index = fragment.index ?? 0;
        const call = calls.get(index) ?? { id: "", type: "function" as const, function: { name: "", arguments: "" } };
        if (fragment.id) call.id = fragment.id;
        if (fragment.function?.name) call.function.name += fragment.function.name;
        if (fragment.function?.arguments) call.function.arguments += fragment.function.arguments;
        calls.set(index, call);
      }
    }
  }

  function consumeLines(final = false) {
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line === "") consumeEvent();
      else if (line.startsWith("data:")) eventData.push(line.slice(5).trimStart());
    }
    if (final) {
      if (buffer.startsWith("data:")) eventData.push(buffer.slice(5).trimStart());
      consumeEvent();
    }
  }

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      consumeLines();
    }
    buffer += decoder.decode();
    consumeLines(true);
  } finally {
    reader.releaseLock();
  }
  const toolCalls = [...calls.entries()].sort(([left], [right]) => left - right).map(([, call]) => parseToolCall(call));
  if (!content && toolCalls.length === 0) throw new Error("Gateway가 빈 응답을 반환했습니다.");
  return { message: { role: "assistant", content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, conversationId, promptTokens, cachedTokens };
}

function isMissingCodexRollout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("codex: json-rpc error -32600") && message.includes("no rollout found for thread id");
}

function responseInput(messages: ModelMessage[]): Record<string, unknown>[] {
  const input: Record<string, unknown>[] = [];
  for (const message of messages) {
    if (message.role === "tool") {
      if (!message.tool_call_id) throw new Error("도구 결과에 호출 ID가 없습니다.");
      input.push({ type: "function_call_output", call_id: message.tool_call_id, output: message.content });
      continue;
    }
    if (message.role === "assistant" && message.responseOutput?.length) {
      input.push(...message.responseOutput);
      continue;
    }
    if (message.content) input.push({ role: message.role, content: message.content });
    for (const call of message.tool_calls ?? []) {
      input.push({ type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments });
    }
  }
  return input;
}

function parseResponseReply(body: unknown): ModelReply {
  const value = body as {
    status?: unknown;
    error?: { message?: string };
    output?: unknown;
    usage?: { input_tokens?: unknown; input_tokens_details?: { cached_tokens?: unknown } };
  };
  if (value?.error) throw new Error(value.error.message || "Gateway Responses 요청이 실패했습니다.");
  if (value?.status && value.status !== "completed") throw new Error(`Gateway Responses 요청이 ${value.status} 상태로 끝났습니다.`);
  if (!Array.isArray(value?.output)) throw new Error("Gateway Responses 출력 형식이 올바르지 않습니다.");
  const output = value.output.filter((item): item is ResponseOutputItem => !!item && typeof item === "object" && !Array.isArray(item));
  const content = output.flatMap((item) => item.type === "message" && Array.isArray(item.content)
    ? item.content.filter((part): part is { type: string; text: string } => !!part && typeof part === "object" && part.type === "output_text" && typeof part.text === "string").map((part) => part.text)
    : []).join("");
  const toolCalls = output.filter((item) => item.type === "function_call").map((item) => parseToolCall({
    id: item.call_id,
    function: { name: item.name, arguments: item.arguments },
  }));
  if (!content && toolCalls.length === 0) throw new Error("Gateway가 빈 응답을 반환했습니다.");
  return {
    message: { role: "assistant", content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}), responseOutput: output },
    conversationId: "",
    promptTokens: typeof value.usage?.input_tokens === "number" ? value.usage.input_tokens : 0,
    cachedTokens: typeof value.usage?.input_tokens_details?.cached_tokens === "number" ? value.usage.input_tokens_details.cached_tokens : 0,
  };
}

async function readStreamedResponse(response: Response, onDelta: (delta: StreamDelta) => void): Promise<ModelReply> {
  if (!response.body) throw new Error("Gateway 스트림을 읽을 수 없습니다.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventData: string[] = [];
  const output = new Map<number, ResponseOutputItem>();
  let completed: unknown;
  let streamedText = "";

  function consumeEvent() {
    if (!eventData.length) return;
    const data = eventData.join("\n");
    eventData = [];
    if (data === "[DONE]") return;
    const event = JSON.parse(data) as {
      type?: string; delta?: string; output_index?: number; item?: ResponseOutputItem;
      response?: unknown; error?: { message?: string }; message?: string;
    };
    if (event.type === "error" || event.type === "response.failed") {
      throw new Error(event.error?.message || event.message || "Gateway Responses 스트림이 실패했습니다.");
    }
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      streamedText += event.delta;
      onDelta({ kind: "response", text: event.delta });
    }
    if (event.type === "response.reasoning_summary_text.delta" && typeof event.delta === "string") {
      onDelta({ kind: "thinking", text: event.delta });
    }
    if (event.type === "response.output_item.done" && typeof event.output_index === "number" && event.item) {
      output.set(event.output_index, event.item);
    }
    if (event.type === "response.completed" || event.type === "response.incomplete") completed = event.response;
  }

  function consumeLines(final = false) {
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (!line) consumeEvent();
      else if (line.startsWith("data:")) eventData.push(line.slice(5).trimStart());
    }
    if (final) {
      if (buffer.startsWith("data:")) eventData.push(buffer.slice(5).trimStart());
      consumeEvent();
    }
  }

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      consumeLines();
    }
    buffer += decoder.decode();
    consumeLines(true);
  } finally {
    reader.releaseLock();
  }
  if (!completed) throw new Error("Gateway Responses 스트림이 완료 이벤트 없이 끝났습니다.");
  const value = completed as { output?: unknown };
  const fallbackOutput = [...output.entries()].sort(([left], [right]) => left - right).map(([, item]) => item);
  const reply = parseResponseReply({ ...value, output: Array.isArray(value.output) ? value.output : fallbackOutput });
  if (streamedText && !reply.message.content) throw new Error("Gateway Responses 완료 응답에 스트리밍 텍스트가 없습니다.");
  return reply;
}

async function requestResponses(
  settings: GatewaySettings,
  messages: ModelMessage[],
  tools: ToolDefinition[],
  signal: AbortSignal,
  onDelta?: (delta: StreamDelta) => void,
  toolChoice: "auto" | "none" = "auto",
): Promise<ModelReply> {
  const baseUrl = normalizeGatewayUrl(settings.baseUrl);
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: headers(settings),
    body: JSON.stringify({
      model: settings.model,
      input: responseInput(messages),
      ...(tools.length ? {
        tools: tools.map((tool) => ({ type: "function", ...tool.function, strict: false })),
        tool_choice: toolChoice,
        ...(toolChoice === "none" ? { parallel_tool_calls: false } : {}),
      } : {}),
      include: ["reasoning.encrypted_content"],
      store: false,
      stream: !!onDelta,
    }),
    signal,
  });
  if (!response.ok) {
    await readJson(response);
    throw new Error(`Gateway Responses 요청에 실패했습니다. (${response.status})`);
  }
  if (onDelta && response.headers.get("Content-Type")?.includes("text/event-stream")) return readStreamedResponse(response, onDelta);
  return parseResponseReply(await readJson(response));
}

async function requestModelOnce(
  settings: GatewaySettings,
  messages: ModelMessage[],
  tools: ToolDefinition[],
  conversationId: string,
  signal: AbortSignal,
  onDelta?: (delta: StreamDelta) => void,
  onChunk?: () => void,
  toolChoice: "auto" | "none" = "auto",
): Promise<ModelReply> {
  const baseUrl = normalizeGatewayUrl(settings.baseUrl);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: headers(settings),
    body: JSON.stringify({
      model: settings.model,
      messages,
      ...(tools.length ? { tools, tool_choice: toolChoice, ...(toolChoice === "none" ? { parallel_tool_calls: false } : {}) } : {}),
      ...(conversationId ? { conversation_id: conversationId } : {}),
      stream: !!onDelta,
      ...(onDelta ? { stream_options: { include_usage: true } } : {}),
    }),
    signal,
  });
  if (!response.ok) {
    try {
      await readJson(response);
    } catch (error) {
      if (onDelta && [400, 422].includes(response.status) && error instanceof Error && /\bstream(?:_options|ing)?\b/i.test(error.message)) {
        return requestModelOnce(settings, messages, tools, conversationId, signal, undefined, undefined, toolChoice);
      }
      throw error;
    }
    throw new Error(`Gateway 요청에 실패했습니다. (${response.status})`);
  }
  if (onDelta && response.headers.get("Content-Type")?.includes("text/event-stream")) {
    return readStreamedReply(response, conversationId, onDelta, onChunk || (() => {}));
  }
  return parseModelReply(await readJson(response), conversationId);
}

export async function requestModel(
  settings: GatewaySettings,
  messages: ModelMessage[],
  tools: ToolDefinition[],
  conversationId: string,
  signal: AbortSignal,
  onDelta?: (delta: StreamDelta) => void,
  toolChoice: "auto" | "none" = "auto",
): Promise<ModelReply> {
  if (settings.apiMode === "responses") {
    if (settings.model.startsWith("codex/")) throw new Error("현재 Q Gateway의 Codex Responses 어댑터는 도구 결과를 이어받지 못합니다. Chat Completions를 선택해 주세요.");
    return requestResponses(settings, messages, tools, signal, onDelta, toolChoice);
  }
  let receivedChunk = false;
  try {
    return await requestModelOnce(settings, messages, tools, conversationId, signal, onDelta, () => { receivedChunk = true; }, toolChoice);
  } catch (error) {
    if (!conversationId || receivedChunk || signal.aborted || !isMissingCodexRollout(error)) throw error;
    // The full message history is already supplied, so a fresh provider thread can rebuild it.
    return requestModelOnce(settings, messages, tools, "", signal, onDelta, undefined, toolChoice);
  }
}

export async function completeChat(
  settings: GatewaySettings,
  messages: ChatMessage[],
  conversationId: string,
): Promise<ChatResult> {
  if (!settings.model) {
    throw new Error("모델을 선택해 주세요.");
  }

  const baseUrl = normalizeGatewayUrl(settings.baseUrl);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: headers(settings),
    body: JSON.stringify({
      model: settings.model,
      messages: messages.map(({ role, content }) => ({ role, content })),
      ...(conversationId ? { conversation_id: conversationId } : {}),
      stream: false,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = (await readJson(response)) as {
    choices?: Array<{ message?: { content?: unknown } }>;
    conversation_id?: unknown;
    usage?: { prompt_tokens_details?: { cached_tokens?: unknown } };
  };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Gateway 응답에서 텍스트를 찾지 못했습니다.");
  }

  const cachedTokens = body.usage?.prompt_tokens_details?.cached_tokens;
  return {
    message: {
      role: "assistant",
      content,
      ...(typeof cachedTokens === "number" ? { cachedTokens } : {}),
    },
    conversationId:
      typeof body.conversation_id === "string" ? body.conversation_id : conversationId,
  };
}
