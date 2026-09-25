import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import {
  listModelDetails,
  normalizeGatewayUrl,
  type ChatMessage,
  type GatewayModel,
  type GatewaySettings,
} from "./gateway";
import { emptyAgentState, runTurn, type AgentState } from "./agent";
import { emptyState, loadState, saveState } from "./storage";
import { canReadPages, getActivePageCandidate, requestPageAccess, listOpenTabsTool, navigationTool, pageContextTool, switchTabTool, type TabAction, type PageCandidate, type PageTarget } from "./page-context";
import { domClickTool, domListTool, domReadTool, domWriteTool } from "./dom-tools";

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

function Status({ connection }: { connection: Connection }) {
  const label = connection === "connected" ? "연결됨" : connection === "checking" ? "확인 중" : "연결 안 됨";
  return <span className={`connection connection--${connection}`} role="status"><span className="connection__dot" />{label}</span>;
}

interface SettingsViewProps {
  settings: GatewaySettings;
  availableModels: GatewayModel[];
  onClose: () => void;
  onSave: (settings: GatewaySettings, models: GatewayModel[]) => void;
}

function SettingsView({ settings, availableModels, onClose, onSave }: SettingsViewProps) {
  const [draft, setDraft] = useState(settings);
  const [checkedModels, setCheckedModels] = useState<GatewayModel[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const sameGateway = draft.baseUrl === settings.baseUrl && draft.apiKey === settings.apiKey;
  const models = checkedModels ?? (sameGateway ? availableModels : []);

  function changeGateway(field: "baseUrl" | "apiKey", value: string) {
    setDraft({ ...draft, [field]: value, model: "" });
    setCheckedModels(null);
    setMessage("");
  }

  const selectedModel = models.find((model) => model.id === draft.model);

  async function checkConnection(): Promise<GatewayModel[] | null> {
    setTesting(true);
    setMessage("");
    try {
      const found = await listModelDetails(draft);
      if (found.length === 0) throw new Error("사용 가능한 모델이 없습니다. Q의 제공자 설정을 확인해 주세요.");
      setCheckedModels(found);
      setDraft((current) => {
        const existing = found.some((model) => model.id === current.model);
        return {
          ...current,
          baseUrl: normalizeGatewayUrl(current.baseUrl),
          model: existing ? current.model : found[0].id,
          contextWindowOverride: existing ? current.contextWindowOverride : 0,
        };
      });
      setIsError(false);
      setMessage(`${found.length}개 모델을 확인했습니다.`);
      return found;
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "Gateway에 연결하지 못했습니다.");
      return null;
    } finally {
      setTesting(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = await checkConnection();
    if (!found) return;
    const model = found.find((entry) => entry.id === draft.model) ?? found[0];
    const contextWindowOverride = model.id === draft.model ? draft.contextWindowOverride : 0;
    if (!model.contextLength && !contextWindowOverride) {
      setIsError(true);
      setMessage("이 모델은 문맥 길이를 제공하지 않습니다. 문맥 길이를 입력해 주세요.");
      return;
    }
    onSave({ ...draft, baseUrl: normalizeGatewayUrl(draft.baseUrl), model: model.id, contextWindowOverride }, found);
  }

  return (
    <div className="settings-view">
      <button className="mp-button mp-button--ghost back-button" type="button" onClick={onClose}><Icon name="back" />채팅으로 돌아가기</button>
      <div className="settings-heading">
        <h2>Gateway 설정</h2>
        <p>Q Gateway가 출력한 접속 주소를 입력하세요.</p>
      </div>
      <form className="settings-form" onSubmit={submit}>
        <div className="mp-field">
          <label className="mp-field__label" htmlFor="gateway-url">Gateway URL</label>
          <input id="gateway-url" className="mp-input" type="url" required placeholder="http://127.0.0.1:8080/v1" value={draft.baseUrl} onChange={(event) => changeGateway("baseUrl", event.target.value)} aria-describedby="gateway-url-hint" />
          <p id="gateway-url-hint" className="mp-field__hint">현재는 로컬 Q Gateway에 연결합니다.</p>
        </div>
        <div className="mp-field">
          <label className="mp-field__label" htmlFor="gateway-key">API 키 (선택)</label>
          <div className="password-field">
            <input id="gateway-key" className="mp-input" type={showKey ? "text" : "password"} value={draft.apiKey} onChange={(event) => changeGateway("apiKey", event.target.value)} autoComplete="off" aria-describedby="gateway-key-hint" />
            <button type="button" className="password-field__toggle" aria-label={showKey ? "API 키 숨기기" : "API 키 보기"} onClick={() => setShowKey(!showKey)}><Icon name="eye" /></button>
          </div>
          <p id="gateway-key-hint" className="mp-field__hint">Q Gateway에 인증 키를 설정한 경우에만 입력하세요.</p>
        </div>
        <div className="mp-field">
          <label className="mp-field__label" htmlFor="settings-model">모델</label>
          <select id="settings-model" className="mp-select" value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value, contextWindowOverride: 0 })} disabled={models.length === 0}>
            {models.length === 0 && <option value="">연결 확인 후 선택</option>}
            {models.map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}
          </select>
          <p className="mp-field__hint">Gateway가 제공하는 모델 목록에서 선택합니다.</p>
        </div>
        <div className="mp-field">
          <label className="mp-field__label" htmlFor="context-window">문맥 길이 (토큰)</label>
          <input id="context-window" className="mp-input" type="number" min="1024" step="1" placeholder={selectedModel?.contextLength ? String(selectedModel.contextLength) : "모델이 제공하지 않으면 입력"} value={draft.contextWindowOverride || ""} onChange={(event) => setDraft({ ...draft, contextWindowOverride: event.target.value ? Number(event.target.value) : 0 })} />
          <p className="mp-field__hint">{selectedModel?.contextLength ? `Gateway 제공값 ${selectedModel.contextLength.toLocaleString()} · 입력하면 우선 적용됩니다.` : "Gateway 제공값이 없으면 직접 입력해야 압축할 수 있습니다."}</p>
        </div>
        <button className="mp-button mp-button--secondary" type="button" onClick={() => void checkConnection()} disabled={testing}>{testing ? "확인 중…" : "연결 확인"}</button>
        {message && <div className={`inline-notice ${isError ? "inline-notice--error" : "inline-notice--success"}`} role={isError ? "alert" : "status"}>{message}</div>}
        <button className="mp-button mp-button--primary save-button" type="submit" disabled={testing}>{testing ? "확인 중…" : "저장"}</button>
      </form>
    </div>
  );
}

