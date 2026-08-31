import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { Diagnostic, SkillIR, ToolRef } from "./types.js";
import { validateSkillYaml } from "./schema.js";
import { canonicalStringify, sha256Text } from "./util.js";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Resource files to bundle verbatim next to the compiled SKILL.md on every
 * target. An explicit `resources:` list in skill.yaml wins; when the field is
 * absent every non-source file in the skill source is auto-detected
 * (SKILL.md, skill.yaml, tools/ descriptors and dotfiles are always source).
 * An empty explicit array opts out entirely.
 */
function collectResources(
  srcDir: string,
  explicit: string[] | undefined,
  diagnostics: Diagnostic[]
): Record<string, string> {
  const out: Record<string, string> = {};
  if (explicit !== undefined) {
    for (const relRaw of explicit) {
      const rel = relRaw.split("\\").join("/");
      const abs = join(srcDir, ...rel.split("/"));
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        diagnostics.push({
          level: "error",
          code: "resource-missing",
          message: `resources: "${rel}" does not exist in the skill source`
        });
        continue;
      }
      out[rel] = readFileSync(abs, "utf8");
    }
    return out;
  }
  const walk = (dir: string, prefix: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const rel = prefix ? prefix + "/" + e.name : e.name;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "tools") walk(p, rel);
        continue;
      }
      if (rel === "SKILL.md" || rel === "skill.yaml") continue;
      out[rel] = readFileSync(p, "utf8");
    }
  };
  walk(srcDir, "");
  return out;
}

/** Warn when SKILL.md points at a bundled-looking doc that ships nowhere. */
function checkBodyReferences(
  body: string,
  resources: Record<string, string>,
  diagnostics: Diagnostic[]
): void {
  const bundled = new Set(Object.keys(resources));
  for (const m of body.matchAll(/`([^`\r\n]+\.md)`/g)) {
    const ref = m[1].split("\\").join("/");
    if (ref === "SKILL.md" || bundled.has(ref)) continue;
    diagnostics.push({
      level: "warning",
      code: "missing-referenced-resource",
      message: `SKILL.md references "${ref}" but it is not bundled as a resource — the compiled skill will point at a missing file`
    });
  }
}

export function parseFrontmatter(text: string): { fm: Record<string, string>; body: string } {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return { fm: {}, body: text };
  const fm = (yaml.load(m[1]) as Record<string, string>) ?? {};
  return { fm, body: text.slice(m[0].length) };
}

export function loadSource(srcDir: string): { ir: SkillIR; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const ymlPath = join(srcDir, "skill.yaml");
  if (!existsSync(ymlPath)) {
    throw new Error(`skill.yaml not found in ${srcDir} — a skill source must contain skill.yaml`);
  }
  const raw = yaml.load(readFileSync(ymlPath, "utf8"));
  const { data, diagnostics: schemaDiags } = validateSkillYaml(raw, ymlPath);
  diagnostics.push(...schemaDiags);

  // SKILL.md — the instruction body. skill.yaml wins on conflicting metadata.
  const mdPath = join(srcDir, "SKILL.md");
  let body = "";
  let fm: Record<string, string> = {};
  if (existsSync(mdPath)) {
    const parsed = parseFrontmatter(readFileSync(mdPath, "utf8"));
    fm = parsed.fm;
    body = parsed.body.trim();
  } else {
    diagnostics.push({
      level: "warning",
      code: "no-skill-md",
      message: "SKILL.md missing — the compiled skill will have an empty instruction body"
    });
  }
  if (typeof fm.name === "string" && fm.name && fm.name !== data.name) {
    diagnostics.push({
      level: "warning",
      code: "name-mismatch",
      message: `SKILL.md frontmatter name "${fm.name}" != skill.yaml name "${data.name}" — skill.yaml wins`
    });
  }
  if (typeof fm.description === "string" && fm.description && data.description && fm.description !== data.description) {
    diagnostics.push({
      level: "warning",
      code: "description-mismatch",
      message: 'SKILL.md frontmatter description differs from skill.yaml — skill.yaml wins'
    });
  }

  // tools: inline in skill.yaml AND tools/<id>/tool.json — merged by id,
  // directory descriptors win (QM-compatible layout is authoritative)
  const tools: ToolRef[] = [];
  const toolsDir = join(srcDir, "tools");
  if (existsSync(toolsDir)) {
    for (const entry of readdirSync(toolsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const tj = join(toolsDir, entry.name, "tool.json");
      if (!existsSync(tj)) continue;
      try {
        const t = JSON.parse(readFileSync(tj, "utf8")) as ToolRef;
        if (typeof t.id !== "string" || !t.id) throw new Error("missing id");
        if (typeof t.advertise !== "string") throw new Error("missing advertise");
        tools.push(t);
      } catch (err) {
        diagnostics.push({
          level: "error",
          code: "tool-json-invalid",
          message: `${tj}: ${(err as Error).message}`
        });
      }
    }
  }

  // resources: explicit list wins; otherwise auto-detect. Checked against
  // SKILL.md body references so a doc the instructions cite cannot silently
  // ship missing (the 4-runtime trial's deployment.md gap).
  const resources = collectResources(srcDir, data.resources, diagnostics);
  checkBodyReferences(body, resources, diagnostics);

  const mergedTools = new Map<string, ToolRef>();
  for (const t of (data.tools ?? []) as ToolRef[]) mergedTools.set(t.id, t);
  for (const t of tools) mergedTools.set(t.id, t);

  const ir: SkillIR = {
    name: data.name,
    version: data.version,
    description: data.description ?? fm.description ?? "",
    needs: (data.needs ?? []) as SkillIR["needs"],
    optional: (data.optional ?? []) as SkillIR["optional"],
    frontmatter: fm,
    body,
    tools: [...mergedTools.values()],
    triggers: data.triggers ?? [],
    targets: data.targets ?? {},
    resources,
    sourceDir: srcDir,
    irHash: ""
  };
  ir.irHash = sha256Text(
    canonicalStringify({
      name: ir.name,
      version: ir.version,
      description: ir.description,
      needs: ir.needs,
      optional: ir.optional,
      frontmatter: ir.frontmatter,
      body: ir.body,
      tools: ir.tools,
      triggers: ir.triggers,
      targets: ir.targets,
      resources: ir.resources
    })
  );
  return { ir, diagnostics };
}
