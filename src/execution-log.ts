import type { AgentTraceEvent } from "./agent.ts";
import type { ApprovalPolicy } from "./browser-approval.ts";

export interface ExecutionLogRecord extends AgentTraceEvent {
  timestamp: string;
  turnId: string;
  sequence: number;
  model: string;
  pageConnected: boolean;
  approvalPolicy: ApprovalPolicy;
}

const storageKey = "qumiExecutionLog";
const maxEvents = 10_000;
const retentionMs = 7 * 24 * 60 * 60_000;
let pendingWrite = Promise.resolve();

async function readStored(): Promise<ExecutionLogRecord[]> {
  const value = typeof chrome !== "undefined" && chrome.storage?.local
    ? (await chrome.storage.local.get(storageKey))[storageKey]
    : JSON.parse(localStorage.getItem(storageKey) || "null");
  if (!value || typeof value !== "object" || !Array.isArray(value.events)) return [];
  return value.events.filter((item: unknown): item is ExecutionLogRecord => {
    if (!item || typeof item !== "object") return false;
    const record = item as Partial<ExecutionLogRecord>;
    return typeof record.timestamp === "string" && typeof record.turnId === "string" && typeof record.sequence === "number" && typeof record.event === "string" && typeof record.model === "string";
  });
}

async function writeStored(events: ExecutionLogRecord[]): Promise<void> {
  const value = { version: 1, events };
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    await chrome.storage.local.set({ [storageKey]: value });
    return;
  }
  localStorage.setItem(storageKey, JSON.stringify(value));
}

function retained(events: ExecutionLogRecord[]): ExecutionLogRecord[] {
  const cutoff = Date.now() - retentionMs;
  return events.filter((event) => Date.parse(event.timestamp) >= cutoff)
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp) || (left.turnId === right.turnId ? left.sequence - right.sequence : 0))
    .slice(-maxEvents);
}

function appendRecords(events: ExecutionLogRecord[]): Promise<void> {
  pendingWrite = pendingWrite.catch(() => {}).then(async () => {
    const previous = await readStored();
    await writeStored(retained([...previous, ...events]));
  });
  return pendingWrite;
}

export async function readExecutionLog(): Promise<ExecutionLogRecord[]> {
  await pendingWrite.catch(() => {});
  return retained(await readStored());
}

export function clearExecutionLog(): Promise<void> {
  pendingWrite = pendingWrite.catch(() => {}).then(() => writeStored([]));
  return pendingWrite;
}

export function createExecutionLog(model: string, pageConnected: boolean, approvalPolicy: ApprovalPolicy) {
  const turnId = crypto.randomUUID();
  let sequence = 0;
  const buffer: ExecutionLogRecord[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing = Promise.resolve();

  function flush(): Promise<void> {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!buffer.length) return writing;
    const batch = buffer.splice(0);
    writing = writing.catch(() => {}).then(() => appendRecords(batch)).catch((error) => {
      buffer.unshift(...batch);
      throw error;
    });
    return writing;
  }

  function record(event: AgentTraceEvent): void {
    buffer.push({ ...event, timestamp: new Date().toISOString(), turnId, sequence: ++sequence, model, pageConnected, approvalPolicy });
    if (event.event === "turn_started" || event.event === "turn_completed" || event.event === "turn_failed") {
      void flush().catch(() => {});
    } else if (!timer) {
      timer = setTimeout(() => { void flush().catch(() => {}); }, 400);
    }
  }

  async function finish(): Promise<void> {
    if (timer) { clearTimeout(timer); timer = null; }
    await writing.catch(() => {});
    if (buffer.length) await flush();
  }

  return { turnId, record, finish };
}
