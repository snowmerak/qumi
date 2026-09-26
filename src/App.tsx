import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import {
  listModelDetails,
  normalizeGatewayUrl,
  type ChatMessage,
  type GatewayModel,
} from "./gateway";
import { emptyAgentState, runTurn, type AgentState } from "./agent";
import { approvalPolicyFrom, requiresBrowserApproval } from "./browser-approval";
import { browserTurnTools } from "./browser-turn-tools";
import { clearExecutionLog, createExecutionLog, readExecutionLog } from "./execution-log";
import { emptyState, loadState, saveState, type AppSettings } from "./storage";
import { canReadPages, capturePageTarget, getActiveBrowserTab, getActivePageCandidate, hasPageAccess, requestPageAccess, type TabAction, type PageCandidate, type PageTarget } from "./page-context";
import { promptWithSelections, type PageSelection } from "./page-selection";
import { cancelPageRegion, capturePageRegion } from "./page-region";
import { formatNumber, languagePreferenceFrom, localizeApprovalDetail, localizeApprovalTitle, localizeKnownError, resolveLocale, translate, type LanguagePreference, type Locale, type MessageKey } from "./i18n";
import { connectMcpServer, connectMcpServers, validateMcpServer } from "./mcp-tools";
import { forgetMcpAuthorization } from "./mcp-oauth";
import { installSkillFiles, type InstalledSkill } from "./skills";

type Connection = "checking" | "connected" | "disconnected";
type PendingAction = { title: string; detail: string; decide: (approved: boolean) => void };

function Icon({ name }: { name: "settings" | "back" | "plus" | "send" | "eye" }): ReactElement {
  const paths = {
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.9 1.9-.06-.06A1.7 1.7 0 0 0 16 18.4a1.7 1.7 0 0 0-1 .6V21h-6v-2a1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.84.38l-.06.06-1.9-1.9.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1H2v-4h2a1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.88L4.2 7.06l1.9-1.9.06.06A1.7 1.7 0 0 0 8 5.6a1.7 1.7 0 0 0 1-.6V3h6v2a1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.84-.38l.06-.06 1.9 1.9-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 .6 1h2v4h-2a1.7 1.7 0 0 0-.6 1Z" /></>,
    back: <><path d="m14.5 5-7 7 7 7" /><path d="M8 12h13" /></>,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    send: <><path d="m21 3-8 18-3.5-7.5L2 10z" /><path d="M9.5 13.5 21 3" /></>,
    eye: <><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="2.5" /></>,
  };
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function Status({ connection, locale }: { connection: Connection; locale: Locale }) {
  const label = translate(locale, connection);
  return <span className={`connection connection--${connection}`} role="status"><span className="connection__dot" />{label}</span>;
}

function SelectionNote({ selection, number, onRemove, locale }: { selection: PageSelection; number: number; onRemove?: () => void; locale: Locale }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`selection-note ${expanded ? "selection-note--expanded" : ""}`}>
      <button className="selection-note__trigger" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{translate(locale, "annotation", { number })}</button>
      {onRemove && <button className="selection-note__remove" type="button" aria-label={translate(locale, "removeAnnotation", { number })} onClick={onRemove}>×</button>}
      <div className="selection-note__detail">
        <div className="selection-note__source" title={selection.url}>{selection.title} · {selection.url}</div>
        <div className="selection-note__selector">{selection.selector}</div>
        <div className="selection-note__section">{translate(locale, "regionText")}</div>
        <pre>{selection.text}</pre>
        <div className="selection-note__section">{translate(locale, "regionHtml")}{selection.truncated ? translate(locale, "attachmentTruncated") : ""}</div>
        <pre>{selection.html}</pre>
      </div>
    </div>
  );
}

function SelectionNotes({ selections, onRemove, locale }: { selections: PageSelection[]; onRemove?: (index: number) => void; locale: Locale }) {
  if (!selections.length) return null;
  return <div className="selection-notes">{selections.map((selection, index) => <SelectionNote key={`${selection.url}:${selection.selector}:${index}`} selection={selection} number={index + 1} onRemove={onRemove ? () => onRemove(index) : undefined} locale={locale} />)}</div>;
}

interface SettingsViewProps {
  settings: AppSettings;
  availableModels: GatewayModel[];
  onClose: () => void;
  onSave: (settings: AppSettings, models: GatewayModel[]) => void;
  skills: InstalledSkill[];
  onSkillsChange: (skills: InstalledSkill[]) => void;
  onExportLog: () => Promise<number>;
  onClearLog: () => Promise<void>;
  onLanguageChange: (language: LanguagePreference) => void;
}

