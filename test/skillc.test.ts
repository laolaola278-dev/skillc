import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { loadSource } from "../src/parse.js";
import { validateSkillYaml } from "../src/schema.js";
import { checkCompat } from "../src/compat.js";
import { emitForTarget } from "../src/emit/index.js";
import { applyPlan, injectionBlock, planSync } from "../src/sync.js";
import { packSource, unpackInto, writePack } from "../src/pack.js";
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
});

test("emit codex: SKILL.md + tool.json + AGENTS.md injection block", () => {
  const ir = loadSource(makeSource("t5b", YAML, MD)).ir;
  const { files, diagnostics } = emitForTarget("codex", ir);
  const skill = files.find((f) => f.path === ".codex/skills/demo-skill/SKILL.md");
  assert.ok(skill, "codex SKILL.md emitted");
  assert.ok(skill.content.startsWith("---\nname: demo-skill\n"));
  const tool = files.find((f) => f.path === ".codex/skills/demo-skill/tools/demo-tool/tool.json");
  assert.ok(tool, "codex tool.json emitted");
  const inj = files.find((f) => f.path === "AGENTS.md");
  assert.ok(inj, "AGENTS.md injection emitted");
  assert.equal(inj.kind, "injection");
  assert.equal(inj.markerName, "demo-skill");
  assert.ok(inj.content.startsWith("<!-- skillc:begin name=demo-skill version=1.0.0 hash="));
  assert.ok(inj.content.trimEnd().endsWith("<!-- skillc:end -->"));
  assert.ok(inj.content.includes(".codex/skills/demo-skill/SKILL.md"));
  assert.equal(diagnostics.filter((d) => d.code === "cap-degraded").length, 0, "yaml needs all native on codex");
});

test("emit dsh: triggers compiled into text with info diagnostic", () => {
  const yml = YAML + "triggers:\n  - cron: \"0 9 * * 1\"\n    prompt: morning check\n";
  const ir = loadSource(makeSource("t5c", yml, MD)).ir;
  const { files, diagnostics } = emitForTarget("dsh", ir);
  const skill = files.find((f) => f.path === ".dsh/skills/demo-skill/SKILL.md");
  assert.ok(skill, "dsh SKILL.md emitted");
  assert.ok(skill.content.includes("## Triggers"));
  assert.ok(skill.content.includes("cron \"0 9 * * 1\""));
  assert.ok(diagnostics.some((d) => d.code === "triggers-documented"));
  const { diagnostics: ccDiags } = emitForTarget("claude-code", ir);
  assert.ok(ccDiags.some((d) => d.code === "triggers-compiled-out"), "cron compiled out on claude-code");
});

