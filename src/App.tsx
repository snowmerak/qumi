import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import {
  completeChat,
  listModels,
  normalizeGatewayUrl,
  type ChatMessage,
  type GatewaySettings,
} from "./gateway";
import { emptyState, loadState, saveState } from "./storage";

type Connection = "checking" | "connected" | "disconnected";

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
  onClose: () => void;
  onSave: (settings: GatewaySettings, models: string[]) => void;
}

function SettingsView({ settings, onClose, onSave }: SettingsViewProps) {
  const [draft, setDraft] = useState(settings);
  const [models, setModels] = useState<string[]>(settings.model ? [settings.model] : []);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [showKey, setShowKey] = useState(false);

  async function checkConnection(): Promise<string[] | null> {
    setTesting(true);
    setMessage("");
    try {
      const found = await listModels(draft);
      if (found.length === 0) throw new Error("사용 가능한 모델이 없습니다. Q의 제공자 설정을 확인해 주세요.");
      setModels(found);
      setDraft((current) => ({ ...current, baseUrl: normalizeGatewayUrl(current.baseUrl), model: found.includes(current.model) ? current.model : found[0] }));
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
    onSave({ ...draft, baseUrl: normalizeGatewayUrl(draft.baseUrl), model: found.includes(draft.model) ? draft.model : found[0] }, found);
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
          <input id="gateway-url" className="mp-input" type="url" required placeholder="http://127.0.0.1:8080/v1" value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} aria-describedby="gateway-url-hint" />
          <p id="gateway-url-hint" className="mp-field__hint">현재는 로컬 Q Gateway에 연결합니다.</p>
        </div>
        <div className="mp-field">
          <label className="mp-field__label" htmlFor="gateway-key">API 키 (선택)</label>
          <div className="password-field">
            <input id="gateway-key" className="mp-input" type={showKey ? "text" : "password"} value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} autoComplete="off" aria-describedby="gateway-key-hint" />
            <button type="button" className="password-field__toggle" aria-label={showKey ? "API 키 숨기기" : "API 키 보기"} onClick={() => setShowKey(!showKey)}><Icon name="eye" /></button>
          </div>
          <p id="gateway-key-hint" className="mp-field__hint">Q Gateway에 인증 키를 설정한 경우에만 입력하세요.</p>
        </div>
        <div className="mp-field">
          <label className="mp-field__label" htmlFor="settings-model">모델</label>
          <select id="settings-model" className="mp-select" value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} disabled={models.length === 0}>
            {models.length === 0 && <option value="">연결 확인 후 선택</option>}
            {models.map((model) => <option key={model} value={model}>{model}</option>)}
          </select>
          <p className="mp-field__hint">Gateway가 제공하는 모델 목록에서 선택합니다.</p>
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
  const [conversationId, setConversationId] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [connection, setConnection] = useState<Connection>("disconnected");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const messagesEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void loadState().then((saved) => {
      if (!active) return;
      setSettings(saved.settings);
      setMessages(saved.messages);
      setConversationId(saved.conversationId);
      setReady(true);
      if (!saved.settings.baseUrl) return;
      setConnection("checking");
      void listModels(saved.settings).then((found) => {
        if (!active) return;
        if (found.length === 0) {
          setConnection("disconnected");
          return;
        }
        setModels(found);
        setConnection("connected");
        if (!found.includes(saved.settings.model)) {
          setSettings({ ...saved.settings, model: found[0] });
          setMessages([]);
          setConversationId("");
        }
      }).catch(() => { if (active) setConnection("disconnected"); });
    }).catch(() => { if (active) { setReady(true); setError("저장된 설정을 읽지 못했습니다."); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (ready) void saveState({ settings, messages, conversationId }).catch(() => setError("대화 내용을 저장하지 못했습니다."));
  }, [ready, settings, messages, conversationId]);

  useEffect(() => { messagesEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);

  function saveSettings(next: GatewaySettings, found: string[]) {
    if (next.baseUrl !== settings.baseUrl || next.apiKey !== settings.apiKey || next.model !== settings.model) {
      setMessages([]);
      setConversationId("");
    }
    setSettings(next);
    setModels(found);
    setConnection("connected");
    setError("");
    setView("chat");
  }

  function changeModel(model: string) {
    setSettings({ ...settings, model });
    setMessages([]);
    setConversationId("");
    setError("");
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || sending || connection !== "connected" || !settings.model) return;
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(nextMessages);
    setDraft("");
    setError("");
    setSending(true);
    try {
      const result = await completeChat(settings, nextMessages, conversationId);
      setMessages([...nextMessages, result.message]);
      setConversationId(result.conversationId);
    } catch (cause) {
      setMessages(messages);
      setDraft(content);
      setError(cause instanceof Error ? cause.message : "응답을 받지 못했습니다.");
    } finally {
      setSending(false);
    }
  }

  const canSend = connection === "connected" && !!settings.model && !sending;

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
        <SettingsView settings={settings} onClose={() => setView("chat")} onSave={saveSettings} />
      ) : (
        <>
          <div className="model-bar">
            <div className="mp-field">
              <label className="mp-field__label" htmlFor="active-model">모델</label>
              <select id="active-model" className="mp-select" value={settings.model} onChange={(event) => changeModel(event.target.value)} disabled={models.length === 0 || sending}>
                {models.length === 0 && <option value="">모델 없음</option>}
                {models.map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
            </div>
            <button className="mp-button mp-button--ghost icon-button new-chat" type="button" aria-label="새 대화" title="새 대화" onClick={() => { setMessages([]); setConversationId(""); setError(""); }} disabled={sending || messages.length === 0}><Icon name="plus" /></button>
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
                  {typeof message.cachedTokens === "number" && <p className="message__meta">캐시 사용 {message.cachedTokens.toLocaleString()} 토큰</p>}
                </article>
              ))}
              {sending && <div className="pending-message" role="status"><span className="mp-spinner" aria-hidden="true" />Q가 응답하는 중…</div>}
              <div ref={messagesEnd} />
            </div>
          </main>

          <form className="composer" onSubmit={(event) => void send(event)}>
            {error && <div className="composer__error" role="alert">{error}</div>}
            <label className="sr-only" htmlFor="chat-input">Q에게 물어보기</label>
            <textarea id="chat-input" className="mp-textarea" rows={3} placeholder="Q에게 물어보기" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} disabled={!canSend} />
            <div className="composer__footer"><span>Q Gateway · 로컬 연결</span><button className="mp-button mp-button--primary" type="submit" disabled={!canSend || !draft.trim()}><Icon name="send" />보내기</button></div>
          </form>
        </>
      )}
    </div>
  );
}
