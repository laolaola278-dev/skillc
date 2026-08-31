import type { EmitFile, EmitResult, SkillIR, ToolRef } from "../types.js";

/** QM-compatible tool descriptor: { id, advertise, install?, mcp? }. */
function toolJson(t: ToolRef): Record<string, unknown> {
  const out: Record<string, unknown> = { id: t.id, advertise: t.advertise };
  if (t.install) out.install = t.install;
  if (t.mcp) out.mcp = t.mcp;
  return out;
}

export function emitClaudeCode(ir: SkillIR): EmitResult {
  const files: EmitFile[] = [];

  const fm = ["---", `name: ${ir.name}`, `description: ${JSON.stringify(ir.description)}`, "---", ""].join("\n");
  let body = ir.body.trim();
  if (ir.tools.length > 0) {
    body += "\n\n## Tools\n\nThis skill ships QM-compatible tool descriptors under `tools/<id>/tool.json`.\n";
  }
  files.push({
    path: `.claude/skills/${ir.name}/SKILL.md`,
    content: fm + body + "\n",
    kind: "standalone"
  });

  for (const t of ir.tools) {
    files.push({
      path: `.claude/skills/${ir.name}/tools/${t.id}/tool.json`,
      content: JSON.stringify(toolJson(t), null, 2) + "\n",
      kind: "standalone"
    });
  }

  return { files, diagnostics: [] };
}
