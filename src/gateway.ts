export interface GatewaySettings {
  baseUrl: string;
  apiKey: string;
  model: string;
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

export async function listModels(settings: GatewaySettings): Promise<string[]> {
  const baseUrl = normalizeGatewayUrl(settings.baseUrl);
  const response = await fetch(`${baseUrl}/models`, {
    headers: headers(settings),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await readJson(response)) as { data?: Array<{ id?: unknown }> };
  if (!Array.isArray(body.data)) {
    throw new Error("Gateway 모델 목록 형식이 올바르지 않습니다.");
  }
  return body.data.map((entry) => entry.id).filter((id): id is string => typeof id === "string");
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
