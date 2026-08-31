import type { Capability, Diagnostic, SkillIR, TargetId } from "./types.js";

/**
 * What each harness can actually do natively. The compiler uses this to
 * decide: pass-through, degrade with a warning, or compile out.
 */
export const TARGET_CAPS: Record<TargetId, Capability[]> = {
  "claude-code": ["read-files", "write-files", "shell", "web-fetch", "subagents", "memory", "mcp"],
  codex: ["read-files", "write-files", "shell", "mcp"],
  dsh: ["read-files", "write-files", "shell", "web-fetch", "subagents", "memory", "mcp", "cron"],
  hermes: ["read-files", "write-files", "shell", "web-fetch", "subagents", "mcp", "cron"],
  cursor: ["read-files", "write-files", "shell", "web-fetch"],
  opencode: ["read-files", "write-files", "shell", "web-fetch", "subagents", "mcp"],
  pi: ["read-files", "write-files", "shell", "web-fetch", "subagents", "mcp"]
};

export function checkCompat(ir: SkillIR, target: TargetId): Diagnostic[] {
  const caps = TARGET_CAPS[target] ?? [];
  const diags: Diagnostic[] = [];
  for (const need of ir.needs) {
    if (caps.includes(need)) continue;
    if (need === "web-fetch") {
      diags.push({
        level: "warning",
        target,
        code: "cap-degraded",
        message: `"web-fetch" is not native on ${target} — the emitted text tells the agent to ask the user to paste fetched content`
      });
    } else {
      diags.push({
        level: "warning",
        target,
        code: "cap-degraded",
        message: `capability "${need}" is not native on ${target} — verify the emitted skill still makes sense`
      });
    }
  }
  return diags;
}
