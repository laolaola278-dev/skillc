import { TARGET_CAPS } from "../compat.js";
import type { EmitResult, SkillIR, TargetId } from "../types.js";
import { emitClaudeCode } from "./claude-code.js";

/** Targets with a working emitter. M2 adds codex and dsh. */
export const IMPLEMENTED_TARGETS: readonly TargetId[] = ["claude-code"];

const EMITTERS: Partial<Record<TargetId, (ir: SkillIR) => EmitResult>> = {
  "claude-code": emitClaudeCode
};

export function emitForTarget(target: TargetId, ir: SkillIR): EmitResult {
  const emit = EMITTERS[target];
  if (!emit) throw new Error(`target "${target}" is declared but not implemented yet`);
  const result = emit(ir);
  const diagnostics = [...TARGET_COMPAT(ir, target), ...result.diagnostics];
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

import { checkCompat as TARGET_COMPAT } from "../compat.js";
