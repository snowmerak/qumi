import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { connectMcpServer, validateMcpServer } from "./mcp-tools.ts";

let server: Server | undefined;
afterEach(async () => { if (server) await new Promise<void>((resolve) => server!.close(() => resolve())); server = undefined; });

describe("Streamable HTTP MCP", () => {
  it("discovers and calls a tool on a modern stateless server", async () => {
    const methods: string[] = [];
    server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      const message = JSON.parse(body) as { id: number; method: string; params?: { name?: string; arguments?: unknown } };
      methods.push(message.method);
      assert.equal(request.headers["mcp-protocol-version"], "2026-07-28");
      assert.equal(request.headers["mcp-method"], message.method);
      if (message.method === "server/discover") {
        response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { resultType: "complete", supportedVersions: ["2026-07-28"], capabilities: { tools: {} }, _meta: { "io.modelcontextprotocol/serverInfo": { name: "test", version: "1.0.0" } } } }));
        return;
      }
      if (message.method === "tools/list") {
        response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { resultType: "complete", ttlMs: 0, cacheScope: "private", tools: [{ name: "echo", inputSchema: { type: "object", properties: { text: { type: "string" } } } }] } }));
        return;
      }
      assert.equal(request.headers["mcp-name"], "echo");
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { resultType: "complete", content: [{ type: "text", text: (message.params?.arguments as { text: string }).text }] } }));
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const connection = await connectMcpServer({ id: "modern", url: `http://127.0.0.1:${address.port}/mcp`, headers: {} }, new AbortController().signal);
    try {
      assert.equal(connection.tools.length, 1);
      const result = await connection.tools[0].execute({ text: "modern" }, new AbortController().signal);
      assert.match(result, /modern/);
      assert.deepEqual(methods, ["server/discover", "tools/list", "tools/call"]);
    } finally { await connection.close(); }
  });

  it("registers, discovers and calls a tool through a legacy session server", async () => {
    const methods: string[] = [];
    server = createServer(async (request, response) => {
      if (request.method !== "POST") { response.writeHead(405).end(); return; }
      let body = "";
      for await (const chunk of request) body += chunk;
      const message = JSON.parse(body) as { id?: number; method: string; params?: { name?: string; arguments?: unknown } };
      methods.push(message.method);
      if (message.method === "server/discover") { response.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } })); return; }
      if (message.method === "initialize") { response.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": "test-session" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "test", version: "1.0.0" } } })); return; }
      assert.equal(request.headers["mcp-session-id"], "test-session");
      if (message.method === "notifications/initialized") { response.writeHead(202).end(); return; }
      if (message.method === "tools/list") { response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "echo", description: "Echo text", inputSchema: { type: "object", properties: { text: { type: "string" } } } }] } })); return; }
      if (message.method === "tools/call") {
        assert.equal(message.params?.name, "echo");
        response.writeHead(200, { "Content-Type": "text/event-stream" }).end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: (message.params?.arguments as { text: string }).text }] } })}\n\n`);
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const connection = await connectMcpServer({ id: "sample", url: `http://127.0.0.1:${address.port}/mcp`, headers: {} }, new AbortController().signal);
    try {
      assert.equal(connection.tools.length, 1);
      assert.equal(connection.tools[0].definition.function.name, "mcp_sample__echo");
      const result = await connection.tools[0].execute({ text: "hello" }, new AbortController().signal);
      assert.match(result, /hello/);
      assert.ok(methods.includes("tools/call"));
    } finally { await connection.close(); }
  });

  it("rejects invalid server addresses and transport headers", () => {
    assert.throws(() => validateMcpServer({ id: "local", url: "file:///mcp", headers: {} }), /HTTP/);
    assert.throws(() => validateMcpServer({ id: "local", url: "https://example.com/mcp", headers: { "Mcp-Session-Id": "fake" } }), /헤더/);
  });
});
