import { emptyAgentState, type AgentState } from "./agent.ts";
import type { ChatMessage, GatewaySettings } from "./gateway.ts";
import type { SavedState } from "./storage.ts";

export interface Session {
  id: string;
  title: string;
  kind: "chat" | "job";
  createdAt: number;
  updatedAt: number;
  model: Pick<GatewaySettings, "model" | "apiMode" | "contextWindowOverride">;
  contextWindow: number;
  messages: ChatMessage[];
  agent: AgentState;
}

const indexKey = "qumiSessionIds";
const activeKey = "qumiActiveSessionId";
const sessionKey = (id: string) => `qumiSession:${id}`;

async function read(keys: string | string[] | null): Promise<Record<string, unknown>> {
  if (typeof chrome !== "undefined" && chrome.storage?.local) return chrome.storage.local.get(keys);
  const names = keys === null ? Object.keys(localStorage) : typeof keys === "string" ? [keys] : keys;
  return Object.fromEntries(names.map((key) => [key, JSON.parse(localStorage.getItem(key) || "null")]));
}

async function write(items: Record<string, unknown>): Promise<void> {
  if (typeof chrome !== "undefined" && chrome.storage?.local) await chrome.storage.local.set(items);
  else for (const [key, value] of Object.entries(items)) localStorage.setItem(key, JSON.stringify(value));
}

function validSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<Session>;
  return typeof session.id === "string" && typeof session.title === "string"
    && (session.kind === "chat" || session.kind === "job")
    && typeof session.createdAt === "number" && typeof session.updatedAt === "number"
    && typeof session.model?.model === "string" && Array.isArray(session.messages)
    && !!session.agent && Array.isArray(session.agent.context) && Array.isArray(session.agent.transcript);
}

export function newSession(settings: GatewaySettings, kind: Session["kind"] = "chat", title = "", contextWindow = 0): Session {
  const now = Date.now();
  return {
    id: crypto.randomUUID(), title, kind, createdAt: now, updatedAt: now,
    model: { model: settings.model, apiMode: settings.apiMode, contextWindowOverride: settings.contextWindowOverride },
    contextWindow, messages: [], agent: emptyAgentState(),
  };
}

export async function loadSessions(legacy: SavedState): Promise<{ sessions: Session[]; activeId: string }> {
  const { [indexKey]: rawIds, [activeKey]: rawActive } = await read([indexKey, activeKey]);
  if (!Array.isArray(rawIds)) {
    const first = newSession(legacy.settings);
    first.messages = legacy.messages;
    first.agent = legacy.agent;
    first.title = legacy.messages.find((message) => message.role === "user")?.content.slice(0, 80) || "";
    await write({ [sessionKey(first.id)]: first, [indexKey]: [first.id], [activeKey]: first.id });
    return { sessions: [first], activeId: first.id };
  }
  const ids = rawIds.filter((id): id is string => typeof id === "string");
  const stored = await read(ids.map(sessionKey));
  const sessions = ids.map((id) => stored[sessionKey(id)]).filter(validSession);
  if (!sessions.length) {
    const first = newSession(legacy.settings);
    await write({ [sessionKey(first.id)]: first, [indexKey]: [first.id], [activeKey]: first.id });
    return { sessions: [first], activeId: first.id };
  }
  return { sessions, activeId: typeof rawActive === "string" && sessions.some((session) => session.id === rawActive) ? rawActive : sessions[0].id };
}

export async function saveSession(session: Session): Promise<void> {
  const previous = pendingWrites.get(session.id) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => write({ [sessionKey(session.id)]: session }));
  pendingWrites.set(session.id, next);
  try { await next; }
  finally { if (pendingWrites.get(session.id) === next) pendingWrites.delete(session.id); }
}

export async function loadSession(id: string): Promise<Session | null> {
  const stored = await read(sessionKey(id));
  const value = stored[sessionKey(id)];
  return validSession(value) ? value : null;
}

const pendingWrites = new Map<string, Promise<void>>();

export async function addSession(session: Session): Promise<void> {
  const { [indexKey]: rawIds } = await read(indexKey);
  const ids = Array.isArray(rawIds) ? rawIds.filter((id): id is string => typeof id === "string") : [];
  await write({ [sessionKey(session.id)]: session, [indexKey]: [...new Set([...ids, session.id])] });
}

export async function setActiveSession(id: string): Promise<void> {
  await write({ [activeKey]: id });
}
