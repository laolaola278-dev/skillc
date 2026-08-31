#!/usr/bin/env node
import { Command } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadSource } from "./parse.js";
import { IMPLEMENTED_TARGETS, emitForTarget } from "./emit/index.js";
import { applyPlan, planSync } from "./sync.js";
import { mergeLock, readLockfile, writeLockfile } from "./lockfile.js";
import { packSource, unpackInto, writePack } from "./pack.js";
import { version } from "./version.js";
import { sha256Text } from "./util.js";
import type { Diagnostic, SkillIR, TargetId } from "./types.js";

const LEVEL_MARK: Record<Diagnostic["level"], string> = { error: "x", warning: "!", info: "·" };
const ACTION_MARK: Record<string, string> = {
  create: "+",
  replace: "~",
  "inject-replace": "~",
  "inject-append": "+",
  unchanged: "=",
  blocked: "!"
};

function printDiags(diags: Diagnostic[]): void {
  for (const d of diags) {
    const where = d.target ? "[" + d.target + "] " : "";
    const line = LEVEL_MARK[d.level] + " " + where + d.message;
    if (d.level === "error") console.error(line);
    else console.log(line);
  }
}

function chooseTargets(ir: SkillIR, only?: string): { chosen: TargetId[]; missing: TargetId[] } {
  const declared = Object.keys(ir.targets) as TargetId[];
  const base = only ? [only as TargetId] : declared.length > 0 ? declared : [...IMPLEMENTED_TARGETS];
  const chosen = base.filter((t) => (IMPLEMENTED_TARGETS as readonly string[]).includes(t));
  const missing = base.filter((t) => !(IMPLEMENTED_TARGETS as readonly string[]).includes(t));
  return { chosen, missing };
}

function load(srcDir: string): { ir: SkillIR; diagnostics: Diagnostic[] } | null {
  try {
    return loadSource(resolve(process.cwd(), srcDir));
  } catch (err) {
    console.error("x " + (err as Error).message);
    process.exitCode = 1;
    return null;
  }
}

interface SyncOpts { src: string; root: string; target?: string; write?: boolean; force?: boolean; }

function runSync(opts: SyncOpts): void {
  const loaded = load(opts.src);
  if (!loaded) return;
  const { ir, diagnostics } = loaded;
  printDiags(diagnostics);
  const root = resolve(process.cwd(), opts.root);
  const lock = readLockfile(root);
  if (lock && lock.skill !== ir.name) {
    console.error("x .skillc/lock.json belongs to skill \"" + lock.skill + "\", not \"" + ir.name + "\" — remove it or use a different root");
    process.exitCode = 1;
    return;
  }
  const { chosen, missing } = chooseTargets(ir, opts.target);
  for (const m of missing) console.log('! target "' + m + '" is declared but not implemented yet — skipped');
  const byTarget = new Map<TargetId, ReturnType<typeof planSync>>();
  for (const t of chosen) {
    const { files, diagnostics: d } = emitForTarget(t, ir);
    printDiags(d);
    const plan = planSync(t, files, root, lock, { force: opts.force });
    for (const a of plan.actions) {
      console.log(ACTION_MARK[a.kind] + " [" + t + "] " + a.file.path + (a.reason ? " — " + a.reason : ""));
    }
    byTarget.set(t, plan);
  }
  const totalBlocked = [...byTarget.values()].reduce((n, p) => n + p.actions.filter((a) => a.kind === "blocked").length, 0);
  if (!opts.write) {
    console.log("dry-run: " + [...byTarget.values()].reduce((n, p) => n + p.actions.length, 0) + " action(s), " + totalBlocked + " blocked — pass --write to apply");
    if (totalBlocked > 0) process.exitCode = 2;
    return;
  }
  if (totalBlocked > 0 && !opts.force) {
    console.error("x refusing to sync: " + totalBlocked + " file(s) changed outside skillc — resolve them or pass --force");
    process.exitCode = 1;
    return;
  }
  const patch: Record<string, Record<string, { version: string; hash: string }>> = {};
  for (const [t, plan] of byTarget) {
    const res = applyPlan(t, plan.actions, root, ir.version);
    printDiags(res.diagnostics);
    patch[t] = res.entries;
    console.log("  wrote " + res.written.length + " file(s) for " + t);
  }
  writeLockfile(root, mergeLock(lock, ir.name, ir.version, patch));
  console.log("ok sync complete; lockfile -> .skillc/lock.json");
}

const program = new Command();
program
  .name("skillc")
  .description(
    "Compile one agent skill source to every harness: Claude Code, Codex, DSH. Write once, compile anywhere."
  )
  .version(version());

