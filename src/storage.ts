import { emptyAgentState, type AgentState } from "./agent.ts";
import { approvalPolicyFrom, type ApprovalPolicy } from "./browser-approval.ts";
import type { ChatMessage, GatewaySettings, ModelMessage } from "./gateway.ts";

export interface AppSettings extends GatewaySettings {
  approvalPolicy: ApprovalPolicy;
}

export interface SavedState {
  settings: AppSettings;
  messages: ChatMessage[];
  agent: AgentState;
}

const storageKey = "qumiState";

export const emptyState: SavedState = {
  settings: { baseUrl: "", apiKey: "", model: "", contextWindowOverride: 0, approvalPolicy: "changes" },
  messages: [],
  agent: emptyAgentState(),
};

function storedMessages(value: unknown): ChatMessage[] {
  return Array.isArray(value)
    ? value.filter((message): message is ChatMessage =>
      (message?.role === "user" || message?.role === "assistant") && typeof message?.content === "string")
    : [];
}

function modelMessages(value: unknown): ModelMessage[] {
  return Array.isArray(value)
    ? value.filter((message): message is ModelMessage =>
      ["system", "user", "assistant", "tool"].includes(message?.role) && typeof message?.content === "string")
    : [];
}

export async function loadState(): Promise<SavedState> {
  const value =
    typeof chrome !== "undefined" && chrome.storage?.local
      ? (await chrome.storage.local.get(storageKey))[storageKey]
      : JSON.parse(localStorage.getItem(storageKey) || "null");

  if (!value || typeof value !== "object") return emptyState;
  const saved = value as Partial<SavedState> & { conversationId?: unknown };
  const messages = storedMessages(saved.messages);
  const oldContext = messages.map(({ role, content }): ModelMessage => ({ role, content }));
  const agent = saved.agent && typeof saved.agent === "object" ? saved.agent : emptyAgentState();
  return {
    settings: {
      baseUrl: typeof saved.settings?.baseUrl === "string" ? saved.settings.baseUrl : "",
      apiKey: typeof saved.settings?.apiKey === "string" ? saved.settings.apiKey : "",
      model: typeof saved.settings?.model === "string" ? saved.settings.model : "",
      contextWindowOverride: typeof saved.settings?.contextWindowOverride === "number" && Number.isSafeInteger(saved.settings.contextWindowOverride) && saved.settings.contextWindowOverride > 0
        ? saved.settings.contextWindowOverride : 0,
      approvalPolicy: approvalPolicyFrom(saved.settings?.approvalPolicy),
    },
    messages,
    agent: {
      transcript: saved.agent ? modelMessages(agent.transcript) : oldContext,
      context: saved.agent ? modelMessages(agent.context) : oldContext,
      conversationId: typeof agent.conversationId === "string" ? agent.conversationId
        : typeof saved.conversationId === "string" ? saved.conversationId : "",
      providerOverhead: typeof agent.providerOverhead === "number" && agent.providerOverhead >= 0 ? agent.providerOverhead : 0,
    },
  };
}

async function writeState(state: SavedState): Promise<void> {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    await chrome.storage.local.set({ [storageKey]: state });
    return;
  }
  localStorage.setItem(storageKey, JSON.stringify(state));
}

let pendingWrite = Promise.resolve();

export function saveState(state: SavedState): Promise<void> {
  pendingWrite = pendingWrite.catch(() => {}).then(() => writeState(state));
  return pendingWrite;
}
