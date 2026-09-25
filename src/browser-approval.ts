import type { AgentTool } from "./agent.ts";
import type { PageTarget } from "./page-context.ts";

export type ApprovalPolicy = "all" | "changes" | "none";
export type BrowserActionKind = "read" | "change";
export type ApprovalPrompt = (title: string, detail: string, signal: AbortSignal) => Promise<boolean>;

export function approvalPolicyFrom(value: unknown): ApprovalPolicy {
  return value === "all" || value === "none" ? value : "changes";
}

export function requiresBrowserApproval(policy: ApprovalPolicy, kind: BrowserActionKind): boolean {
  return policy === "all" || (policy === "changes" && kind === "change");
}

export function withReadApproval(tool: AgentTool, target: PageTarget, policy: ApprovalPolicy, approve: ApprovalPrompt): AgentTool {
  if (!requiresBrowserApproval(policy, "read")) return tool;
  return {
    ...tool,
    execute: async (args, signal) => {
      signal.throwIfAborted();
      const name = tool.definition.function.name;
      const detail = `${target.url}\n도구: ${name}\n인수: ${JSON.stringify(args)}`;
      if (!await approve("브라우저 정보 읽기", detail, signal)) return JSON.stringify({ approved: false, tool: name });
      return tool.execute(args, signal);
    },
  };
}