function SettingsView({ settings, availableModels, onClose, onSave, skills, onSkillsChange, onExportLog, onClearLog, onLanguageChange }: SettingsViewProps) {
  const [draft, setDraft] = useState(settings);
  const [checkedModels, setCheckedModels] = useState<GatewayModel[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [logMessage, setLogMessage] = useState("");
  const [mcpId, setMcpId] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpHeaders, setMcpHeaders] = useState("{}");
  const [mcpAuthMode, setMcpAuthMode] = useState<"headers" | "oauth">("headers");
  const [mcpClientId, setMcpClientId] = useState("");
  const [mcpMetadataUrl, setMcpMetadataUrl] = useState("");
  const [mcpScope, setMcpScope] = useState("");
  const [mcpMessage, setMcpMessage] = useState("");
  const [mcpBusy, setMcpBusy] = useState(false);
  const [skillMessage, setSkillMessage] = useState("");
  const locale = resolveLocale(draft.language);
  const tr = (key: MessageKey, variables?: Record<string, string | number>) => translate(locale, key, variables);
  const sameGateway = draft.baseUrl === settings.baseUrl && draft.apiKey === settings.apiKey;
  const models = checkedModels ?? (sameGateway ? availableModels : []);

  function changeGateway(field: "baseUrl" | "apiKey", value: string) {
    setDraft({ ...draft, [field]: value, model: "" });
    setCheckedModels(null);
    setMessage("");
  }

  const selectedModel = models.find((model) => model.id === draft.model);

  function addMcpServer() {
    try {
      const parsed: unknown = JSON.parse(mcpHeaders);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some((value) => typeof value !== "string")) throw new Error(tr("mcpHeadersInvalid"));
      const server = validateMcpServer({
        id: mcpId.trim(), url: mcpUrl.trim(), headers: parsed as Record<string, string>,
        ...(mcpAuthMode === "oauth" ? { auth: { type: "oauth" as const, clientId: mcpClientId, clientMetadataUrl: mcpMetadataUrl, scope: mcpScope } } : {}),
      });
      if (draft.mcpServers.some((current) => current.id === server.id)) throw new Error(tr("mcpIdExists"));
      setDraft((current) => ({ ...current, mcpServers: [...current.mcpServers, server] }));
      setMcpId(""); setMcpUrl(""); setMcpHeaders("{}"); setMcpAuthMode("headers");
      setMcpClientId(""); setMcpMetadataUrl(""); setMcpScope(""); setMcpMessage("");
    } catch (error) { setMcpMessage(error instanceof Error ? localizeKnownError(locale, error.message) : tr("mcpAddFailed")); }
  }

  async function checkMcpServer(server: AppSettings["mcpServers"][number], interactive: boolean): Promise<void> {
    setMcpBusy(true);
    setMcpMessage("");
    try {
      const connection = await connectMcpServer(server, interactive ? new AbortController().signal : AbortSignal.timeout(10_000), interactive);
      setMcpMessage(tr("mcpConnected", { count: connection.tools.length }));
      await connection.close();
    } catch (error) {
      setMcpMessage(error instanceof Error ? error.message : tr("mcpConnectFailed"));
    } finally {
      setMcpBusy(false);
    }
  }

  async function removeMcpServer(id: string): Promise<void> {
    try {
      await forgetMcpAuthorization(id);
      setDraft((current) => ({ ...current, mcpServers: current.mcpServers.filter((item) => item.id !== id) }));
      setMcpMessage("");
    } catch (error) {
      setMcpMessage(error instanceof Error ? error.message : tr("mcpConnectFailed"));
    }
  }

  async function importSkills(files: FileList | null) {
    if (!files?.length) return;
    try {
      const imported = await installSkillFiles(files);
      if (!imported.length) throw new Error(tr("skillFileMissing"));
      const next = [...skills];
      for (const skill of imported) {
        const index = next.findIndex((current) => current.id === skill.id);
        if (index >= 0) next[index] = skill;
        else next.push(skill);
      }
      onSkillsChange(next);
      setSkillMessage(tr("skillsInstalled", { count: imported.length }));
    } catch (error) { setSkillMessage(error instanceof Error ? localizeKnownError(locale, error.message) : tr("skillImportFailed")); }
  }

  async function checkConnection(): Promise<GatewayModel[] | null> {
    setTesting(true);
    setMessage("");
    try {
      const found = await listModelDetails(draft);
      if (found.length === 0) throw new Error(tr("noAvailableModels"));
      setCheckedModels(found);
      setDraft((current) => {
        const existing = found.some((model) => model.id === current.model);
        return {
          ...current,
          baseUrl: normalizeGatewayUrl(current.baseUrl),
          model: existing ? current.model : found[0].id,
          apiMode: (existing ? current.model : found[0].id).startsWith("codex/") ? "chat_completions" : current.apiMode,
          contextWindowOverride: existing ? current.contextWindowOverride : 0,
        };
      });
      setIsError(false);
      setMessage(tr("modelsFound", { count: formatNumber(locale, found.length) }));
      return found;
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? localizeKnownError(locale, error.message) : tr("gatewayConnectFailed"));
      return null;
    } finally {
      setTesting(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (settings.baseUrl && sameGateway && draft.model === settings.model && draft.contextWindowOverride === settings.contextWindowOverride) {
      onSave(draft, models);
      return;
    }
    const found = sameGateway && models.length ? models : await checkConnection();
    if (!found) return;
    const model = found.find((entry) => entry.id === draft.model) ?? found[0];
    const contextWindowOverride = model.id === draft.model ? draft.contextWindowOverride : 0;
    if (!model.contextLength && !contextWindowOverride) {
      setIsError(true);
      setMessage(tr("contextLengthMissing"));
      return;
    }
    onSave({ ...draft, baseUrl: normalizeGatewayUrl(draft.baseUrl), model: model.id, apiMode: model.id.startsWith("codex/") ? "chat_completions" : draft.apiMode, contextWindowOverride }, found);
  }

  return (
    <div className="settings-view">
      <button className="mp-button mp-button--ghost back-button" type="button" onClick={onClose}><Icon name="back" />{tr("backToChat")}</button>
      <div className="settings-heading">
        <h2>{tr("settingsTitle")}</h2>
        <p>{tr("settingsIntro")}</p>
      </div>
      <form className="settings-form" onSubmit={submit}>
        <div className="mp-field">
          <label className="mp-field__label" htmlFor="settings-language">{tr("language")}</label>
          <select id="settings-language" className="mp-select" value={draft.language} onChange={(event) => { const language = languagePreferenceFrom(event.target.value); setDraft((current) => ({ ...current, language })); setMessage(""); setLogMessage(""); onLanguageChange(language); }} aria-describedby="settings-language-hint">
            <option value="auto">{tr("languageAuto")}</option>
            <option value="en">English</option>
            <option value="ko">한국어</option>
            <option value="ja">日本語</option>
            <option value="zh">简体中文</option>
          </select>
          <p id="settings-language-hint" className="mp-field__hint">{tr("languageHint")}</p>
        </div>
        <div className="mp-field">
          <label className="mp-field__label" htmlFor="gateway-url">Gateway URL</label>
          <input id="gateway-url" className="mp-input" type="url" required placeholder="http://127.0.0.1:8080/v1" value={draft.baseUrl} onChange={(event) => changeGateway("baseUrl", event.target.value)} aria-describedby="gateway-url-hint" />
          <p id="gateway-url-hint" className="mp-field__hint">{tr("gatewayUrlHint")}</p>
        </div>
        <div className="mp-field">
          <label className="mp-field__label" htmlFor="gateway-key">{tr("apiKeyOptional")}</label>
          <div className="password-field">
            <input id="gateway-key" className="mp-input" type={showKey ? "text" : "password"} value={draft.apiKey} onChange={(event) => changeGateway("apiKey", event.target.value)} autoComplete="off" aria-describedby="gateway-key-hint" />
            <button type="button" className="password-field__toggle" aria-label={tr(showKey ? "hideApiKey" : "showApiKey")} onClick={() => setShowKey(!showKey)}><Icon name="eye" /></button>
          </div>
          <p id="gateway-key-hint" className="mp-field__hint">{tr("apiKeyHint")}</p>
        </div>
        <div className="mp-field">
          <label className="mp-field__label" htmlFor="settings-model">{tr("model")}</label>
          <select id="settings-model" className="mp-select" value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value, apiMode: event.target.value.startsWith("codex/") ? "chat_completions" : draft.apiMode, contextWindowOverride: 0 })} disabled={models.length === 0}>
            {models.length === 0 && <option value="">{tr("selectAfterConnection")}</option>}
            {models.map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}
          </select>
          <p className="mp-field__hint">{tr("modelHint")}</p>
        </div>
        <div className="mp-field">
          <label className="mp-field__label" htmlFor="api-mode">{tr("modelApi")}</label>
          <select id="api-mode" className="mp-select" value={draft.apiMode ?? "chat_completions"} onChange={(event) => setDraft({ ...draft, apiMode: event.target.value === "responses" ? "responses" : "chat_completions" })} aria-describedby="api-mode-hint">
            <option value="chat_completions">Chat Completions</option>
            <option value="responses" disabled={draft.model.startsWith("codex/")}>Responses</option>
          </select>
          <p id="api-mode-hint" className="mp-field__hint">{tr(draft.model.startsWith("codex/") ? "codexApiHint" : "responsesApiHint")}</p>
        </div>
        <div className="mp-field">
          <label className="mp-field__label" htmlFor="context-window">{tr("contextLength")}</label>
          <input id="context-window" className="mp-input" type="number" min="1024" step="1" placeholder={selectedModel?.contextLength ? String(selectedModel.contextLength) : tr("contextPlaceholder")} value={draft.contextWindowOverride || ""} onChange={(event) => setDraft({ ...draft, contextWindowOverride: event.target.value ? Number(event.target.value) : 0 })} />
          <p className="mp-field__hint">{selectedModel?.contextLength ? tr("contextProvided", { count: formatNumber(locale, selectedModel.contextLength) }) : tr("contextMissing")}</p>
        </div>
        <div className="mp-field">
          <label className="mp-field__label" htmlFor="approval-policy">{tr("approvalPolicy")}</label>
          <select id="approval-policy" className="mp-select" value={draft.approvalPolicy} onChange={(event) => setDraft({ ...draft, approvalPolicy: approvalPolicyFrom(event.target.value) })} aria-describedby="approval-policy-hint">
            <option value="all">{tr("approvalAll")}</option>
            <option value="changes">{tr("approvalChanges")}</option>
            <option value="none">{tr("approvalNone")}</option>
          </select>
          <p id="approval-policy-hint" className="mp-field__hint">{tr("approvalHint")}</p>
        </div>
        <div className="mp-field">
          <span className="mp-field__label">{tr("mcpServers")}</span>
          <p className="mp-field__hint">{tr("mcpHint")}</p>
          {draft.mcpServers.map((server) => <div className="integration-row integration-row--mcp" key={server.id}>
            <span><strong>{server.id}</strong><small>{server.url}</small></span>
            {server.auth && <button className="mp-button mp-button--ghost" type="button" disabled={mcpBusy} onClick={() => void checkMcpServer(server, true)}>{tr("mcpSignIn")}</button>}
            {server.auth && <button className="mp-button mp-button--ghost" type="button" disabled={mcpBusy} onClick={() => void forgetMcpAuthorization(server.id).then(() => setMcpMessage(tr("mcpSignedOut"))).catch((error) => setMcpMessage(error instanceof Error ? error.message : tr("mcpConnectFailed")))}>{tr("mcpSignOut")}</button>}
            <button className="mp-button mp-button--ghost" type="button" disabled={mcpBusy} onClick={() => void checkMcpServer(server, false)}>{tr("checkConnection")}</button>
            <button className="mp-button mp-button--ghost" type="button" disabled={mcpBusy} onClick={() => void removeMcpServer(server.id)}>{tr("remove")}</button>
          </div>)}
          <input className="mp-input" type="text" value={mcpId} onChange={(event) => setMcpId(event.target.value)} placeholder={tr("mcpName")} aria-label={tr("mcpName")} />
          <input className="mp-input" type="url" value={mcpUrl} onChange={(event) => setMcpUrl(event.target.value)} placeholder="https://example.com/mcp" aria-label={tr("mcpUrl")} />
          <select className="mp-select" value={mcpAuthMode} onChange={(event) => setMcpAuthMode(event.target.value === "oauth" ? "oauth" : "headers")} aria-label={tr("mcpAuthMode")}>
            <option value="headers">{tr("mcpHeaderAuth")}</option>
            <option value="oauth">OAuth</option>
          </select>
          <textarea className="mp-input" value={mcpHeaders} onChange={(event) => setMcpHeaders(event.target.value)} aria-label={tr("mcpHeaders")} rows={2} />
          {mcpAuthMode === "oauth" && <>
            <input className="mp-input" type="text" value={mcpClientId} onChange={(event) => setMcpClientId(event.target.value)} placeholder={tr("mcpClientId")} aria-label={tr("mcpClientId")} autoComplete="off" />
            <input className="mp-input" type="url" value={mcpMetadataUrl} onChange={(event) => setMcpMetadataUrl(event.target.value)} placeholder={tr("mcpClientMetadataUrl")} aria-label={tr("mcpClientMetadataUrl")} />
            <input className="mp-input" type="text" value={mcpScope} onChange={(event) => setMcpScope(event.target.value)} placeholder={tr("mcpScopes")} aria-label={tr("mcpScopes")} />
            <p className="mp-field__hint">{tr("mcpOAuthHint")}</p>
          </>}
          <button className="mp-button mp-button--secondary" type="button" onClick={addMcpServer}>{tr("addMcpServer")}</button>
          {mcpMessage && <p className="mp-field__hint" role="status">{mcpMessage}</p>}
        </div>
        <div className="mp-field">
          <span className="mp-field__label">{tr("agentSkills")}</span>
          <p className="mp-field__hint">{tr("skillHint")}</p>
          {skills.map((skill) => <div className="integration-row" key={skill.id}><span><strong>{skill.name}</strong><small>{skill.description}</small></span><button className="mp-button mp-button--ghost" type="button" onClick={() => onSkillsChange(skills.filter((item) => item.id !== skill.id))}>{tr("remove")}</button></div>)}
          <label className="mp-button mp-button--secondary integration-upload">{tr("importSkillFile")}<input type="file" accept=".md,text/markdown" onChange={(event) => { void importSkills(event.target.files); event.target.value = ""; }} /></label>
          <label className="mp-button mp-button--secondary integration-upload">{tr("importSkillFolder")}<input type="file" multiple {...{ webkitdirectory: "" }} onChange={(event) => { void importSkills(event.target.files); event.target.value = ""; }} /></label>
          {skillMessage && <p className="mp-field__hint" role="status">{skillMessage}</p>}
        </div>
        <div className="mp-field">
          <span className="mp-field__label">{tr("executionLog")}</span>
          <p className="mp-field__hint">{tr("logHint")}</p>
          <div className="execution-log-actions">
            <button className="mp-button mp-button--secondary" type="button" onClick={() => void onExportLog().then((count) => setLogMessage(tr("logDownloaded", { count: formatNumber(locale, count) }))).catch(() => setLogMessage(tr("logDownloadFailed")))}>{tr("downloadJson")}</button>
            <button className="mp-button mp-button--ghost" type="button" onClick={() => void onClearLog().then(() => setLogMessage(tr("logCleared"))).catch(() => setLogMessage(tr("logClearFailed")))}>{tr("clearLog")}</button>
          </div>
          {logMessage && <p className="mp-field__hint" role="status">{logMessage}</p>}
        </div>
        <button className="mp-button mp-button--secondary" type="button" onClick={() => void checkConnection()} disabled={testing}>{tr(testing ? "checkingEllipsis" : "checkConnection")}</button>
        {message && <div className={`inline-notice ${isError ? "inline-notice--error" : "inline-notice--success"}`} role={isError ? "alert" : "status"}>{message}</div>}
        <button className="mp-button mp-button--primary save-button" type="submit" disabled={testing}>{tr(testing ? "checkingEllipsis" : "save")}</button>
      </form>
    </div>
  );
}