test("emit hermes: agentskills SKILL.md + tools, triggers inline without diagnostics", () => {
  const yml = YAML + "triggers:\n  - cron: \"0 9 * * 1\"\n    prompt: morning check\n";
  const ir = loadSource(makeSource("t5d", yml, MD)).ir;
  const { files, diagnostics } = emitForTarget("hermes", ir);
  const skill = files.find((f) => f.path === ".hermes/skills/demo-skill/SKILL.md");
  assert.ok(skill, "hermes SKILL.md emitted");
  assert.ok(skill.content.startsWith("---\nname: demo-skill\n"));
  assert.ok(skill.content.includes(JSON.stringify("A demo skill for tests.")));
  assert.ok(skill.content.includes("## Triggers"));
  assert.ok(skill.content.includes("## Tools"));
  const tool = files.find((f) => f.path === ".hermes/skills/demo-skill/tools/demo-tool/tool.json");
  assert.ok(tool, "hermes tool.json emitted");
  assert.equal(diagnostics.length, 0, "hermes is fully capable for this fixture");
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

test("pack/unpack round-trip preserves the source", () => {
  const src = makeSource("t8", YAML, MD);
  const pack = packSource(src);
  assert.equal(pack.name, "demo-skill");
  assert.equal(Object.keys(pack.files).sort().join(","), "SKILL.md,skill.yaml");
  const out = join(TMP, "t8", "restored");
  writePack(pack, join(TMP, "t8", "demo.skillpack"));
  const res = unpackInto(join(TMP, "t8", "demo.skillpack"), out);
  const ir = loadSource(res.outDir).ir;
  assert.equal(ir.name, "demo-skill");
  assert.equal(ir.version, "1.0.0");
  assert.equal(ir.tools.length, 1);
  assert.equal(ir.body.trim(), loadSource(src).ir.body.trim());
  assert.equal(ir.irHash, loadSource(src).ir.irHash, "irHash identical after round-trip");
});

test("unpack reverse-imports a bare SKILL.md directory", () => {
  const bare = join(TMP, "t9", "some-skill");
  mkdirSync(bare, { recursive: true });
  writeFileSync(
    join(bare, "SKILL.md"),
    "---\nname: imported-skill\ndescription: Imported from elsewhere.\n---\n\n# Imported\n\nBody here.\n",
    "utf8"
  );
  const tdir = join(bare, "tools", "x-tool");
  mkdirSync(tdir, { recursive: true });
  writeFileSync(join(tdir, "tool.json"), JSON.stringify({ id: "x-tool", advertise: "x-tool" }), "utf8");

  const res = unpackInto(bare, join(TMP, "t9", "out"));
  const { ir, diagnostics } = loadSource(res.outDir);
  assert.equal(ir.name, "imported-skill");
  assert.equal(ir.description, "Imported from elsewhere.");
  assert.equal(ir.tools.length, 1);
  assert.deepEqual(ir.needs, ["read-files", "write-files"], "conservative default needs");
  assert.equal(diagnostics.length, 0);
});

test("resources: auto-detected files bundle into every target and sync idempotently", () => {
  const dir = makeSource("t10", YAML, MD);
  writeFileSync(join(dir, "deployment.md"), "# Workflow\n\nDo the steps.\n", "utf8");
  mkdirSync(join(dir, "references"), { recursive: true });
  writeFileSync(join(dir, "references", "fly.md"), "# Fly\n", "utf8");
  const { ir } = loadSource(dir);
  assert.deepEqual(Object.keys(ir.resources).sort(), ["deployment.md", "references/fly.md"]);
  for (const t of ["claude-code", "codex", "dsh", "hermes"] as const) {
    const { files } = emitForTarget(t, ir);
    const skill = files.find((f) => f.kind === "standalone" && f.path.endsWith("/SKILL.md"));
    assert.ok(skill, t + " SKILL.md emitted");
    const base = skill.path.replace(/SKILL\.md$/, "");
    assert.ok(files.some((f) => f.path === base + "deployment.md"), t + " bundles deployment.md");
    assert.ok(files.some((f) => f.path === base + "references/fly.md"), t + " bundles references/fly.md");
  }
  const root = join(TMP, "t10", "root");
  const { files } = emitForTarget("codex", ir);
  let plan = planSync("codex", files, root, null);
  assert.ok(
    plan.actions.every((a) => a.kind === "create" || a.kind === "inject-append"),
    "fresh root: standalone resources create, injection appends"
  );
  const res = applyPlan("codex", plan.actions, root, ir.version);
  writeLockfile(root, mergeLock(null, ir.name, ir.version, { codex: res.entries }));
  plan = planSync("codex", files, root, readLock(root));
  assert.ok(plan.actions.every((a) => a.kind === "unchanged"), "second sync idempotent including resources");
  writeFileSync(join(root, ".codex", "skills", "demo-skill", "deployment.md"), "hand-edited\n", "utf8");
  plan = planSync("codex", files, root, readLock(root));
  assert.equal(plan.actions.find((a) => a.file.path.endsWith("deployment.md"))?.kind, "blocked", "hand-edited resource is protected");
  const pack = packSource(dir);
  assert.equal(pack.files["deployment.md"], "# Workflow\n\nDo the steps.\n", "pack carries resources");
});

test("resources: explicit list wins; missing entry errors; unreferenced doc warns; traversal rejected", () => {
  const dir = makeSource("t11", YAML, "# Demo\n\nRead `missing.md`.\n");
  writeFileSync(join(dir, "real.md"), "# Real\n", "utf8");
  const { diagnostics } = loadSource(dir);
  assert.ok(
    diagnostics.some((d) => d.code === "missing-referenced-resource" && d.message.includes("missing.md")),
    "auto-detect does not silence a missing referenced doc"
  );
  const yml = YAML + "resources:\n  - real.md\n  - ghost.md\n";
  const dirB = makeSource("t11b", yml, "# Demo\n\nFollow `real.md`.\n");
  writeFileSync(join(dirB, "real.md"), "# Real\n", "utf8");
  const loaded = loadSource(dirB);
  assert.ok(loaded.diagnostics.some((d) => d.level === "error" && d.code === "resource-missing" && d.message.includes("ghost.md")));
  assert.deepEqual(Object.keys(loaded.ir.resources), ["real.md"]);
  assert.ok(loaded.diagnostics.every((d) => d.code !== "missing-referenced-resource"), "explicit bundling clears the warning");
  assert.throws(() => loadSource(makeSource("t11c", YAML + "resources:\n  - ../secrets.md\n", MD)), /traverse/);
  const empty = loadSource(makeSource("t11d", YAML + "resources: []\n", MD));
  assert.equal(Object.keys(empty.ir.resources).length, 0, "empty array opts out");
});

test("resources: path colliding with an emitted file is skipped with a diagnostic", () => {
  const ir = loadSource(makeSource("t12", YAML + "resources:\n  - SKILL.md\n", MD)).ir;
  const { files, diagnostics } = emitForTarget("claude-code", ir);
  assert.equal(files.filter((f) => f.path === ".claude/skills/demo-skill/SKILL.md").length, 1, "no duplicate emitted");
  assert.ok(diagnostics.some((d) => d.code === "resource-collision"));
});

test("resources: referenced doc bundled -> warning gone and irHash changes", () => {
  const ymlWith = YAML + "resources:\n  - guide.md\n";
  const md = "# Demo\n\nRead `guide.md` completely.\n";
  const without = loadSource(makeSource("t13", YAML, md));
  assert.ok(without.diagnostics.some((d) => d.code === "missing-referenced-resource"));
  const withRes = loadSource(makeSource("t13b", ymlWith, md));
  writeFileSync(join(withRes.ir.sourceDir, "guide.md"), "# Guide\n", "utf8");
  const rebundled = loadSource(withRes.ir.sourceDir);
  assert.ok(rebundled.diagnostics.every((d) => d.code !== "missing-referenced-resource"));
  assert.notEqual(without.ir.irHash, rebundled.ir.irHash, "bundling a resource changes the IR hash");
});
