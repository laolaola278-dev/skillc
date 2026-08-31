import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { loadSource } from "../src/parse.js";
import { validateSkillYaml } from "../src/schema.js";
import { checkCompat } from "../src/compat.js";
import { emitForTarget } from "../src/emit/index.js";
import { applyPlan, injectionBlock, planSync } from "../src/sync.js";
import { mergeLock, readLockfile as readLock, writeLockfile } from "../src/lockfile.js";

const REPO = resolve(import.meta.dirname, "..");
const TMP = join(REPO, "tmp-test");

const YAML = `name: demo-skill
version: 1.0.0
description: A demo skill for tests.
needs: [read-files, write-files, shell]
tools:
  - id: demo-tool
    advertise: demo-tool
    install:
      binary: wrong-binary
targets:
  claude-code: {}
  codex: {}
`;
const MD = `# Demo Skill

Do the demo thing.
`;

function makeSource(name, yml, md) {
  const dir = join(TMP, name, "skill.src");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "skill.yaml"), yml, "utf8");
  writeFileSync(join(dir, "SKILL.md"), md, "utf8");
  return dir;
}

after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

test("parse: yaml + SKILL.md -> SkillIR with stable hash", () => {
  const src = makeSource("t1", YAML, MD);
  const a = loadSource(src);
  assert.equal(a.ir.name, "demo-skill");
  assert.equal(a.ir.version, "1.0.0");
  assert.deepEqual(a.ir.needs, ["read-files", "write-files", "shell"]);
  assert.equal(a.ir.tools.length, 1);
  assert.equal(a.ir.tools[0].id, "demo-tool");
  const b = loadSource(src);
  assert.equal(a.ir.irHash, b.ir.irHash);
});

test("parse: tools/<id>/tool.json overrides inline yaml tool with the same id", () => {
  const src = makeSource("t2", YAML, MD);
  const tdir = join(src, "tools", "demo-tool");
  mkdirSync(tdir, { recursive: true });
  writeFileSync(
    join(tdir, "tool.json"),
    JSON.stringify({ id: "demo-tool", advertise: "demo-tool", install: { binary: "right-binary" } }),
    "utf8"
  );
  const { ir } = loadSource(src);
  assert.equal(ir.tools.length, 1);
  assert.equal(ir.tools[0].install?.binary, "right-binary");
});

test("schema: rejects bad name and reports unknown capability", () => {
  assert.throws(() => validateSkillYaml({ name: "Bad Name", version: "1.0.0" }, "t"));
  assert.throws(() => validateSkillYaml({ name: "ok-name", version: "one" }, "t"));
  const { diagnostics } = validateSkillYaml({ name: "ok-name", version: "1.0.0", needs: ["read-files", "nonsense"] }, "t");
  assert.ok(diagnostics.some((d) => d.level === "error" && d.code === "unknown-capability"));
});

test("compat: web-fetch degrades on codex, passes on claude-code", () => {
  const ir = loadSource(
    makeSource("t4", "name: web-skill\nversion: 1.0.0\ndescription: d\nneeds: [read-files, web-fetch]\n", "# W\n")
  ).ir;
  assert.equal(checkCompat(ir, "claude-code").length, 0);
  const codex = checkCompat(ir, "codex");
  assert.equal(codex.length, 1);
  assert.equal(codex[0].code, "cap-degraded");
});

test("emit claude-code: frontmatter, body, tools section, valid tool.json", () => {
  const ir = loadSource(makeSource("t5", YAML, MD)).ir;
  const { files } = emitForTarget("claude-code", ir);
  const skill = files.find((f) => f.path === ".claude/skills/demo-skill/SKILL.md");
  assert.ok(skill, "SKILL.md emitted");
  assert.ok(skill.content.startsWith("---\nname: demo-skill\n"));
  assert.ok(skill.content.includes(JSON.stringify("A demo skill for tests.")));
  assert.ok(skill.content.includes("# Demo Skill"));
  assert.ok(skill.content.includes("## Tools"));
  const tool = files.find((f) => f.path === ".claude/skills/demo-skill/tools/demo-tool/tool.json");
  assert.ok(tool, "tool.json emitted");
  assert.deepEqual(JSON.parse(tool.content).install, { binary: "wrong-binary" });
  assert.throws(() => emitForTarget("codex", ir), /not implemented/);
});

