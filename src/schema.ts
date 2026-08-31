import {
  CAPABILITIES,
  KNOWN_TARGETS,
  type Capability,
  type Diagnostic,
  type SkillYaml,
  type ToolRef,
  type Trigger
} from "./types.js";

export function validateSkillYaml(
  raw: unknown,
  file: string
): { data: SkillYaml; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const fail = (code: string, message: string): never => {
    throw new Error(`${file}: ${message} (${code})`);
  };

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail("schema", "skill.yaml must be a mapping");
  }
  const data = raw as SkillYaml;

  if (typeof data.name !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(data.name)) {
    fail("name", `name must be kebab-case, got: ${JSON.stringify(data.name)}`);
  }
  if (typeof data.version !== "string" || !/^\d+\.\d+\.\d+(-[\w.-]+)?$/.test(data.version)) {
    fail("version", `version must be semver, got: ${JSON.stringify(data.version)}`);
  }
  if (
    data.description !== undefined &&
    (typeof data.description !== "string" || data.description.length > 1024)
  ) {
    fail("description", "description must be a string of at most 1024 chars (harness routing budget)");
  }

  for (const field of ["needs", "optional"] as const) {
    const list = data[field];
    if (list === undefined) continue;
    if (!Array.isArray(list)) fail(field, `${field} must be an array`);
    for (const c of list) {
      if (!(CAPABILITIES as readonly string[]).includes(String(c))) {
        diagnostics.push({
          level: "error",
          code: "unknown-capability",
          message: `${field}: unknown capability "${String(c)}" (known: ${CAPABILITIES.join(", ")})`
        });
      }
    }
  }

  if (data.tools !== undefined) {
    if (!Array.isArray(data.tools)) fail("tools", "tools must be an array");
    for (const t of data.tools as ToolRef[]) {
      if (typeof t?.id !== "string" || !t.id) fail("tools", "every tool needs a non-empty string id");
      if (typeof t?.advertise !== "string") fail("tools", `tool ${t.id}: advertise must be a string`);
      if (t.install === undefined && t.mcp === undefined) {
        diagnostics.push({
          level: "warning",
          code: "tool-descriptor-only",
          message: `tool ${t.id}: no install/mcp section — it compiles as a descriptor only`
        });
      }
    }
  }

  if (data.triggers !== undefined) {
    if (!Array.isArray(data.triggers)) fail("triggers", "triggers must be an array");
    (data.triggers as Trigger[]).forEach((tr, i) => {
      if (typeof tr?.prompt !== "string" || !tr.prompt) {
        fail("triggers", `triggers[${i}].prompt must be a non-empty string`);
      }
      if (!tr.cron && !tr.watch) {
        fail("triggers", `triggers[${i}]: needs a cron or watch field`);
      }
    });
  }

  if (data.resources !== undefined) {
    if (!Array.isArray(data.resources)) fail("resources", "resources must be an array of relative file paths");
    for (const raw of data.resources as unknown[]) {
      const r = typeof raw === "string" ? raw : "";
      if (r.trim() === "") {
        fail("resources", "every resource must be a non-empty relative path string");
      }
      const norm = r.split("\\").join("/");
      if (norm !== r) {
        diagnostics.push({
          level: "info",
          code: "resource-path-normalized",
          message: `resources: "${r}" normalized to "${norm}"`
        });
      }
      if (norm.startsWith("/") || /^[A-Za-z]:/.test(norm)) {
        fail("resources", `resource "${r}" must be a relative path inside the skill source`);
      }
      if (norm.split("/").some((s: string) => s === "..")) {
        fail("resources", `resource "${r}" must not traverse outside the skill source`);
      }
    }
  }

  if (data.targets !== undefined) {
    for (const key of Object.keys(data.targets)) {
      if (!(KNOWN_TARGETS as readonly string[]).includes(key)) {
        diagnostics.push({
          level: "warning",
          code: "unknown-target",
          message: `targets: "${key}" is not a known skillc target (known: ${KNOWN_TARGETS.join(", ")})`
        });
      }
    }
  }

  return { data, diagnostics };
}
