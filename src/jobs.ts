export type JobSchedule =
  | { type: "once"; at: number }
  | { type: "daily"; hour: number; minute: number }
  | { type: "weekly"; day: number; hour: number; minute: number };

export interface ScheduledJob {
  id: string;
  sessionId: string;
  title: string;
  prompt: string;
  schedule: JobSchedule;
  nextRunAt: number | null;
  lastStartedAt: number | null;
  lastFinishedAt: number | null;
  status: "scheduled" | "running" | "completed" | "failed" | "paused";
  error: string;
}

const indexKey = "qumiJobIds";
const jobKey = (id: string) => `qumiJob:${id}`;
export const alarmName = (id: string) => `qumi-job:${id}`;

function validTime(hour: number, minute: number): boolean {
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 && Number.isInteger(minute) && minute >= 0 && minute <= 59;
}

export function nextRunAt(schedule: JobSchedule, after: number): number | null {
  if (schedule.type === "once") {
    if (!Number.isFinite(schedule.at)) throw new Error("실행 시각이 올바르지 않습니다.");
    return schedule.at > after ? schedule.at : null;
  }
  if (!validTime(schedule.hour, schedule.minute)) throw new Error("반복 실행 시각이 올바르지 않습니다.");
  if (schedule.type === "weekly" && (!Number.isInteger(schedule.day) || schedule.day < 0 || schedule.day > 6)) {
    throw new Error("반복 요일이 올바르지 않습니다.");
  }
  const date = new Date(after);
  date.setHours(schedule.hour, schedule.minute, 0, 0);
  if (schedule.type === "daily") {
    if (date.getTime() <= after) date.setDate(date.getDate() + 1);
  } else {
    date.setDate(date.getDate() + (schedule.day - date.getDay() + 7) % 7);
    if (date.getTime() <= after) date.setDate(date.getDate() + 7);
  }
  return date.getTime();
}

export function createJob(sessionId: string, title: string, prompt: string, schedule: JobSchedule): ScheduledJob {
  if (!title.trim() || !prompt.trim()) throw new Error("작업 이름과 프롬프트가 필요합니다.");
  const next = nextRunAt(schedule, Date.now());
  if (next === null) throw new Error("미래 실행 시각을 지정해 주세요.");
  return { id: crypto.randomUUID(), sessionId, title: title.trim(), prompt: prompt.trim(), schedule,
    nextRunAt: next, lastStartedAt: null, lastFinishedAt: null, status: "scheduled", error: "" };
}

export function upsertJob(jobs: ScheduledJob[], job: ScheduledJob): ScheduledJob[] {
  const byId = new Map(jobs.map((current) => [current.id, current]));
  byId.set(job.id, job);
  return [...byId.values()];
}

function validJob(value: unknown): value is ScheduledJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Partial<ScheduledJob>;
  return typeof job.id === "string" && typeof job.sessionId === "string" && typeof job.title === "string"
    && typeof job.prompt === "string" && !!job.schedule && typeof job.schedule.type === "string"
    && (job.nextRunAt === null || typeof job.nextRunAt === "number") && typeof job.status === "string";
}

export async function loadJobs(): Promise<ScheduledJob[]> {
  const { [indexKey]: raw } = await chrome.storage.local.get(indexKey);
  const ids = Array.isArray(raw) ? [...new Set(raw.filter((id): id is string => typeof id === "string"))] : [];
  const stored = await chrome.storage.local.get(ids.map(jobKey));
  return ids.map((id) => stored[jobKey(id)]).filter(validJob);
}

export async function loadJob(id: string): Promise<ScheduledJob | null> {
  const { [jobKey(id)]: value } = await chrome.storage.local.get(jobKey(id));
  return validJob(value) ? value : null;
}

export async function saveJob(job: ScheduledJob): Promise<void> {
  await chrome.storage.local.set({ [jobKey(job.id)]: job });
}

export async function addJob(job: ScheduledJob): Promise<void> {
  const { [indexKey]: raw } = await chrome.storage.local.get(indexKey);
  const ids = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
  await chrome.storage.local.set({ [jobKey(job.id)]: job, [indexKey]: [...new Set([...ids, job.id])] });
  await syncAlarm(job);
}

export async function removeJob(id: string): Promise<void> {
  const { [indexKey]: raw } = await chrome.storage.local.get(indexKey);
  const ids = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string" && item !== id) : [];
  await chrome.alarms.clear(alarmName(id));
  await chrome.storage.local.set({ [indexKey]: ids });
  await chrome.storage.local.remove(jobKey(id));
}

export async function syncAlarm(job: ScheduledJob): Promise<void> {
  if (job.status === "paused" || job.nextRunAt === null) {
    await chrome.alarms.clear(alarmName(job.id));
  } else {
    const alarm = await chrome.alarms.get(alarmName(job.id));
    if (!alarm || alarm.scheduledTime !== job.nextRunAt) await chrome.alarms.create(alarmName(job.id), { when: Math.max(Date.now(), job.nextRunAt) });
  }
}
