import { TARGET_CAPS } from "../compat.js";
import { injectionBlock } from "../sync.js";
import type { EmitFile, EmitResult, SkillIR, ToolRef } from "../types.js";

function toolJson(t: ToolRef): Record<string, unknown> {
  const out: Record<string, unknown> = { id: t.id, advertise: t.advertise };
  if (t.install) out.install = t.install;
  if (t.mcp) out.mcp = t.mcp;
  return out;
}

export function emitCodex(ir: SkillIR): EmitResult {
  const files: EmitFile[] = [];
  const caps = TARGET_CAPS.codex;
  const missing = ir.needs.filter((n) => !caps.includes(n));

  const fm = ["---", `name: ${ir.name}`, `description: ${JSON.stringify(ir.description)}`, "---", ""].join("\n");
  let body = ir.body.trim();
  if (missing.includes("web-fetch")) {
    body +=
      "\n\n## Capability notes\n\n" +
      "Web fetch is not natively available in this environment; when the workflow needs " +
      "remote content, ask the user to paste it.\n";
  }
  if (ir.tools.length > 0) {
    body += "\n\n## Tools\n\nThis skill ships QM-compatible tool descriptors under `tools/<id>/tool.json`.\n";
  }
  files.push({ path: `.codex/skills/${ir.name}/SKILL.md`, content: fm + body + "\n", kind: "standalone" });

  for (const t of ir.tools) {
    files.push({
      path: `.codex/skills/${ir.name}/tools/${t.id}/tool.json`,
      content: JSON.stringify(toolJson(t), null, 2) + "\n",
      kind: "standalone"
    });
  }

  const inner =
    `## Skill: ${ir.name} (v${ir.version})\n\n` +
    `${ir.description}\n\n` +
    `Instructions: read \`.codex/skills/${ir.name}/SKILL.md\` before working on ${ir.name} tasks.\n`;
  files.push({
    path: "AGENTS.md",
    content: injectionBlock(ir.name, ir.version, inner),
    kind: "injection",
    markerName: ir.name
  });

  return { files, diagnostics: [] };
}
