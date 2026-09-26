import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { AgentTool } from "./agent.ts";

export interface McpServerSettings {
  id: string;
  url: string;
  headers: Record<string, string>;
}

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/;
const reservedHeaders = new Set(["accept", "content-type", "mcp-protocol-version", "mcp-session-id", "mcp-method", "mcp-name"]);

export function validateMcpServer(value: McpServerSettings): McpServerSettings {
  if (!idPattern.test(value.id)) throw new Error("MCP 서버 이름은 영문·숫자로 시작하고 32자 이하여야 합니다.");
  let url: URL;
  try { url = new URL(value.url); } catch { throw new Error("MCP 서버 URL이 올바르지 않습니다."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("MCP 서버에는 HTTP(S) URL이 필요합니다.");
  if (url.username || url.password || url.hash) throw new Error("MCP URL에 사용자 정보나 fragment를 넣을 수 없습니다.");
  const headers: Record<string, string> = {};
  for (const [name, content] of Object.entries(value.headers)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || reservedHeaders.has(name.toLowerCase())) throw new Error(`MCP 헤더 이름이 올바르지 않습니다: ${name}`);
    if (typeof content !== "string" || /[\r\n]/.test(content)) throw new Error(`MCP 헤더 값이 올바르지 않습니다: ${name}`);
    headers[name] = content;
  }
  return { id: value.id, url: url.toString(), headers };
}

function toolName(server: string, name: string): string {
  const normalized = name.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^[_-]+|[_-]+$/g, "") || "tool";
  const full = `mcp_${server}__${normalized}`;
  if (full.length <= 64) return full;
  let hash = 2166136261;
  for (const char of full) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `${full.slice(0, 55)}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function toolArguments(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MCP 도구 인수는 객체여야 합니다.");
  return value as Record<string, unknown>;
}

export interface McpConnection {
  tools: AgentTool[];
  close: () => Promise<void>;
}

export async function connectMcpServer(settings: McpServerSettings, signal: AbortSignal): Promise<McpConnection> {
  const server = validateMcpServer(settings);
  const client = new Client({ name: "qumi", version: "0.1.0" }, { versionNegotiation: { mode: "auto" } });
  const transport = new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } });
  const close = async () => {
    await transport.terminateSession().catch(() => {});
    await client.close();
  };
  try {
    await client.connect(transport, { signal, timeout: 10_000 });
    const discovered = await client.listTools(undefined, { signal, timeout: 10_000 });
    const names = new Set<string>();
    const tools: AgentTool[] = discovered.tools.map((item) => {
      const exposedName = toolName(server.id, item.name);
      if (names.has(exposedName)) throw new Error(`MCP 도구 이름이 충돌합니다: ${exposedName}`);
      names.add(exposedName);
      const schema = item.inputSchema && typeof item.inputSchema === "object" ? item.inputSchema as Record<string, unknown> : { type: "object", properties: {} };
      return {
        definition: { type: "function", function: { name: exposedName, description: `[MCP ${server.id}] ${item.description || item.name}`, parameters: schema } },
        execute: async (value, callSignal) => {
          callSignal.throwIfAborted();
          const result = await client.callTool({ name: item.name, arguments: toolArguments(value) }, { signal: callSignal, timeout: 60_000 });
          callSignal.throwIfAborted();
          return JSON.stringify(result);
        },
      };
    });
    return { tools, close };
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}

export async function connectMcpServers(settings: McpServerSettings[], signal: AbortSignal): Promise<{ tools: AgentTool[]; errors: string[]; close: () => Promise<void> }> {
  const results = await Promise.allSettled(settings.map((server) => connectMcpServer(server, signal)));
  const connections: McpConnection[] = [];
  const errors: string[] = [];
  const tools: AgentTool[] = [];
  const names = new Set<string>();
  results.forEach((result, index) => {
    if (result.status === "rejected") { errors.push(`${settings[index].id}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`); return; }
    if (result.value.tools.some((tool) => names.has(tool.definition.function.name))) {
      errors.push(`${settings[index].id}: MCP 도구 이름이 충돌합니다.`);
      void result.value.close();
      return;
    }
    connections.push(result.value);
    for (const tool of result.value.tools) { tools.push(tool); names.add(tool.definition.function.name); }
  });
  return { tools, errors, close: async () => { await Promise.allSettled(connections.map((connection) => connection.close())); } };
}
