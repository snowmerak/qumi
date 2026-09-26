import type {
  OAuthClientProvider, OAuthDiscoveryState, StoredOAuthClientInformation, StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import { auth } from "@modelcontextprotocol/client";

export interface McpOAuthSettings {
  type: "oauth";
  clientId?: string;
  clientMetadataUrl?: string;
  scope?: string;
}

interface OAuthRecord {
  serverUrl: string;
  configuration: string;
  client?: StoredOAuthClientInformation;
  staticIssuer?: string;
  tokens?: StoredOAuthTokens;
  codeVerifier?: string;
  state?: string;
  authorizationUrl?: string;
  discovery?: OAuthDiscoveryState;
}

const memoryRecords = new Map<string, OAuthRecord>();
const keyFor = (id: string) => `qumiMcpOAuth:${id}`;

async function readRecord(id: string): Promise<OAuthRecord | undefined> {
  if (typeof chrome !== "undefined" && chrome.storage?.local && chrome.storage?.session) {
    const key = keyFor(id);
    const [local, session] = await Promise.all([chrome.storage.local.get(key), chrome.storage.session.get(key)]);
    const durable = local[key] as OAuthRecord | undefined;
    const transient = session[key] as OAuthRecord | undefined;
    if (!durable) return transient; // Migrate records written by earlier session-only builds.
    if (transient?.serverUrl === durable.serverUrl && transient.configuration === durable.configuration) {
      return { ...durable, codeVerifier: transient.codeVerifier, state: transient.state, authorizationUrl: transient.authorizationUrl };
    }
    return durable;
  }
  return memoryRecords.get(id);
}

async function writeRecord(id: string, record: OAuthRecord): Promise<void> {
  if (typeof chrome !== "undefined" && chrome.storage?.local && chrome.storage?.session) {
    const key = keyFor(id);
    const { serverUrl, configuration, client, staticIssuer, tokens, discovery, codeVerifier, state, authorizationUrl } = record;
    await chrome.storage.local.set({ [key]: { serverUrl, configuration, client, staticIssuer, tokens, discovery } });
    await chrome.storage.session.set({ [key]: { serverUrl, configuration, codeVerifier, state, authorizationUrl } });
  } else {
    memoryRecords.set(id, record);
  }
}

export async function forgetMcpAuthorization(id: string): Promise<void> {
  if (typeof chrome !== "undefined" && chrome.storage?.local && chrome.storage?.session) {
    await Promise.all([chrome.storage.local.remove(keyFor(id)), chrome.storage.session.remove(keyFor(id))]);
  } else {
    memoryRecords.delete(id);
  }
}

export class McpAuthorizationRequiredError extends Error {
  constructor() { super("MCP 로그인이 필요합니다. 설정의 MCP 서버에서 로그인을 눌러 주세요."); }
}

export class BrowserMcpOAuthProvider implements OAuthClientProvider {
  readonly clientMetadataUrl?: string;
  private record: OAuthRecord;
  private readonly id: string;
  private readonly settings: McpOAuthSettings;

  private constructor(id: string, settings: McpOAuthSettings, record: OAuthRecord) {
    this.id = id;
    this.settings = settings;
    this.record = record;
    this.clientMetadataUrl = settings.clientMetadataUrl;
  }

  static async create(id: string, url: string, settings: McpOAuthSettings): Promise<BrowserMcpOAuthProvider> {
    if (typeof chrome === "undefined" || !chrome.identity?.getRedirectURL || !chrome.identity?.launchWebAuthFlow) {
      throw new Error("MCP OAuth 로그인은 Chrome 확장에서 사용할 수 있습니다.");
    }
    await chrome.storage?.local?.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
    const configuration = JSON.stringify(settings);
    const saved = await readRecord(id);
    const record = saved?.serverUrl === url && saved.configuration === configuration
      ? saved : { serverUrl: url, configuration };
    const provider = new BrowserMcpOAuthProvider(id, settings, record);
    if (saved) await provider.persist();
    return provider;
  }

  get redirectUrl(): string { return chrome.identity.getRedirectURL("mcp"); }

  get clientMetadata() {
    return {
      redirect_uris: [this.redirectUrl],
      client_name: "Qumi",
      application_type: "web",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      ...(this.settings.scope ? { scope: this.settings.scope } : {}),
    };
  }

  async hasTokens(): Promise<boolean> { return !!this.record.tokens?.access_token; }
  hasPendingAuthorization(): boolean { return !!this.record.authorizationUrl && !!this.record.state; }

  async state(): Promise<string> {
    this.record.state = crypto.randomUUID();
    await this.persist();
    return this.record.state;
  }

  async clientInformation(ctx?: { issuer: string }): Promise<StoredOAuthClientInformation | undefined> {
    if (this.settings.clientId) {
      if (ctx && this.record.staticIssuer && this.record.staticIssuer !== ctx.issuer) {
        throw new Error("MCP 인증 서버가 변경되었습니다. 서버 설정을 다시 확인해 주세요.");
      }
      if (ctx && !this.record.staticIssuer) {
        this.record.staticIssuer = ctx.issuer;
        await this.persist();
      }
      return { client_id: this.settings.clientId, ...(this.record.staticIssuer ? { issuer: this.record.staticIssuer } : {}) };
    }
    return this.record.client;
  }

  async saveClientInformation(value: StoredOAuthClientInformation): Promise<void> {
    this.record.client = value;
    await this.persist();
  }

  async tokens(): Promise<StoredOAuthTokens | undefined> { return this.record.tokens; }

  async saveTokens(value: StoredOAuthTokens): Promise<void> {
    this.record.tokens = value;
    await this.persist();
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    this.record.authorizationUrl = url.href;
    await this.persist();
  }

  async saveCodeVerifier(value: string): Promise<void> {
    this.record.codeVerifier = value;
    await this.persist();
  }

  codeVerifier(): string {
    if (!this.record.codeVerifier) throw new Error("MCP 로그인 검증 정보가 없습니다. 다시 로그인해 주세요.");
    return this.record.codeVerifier;
  }

  async saveDiscoveryState(value: OAuthDiscoveryState): Promise<void> {
    this.record.discovery = value;
    await this.persist();
  }

  discoveryState(): OAuthDiscoveryState | undefined { return this.record.discovery; }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    if (scope === "all" || scope === "client") this.record.client = undefined;
    if (scope === "all" || scope === "tokens") this.record.tokens = undefined;
    if (scope === "all" || scope === "verifier") this.record.codeVerifier = undefined;
    if (scope === "all") { this.record.state = undefined; this.record.authorizationUrl = undefined; }
    if (scope === "all" || scope === "discovery") this.record.discovery = undefined;
    await this.persist();
  }

  async authorize(): Promise<void> {
    const authorizationUrl = this.record.authorizationUrl;
    if (!authorizationUrl) throw new McpAuthorizationRequiredError();
    try {
      const callback = await chrome.identity.launchWebAuthFlow({ url: authorizationUrl, interactive: true });
      if (!callback) throw new Error("MCP 로그인이 완료되지 않았습니다.");
      const expected = new URL(this.redirectUrl);
      const returned = new URL(callback);
      if (returned.origin !== expected.origin || returned.pathname !== expected.pathname) {
        throw new Error("MCP 로그인 리다이렉트 주소가 일치하지 않습니다.");
      }
      if (!this.record.state || returned.searchParams.get("state") !== this.record.state) {
        throw new Error("MCP 로그인 상태 검증에 실패했습니다. 다시 로그인해 주세요.");
      }
      const code = returned.searchParams.get("code");
      if (!code || returned.searchParams.has("error")) throw new Error("MCP 로그인이 완료되지 않았습니다.");
      // The SDK validates `iss` against the stored issuer before exchanging the code.
      const result = await auth(this, {
        serverUrl: this.record.serverUrl,
        authorizationCode: code,
        iss: returned.searchParams.get("iss") ?? undefined,
        scope: new URL(authorizationUrl).searchParams.get("scope") ?? undefined,
      });
      if (result !== "AUTHORIZED") throw new Error("MCP 로그인이 완료되지 않았습니다.");
    } finally {
      this.record.state = undefined;
      this.record.codeVerifier = undefined;
      this.record.authorizationUrl = undefined;
      await this.persist();
    }
  }

  private persist(): Promise<void> { return writeRecord(this.id, this.record); }
}
