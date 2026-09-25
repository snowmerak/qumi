import type { PageTarget } from "./page-context.ts";
import type { PageSelection } from "./page-selection.ts";

const pageChanged = "페이지가 바뀌었습니다. 새 페이지 연결을 확인한 뒤 다시 시도해 주세요.";

// Chrome serializes this function for executeScript, so its helpers stay inside it.
export function regionPickerInPage(action: "start" | "cancel", hints: { start: string; tooSmall: string } = { start: "드래그로 영역 선택 · Esc로 취소", tooSmall: "조금 더 넓게 드래그해 주세요 · Esc로 취소" }): Promise<PageSelection | null> | null {
  type PickerWindow = Window & { __qumiRegionPickerCancelV1?: () => void };
  const pageWindow = window as PickerWindow;
  if (action === "cancel") { pageWindow.__qumiRegionPickerCancelV1?.(); return null; }
  pageWindow.__qumiRegionPickerCancelV1?.();

  type Bounds = { left: number; top: number; right: number; bottom: number };
  const overlaps = (a: Bounds, b: Bounds) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
    && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;

  function selectorFor(element: Element): string {
    const parts: string[] = [];
    for (let current: Element | null = element; current && current !== document.body; current = current.parentElement) {
      const siblings = current.parentElement
        ? Array.from(current.parentElement.children).filter((item) => item.tagName === current?.tagName)
        : [];
      parts.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(current) + 1})`);
      const candidate = parts.join(" > ");
      if (document.querySelectorAll(candidate).length === 1) return candidate;
    }
    return parts.length ? `body > ${parts.join(" > ")}` : "body";
  }

  function readRegion(bounds: Bounds): PageSelection | null {
    const root = document.body;
    if (!root) return null;
    const groups: Text[][] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let visited = 0;
    while (walker.nextNode() && visited++ < 20_000) {
      const node = walker.currentNode as Text;
      const parent = node.parentElement;
      let selected = !!node.textContent?.trim() && !!parent
        && !parent.closest("script, style, noscript, template, [aria-hidden='true']")
        && overlaps(parent.getBoundingClientRect(), bounds);
      if (selected && parent) {
        const style = getComputedStyle(parent);
        selected = style.display !== "none" && style.visibility !== "hidden";
      }
      if (selected) {
        const range = document.createRange();
        range.selectNodeContents(node);
        selected = Array.from(range.getClientRects()).some((rect) => overlaps(rect, bounds));
      }
      if (selected) {
        if (!groups.length || !groups[groups.length - 1].length) groups.push([]);
        groups[groups.length - 1].push(node);
      } else if (groups.length && groups[groups.length - 1].length) {
        groups.push([]);
      }
    }

    let element: Element | null;
    let fullText: string;
    let fullHtml: string;
    const selectedGroups = groups.filter((group) => group.length);
    if (selectedGroups.length) {
      const enclosingRange = document.createRange();
      enclosingRange.setStart(selectedGroups[0][0], 0);
      const finalGroup = selectedGroups[selectedGroups.length - 1];
      const finalNode = finalGroup[finalGroup.length - 1];
      enclosingRange.setEnd(finalNode, finalNode.textContent?.length ?? 0);
      const ancestor = enclosingRange.commonAncestorContainer;
      element = ancestor.nodeType === Node.ELEMENT_NODE ? ancestor as Element : ancestor.parentElement;
      const fragments = selectedGroups.map((group) => {
        const range = document.createRange();
        range.setStart(group[0], 0);
        const last = group[group.length - 1];
        range.setEnd(last, last.textContent?.length ?? 0);
        const container = document.createElement("div");
        container.append(range.cloneContents());
        return { text: range.toString().trim(), html: container.innerHTML };
      });
      fullText = fragments.map((fragment) => fragment.text).filter(Boolean).join("\n");
      fullHtml = fragments.map((fragment) => fragment.html).filter(Boolean).join("\n");
    } else {
      const hit = document.elementFromPoint((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2);
      if (!hit || hit === root || !root.contains(hit)) return null;
      const rect = hit.getBoundingClientRect();
      const area = (bounds.right - bounds.left) * (bounds.bottom - bounds.top);
      if (!overlaps(rect, bounds) || rect.width * rect.height > area * 4) return null;
      element = hit;
      fullText = ((hit as HTMLElement).innerText || hit.textContent || "").trim();
      fullHtml = hit.innerHTML || hit.outerHTML;
    }
    if (!element || !root.contains(element) || (!fullText && !fullHtml)) return null;
    return {
      url: location.href, title: document.title, selector: selectorFor(element),
      text: fullText.slice(0, 16_000), html: fullHtml.slice(0, 24_000),
      truncated: fullText.length > 16_000 || fullHtml.length > 24_000,
    };
  }

  return new Promise((resolve) => {
    const host = document.createElement("div");
    host.style.setProperty("position", "fixed", "important");
    host.style.setProperty("inset", "0", "important");
    host.style.setProperty("z-index", "2147483647", "important");
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `<style>
      .surface { position: fixed; inset: 0; cursor: crosshair; background: rgba(16, 24, 40, .12); touch-action: none; user-select: none; }
      .box { position: absolute; display: none; border: 2px solid #79a8f8; background: rgba(79, 142, 240, .22); box-shadow: 0 0 0 1px #172239; box-sizing: border-box; pointer-events: none; }
      .hint { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); padding: 9px 13px; border-radius: 8px; background: #1b2230; color: #fff; font: 13px system-ui, sans-serif; white-space: nowrap; pointer-events: none; box-shadow: 0 4px 16px #0005; }
    </style><div class="surface"><div class="box"></div><div class="hint"></div></div>`;
    const surface = shadow.querySelector<HTMLElement>(".surface")!;
    const box = shadow.querySelector<HTMLElement>(".box")!;
    const hint = shadow.querySelector<HTMLElement>(".hint")!;
    hint.textContent = hints.start;
    let start: { x: number; y: number; pointerId: number } | null = null;
    let finished = false;
    const timeout = window.setTimeout(() => finish(null), 2 * 60_000);

    function finish(bounds: Bounds | null): void {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pagehide", onPageHide);
      host.remove();
      delete pageWindow.__qumiRegionPickerCancelV1;
      try { resolve(bounds ? readRegion(bounds) : null); }
      catch { resolve(null); }
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      finish(null);
    }
    function onPageHide(): void { finish(null); }
    function point(event: PointerEvent) {
      return { x: Math.max(0, Math.min(innerWidth, event.clientX)), y: Math.max(0, Math.min(innerHeight, event.clientY)) };
    }
    function draw(x: number, y: number): Bounds {
      const bounds = { left: Math.min(start!.x, x), top: Math.min(start!.y, y), right: Math.max(start!.x, x), bottom: Math.max(start!.y, y) };
      box.style.display = "block";
      box.style.left = `${bounds.left}px`;
      box.style.top = `${bounds.top}px`;
      box.style.width = `${bounds.right - bounds.left}px`;
      box.style.height = `${bounds.bottom - bounds.top}px`;
      return bounds;
    }
    surface.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const { x, y } = point(event);
      start = { x, y, pointerId: event.pointerId };
      surface.setPointerCapture(event.pointerId);
      draw(x, y);
    });
    surface.addEventListener("pointermove", (event) => {
      if (!start || event.pointerId !== start.pointerId) return;
      event.preventDefault();
      const { x, y } = point(event);
      draw(x, y);
    });
    surface.addEventListener("pointerup", (event) => {
      if (!start || event.pointerId !== start.pointerId) return;
      event.preventDefault();
      const { x, y } = point(event);
      const bounds = draw(x, y);
      if (bounds.right - bounds.left < 8 || bounds.bottom - bounds.top < 8) {
        start = null;
        box.style.display = "none";
        hint.textContent = hints.tooSmall;
        return;
      }
      finish(bounds);
    });
    surface.addEventListener("pointercancel", () => { start = null; box.style.display = "none"; });
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pagehide", onPageHide);
    pageWindow.__qumiRegionPickerCancelV1 = () => finish(null);
    document.documentElement.appendChild(host);
  });
}

async function assertCurrentTarget(target: PageTarget): Promise<void> {
  const [active] = await chrome.tabs.query({ active: true, windowId: target.windowId });
  if (!active || active.id !== target.tabId || active.url !== target.url) throw new Error(pageChanged);
}

export async function capturePageRegion(target: PageTarget, hints?: { start: string; tooSmall: string }): Promise<PageSelection | null> {
  await assertCurrentTarget(target);
  let captured: PageSelection | null | undefined;
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: target.tabId }, func: regionPickerInPage, args: ["start", hints ?? { start: "드래그로 영역 선택 · Esc로 취소", tooSmall: "조금 더 넓게 드래그해 주세요 · Esc로 취소" }] });
    captured = injection?.result;
  } catch {
    throw new Error("페이지에서 영역을 선택하지 못했습니다. 페이지 연결 권한을 확인해 주세요.");
  }
  await assertCurrentTarget(target);
  if (!captured) return null;
  if (captured.url !== target.url) throw new Error(pageChanged);
  return captured;
}

export async function cancelPageRegion(target: PageTarget): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId: target.tabId }, func: regionPickerInPage, args: ["cancel"] });
  } catch {
    // Navigation also removes the picker.
  }
}