export function App() {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<"chat" | "settings">("chat");
  const [settings, setSettings] = useState<GatewaySettings>(emptyState.settings);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agent, setAgent] = useState<AgentState>(emptyAgentState);
  const [models, setModels] = useState<GatewayModel[]>([]);
  const [connection, setConnection] = useState<Connection>("disconnected");
  const [draft, setDraft] = useState("");
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

  useEffect(() => {
    let active = true;
    void loadState().then((saved) => {
      if (!active) return;
      setSettings(saved.settings);
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
    }).catch(() => { if (active) { setReady(true); setError("저장된 설정을 읽지 못했습니다."); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (ready) void saveState({ settings, messages, agent }).catch(() => setError("대화 내용을 저장하지 못했습니다."));
  }, [ready, settings, messages, agent]);

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
      currentTabId = null;
      setPageCandidate(null);
      void getActivePageCandidate().then((candidate) => {
        if (active && currentRevision === revision) {
          currentTabId = candidate?.tabId ?? null;
          setPageCandidate(candidate);
        }
      }).catch(() => { if (active && currentRevision === revision) setPageCandidate(null); });
    };
    const onUpdated = (tabId: number, change: { status?: string; url?: string }) => {
      if (change.url || (tabId === currentTabId && (change.status === "loading" || change.status === "complete"))) refresh();
    };
    refresh();
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(refresh);
    return () => {
      active = false;
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(refresh);
    };
  }, []);

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

  useEffect(() => () => requestController.current?.abort(), []);

  async function attachPage() {
    setPageError("");
    if (!pageCandidate) { setPageError("일반 HTTP(S) 웹페이지를 연 뒤 다시 연결해 주세요."); return; }
    try { setPageTarget(await requestPageAccess(pageCandidate)); }
    catch (cause) { setPageTarget(null); setPageError(cause instanceof Error ? cause.message : "페이지에 연결하지 못했습니다."); }
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
      setPendingAction({ title, detail, decide });
    });
  }

  function approveNavigation(url: string, disposition: TabAction, signal: AbortSignal): Promise<boolean> {
    const title = disposition === "new_tab" ? "새 탭 열기" : disposition === "existing_tab" ? "기존 탭 전환" : "현재 탭 이동";
    return approveAction(title, url, signal);
  }

  function saveSettings(next: GatewaySettings, found: GatewayModel[]) {
    if (next.baseUrl !== settings.baseUrl || next.apiKey !== settings.apiKey || next.model !== settings.model || next.contextWindowOverride !== settings.contextWindowOverride) {
      setMessages([]);
      setAgent(emptyAgentState());
    }
    setSettings(next);
    setModels(found);
    setConnection("connected");
    setError("");
    setView("chat");
  }

  function changeModel(model: string) {
    setSettings({ ...settings, model, contextWindowOverride: 0 });
    setMessages([]);
    setAgent(emptyAgentState());
    setError("");
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    const contextWindow = settings.contextWindowOverride || models.find((model) => model.id === settings.model)?.contextLength || 0;
    if (!content || sending || connection !== "connected" || !settings.model || !contextWindow) return;
    const controller = new AbortController();
    requestController.current = controller;
    setPendingPrompt(content);
    setDraft("");
    setStreamed("");
    setThinking("");
    responseStarted.current = false;
    setProgress("응답 중…");
    setError("");
    setSending(true);
    try {
      const result = await runTurn({
        settings, contextWindow, state: agent, prompt: content, signal: controller.signal,
        tools: pageTarget ? [
          pageContextTool(pageTarget), domListTool(pageTarget), domReadTool(pageTarget),
          domWriteTool(pageTarget, approveAction), domClickTool(pageTarget, approveAction),
          listOpenTabsTool(pageTarget),
          navigationTool(pageTarget, approveNavigation, () => setPageTarget(null)),
          switchTabTool(pageTarget, approveNavigation, () => setPageTarget(null)),
        ] : [],
        onEvent: (event) => {
          if (event.type === "thinking" && !responseStarted.current) {
            setProgress("생각 중…");
            setThinking((current) => (current + event.text).slice(-16_000));
          }
          if (event.type === "delta") {
            responseStarted.current = true;
            setThinking("");
            setProgress("응답 중…");
            setStreamed((current) => current + event.text);
          }
          if (event.type === "compacting") { responseStarted.current = false; setProgress("문맥 압축 중…"); setStreamed(""); setThinking(""); }
          if (event.type === "tool") { responseStarted.current = false; setProgress(`${event.name} 실행 중…`); setStreamed(""); setThinking(""); }
        },
      });
      setAgent(result.state);
      setMessages([...messages, { role: "user", content }, { role: "assistant", content: result.content, cachedTokens: result.cachedTokens }]);
    } catch (cause) {
      setDraft(content);
      setError(controller.signal.aborted ? "요청을 취소했습니다." : cause instanceof Error ? cause.message : "응답을 받지 못했습니다.");
    } finally {
      requestController.current = null;
      setPendingPrompt("");
      setStreamed("");
      setThinking("");
      setProgress("");
      setSending(false);
    }
  }

  const contextWindow = settings.contextWindowOverride || models.find((model) => model.id === settings.model)?.contextLength || 0;
  const canSend = connection === "connected" && !!settings.model && contextWindow > 0 && !sending;
  const pageAccessAvailable = canReadPages();

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand"><span className="brand__mark" aria-hidden="true">Q</span><h1>Qumi</h1></div>
        <div className="header-actions">
          <Status connection={connection} />
          <button className="mp-button mp-button--ghost icon-button" type="button" aria-label="Gateway 설정" onClick={() => setView("settings")} disabled={sending}><Icon name="settings" /></button>
        </div>
      </header>

      {view === "settings" ? (
        <SettingsView settings={settings} availableModels={models} onClose={() => setView("chat")} onSave={saveSettings} />
      ) : (
        <>
          <div className="model-bar">
            <div className="mp-field">
              <label className="mp-field__label" htmlFor="active-model">모델</label>
              <select id="active-model" className="mp-select" value={settings.model} onChange={(event) => changeModel(event.target.value)} disabled={models.length === 0 || sending}>
                {models.length === 0 && <option value="">모델 없음</option>}
                {models.map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}
              </select>
            </div>
            <button className="mp-button mp-button--ghost icon-button new-chat" type="button" aria-label="새 대화" title="새 대화" onClick={() => { setMessages([]); setAgent(emptyAgentState()); setError(""); }} disabled={sending || messages.length === 0}><Icon name="plus" /></button>
          </div>

          <div className="page-bar">
            <div className="page-bar__context">
              <span className="page-bar__label">현재 페이지</span>
              <span className="page-bar__title" title={pageTarget?.url || pageCandidate?.url}>{pageTarget ? `${pageTarget.title} · ${pageTarget.url}` : pageAccessAvailable ? pageCandidate ? `${pageCandidate.title} · ${pageCandidate.url}` : "연결할 웹페이지 없음" : "Chrome 확장에서 연결 가능"}</span>
              <span className="page-bar__hint">{pageTarget ? "페이지를 읽으면 내용이 Q Gateway에 전달됩니다." : pageAccessAvailable ? pageCandidate ? `${new URL(pageCandidate.url).hostname} 접근 권한을 Chrome에 요청합니다. 권한은 사이트 단위로 저장됩니다.` : "일반 HTTP(S) 웹페이지를 열어 주세요." : "확장을 Chrome에 로드하면 연결할 수 있습니다."}</span>
              {pageError && <span className="page-bar__error" role="alert">{pageError}</span>}
            </div>
            <button className="mp-button mp-button--secondary" type="button" onClick={() => void attachPage()} disabled={sending || !pageAccessAvailable || !pageCandidate}>{pageTarget ? "다시 연결" : "연결"}</button>
          </div>

          <main className="chat-history" aria-label="대화 내용">
            {messages.length === 0 && (
              <div className="empty-chat">
                <h2>{connection === "connected" ? "무엇을 도와드릴까요?" : "Q Gateway 연결이 필요합니다."}</h2>
                <p>{connection === "connected" ? "Q에 질문을 보내 대화를 시작하세요." : "설정에서 Gateway 주소와 모델을 확인하세요."}</p>
                {connection !== "connected" && <button className="mp-button mp-button--secondary" type="button" onClick={() => setView("settings")}>Gateway 설정</button>}
              </div>
            )}
            <div className="message-list">
              {messages.map((message, index) => (
                <article className={`message message--${message.role}`} key={index}>
                  <div className="message__label">{message.role === "user" ? "사용자" : "Qumi"}</div>
                  <p className="message__content">{message.content}</p>
                  {typeof message.cachedTokens === "number" && message.cachedTokens > 0 && <p className="message__meta">캐시 사용 {message.cachedTokens.toLocaleString()} 토큰</p>}
                </article>
              ))}
              {pendingPrompt && <article className="message message--user"><div className="message__label">사용자</div><p className="message__content">{pendingPrompt}</p></article>}
              {sending && <div className="pending-message" role="status"><span className="mp-spinner" aria-hidden="true" />{progress}</div>}
              {sending && thinking && !streamed && <div className="thinking-preview" aria-label="모델 생각"><div className="thinking-preview__label">생각 중</div><p className="thinking-preview__content" ref={thinkingContent}>{thinking}</p></div>}
              {streamed && <article className="message message--assistant"><div className="message__label">Qumi</div><p className="message__content">{streamed}</p></article>}
              <div ref={messagesEnd} />
            </div>
          </main>

          <form className="composer" onSubmit={(event) => void send(event)}>
            {pendingAction && <div className="navigation-request" role="dialog" aria-label="브라우저 작업 확인">
              <strong>{pendingAction.title}</strong>
              <span>{pendingAction.detail}</span>
              <div><button className="mp-button mp-button--ghost" type="button" onClick={() => pendingAction.decide(false)}>취소</button><button className="mp-button mp-button--primary" type="button" onClick={() => pendingAction.decide(true)}>실행</button></div>
            </div>}
            {error && <div className="composer__error" role="alert">{error}</div>}
            {connection === "connected" && !contextWindow && <div className="composer__error" role="status">설정에서 이 모델의 문맥 길이를 입력해 주세요.</div>}
            <label className="sr-only" htmlFor="chat-input">Q에게 물어보기</label>
            <textarea id="chat-input" className="mp-textarea" rows={3} placeholder="Q에게 물어보기" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} disabled={!canSend} />
            <div className="composer__footer"><span>Q Gateway · 로컬 연결</span>{sending ? <button className="mp-button mp-button--secondary" type="button" onClick={() => requestController.current?.abort()}>중단</button> : <button className="mp-button mp-button--primary" type="submit" disabled={!canSend || !draft.trim()}><Icon name="send" />보내기</button>}</div>
          </form>
        </>
      )}
    </div>
  );
}
