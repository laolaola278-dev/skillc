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
