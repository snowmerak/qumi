import assert from "node:assert/strict";
import test from "node:test";
import { languagePreferenceFrom, localizeApprovalDetail, localizeApprovalTitle, localizeKnownError, resolveLocale, translate } from "./i18n.ts";
import { emptyState, loadState, saveState } from "./storage.ts";
import { renderTaskCompletion } from "./task-tools.ts";

test("browser language selects the four supported locales and falls back to English", () => {
  assert.equal(resolveLocale("auto", "ko-KR"), "ko");
  assert.equal(resolveLocale("auto", "ja-JP"), "ja");
  assert.equal(resolveLocale("auto", "zh-TW"), "zh");
  assert.equal(resolveLocale("auto", "en-GB"), "en");
  assert.equal(resolveLocale("auto", "fr-FR"), "en");
  assert.equal(resolveLocale("ja", "ko-KR"), "ja");
  assert.equal(languagePreferenceFrom("invalid"), "auto");
});

test("messages interpolate and browser approval text follows the chosen language", () => {
  assert.equal(translate("ja", "annotation", { number: 2 }), "<注記 2>");
  assert.equal(translate("zh", "modelsFound", { count: 3 }), "找到 3 个模型。");
  assert.equal(localizeApprovalTitle("en", "엘리먼트 클릭"), "Click element");
  assert.equal(localizeApprovalDetail("en", "https://example.com\n새 값: null (속성 제거)"), "https://example.com\nNew value: null (remove attribute)");
  assert.equal(localizeKnownError("en", "Gateway 요청에 실패했습니다. (502)"), "Gateway request failed (502).");
  assert.equal(renderTaskCompletion({ outcome: "blocked", summary: "Done", findings: ["A"], artifacts: [], verification: [], blocker: "B" }, "ja"), "Done\n\n確認事項:\n- A\n\n阻害要因: B");
});

test("language preference survives storage and old settings default to automatic", async () => {
  const values = new Map<string, string>();
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } });
  try {
    await saveState({ ...emptyState, settings: { ...emptyState.settings, language: "zh" } });
    assert.equal((await loadState()).settings.language, "zh");
    values.set("qumiState", JSON.stringify({ settings: { baseUrl: "" }, messages: [] }));
    assert.equal((await loadState()).settings.language, "auto");
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, "localStorage");
    else Object.defineProperty(globalThis, "localStorage", { configurable: true, value: previous });
  }
});
