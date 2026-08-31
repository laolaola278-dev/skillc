export const CAPABILITIES = [
  "read-files",
  "write-files",
  "shell",
  "web-fetch",
  "subagents",
  "memory",
  "cron",
  "mcp"
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const KNOWN_TARGETS = [
  "claude-code",
  "codex",
  "dsh",
  "cursor",
  "opencode",
  "pi"
] as const;

export type TargetId = (typeof KNOWN_TARGETS)[number];

export interface ToolRef {
  id: string;
  advertise: string;
  install?: { binary?: string };
  mcp?: { command?: string; args?: string[]; url?: string };
}

export interface Trigger {
  cron?: string;
  watch?: string;
  prompt: string;
}

export interface SkillYaml {
  name: string;
  version: string;
  description?: string;
  needs?: Capability[];
  optional?: Capability[];
  tools?: ToolRef[];
  triggers?: Trigger[];
  targets?: Partial<Record<TargetId, unknown>>;
}

export interface SkillIR {
  name: string;
  version: string;
  description: string;
  needs: Capability[];
  optional: Capability[];
  frontmatter: Record<string, string>;
  body: string;
  tools: ToolRef[];
  triggers: Trigger[];
  targets: Partial<Record<TargetId, unknown>>;
  sourceDir: string;
  irHash: string;
}

export type DiagnosticLevel = "error" | "warning" | "info";

export interface Diagnostic {
  level: DiagnosticLevel;
  code: string;
  message: string;
  target?: TargetId;
}

/**
 * "standalone": the file is wholly owned by skillc (e.g. SKILL.md).
 * "injection": the content is a marker block that must live inside a
 *              possibly user-owned file (e.g. AGENTS.md).
 */
export type EmitKind = "standalone" | "injection";

export interface EmitFile {
  path: string;
  content: string;
  kind: EmitKind;
  markerName?: string;
}

export interface EmitResult {
  files: EmitFile[];
  diagnostics: Diagnostic[];
}

/** Portable single-file bundle of a skill source (skillc pack). */
export interface SkillPack {
  skillpack: 1;
  name: string;
  version: string;
  irHash: string;
  files: Record<string, string>;
}
