import { runTurn } from "./agent.ts";
import { browserTurnTools } from "./browser-turn-tools.ts";
import { createExecutionLog } from "./execution-log.ts";
import { loadJob, loadJobs, nextRunAt, saveJob, syncAlarm } from "./jobs.ts";
import { connectMcpServers } from "./mcp-tools.ts";
import { capturePageTarget, hasPageAccess, type BrowserTabTarget, type PageTarget } from "./page-context.ts";
import { createSkillTool, type InstalledSkill } from "./skills.ts";
import { loadSession, saveSession } from "./sessions.ts";
import { loadState, saveSkills } from "./storage.ts";

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

const running = new Set<string>();
const scheduledTurnTimeoutMs = 4 * 60_000;

async function activeTab(): Promise<BrowserTabTarget | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined || tab.windowId === undefined) return null;
  return { tabId: tab.id, windowId: tab.windowId, url: tab.url ?? "", title: tab.title || tab.url || "새 탭" };
}

async function connectedPage(tab: BrowserTabTarget): Promise<PageTarget | null> {
  if (!/^https?:\/\//.test(tab.url)) return null;
  try {
    if (!await hasPageAccess(tab)) return null;
    return await capturePageTarget(tab);
  } catch { return null; }
}

async function runScheduledJob(id: string): Promise<void> {
  const job = await loadJob(id);
  if (running.has(id)) {
    if (job && job.nextRunAt !== null && job.nextRunAt <= Date.now() && job.schedule.type !== "once") {
      job.nextRunAt = nextRunAt(job.schedule, Date.now());
      await saveJob(job);
      await syncAlarm(job);
    }
    return;
  }
  if (!job || job.status === "paused" || job.nextRunAt === null || job.nextRunAt > Date.now() + 10_000) return;
  running.add(id);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("예약 작업 실행 시간이 초과되었습니다.")), scheduledTurnTimeoutMs);
  const keepAlive = setInterval(() => { void chrome.runtime.getPlatformInfo().catch(() => {}); }, 20_000);
  let mcp: Awaited<ReturnType<typeof connectMcpServers>> | null = null;
  let log: ReturnType<typeof createExecutionLog> | null = null;
  try {
    job.status = "running";
    job.lastStartedAt = startedAt;
    job.error = "";
    job.nextRunAt = job.schedule.type === "once" ? null : nextRunAt(job.schedule, startedAt);
    await saveJob(job);
    await syncAlarm(job);
    const session = await loadSession(job.sessionId);
    if (!session) throw new Error("예약 작업의 대화 세션을 찾지 못했습니다.");
    const pending = { role: "user" as const, content: job.prompt };
    await saveSession({ ...session, messages: [...session.messages, pending], updatedAt: startedAt });
    const saved = await loadState();
    const settings = { ...saved.settings, ...session.model };
    const contextWindow = session.contextWindow || session.model.contextWindowOverride || 0;
    if (!settings.baseUrl || !settings.model || !contextWindow) throw new Error("Gateway 모델과 문맥 길이를 설정해 주세요.");
    const skills: InstalledSkill[] = [...saved.skills];
    mcp = await connectMcpServers(settings.mcpServers, controller.signal);
    if (mcp.errors.length) throw new Error(`MCP 연결 실패: ${mcp.errors.join("; ")}`);
    const tab = await activeTab();
    const page = tab ? await connectedPage(tab) : null;
    const allow = async () => true;
    const browser = tab ? browserTurnTools(tab, page, {
      approvalPolicy: "none", approveRead: allow, approveChange: allow, approveNavigation: allow,
      onNavigated: () => {}, maxResultBytes: Math.max(1_024, Math.min(48_000, contextWindow - 512)),
    }) : [];
    const registerSkill = createSkillTool(async (skill) => {
      const index = skills.findIndex((item) => item.id === skill.id);
      if (index >= 0) skills[index] = skill;
      else skills.push(skill);
      await saveSkills(skills);
    });
    log = createExecutionLog(settings.model, !!page, "none");
    const result = await runTurn({
      settings, contextWindow, state: session.agent, prompt: job.prompt, signal: controller.signal,
      skills, skillToolsWhenEmpty: true, tools: [...mcp.tools, ...browser, registerSkill], onTrace: log.record,
    });
    await saveSession({ ...session, agent: result.state,
      messages: [...session.messages, pending, { role: "assistant", content: result.content, cachedTokens: result.cachedTokens }], updatedAt: Date.now() });
    const latest = await loadJob(id);
    if (latest) await saveJob({ ...latest, status: latest.status === "paused" ? "paused" : latest.nextRunAt === null ? "completed" : "scheduled", lastFinishedAt: Date.now(), error: "" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const latest = await loadJob(id);
    if (latest) await saveJob({ ...latest, status: latest.status === "paused" ? "paused" : "failed", lastFinishedAt: Date.now(), error: message });
    const session = await loadSession(job.sessionId);
    if (session) await saveSession({ ...session, messages: [...session.messages, { role: "assistant", content: `예약 작업 실패: ${message}` }], updatedAt: Date.now() });
  } finally {
    clearTimeout(timeout);
    clearInterval(keepAlive);
    await mcp?.close().catch(() => {});
    await log?.finish().catch(() => {});
    running.delete(id);
  }
}

async function reconcileJobs(): Promise<void> {
  for (const job of await loadJobs()) {
    if (job.status === "running" && !running.has(job.id)) {
      // Do not replay an interrupted turn: browser and MCP side effects may already have happened.
      job.status = "failed";
      job.error = "브라우저가 종료되어 실행이 중단되었습니다. 이전 실행은 자동으로 다시 수행하지 않습니다.";
      job.lastFinishedAt = Date.now();
      await saveJob(job);
    }
    if (job.nextRunAt !== null && job.nextRunAt <= Date.now()) void runScheduledJob(job.id);
    else await syncAlarm(job);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith("qumi-job:")) void runScheduledJob(alarm.name.slice("qumi-job:".length));
});
chrome.runtime.onStartup.addListener(() => { void reconcileJobs(); });
chrome.runtime.onInstalled.addListener(() => { void reconcileJobs(); });
void reconcileJobs();
