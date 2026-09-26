import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { connectMcpServer, validateMcpServer } from "./mcp-tools.ts";
import { BrowserMcpOAuthProvider, forgetMcpAuthorization } from "./mcp-oauth.ts";

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
    assert.throws(() => validateMcpServer({ id: "local", url: "https://example.com/mcp", headers: { Authorization: "Bearer old" }, auth: { type: "oauth" } }), /Authorization/);
    assert.throws(() => validateMcpServer({ id: "local", url: "http://example.com/mcp", headers: {}, auth: { type: "oauth" } }), /HTTPS/);
  });

  it("explains a server's rejected extension Origin without exposing its ID", async () => {
    server = createServer((_request, response) => {
      response.writeHead(403, { "Content-Type": "application/json" }).end(JSON.stringify({
        jsonrpc: "2.0", error: { code: -32000, message: "Invalid Origin: test-extension-id" }, id: null,
      }));
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await assert.rejects(
      connectMcpServer({ id: "origin", url: `http://127.0.0.1:${address.port}/mcp`, headers: {} }, new AbortController().signal),
      (error: unknown) => error instanceof Error && error.message.includes("확장의 Origin을 거부") && !error.message.includes("test-extension-id"),
    );
  });

  it("completes public-client OAuth with PKCE, issuer and resource binding", async () => {
    const oldChrome = globalThis.chrome;
    const stored = new Map<string, unknown>();
    const durable = new Map<string, unknown>();
    const seen: string[] = [];
    let origin = "";
    let authorized = false;
    let tokenExchanges = 0;
    let authorizationPrompts = 0;
    let registrations = 0;
    globalThis.chrome = {
      identity: {
        getRedirectURL: () => "https://test-extension.chromiumapp.org/mcp",
        launchWebAuthFlow: async ({ url }: { url: string }) => {
          const request = new URL(url);
          assert.equal(request.searchParams.get("client_id"), authorizationPrompts < 2 ? "test-client" : "dynamic-client");
          assert.equal(request.searchParams.get("code_challenge_method"), "S256");
          assert.equal(request.searchParams.get("resource"), `${origin}/mcp`);
          assert.equal(request.searchParams.get("redirect_uri"), "https://test-extension.chromiumapp.org/mcp");
          const state = request.searchParams.get("state");
          assert.ok(state);
          authorizationPrompts++;
          assert.equal(request.searchParams.get("scope"), authorizationPrompts === 2 ? "read write" : "read");
          authorized = true;
          return `https://test-extension.chromiumapp.org/mcp?code=test-code&state=${encodeURIComponent(state)}&iss=${encodeURIComponent(origin)}`;
        },
      },
      storage: {
        session: {
          get: async (key: string) => ({ [key]: stored.get(key) }),
          set: async (items: Record<string, unknown>) => { for (const [key, value] of Object.entries(items)) stored.set(key, value); },
          remove: async (key: string) => { stored.delete(key); },
        },
        local: {
          setAccessLevel: async (options: { accessLevel: string }) => { assert.equal(options.accessLevel, "TRUSTED_CONTEXTS"); },
          get: async (key: string) => ({ [key]: durable.get(key) }),
          set: async (items: Record<string, unknown>) => { for (const [key, value] of Object.entries(items)) durable.set(key, value); },
          remove: async (key: string) => { durable.delete(key); },
        },
      },
    } as unknown as typeof chrome;
    try {
      server = createServer(async (request, response) => {
        const path = new URL(request.url || "/", origin).pathname;
        seen.push(path);
        if (path.includes("oauth-protected-resource")) {
          response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: ["read"] }));
          return;
        }
        if (path.includes("oauth-authorization-server") || path.includes("openid-configuration")) {
          response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
            issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`,
            registration_endpoint: `${origin}/register`,
            response_types_supported: ["code"], code_challenge_methods_supported: ["S256"],
            authorization_response_iss_parameter_supported: true,
          }));
          return;
        }
        if (path === "/register") {
          let body = "";
          for await (const chunk of request) body += chunk;
          const registration = JSON.parse(body) as { redirect_uris: string[]; token_endpoint_auth_method: string };
          assert.deepEqual(registration.redirect_uris, ["https://test-extension.chromiumapp.org/mcp"]);
          assert.equal(registration.token_endpoint_auth_method, "none");
          registrations++;
          response.writeHead(201, { "Content-Type": "application/json" }).end(JSON.stringify({ ...registration, client_id: "dynamic-client" }));
          return;
        }
        if (path === "/token") {
          let body = "";
          for await (const chunk of request) body += chunk;
          const form = new URLSearchParams(body);
          assert.equal(form.get("grant_type"), "authorization_code");
          assert.equal(form.get("code"), "test-code");
          assert.ok(form.get("code_verifier"));
          assert.equal(form.get("resource"), `${origin}/mcp`);
          tokenExchanges++;
          response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
            access_token: tokenExchanges === 1 ? "test-token" : "elevated-token",
            refresh_token: tokenExchanges === 1 ? "refresh-one" : "refresh-two",
            token_type: "Bearer", expires_in: 3600, scope: tokenExchanges === 1 ? "read" : "read write",
          }));
          return;
        }
        if (path === "/mcp") {
          if (!request.headers.authorization?.startsWith("Bearer ")) {
            response.writeHead(401, { "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"` }).end();
            return;
          }
          let body = "";
          for await (const chunk of request) body += chunk;
          const message = JSON.parse(body) as { id: number; method: string };
          if (message.method === "tools/call" && request.headers.authorization !== "Bearer elevated-token") {
            response.writeHead(403, { "WWW-Authenticate": `Bearer error="insufficient_scope", scope="read write", resource_metadata="${origin}/.well-known/oauth-protected-resource"` }).end();
            return;
          }
          const result = message.method === "server/discover"
            ? { resultType: "complete", supportedVersions: ["2026-07-28"], capabilities: { tools: {} }, _meta: { "io.modelcontextprotocol/serverInfo": { name: "test", version: "1.0" } } }
            : message.method === "tools/list"
              ? { resultType: "complete", ttlMs: 0, cacheScope: "private", tools: [{ name: "echo", inputSchema: { type: "object", properties: {} } }] }
              : { resultType: "complete", content: [{ type: "text", text: "done" }] };
          response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
          return;
        }
        response.writeHead(404).end();
      });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      origin = `http://127.0.0.1:${address.port}`;
      const settings = { id: "oauth", url: `${origin}/mcp`, headers: {}, auth: { type: "oauth" as const, clientId: "test-client" } };
      await assert.rejects(connectMcpServer(settings, new AbortController().signal), /로그인/);
      const connection = await connectMcpServer(settings, new AbortController().signal, true);
      assert.equal(connection.tools.length, 1);
      await connection.close();
      assert.equal(authorized, true);
      assert.equal(tokenExchanges, 1);
      assert.ok(seen.some((path) => path.includes("oauth-protected-resource")));
      const saved = durable.get("qumiMcpOAuth:oauth") as { tokens?: { access_token: string; refresh_token: string }; state?: string };
      assert.equal(saved.tokens?.access_token, "test-token");
      assert.equal(saved.tokens?.refresh_token, "refresh-one");
      assert.equal(saved.state, undefined);
      stored.clear(); // Simulate a browser restart clearing chrome.storage.session.
      const another = await connectMcpServer(settings, new AbortController().signal);
      await assert.rejects(another.tools[0].execute({}, new AbortController().signal), /로그인/);
      await another.close();
      assert.equal(tokenExchanges, 1);
      const elevated = await connectMcpServer(settings, new AbortController().signal, true);
      assert.match(await elevated.tools[0].execute({}, new AbortController().signal), /done/);
      await elevated.close();
      assert.equal(tokenExchanges, 2);
      assert.equal(authorizationPrompts, 2);
      const dynamic = await connectMcpServer({ id: "dynamic", url: `${origin}/mcp`, headers: {}, auth: { type: "oauth" } }, new AbortController().signal, true);
      await dynamic.close();
      assert.equal(registrations, 1);
      assert.equal(authorizationPrompts, 3);
      await forgetMcpAuthorization("oauth");
      await forgetMcpAuthorization("dynamic");
      assert.equal(durable.size, 0);
      await assert.rejects(connectMcpServer(settings, new AbortController().signal), /로그인/);
    } finally {
      globalThis.chrome = oldChrome;
    }
  });

  it("rejects an OAuth callback with the wrong state before token exchange", async () => {
    const oldChrome = globalThis.chrome;
    const stored = new Map<string, unknown>();
    const durable = new Map<string, unknown>();
    globalThis.chrome = {
      identity: {
        getRedirectURL: () => "https://test-extension.chromiumapp.org/mcp",
        launchWebAuthFlow: async () => "https://test-extension.chromiumapp.org/mcp?code=stolen&state=wrong",
      },
      storage: {
        session: {
          get: async (key: string) => ({ [key]: stored.get(key) }),
          set: async (items: Record<string, unknown>) => { for (const [key, value] of Object.entries(items)) stored.set(key, value); },
          remove: async (key: string) => { stored.delete(key); },
        },
        local: {
          get: async (key: string) => ({ [key]: durable.get(key) }),
          set: async (items: Record<string, unknown>) => { for (const [key, value] of Object.entries(items)) durable.set(key, value); },
          remove: async (key: string) => { durable.delete(key); },
        },
      },
    } as unknown as typeof chrome;
    try {
      const provider = await BrowserMcpOAuthProvider.create("state-test", "https://example.com/mcp", { type: "oauth" });
      await provider.state();
      await provider.redirectToAuthorization(new URL("https://example.com/authorize?client_id=test"));
      await assert.rejects(provider.authorize(), /상태 검증/);
      assert.equal(await provider.hasTokens(), false);
    } finally {
      await forgetMcpAuthorization("state-test");
      globalThis.chrome = oldChrome;
    }
  });
});
