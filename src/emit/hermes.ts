import type { EmitFile, EmitResult, SkillIR, ToolRef } from "../types.js";

function toolJson(t: ToolRef): Record<string, unknown> {
  const out: Record<string, unknown> = { id: t.id, advertise: t.advertise };
  if (t.install) out.install = t.install;
  if (t.mcp) out.mcp = t.mcp;
  return out;
}

/**
 * Hermes Agent (NousResearch/hermes-agent) reads the agentskills.io open
 * standard: SKILL.md with name/description frontmatter under the profile's
 * skills directory (default ~/.hermes/skills). Project-scope skills are
 * wired by adding the emitted directory to skills.external_dirs in
 * ~/.hermes/config.yaml.
 */
export function emitHermes(ir: SkillIR): EmitResult {
  const files: EmitFile[] = [];

  const fm = ["---", `name: ${ir.name}`, `description: ${JSON.stringify(ir.description)}`, "---", ""].join("\n");
  let body = ir.body.trim();
  if (ir.triggers.length > 0) {
    body +=
      "\n\n## Triggers\n\n" +
      ir.triggers
        .map((t) => `- ${t.cron ? "cron " + JSON.stringify(t.cron) : "watch " + JSON.stringify(t.watch)}: ${t.prompt}`)
        .join("\n") +
      "\n";
  }
  if (ir.tools.length > 0) {
    body += "\n\n## Tools\n\nThis skill ships QM-compatible tool descriptors under \`tools/<id>/tool.json\`.\n";
  }
  files.push({ path: `.hermes/skills/${ir.name}/SKILL.md`, content: fm + body + "\n", kind: "standalone" });

  for (const t of ir.tools) {
    files.push({
      path: `.hermes/skills/${ir.name}/tools/${t.id}/tool.json`,
      content: JSON.stringify(toolJson(t), null, 2) + "\n",
      kind: "standalone"
    });
  }

  return { files, diagnostics: [] };
}