test("sync standalone: create -> unchanged -> blocked -> force replace", () => {
  const ir = loadSource(makeSource("t6", YAML, MD)).ir;
  const root = join(TMP, "t6", "root");
  const { files } = emitForTarget("claude-code", ir);
  const skillFile = files[0];

  let plan = planSync("claude-code", files, root, null);
  assert.ok(plan.actions.every((a) => a.kind === "create"));
  const res = applyPlan("claude-code", plan.actions, root, ir.version);
  assert.equal(res.written.length, files.length);
  assert.equal(readFileSync(join(root, skillFile.path), "utf8"), skillFile.content);
  writeLockfile(root, mergeLock(null, ir.name, ir.version, { "claude-code": res.entries }));

  plan = planSync("claude-code", files, root, readLock(root));
  assert.ok(plan.actions.every((a) => a.kind === "unchanged"));

  writeFileSync(join(root, skillFile.path), skillFile.content + "\nhand-edited\n", "utf8");
  plan = planSync("claude-code", files, root, readLock(root));
  const blocked = plan.actions.find((a) => a.file.path === skillFile.path);
  assert.equal(blocked?.kind, "blocked");
  const res2 = applyPlan("claude-code", plan.actions, root, ir.version);
  assert.ok(!res2.written.includes(skillFile.path), "blocked file must not be written");

  plan = planSync("claude-code", files, root, readLock(root), { force: true });
  assert.equal(plan.actions.find((a) => a.file.path === skillFile.path)?.kind, "replace");
  applyPlan("claude-code", plan.actions, root, ir.version);
  assert.equal(readFileSync(join(root, skillFile.path), "utf8"), skillFile.content);
});

test("sync injection: append, idempotent, replace preserves surrounding text", () => {
  const root = join(TMP, "t7", "root");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "AGENTS.md"), "# mine\n\nhand-written rules\n", "utf8");
  const inner1 = "## Skill: demo-skill\n\nv1 rules\n";
  const block1 = injectionBlock("demo-skill", "1.0.0", inner1);
  const inj = { path: "AGENTS.md", content: block1, kind: "injection", markerName: "demo-skill" };

  let plan = planSync("codex", [inj], root, null);
  assert.equal(plan.actions[0].kind, "inject-append");
  const res = applyPlan("codex", plan.actions, root, "1.0.0");
  let text = readFileSync(join(root, "AGENTS.md"), "utf8");
  assert.ok(text.startsWith("# mine\n\nhand-written rules"));
  assert.ok(text.includes("v1 rules"));

  writeLockfile(root, mergeLock(null, "demo-skill", "1.0.0", { codex: res.entries }));
  plan = planSync("codex", [inj], root, readLock(root));
  assert.equal(plan.actions[0].kind, "unchanged");

  const block2 = injectionBlock("demo-skill", "1.1.0", "## Skill: demo-skill\n\nv2 rules\n");
  const inj2 = { ...inj, content: block2 };
  plan = planSync("codex", [inj2], root, readLock(root));
  assert.equal(plan.actions[0].kind, "inject-replace");
  applyPlan("codex", plan.actions, root, "1.1.0");
  text = readFileSync(join(root, "AGENTS.md"), "utf8");
  assert.ok(text.includes("v2 rules"));
  assert.ok(!text.includes("v1 rules"));
  assert.ok(text.includes("hand-written rules"), "user text survives");

  const foreign = injectionBlock("other-skill", "0.0.1", "other rules");
  const text3 = readFileSync(join(root, "AGENTS.md"), "utf8");
  writeFileSync(join(root, "AGENTS.md"), text3 + "\n" + foreign, "utf8");
  plan = planSync("codex", [inj2], root, readLock(root));
  assert.equal(plan.actions[0].kind, "unchanged", "foreign block does not disturb ours");
  const planForeign = planSync("codex", [{ ...inj2, markerName: "other-skill", content: foreign }], root, null);
  assert.equal(planForeign.actions[0].kind, "unchanged", "identical foreign block is idempotent");
  const foreign2 = injectionBlock("other-skill", "0.0.2", "more rules");
  const planForeign2 = planSync("codex", [{ ...inj2, markerName: "other-skill", content: foreign2 }], root, null);
  assert.equal(planForeign2.actions[0].kind, "inject-replace", "same marker, new content -> replace");
});
