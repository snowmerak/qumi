import { parse as parseYaml } from "yaml";
import type { AgentTool } from "./agent.ts";

export interface InstalledSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  files: Record<string, string>;
}

const skillName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const maximumFileBytes = 1 << 20;
const maximumInstallBytes = 5 << 20;

function relativePath(value: string): string {
  const path = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!path || path.startsWith("/") || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`잘못된 스킬 파일 경로: ${value}`);
  }
  return path;
}

export function parseSkill(files: Record<string, string>): InstalledSkill {
  const body = files["SKILL.md"];
  if (typeof body !== "string") throw new Error("SKILL.md 파일이 필요합니다.");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(body);
  if (!match) throw new Error("SKILL.md에 YAML frontmatter가 필요합니다.");
  const metadata: unknown = parseYaml(match[1]);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("스킬 메타데이터가 올바르지 않습니다.");
  const values = metadata as Record<string, unknown>;
  const name = typeof values.name === "string" ? values.name.trim() : "";
  const description = typeof values.description === "string" ? values.description.trim() : "";
  if (!skillName.test(name) || name.length > 64 || !description) throw new Error("스킬에는 유효한 name과 description이 필요합니다.");
  const metadataTags = values.metadata && typeof values.metadata === "object" && !Array.isArray(values.metadata)
    ? (values.metadata as Record<string, unknown>).tags : undefined;
  const tags = [...(Array.isArray(values.tags) ? values.tags.filter((tag): tag is string => typeof tag === "string") : []),
    ...(typeof metadataTags === "string" ? metadataTags.split(/[,;]/) : [])].map((tag) => tag.trim().toLowerCase()).filter(Boolean).slice(0, 20);
  const normalized: Record<string, string> = {};
  let bytes = 0;
  for (const [rawPath, content] of Object.entries(files)) {
    const path = relativePath(rawPath);
    const size = new TextEncoder().encode(content).length;
    if (size > maximumFileBytes) throw new Error(`${path} 파일이 1 MiB를 초과합니다.`);
    bytes += size;
    if (bytes > maximumInstallBytes) throw new Error("스킬 전체 크기가 5 MiB를 초과합니다.");
    normalized[path] = content;
  }
  return { id: name, name, description, tags, files: normalized };
}

export async function installSkillFiles(files: FileList | File[]): Promise<InstalledSkill[]> {
  const selected = Array.from(files).map((file) => ({ file, path: relativePath(file.webkitRelativePath || file.name) }));
  const roots = selected.filter(({ path }) => path === "SKILL.md" || path.endsWith("/SKILL.md"))
    .map(({ path }) => path.slice(0, -"SKILL.md".length));
  const groups = new Map<string, Record<string, string>>();
  for (const { file, path: fullPath } of selected) {
    const root = roots.filter((candidate) => fullPath.startsWith(candidate)).sort((a, b) => b.length - a.length)[0];
    if (root === undefined) continue;
    const path = fullPath.slice(root.length);
    if (!groups.has(root)) groups.set(root, {});
    groups.get(root)![path] = await file.text();
  }
  return [...groups.values()].filter((group) => "SKILL.md" in group).map(parseSkill);
}

function terms(value: string): string[] {
  const words = value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const result = new Set(words);
  for (const word of words) if (/[^\u0000-\u007f]/u.test(word)) for (let i = 0; i + 2 <= word.length; i++) result.add(word.slice(i, i + 2));
  return [...result].filter((word) => word.length > 1);
}

export function searchSkills(skills: InstalledSkill[], query: string, limit = 8): Array<{ id: string; name: string; description: string; tags: string[]; score: number }> {
  const needles = terms(query.slice(0, 4000));
  if (!needles.length) return [];
  return skills.map((skill) => {
    const name = skill.name.toLowerCase();
    const description = skill.description.toLowerCase();
    const tags = skill.tags.join(" ").toLowerCase();
    const body = skill.files["SKILL.md"].toLowerCase();
    let score = 0;
    for (const needle of needles) {
      if (name.includes(needle)) score += 8;
      if (tags.includes(needle)) score += 5;
      if (description.includes(needle)) score += 3;
      if (body.includes(needle)) score += 1;
    }
    if (query.toLowerCase().includes(`$${name}`)) score += 100;
    return { id: skill.id, name: skill.name, description: skill.description.slice(0, 600), tags: skill.tags.map((tag) => tag.slice(0, 80)).slice(0, 12), score };
  }).filter((hit) => hit.score > 0).sort((left, right) => right.score - left.score || left.name.localeCompare(right.name)).slice(0, Math.max(1, Math.min(100, limit)));
}

export function skillTools(skills: InstalledSkill[], maxResultBytes = 48_000): AgentTool[] {
  if (!skills.length) return [];
  return [
    { definition: { type: "function", function: { name: "search_skills", description: "Search installed Agent Skills by task-specific keywords. Results contain metadata only; call get_skill for full instructions.", parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer" } }, required: ["query"], additionalProperties: false } } }, execute: async (value, signal) => {
      signal.throwIfAborted();
      const args = value as { query?: unknown; limit?: unknown };
      if (typeof args?.query !== "string" || !args.query.trim()) throw new Error("query가 필요합니다.");
      const hits = searchSkills(skills, args.query, typeof args.limit === "number" ? args.limit : 8);
      return JSON.stringify({ total: hits.length, hits });
    } },
    { definition: { type: "function", function: { name: "get_skill", description: "Read SKILL.md or a text resource from an installed Agent Skill. Use the exact id returned by search_skills; if nextOffset is returned, call again with that offset to read the rest.", parameters: { type: "object", properties: { id: { type: "string" }, path: { type: "string" }, offset: { type: "integer", minimum: 0, description: "Character offset returned as nextOffset by a prior get_skill call." } }, required: ["id"], additionalProperties: false } } }, execute: async (value, signal) => {
      signal.throwIfAborted();
      const args = value as { id?: unknown; path?: unknown; offset?: unknown };
      if (typeof args?.id !== "string" || (args.path !== undefined && typeof args.path !== "string")) throw new Error("스킬 id 또는 path가 올바르지 않습니다.");
      if (args.offset !== undefined && (!Number.isSafeInteger(args.offset) || (args.offset as number) < 0)) throw new Error("offset은 0 이상의 정수여야 합니다.");
      const skill = skills.find((candidate) => candidate.id === args.id);
      if (!skill) throw new Error(`설치된 스킬을 찾지 못했습니다: ${args.id}`);
      const path = relativePath(args.path || "SKILL.md");
      if (!(path in skill.files)) throw new Error(`스킬 리소스를 찾지 못했습니다: ${path}`);
      const characters = Array.from(skill.files[path]);
      const offset = (args.offset as number | undefined) ?? 0;
      if (offset > characters.length) throw new Error("offset이 스킬 본문을 벗어났습니다.");
      const metadata = { skill: { id: skill.id, name: skill.name }, path, totalChars: characters.length };
      let low = offset;
      let high = characters.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        const output = JSON.stringify({ ...metadata, content: characters.slice(offset, middle).join(""), ...(middle < characters.length ? { nextOffset: middle } : {}) });
        if (new TextEncoder().encode(output).length <= maxResultBytes) low = middle;
        else high = middle - 1;
      }
      if (low === offset && offset < characters.length) throw new Error("스킬 결과 예산이 너무 작습니다.");
      return JSON.stringify({ ...metadata, content: characters.slice(offset, low).join(""), ...(low < characters.length ? { nextOffset: low } : {}) });
    } },
  ];
}
