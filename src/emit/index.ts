import { TARGET_CAPS, checkCompat } from "../compat.js";
import type { EmitResult, SkillIR, TargetId } from "../types.js";
import { emitClaudeCode } from "./claude-code.js";
import { emitCodex } from "./codex.js";
import { emitDsh } from "./dsh.js";
import { emitHermes } from "./hermes.js";

/** Targets with a working emitter. */
export const IMPLEMENTED_TARGETS: readonly TargetId[] = ["claude-code", "codex", "dsh", "hermes"];

const EMITTERS: Partial<Record<TargetId, (ir: SkillIR) => EmitResult>> = {
  "claude-code": emitClaudeCode,
  codex: emitCodex,
  dsh: emitDsh,
  hermes: emitHermes
};

export function emitForTarget(target: TargetId, ir: SkillIR): EmitResult {
  const emit = EMITTERS[target];
  if (!emit) throw new Error(`target "${target}" is declared but not implemented yet`);
  const result = emit(ir);
  const diagnostics = [...checkCompat(ir, target), ...result.diagnostics];

  // Resources ship verbatim into the same skill directory the target's
  // SKILL.md lands in, so relative references from SKILL.md resolve.
  const resources = Object.entries(ir.resources ?? {});
  if (resources.length > 0) {
    const skillDir = result.files.find((f) => f.kind === "standalone" && /SKILL\.md$/.test(f.path))?.path;
    if (skillDir) {
      const base = skillDir.replace(/SKILL\.md$/, "");
      for (const [rel, content] of resources) {
        const norm = rel.split("\\").join("/");
        if (norm.split("/").some((s) => s === "..")) {
          diagnostics.push({
            level: "warning",
            code: "resource-skipped",
            message: `resource "${rel}" skipped on ${target} — must not traverse outside the skill directory`
          });
          continue;
        }
        if (result.files.some((f) => f.path === base + norm)) {
          diagnostics.push({
            level: "warning",
            code: "resource-collision",
            message: `resource "${rel}" collides with an emitted file on ${target} — resource skipped`
          });
          continue;
        }
        result.files.push({ path: base + norm, content, kind: "standalone" });
      }
    } else {
      diagnostics.push({
        level: "warning",
        code: "resources-dropped",
        message: `${resources.length} resource(s) dropped on ${target} — emitter produced no SKILL.md`
      });
    }
  }

  if (ir.triggers.length > 0 && !(TARGET_CAPS[target] ?? []).includes("cron")) {
    diagnostics.push({
      level: "info",
      target,
      code: "triggers-compiled-out",
      message: `${ir.triggers.length} trigger(s) compiled out on ${target} — no native cron (skillc cron ships in M3)`
    });
  }
  for (const d of diagnostics) d.target = target;
  return { files: result.files, diagnostics };
}
