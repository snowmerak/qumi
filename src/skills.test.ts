import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { installSkillFiles, parseSkill, searchSkills, skillTools } from "./skills.ts";

const translation = `---\nname: article-translation\ndescription: Translate articles while preserving structure.\ntags: [translation, prose]\n---\n\n# Translation\nPreserve headings and links.\n`;

describe("installed Agent Skills", () => {
  it("searches metadata and reads full text only through get_skill", async () => {
    const skill = parseSkill({ "SKILL.md": translation, "references/style.md": "Use natural Korean." });
    const hits = searchSkills([skill], "translate article");
    assert.equal(hits[0].id, "article-translation");
    assert.equal(JSON.stringify(hits).includes("Preserve headings"), false);
    const tools = skillTools([skill]);
    const result = JSON.parse(await tools[1].execute({ id: skill.id, path: "references/style.md" }, new AbortController().signal));
    assert.equal(result.content, "Use natural Korean.");
    await assert.rejects(tools[1].execute({ id: skill.id, path: "../secret" }, new AbortController().signal), /경로/);
  });

  it("imports multiple skill folders and their resources", async () => {
    const file = (path: string, content: string) => {
      const item = new File([content], path.split("/").at(-1)!);
      Object.defineProperty(item, "webkitRelativePath", { value: path });
      return item;
    };
    const imported = await installSkillFiles([
      file("skills/article-translation/SKILL.md", translation),
      file("skills/article-translation/references/style.md", "Natural tone"),
      file("skills/proofreading/SKILL.md", "---\nname: proofreading\ndescription: Check grammar.\n---\n\n# Proofreading"),
    ]);
    assert.equal(imported.length, 2);
    assert.equal(imported[0].files["references/style.md"], "Natural tone");
  });

  it("reads a long skill in complete, bounded chunks", async () => {
    const skill = parseSkill({ "SKILL.md": translation + "한국어 문장. ".repeat(1000) });
    const tool = skillTools([skill], 500)[1];
    let offset = 0;
    let body = "";
    for (let count = 0; count < 100; count++) {
      const result = JSON.parse(await tool.execute({ id: skill.id, offset }, new AbortController().signal));
      assert.ok(new TextEncoder().encode(JSON.stringify(result)).length <= 500);
      body += result.content;
      if (result.nextOffset === undefined) break;
      offset = result.nextOffset;
    }
    assert.equal(body, skill.files["SKILL.md"]);
  });
});
