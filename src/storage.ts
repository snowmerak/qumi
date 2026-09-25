import type { ChatMessage, GatewaySettings } from "./gateway";

export interface SavedState {
  settings: GatewaySettings;
  messages: ChatMessage[];
  conversationId: string;
}

const storageKey = "qumiState";

export const emptyState: SavedState = {
  settings: { baseUrl: "", apiKey: "", model: "" },
  messages: [],
  conversationId: "",
};

export async function loadState(): Promise<SavedState> {
  const value =
    typeof chrome !== "undefined" && chrome.storage?.local
      ? (await chrome.storage.local.get(storageKey))[storageKey]
      : JSON.parse(localStorage.getItem(storageKey) || "null");

  if (!value || typeof value !== "object") return emptyState;
  const saved = value as Partial<SavedState>;
  return {
    settings: {
      baseUrl: typeof saved.settings?.baseUrl === "string" ? saved.settings.baseUrl : "",
      apiKey: typeof saved.settings?.apiKey === "string" ? saved.settings.apiKey : "",
      model: typeof saved.settings?.model === "string" ? saved.settings.model : "",
    },
    messages: Array.isArray(saved.messages)
      ? saved.messages.filter(
          (message): message is ChatMessage =>
            (message?.role === "user" || message?.role === "assistant") &&
            typeof message?.content === "string",
        )
      : [],
    conversationId: typeof saved.conversationId === "string" ? saved.conversationId : "",
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
