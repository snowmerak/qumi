import { emptyAgentState, type AgentState } from "./agent.ts";
import { approvalPolicyFrom, type ApprovalPolicy } from "./browser-approval.ts";
import { languagePreferenceFrom, type LanguagePreference } from "./i18n.ts";
import type { ChatMessage, GatewaySettings, ModelMessage } from "./gateway.ts";
import { validateMcpServer, type McpServerSettings } from "./mcp-tools.ts";
import { parseSkill, type InstalledSkill } from "./skills.ts";

export interface AppSettings extends GatewaySettings {
  approvalPolicy: ApprovalPolicy;
  language: LanguagePreference;
  mcpServers: McpServerSettings[];
}

export interface SavedState {
  settings: AppSettings;
  messages: ChatMessage[];
  agent: AgentState;
  skills: InstalledSkill[];
}

const storageKey = "qumiState";
const mcpServersKey = "qumiMcpServers";

export const emptyState: SavedState = {
  settings: { baseUrl: "", apiKey: "", model: "", apiMode: "chat_completions", contextWindowOverride: 0, approvalPolicy: "changes", language: "auto", mcpServers: [] },
  messages: [],
  agent: emptyAgentState(),
  skills: [],
};

function storedMessages(value: unknown): ChatMessage[] {
  return Array.isArray(value)
    ? value.filter((message): message is ChatMessage =>
      (message?.role === "user" || message?.role === "assistant") && typeof message?.content === "string")
      .map((message) => ({
        ...message,
        selections: Array.isArray(message.selections) ? message.selections.filter((selection) =>
          selection && typeof selection.url === "string" && typeof selection.title === "string"
          && typeof selection.selector === "string" && typeof selection.text === "string"
          && typeof selection.html === "string" && typeof selection.truncated === "boolean") : undefined,
      }))
    : [];
}

function modelMessages(value: unknown): ModelMessage[] {
  return Array.isArray(value)
    ? value.filter((message): message is ModelMessage =>
      ["system", "user", "assistant", "tool"].includes(message?.role) && typeof message?.content === "string")
    : [];
}

function storedMcpServers(value: unknown): McpServerSettings[] {
  return Array.isArray(value) ? value.flatMap((entry) => {
    try { return [validateMcpServer(entry)]; } catch { return []; }
  }) : [];
}

export async function saveMcpServers(servers: McpServerSettings[]): Promise<void> {
  const validated = servers.map(validateMcpServer);
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    await chrome.storage.local.set({ [mcpServersKey]: validated });
  } else {
    localStorage.setItem(mcpServersKey, JSON.stringify(validated));
  }
}

export async function loadState(): Promise<SavedState> {
  const stored = typeof chrome !== "undefined" && chrome.storage?.local
    ? await chrome.storage.local.get([storageKey, mcpServersKey])
    : { [storageKey]: JSON.parse(localStorage.getItem(storageKey) || "null"), [mcpServersKey]: JSON.parse(localStorage.getItem(mcpServersKey) || "null") };
  const value = stored[storageKey];
  const independentServers = stored[mcpServersKey];

  if (!value || typeof value !== "object") return { ...emptyState, settings: { ...emptyState.settings, mcpServers: storedMcpServers(independentServers) } };
  const saved = value as Partial<SavedState> & { conversationId?: unknown };
  const messages = storedMessages(saved.messages);
  const oldContext = messages.map(({ role, content }): ModelMessage => ({ role, content }));
  const agent = saved.agent && typeof saved.agent === "object" ? saved.agent : emptyAgentState();
  return {
    settings: {
      baseUrl: typeof saved.settings?.baseUrl === "string" ? saved.settings.baseUrl : "",
      apiKey: typeof saved.settings?.apiKey === "string" ? saved.settings.apiKey : "",
      model: typeof saved.settings?.model === "string" ? saved.settings.model : "",
      apiMode: saved.settings?.apiMode === "responses" ? "responses" : "chat_completions",
      contextWindowOverride: typeof saved.settings?.contextWindowOverride === "number" && Number.isSafeInteger(saved.settings.contextWindowOverride) && saved.settings.contextWindowOverride > 0
        ? saved.settings.contextWindowOverride : 0,
      approvalPolicy: approvalPolicyFrom(saved.settings?.approvalPolicy),
      language: languagePreferenceFrom(saved.settings?.language),
      mcpServers: storedMcpServers(Array.isArray(independentServers) ? independentServers : saved.settings?.mcpServers),
    },
    messages,
    skills: Array.isArray(saved.skills) ? saved.skills.flatMap((entry) => {
      try { return [parseSkill(entry.files)]; } catch { return []; }
    }) : [],
    agent: {
      transcript: saved.agent ? modelMessages(agent.transcript) : oldContext,
      context: saved.agent ? modelMessages(agent.context) : oldContext,
      conversationId: typeof agent.conversationId === "string" ? agent.conversationId
        : typeof saved.conversationId === "string" ? saved.conversationId : "",
      providerOverhead: typeof agent.providerOverhead === "number" && agent.providerOverhead >= 0 ? agent.providerOverhead : 0,
      activeTask: agent.activeTask && typeof agent.activeTask.objective === "string" && agent.activeTask.objective.trim()
        ? { objective: agent.activeTask.objective, completionCriteria: Array.isArray(agent.activeTask.completionCriteria)
          ? agent.activeTask.completionCriteria.filter((item): item is string => typeof item === "string") : [],
          ...(typeof agent.activeTask.skillKeywords === "string" ? { skillKeywords: agent.activeTask.skillKeywords } : {}) }
        : null,
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
