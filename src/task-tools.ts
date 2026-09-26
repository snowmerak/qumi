import type { ToolDefinition } from "./gateway.ts";
import { translate, type Locale } from "./i18n.ts";

export interface ActiveTask {
  objective: string;
  completionCriteria: string[];
  skillKeywords?: string;
}

export interface TaskCompletion {
  outcome: "succeeded" | "blocked";
  summary: string;
  findings: string[];
  artifacts: string[];
  verification: string[];
  blocker: string;
}

const stringArray = { type: "array", items: { type: "string" } };

export const taskTools: ToolDefinition[] = [
  { type: "function", function: {
    name: "task_start",
    description: "Start an explicit task for work requiring tools or multiple steps. A short direct answer does not need this. Once started, finish with task_complete.",
    parameters: { type: "object", properties: {
      objective: { type: "string" }, completion_criteria: stringArray,
      skill_keywords: { type: "string", description: "Concise English search keywords for relevant Agent Skills, especially when the objective is not in English." },
    }, required: ["objective"], additionalProperties: false },
  } },
  { type: "function", function: {
    name: "task_complete",
    description: "Finish the active task with a structured result. Call this alone, after all work is done. Use blocked with a blocker if the task cannot be completed.",
    parameters: { type: "object", properties: {
      outcome: { type: "string", enum: ["succeeded", "blocked"] },
      summary: { type: "string" }, findings: stringArray, artifacts: stringArray,
      verification: stringArray, blocker: { type: "string" },
    }, required: ["outcome", "summary"], additionalProperties: false },
  } },
];

function objectArguments(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("인수는 객체여야 합니다.");
  const args = value as Record<string, unknown>;
  if (Object.keys(args).some((key) => !allowed.includes(key))) throw new Error("지원하지 않는 인수가 있습니다.");
  return args;
}

function strings(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${name}은 문자열 목록이어야 합니다.`);
  return value.map((item: string) => item.trim()).filter(Boolean);
}

export function parseTaskStart(value: unknown): ActiveTask {
  const args = objectArguments(value, ["objective", "completion_criteria", "skill_keywords"]);
  const objective = typeof args.objective === "string" ? args.objective.trim() : "";
  if (!objective) throw new Error("objective가 필요합니다.");
  if (args.skill_keywords !== undefined && typeof args.skill_keywords !== "string") throw new Error("skill_keywords는 문자열이어야 합니다.");
  return { objective, completionCriteria: strings(args.completion_criteria, "completion_criteria"), ...(args.skill_keywords ? { skillKeywords: args.skill_keywords.trim().slice(0, 400) } : {}) };
}

export function parseTaskCompletion(value: unknown): TaskCompletion {
  const args = objectArguments(value, ["outcome", "summary", "findings", "artifacts", "verification", "blocker"]);
  if (args.outcome !== "succeeded" && args.outcome !== "blocked") throw new Error("outcome은 succeeded 또는 blocked여야 합니다.");
  const summary = typeof args.summary === "string" ? args.summary.trim() : "";
  if (!summary) throw new Error("summary가 필요합니다.");
  const blocker = args.blocker === undefined ? "" : typeof args.blocker === "string" ? args.blocker.trim() : "";
  if (args.blocker !== undefined && typeof args.blocker !== "string") throw new Error("blocker는 문자열이어야 합니다.");
  if (args.outcome === "blocked" && !blocker) throw new Error("blocked 결과에는 blocker가 필요합니다.");
  return {
    outcome: args.outcome, summary, blocker,
    findings: strings(args.findings, "findings"), artifacts: strings(args.artifacts, "artifacts"), verification: strings(args.verification, "verification"),
  };
}

export function renderTaskCompletion(completion: TaskCompletion, locale: Locale = "ko"): string {
  let content = completion.summary;
  for (const [name, values] of [[translate(locale, "taskFindings"), completion.findings], [translate(locale, "taskArtifacts"), completion.artifacts], [translate(locale, "taskVerification"), completion.verification]] as const) {
    if (values.length) content += `\n\n${name}:\n${values.map((value) => `- ${value}`).join("\n")}`;
  }
  if (completion.blocker) content += `\n\n${translate(locale, "taskBlocker")}: ${completion.blocker}`;
  return content;
}