program
  .command("build")
  .description("compile skill.src into a plan at .skillc/plan.json (nothing else is written)")
  .option("--src <dir>", "skill source directory", "skill.src")
  .option("--target <id>", "compile only this target")
  .option("--root <dir>", "project root the target paths resolve against", ".")
  .action((opts: { src: string; target?: string; root: string }) => {
    const loaded = load(opts.src);
    if (!loaded) return;
    const { ir, diagnostics } = loaded;
    console.log("skillc build — " + ir.name + "@" + ir.version + " (ir " + ir.irHash + ")");
    printDiags(diagnostics);
    const root = resolve(process.cwd(), opts.root);
    const { chosen, missing } = chooseTargets(ir, opts.target);
    const plan = {
      skillc: 1 as const,
      skill: ir.name,
      version: ir.version,
      irHash: ir.irHash,
      generatedAt: new Date().toISOString(),
      targets: {} as Record<string, { files: { path: string; hash: string; kind: string }[] }>
    };
    let total = 0;
    for (const t of chosen) {
      const { files, diagnostics: d } = emitForTarget(t, ir);
      printDiags(d);
      plan.targets[t] = { files: files.map((f) => ({ path: f.path, hash: sha256Text(f.content), kind: f.kind })) };
      for (const f of files) {
        console.log("  · [" + t + "] " + f.path + " (" + f.kind + ")");
        total += 1;
      }
    }
    for (const m of missing) {
      console.log('! target "' + m + '" is declared but not implemented yet (planned: cursor, opencode, pi…)');
    }
    mkdirSync(join(root, ".skillc"), { recursive: true });
    writeFileSync(join(root, ".skillc", "plan.json"), JSON.stringify(plan, null, 2) + "\n", "utf8");
    console.log("ok " + total + " file(s) across " + Object.keys(plan.targets).length + " target(s) -> .skillc/plan.json");
  });

program
  .command("sync")
  .description("apply compiled output to each target's real location (dry-run unless --write)")
  .option("--src <dir>", "skill source directory", "skill.src")
  .option("--target <id>", "sync only this target")
  .option("--root <dir>", "project root the target paths resolve against", ".")
  .option("--write", "apply changes", false)
  .option("--force", "overwrite files that changed outside skillc", false)
  .action((opts: SyncOpts) => {
    runSync(opts);
  });

program
  .command("upgrade")
  .description("sync with a version-delta report (applies unless blocked; --force overrides)")
  .option("--src <dir>", "skill source directory", "skill.src")
  .option("--target <id>", "upgrade only this target")
  .option("--root <dir>", "project root", ".")
  .option("--force", "overwrite files that changed outside skillc", false)
  .action((opts: { src: string; root: string; target?: string; force?: boolean }) => {
    const loaded = load(opts.src);
    if (!loaded) return;
    const { ir } = loaded;
    const root = resolve(process.cwd(), opts.root);
    const lock = readLockfile(root);
    if (lock && lock.skill === ir.name) {
      if (lock.skillVersion === ir.version) console.log("already at " + ir.version + " — syncing anyway");
      else console.log("upgrading installed " + lock.skillVersion + " -> " + ir.version);
    } else {
      console.log("no prior install found — performing first sync of " + ir.name + "@" + ir.version);
    }
    runSync({ ...opts, write: true });
  });

program
  .command("pack")
  .description("bundle a skill.src into a single portable .skillpack file")
  .option("--src <dir>", "skill source directory", "skill.src")
  .requiredOption("-o, --out <file>", "output .skillpack path")
  .action((opts: { src: string; out: string }) => {
    try {
      const p = packSource(resolve(process.cwd(), opts.src));
      writePack(p, resolve(process.cwd(), opts.out));
      console.log("ok " + p.name + "@" + p.version + " (" + Object.keys(p.files).length + " files) -> " + opts.out);
    } catch (err) {
      console.error("x " + (err as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command("unpack")
  .description("reverse-import a .skillpack file or an existing skill directory into skill.src")
  .argument("<input>", ".skillpack file or skill directory containing SKILL.md")
  .option("-o, --out <dir>", "output directory (creates <dir>/skill.src)", ".")
  .action((input: string, opts: { out: string }) => {
    try {
      const res = unpackInto(resolve(process.cwd(), input), resolve(process.cwd(), opts.out));
      console.log("ok skill.src -> " + res.outDir);
      for (const warn of res.warnings) console.log("! " + warn);
      console.log("next: skillc doctor --src " + res.outDir);
    } catch (err) {
      console.error("x " + (err as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command("doctor")
  .description("validate the source and per-target compatibility; writes nothing")
  .option("--src <dir>", "skill source directory", "skill.src")
  .action((opts: { src: string }) => {
    const loaded = load(opts.src);
    if (!loaded) return;
    const { ir, diagnostics } = loaded;
    printDiags(diagnostics);
    let errors = diagnostics.filter((d) => d.level === "error").length;
    let warnings = diagnostics.filter((d) => d.level === "warning").length;
    const declared = Object.keys(ir.targets) as TargetId[];
    if (declared.length === 0) {
      console.log("! no targets declared in skill.yaml — build falls back to implemented defaults");
      warnings += 1;
    }
    if (!ir.body) {
      console.log("! SKILL.md body is empty");
      warnings += 1;
    }
    for (const t of declared) {
      if (!(IMPLEMENTED_TARGETS as readonly string[]).includes(t)) {
        console.log("· [" + t + "] planned — not implemented yet");
        continue;
      }
      const { diagnostics: d } = emitForTarget(t, ir);
      printDiags(d);
      errors += d.filter((x) => x.level === "error").length;
      warnings += d.filter((x) => x.level === "warning").length;
    }
    console.log("doctor: " + errors + " error(s), " + warnings + " warning(s)");
    if (errors > 0) process.exitCode = 1;
  });

program.parse(process.argv);