export function App() {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<"chat" | "settings">("chat");
  const [settings, setSettings] = useState<AppSettings>(emptyState.settings);
  const [skills, setSkills] = useState<InstalledSkill[]>([]);
  const locale = resolveLocale(settings.language);
  const tr = (key: MessageKey, variables?: Record<string, string | number>) => translate(locale, key, variables);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agent, setAgent] = useState<AgentState>(emptyAgentState);
  const [models, setModels] = useState<GatewayModel[]>([]);
  const [connection, setConnection] = useState<Connection>("disconnected");
  const [draft, setDraft] = useState("");
  const [selectedRegions, setSelectedRegions] = useState<PageSelection[]>([]);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState("");
  const [streamed, setStreamed] = useState("");
  const [thinking, setThinking] = useState("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [pageTarget, setPageTarget] = useState<PageTarget | null>(null);
  const [pageCandidate, setPageCandidate] = useState<PageCandidate | null>(null);
  const [pageError, setPageError] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const thinkingContent = useRef<HTMLParagraphElement>(null);
  const responseStarted = useRef(false);
  const requestController = useRef<AbortController | null>(null);
  const pageCandidateRef = useRef<PageCandidate | null>(null);
  const regionTargetRef = useRef<PageTarget | null>(null);

  useEffect(() => { document.documentElement.lang = locale === "zh" ? "zh-CN" : locale; }, [locale]);

  useEffect(() => {
    let active = true;
    void loadState().then((saved) => {
      if (!active) return;
      setSettings(saved.settings);
      setSkills(saved.skills);
      setMessages(saved.messages);
      setAgent(saved.agent);
      setReady(true);
      if (!saved.settings.baseUrl) return;
      setConnection("checking");
      void listModelDetails(saved.settings).then((found) => {
        if (!active) return;
        if (found.length === 0) {
          setConnection("disconnected");
          return;
        }
        setModels(found);
        setConnection("connected");
        if (!found.some((model) => model.id === saved.settings.model)) {
          setSettings({ ...saved.settings, model: found[0].id, contextWindowOverride: 0 });
          setMessages([]);
          setAgent(emptyAgentState());
        }
      }).catch(() => { if (active) setConnection("disconnected"); });
    }).catch(() => { if (active) { setReady(true); setError(tr("readSettingsFailed")); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (ready) void saveState({ settings, messages, agent, skills }).catch(() => setError(tr("saveConversationFailed")));
  }, [ready, settings, messages, agent, skills]);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: sending ? "auto" : "smooth" });
    if (thinkingContent.current) thinkingContent.current.scrollTop = thinkingContent.current.scrollHeight;
  }, [messages, streamed, thinking, sending]);

  useEffect(() => {
    if (!canReadPages()) return;
    let active = true;
    let revision = 0;
    let currentTabId: number | null = null;
    const refresh = () => {
      const currentRevision = ++revision;
      void getActivePageCandidate().then((candidate) => {
        if (active && currentRevision === revision) {
          currentTabId = candidate?.tabId ?? null;
          pageCandidateRef.current = candidate;
          setPageCandidate(candidate);
          setPageTarget((current) => candidate && !candidate.loading && current?.tabId === candidate.tabId && current.url === candidate.url ? current : null);
          setPageError("");
        }
      }).catch(() => { if (active && currentRevision === revision) { currentTabId = null; pageCandidateRef.current = null; setPageCandidate(null); setPageTarget(null); } });
    };
    const onUpdated = (tabId: number, change: { status?: string; url?: string }) => {
      if ((tabId === currentTabId && (change.url || change.status === "loading" || change.status === "complete")) || (currentTabId === null && change.url)) refresh();
    };
    refresh();
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(refresh);
    chrome.permissions.onAdded.addListener(refresh);
    chrome.permissions.onRemoved.addListener(refresh);
    return () => {
      active = false;
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(refresh);
      chrome.permissions.onAdded.removeListener(refresh);
      chrome.permissions.onRemoved.removeListener(refresh);
    };
  }, []);

  useEffect(() => {
    if (!pageCandidate || pageCandidate.loading || !canReadPages()) return;
    let active = true;
    void hasPageAccess(pageCandidate).then(async (granted) => {
      if (!active) return;
      if (!granted) { setPageTarget(null); return; }
      const target = await capturePageTarget(pageCandidate);
      if (active) { setPageTarget(target); setPageError(""); }
    }).catch(() => { if (active) setPageTarget(null); });
    return () => { active = false; };
  }, [pageCandidate]);

  useEffect(() => {
    if (!pageTarget || !canReadPages()) return;
    const onActivated = ({ tabId, windowId }: { tabId: number; windowId: number }) => {
      if (windowId === pageTarget.windowId && tabId !== pageTarget.tabId) setPageTarget(null);
    };
    const onUpdated = (tabId: number, change: { status?: string; url?: string }) => {
      if (tabId === pageTarget.tabId && (change.status === "loading" || (change.url && change.url !== pageTarget.url))) setPageTarget(null);
    };
    const onRemoved = (tabId: number) => { if (tabId === pageTarget.tabId) setPageTarget(null); };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };
  }, [pageTarget]);

  useEffect(() => {
    return () => {
      if (pageTarget && regionTargetRef.current?.tabId === pageTarget.tabId) void cancelPageRegion(pageTarget);
    };
  }, [pageTarget]);

  useEffect(() => () => requestController.current?.abort(), []);

  async function attachPage() {
    setPageError("");
    if (!pageCandidate) { setPageError(tr("openWebPage")); return; }
    if (pageCandidate.loading) { setPageError(tr("waitForPageLoad")); return; }
    const candidate = pageCandidate;
    const stillCurrent = () => pageCandidateRef.current?.tabId === candidate.tabId && pageCandidateRef.current.url === candidate.url && !pageCandidateRef.current.loading;
    try {
      const target = await requestPageAccess(candidate);
      if (stillCurrent()) setPageTarget(target);
    } catch (cause) {
      if (!stillCurrent()) return;
      setPageTarget(null);
      setPageError(cause instanceof Error ? localizeKnownError(locale, cause.message) : tr("pageConnectFailed"));
    }
  }

  async function attachSelection() {
    if (regionTargetRef.current) { await cancelPageRegion(regionTargetRef.current); return; }
    if (!pageTarget || sending) return;
    if (selectedRegions.length >= 5) { setError(tr("tooManyRegions")); return; }
    regionTargetRef.current = pageTarget;
    setSelectionLoading(true);
    setError("");
    try {
      const selection = await capturePageRegion(pageTarget, { start: tr("pickerHint"), tooSmall: tr("pickerTooSmall") });
      if (selection) setSelectedRegions((current) => [...current, selection]);
    } catch (cause) {
      setError(cause instanceof Error ? localizeKnownError(locale, cause.message) : tr("regionReadFailed"));
    } finally {
      regionTargetRef.current = null;
      setSelectionLoading(false);
    }
  }

  function approveAction(title: string, detail: string, signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(signal.reason); return; }
      const onAbort = () => {
        setPendingAction((current) => current?.decide === decide ? null : current);
        reject(signal.reason);
      };
      const decide = (approved: boolean) => {
        signal.removeEventListener("abort", onAbort);
        setPendingAction(null);
        resolve(approved);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      setPendingAction({ title: localizeApprovalTitle(locale, title), detail: localizeApprovalDetail(locale, detail), decide });
    });
  }

  function approveNavigation(url: string, disposition: TabAction, signal: AbortSignal): Promise<boolean> {
    const title = tr(disposition === "new_tab" ? "openNewTabApproval" : disposition === "existing_tab" ? "switchTabApproval" : "navigateTabApproval");
    return approveChange(title, url, signal);
  }

  function approveChange(title: string, detail: string, signal: AbortSignal): Promise<boolean> {
    return requiresBrowserApproval(settings.approvalPolicy, "change") ? approveAction(title, detail, signal) : Promise.resolve(true);
  }

  function saveSettings(next: AppSettings, found: GatewayModel[]) {
    const providerSettingsChanged = next.baseUrl !== settings.baseUrl || next.apiKey !== settings.apiKey || next.model !== settings.model || next.apiMode !== settings.apiMode || next.contextWindowOverride !== settings.contextWindowOverride;
    if (providerSettingsChanged) {
      setMessages([]);
      setAgent(emptyAgentState());
      setSelectedRegions([]);
    }
    setSettings(next);
    setModels(found);
    if (providerSettingsChanged && found.length) setConnection("connected");
    setError("");
    setView("chat");
  }

  function changeModel(model: string) {
    setSettings({ ...settings, model, apiMode: model.startsWith("codex/") ? "chat_completions" : settings.apiMode, contextWindowOverride: 0 });
    setMessages([]);
    setAgent(emptyAgentState());
    setSelectedRegions([]);
    setError("");
  }

  async function exportLog(): Promise<number> {
    const events = await readExecutionLog();
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), events }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `qumi-execution-log-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
    return events.length;
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    const selections = [...selectedRegions];
    const contextWindow = settings.contextWindowOverride || models.find((model) => model.id === settings.model)?.contextLength || 0;
    if (!content || sending || connection !== "connected" || !settings.model || !contextWindow) return;
    const controller = new AbortController();
    const executionLog = createExecutionLog(settings.model, !!pageTarget, settings.approvalPolicy);
    requestController.current = controller;
    setPendingPrompt(content);
    setDraft("");
    setStreamed("");
    setThinking("");
    responseStarted.current = false;
    setProgress(tr("responding"));
    setError("");
    setSending(true);
    let mcpConnection: Awaited<ReturnType<typeof connectMcpServers>> | null = null;
    try {
      mcpConnection = await connectMcpServers(settings.mcpServers, controller.signal);
      controller.signal.throwIfAborted();
      if (mcpConnection.errors.length) setError(`${tr("mcpConnectFailed")}: ${mcpConnection.errors.join("; ")}`);
      const browserTab = await getActiveBrowserTab();
      const connectedPage = pageTarget && browserTab?.tabId === pageTarget.tabId && browserTab.url === pageTarget.url ? pageTarget : null;
      const result = await runTurn({
        settings, contextWindow, state: agent, prompt: promptWithSelections(content, selections), signal: controller.signal, locale, skills,
        onTrace: executionLog.record,
        tools: [...mcpConnection.tools.map((tool) => ({ ...tool, execute: async (args: unknown, signal: AbortSignal) => {
          if (!await approveChange(tr("mcpActionApproval"), `${tool.definition.function.name}\n${JSON.stringify(args)}`, signal)) return JSON.stringify({ approved: false });
          signal.throwIfAborted();
          return tool.execute(args, signal);
        } })), ...(browserTab ? browserTurnTools(browserTab, connectedPage, {
          approvalPolicy: settings.approvalPolicy,
          approveRead: approveAction,
          approveChange,
          approveNavigation,
          onNavigated: () => setPageTarget(null),
          maxResultBytes: Math.max(1_024, Math.min(48_000, contextWindow - 512)),
        }) : [])],
        onEvent: (event) => {
          if (controller.signal.aborted) return;
          if (event.type === "model") setProgress(tr("waitingForModel"));
          if (event.type === "thinking" && !responseStarted.current) {
            setProgress(tr("thinkingEllipsis"));
            setThinking((current) => (current + event.text).slice(-16_000));
          }
          if (event.type === "delta") {
            responseStarted.current = true;
            setThinking("");
            setProgress(tr("responding"));
            setStreamed((current) => current + event.text);
          }
          if (event.type === "compacting") { responseStarted.current = false; setProgress(tr("compacting")); setStreamed(""); setThinking(""); }
          if (event.type === "tool") { responseStarted.current = false; setProgress(tr("runningTool", { tool: event.name })); setStreamed(""); setThinking(""); }
        },
      });
      setAgent(result.state);
      setMessages([...messages, { role: "user", content, selections }, { role: "assistant", content: result.content, cachedTokens: result.cachedTokens }]);
      setSelectedRegions([]);
    } catch (cause) {
      setDraft(content);
      setError(controller.signal.aborted ? tr("requestCancelled") : cause instanceof Error ? localizeKnownError(locale, cause.message) : tr("responseFailed"));
    } finally {
      if (mcpConnection) void mcpConnection.close();
      void executionLog.finish().catch(() => setError((current) => current || tr("logSaveFailed")));
      requestController.current = null;
      setPendingPrompt("");
      setStreamed("");
      setThinking("");
      setProgress("");
      setSending(false);
    }
  }

  const contextWindow = settings.contextWindowOverride || models.find((model) => model.id === settings.model)?.contextLength || 0;
  const canSend = connection === "connected" && !!settings.model && contextWindow > 0 && !sending && !selectionLoading;
  const pageAccessAvailable = canReadPages();

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand"><span className="brand__mark" aria-hidden="true">Q</span><h1>Qumi</h1></div>
        <div className="header-actions">
          <Status connection={connection} locale={locale} />
          <button className="mp-button mp-button--ghost icon-button" type="button" aria-label={tr("settingsAria")} onClick={() => setView("settings")} disabled={sending}><Icon name="settings" /></button>
        </div>
      </header>

      {view === "settings" ? (
        <SettingsView settings={settings} availableModels={models} skills={skills} onSkillsChange={setSkills} onClose={() => setView("chat")} onSave={saveSettings} onExportLog={exportLog} onClearLog={clearExecutionLog} onLanguageChange={(language) => { setSettings((current) => ({ ...current, language })); setError(""); setPageError(""); }} />
      ) : (
        <>
          <div className="model-bar">
            <div className="mp-field">
              <label className="mp-field__label" htmlFor="active-model">{tr("model")}</label>
              <select id="active-model" className="mp-select" value={settings.model} onChange={(event) => changeModel(event.target.value)} disabled={models.length === 0 || sending}>
                {models.length === 0 && <option value="">{tr("noModels")}</option>}
                {models.map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}
              </select>
            </div>
            <button className="mp-button mp-button--ghost icon-button new-chat" type="button" aria-label={tr("newChat")} title={tr("newChat")} onClick={() => { setMessages([]); setAgent(emptyAgentState()); setSelectedRegions([]); setError(""); }} disabled={sending || messages.length === 0}><Icon name="plus" /></button>
          </div>

          <div className="page-bar">
            <div className="page-bar__context">
              <span className="page-bar__label">{tr("currentPage")}</span>
              <span className="page-bar__title" title={pageTarget?.url || pageCandidate?.url}>{pageTarget ? `${pageTarget.title} · ${pageTarget.url}` : pageAccessAvailable ? pageCandidate ? `${pageCandidate.title} · ${pageCandidate.url}` : tr("noWebPage") : tr("extensionOnly")}</span>
              <span className="page-bar__hint">{pageTarget ? tr("pageReadHint") : pageAccessAvailable ? pageCandidate ? pageCandidate.loading ? tr("pageLoading") : tr("pageAutoConnectHint") : tr("pageNavigationHint") : tr("extensionHint")}</span>
              {pageError && <span className="page-bar__error" role="alert">{pageError}</span>}
            </div>
            {!pageTarget && <button className="mp-button mp-button--secondary" type="button" onClick={() => void attachPage()} disabled={sending || !pageAccessAvailable || !pageCandidate || !!pageCandidate.loading}>{tr("connect")}</button>}
          </div>

          <main className="chat-history" aria-label={tr("conversation")}>
            {messages.length === 0 && (
              <div className="empty-chat">
                <h2>{tr(connection === "connected" ? "howCanIHelp" : "gatewayRequired")}</h2>
                <p>{tr(connection === "connected" ? "startConversation" : "checkGateway")}</p>
                {connection !== "connected" && <button className="mp-button mp-button--secondary" type="button" onClick={() => setView("settings")}>{tr("gatewaySettings")}</button>}
              </div>
            )}
            <div className="message-list">
              {messages.map((message, index) => (
                <article className={`message message--${message.role}`} key={index}>
                  <div className="message__label">{message.role === "user" ? tr("user") : "Qumi"}</div>
                  <p className="message__content">{message.content}</p>
                  {message.selections && <SelectionNotes selections={message.selections} locale={locale} />}
                  {typeof message.cachedTokens === "number" && message.cachedTokens > 0 && <p className="message__meta">{tr("cachedTokens", { count: formatNumber(locale, message.cachedTokens) })}</p>}
                </article>
              ))}
              {pendingPrompt && <article className="message message--user"><div className="message__label">{tr("user")}</div><p className="message__content">{pendingPrompt}</p><SelectionNotes selections={selectedRegions} locale={locale} /></article>}
              {sending && <div className="pending-message" role="status"><span className="mp-spinner" aria-hidden="true" />{progress}</div>}
              {sending && thinking && !streamed && <div className="thinking-preview" aria-label={tr("thinking")}><div className="thinking-preview__label">{tr("thinking")}</div><p className="thinking-preview__content" ref={thinkingContent}>{thinking}</p></div>}
              {streamed && <article className="message message--assistant"><div className="message__label">Qumi</div><p className="message__content">{streamed}</p></article>}
              <div ref={messagesEnd} />
            </div>
          </main>

          <form className="composer" onSubmit={(event) => void send(event)}>
            {pendingAction && <div className="navigation-request" role="dialog" aria-label={tr("browserActionConfirmation")}>
              <strong>{pendingAction.title}</strong>
              <span>{pendingAction.detail}</span>
              <div><button className="mp-button mp-button--ghost" type="button" onClick={() => pendingAction.decide(false)}>{tr("cancel")}</button><button className="mp-button mp-button--primary" type="button" onClick={() => pendingAction.decide(true)}>{tr("run")}</button></div>
            </div>}
            {error && <div className="composer__error" role="alert">{error}</div>}
            {connection === "connected" && !contextWindow && <div className="composer__error" role="status">{tr("contextLengthRequired")}</div>}
            {pageTarget && <div className="composer__selection-actions"><button className="mp-button mp-button--secondary" type="button" onClick={() => void attachSelection()} disabled={sending || (!selectionLoading && selectedRegions.length >= 5)}>{tr(selectionLoading ? "cancelSelection" : "addRegion")}</button><span>{tr(selectionLoading ? "selectingRegionHint" : "selectRegionHint")}</span></div>}
            {!sending && <SelectionNotes selections={selectedRegions} locale={locale} onRemove={(index) => setSelectedRegions((current) => current.filter((_, itemIndex) => itemIndex !== index))} />}
            <label className="sr-only" htmlFor="chat-input">{tr("askQ")}</label>
            <textarea id="chat-input" className="mp-textarea" rows={3} placeholder={tr("askQ")} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} disabled={!canSend} />
            <div className="composer__footer"><span>{tr("localConnection")}</span>{sending ? <button className="mp-button mp-button--secondary" type="button" onClick={() => requestController.current?.abort()}>{tr("stop")}</button> : <button className="mp-button mp-button--primary" type="submit" disabled={!canSend || !draft.trim()}><Icon name="send" />{tr("send")}</button>}</div>
          </form>
        </>
      )}
    </div>
  );
}
