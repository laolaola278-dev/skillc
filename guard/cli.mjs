#!/usr/bin/env node
// gitguard — block personal-environment fingerprints (local paths, usernames,
// provider names, API keys) from reaching GitHub. Zero dependencies. Node >= 18.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.1.0";
const CONFIG_NAME = "gitguard.json";

// ---- default rules: personal-environment fingerprints + common key shapes ----
// level error => block (exit 1). warning => print only. Configure in gitguard.json.
const DEFAULT_RULES = [
  { id: "win-drive-path", level: "error", pattern: /(?<![A-Za-z0-9])[A-Za-z]:\\/, msg: "Windows drive-letter absolute path" },
  { id: "win-user-profile", level: "error", pattern: /[A-Za-z]:\\Users\\[^\\\s"']+/i, msg: "Windows user profile leaks local username" },
  { id: "unix-home", level: "warning", pattern: /~\/[A-Za-z][^\s"']*/, msg: "home-relative path (often intended in docs)" },
  { id: "github-token", level: "error", pattern: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}/, msg: "GitHub token" },
  { id: "sk-style-key", level: "error", pattern: /sk-[A-Za-z0-9]{20,}/, msg: "OpenAI-style API key" },
  { id: "aws-access-key", level: "error", pattern: /AKIA[0-9A-Z]{16}/, msg: "AWS access key id" },
  { id: "private-key-block", level: "error", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, msg: "private key block" },
  { id: "assign-secret", level: "warning", pattern: /(?:passwd|password|pass|pw|secret|api[_-]?key|token)\s*[:=]\s*["']?[^\s"']{12,}/i, msg: "possible secret assignment" }
];

function findRepoRoot(startDir) {
  let d = resolve(startDir || process.cwd());
  for (;;) {
    if (existsSync(join(d, ".git"))) return d;
    const parent = dirname(d);
    if (parent === d) return null;
    d = parent;
  }
}

function loadConfig(root) {
  const cfgPath = join(root, CONFIG_NAME);
  if (!existsSync(cfgPath)) return { rules: DEFAULT_RULES, cfgPath: null, ignore: [], skip: [] };
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    const disabled = new Set(cfg.disabled || []);
    const extra = (cfg.rules || []).map((r) => ({
      id: r.id, level: r.level || "error",
      pattern: new RegExp(r.pattern), msg: r.msg || r.id
    }));
    const rules = DEFAULT_RULES.filter((r) => !disabled.has(r.id)).concat(extra);
    const ignore = cfg.ignore || [];
    const skip = (cfg.skip || []).map((s) => ({ file: s.file || "", line: new RegExp(s.line) }));
    return { rules, cfgPath, ignore, skip };
  } catch (err) {
    console.error("gitguard: invalid " + CONFIG_NAME + ": " + err.message);
    process.exit(1);
  }
}

function scanText(text, rules, source, skip = []) {
  const hits = [];
  const lines = String(text).split(/\r?\n/);
  const skipFor = skip.filter((s) => source.startsWith(s.file));
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (skipFor.some((s) => s.line.test(line))) continue;
    for (const rule of rules) {
      const m = rule.pattern.exec(line);
      if (m && m[0].length > 0) {
        const start = Math.max(0, m.index - 16);
        const end = Math.min(line.length, m.index + m[0].length + 16);
        const ctx = (start > 0 ? "..." : "") + line.slice(start, end) + (end < line.length ? "..." : "");
        hits.push({ level: rule.level, id: rule.id, msg: rule.msg, source, line: i + 1, context: ctx });
      }
    }
  }
  return hits;
}

function gitFiles(root, staged) {
  const args = staged
    ? ["diff", "--cached", "--name-only", "-z"]
    : ["ls-files", "-z"];
  const res = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (res.status !== 0) return [];
  return res.stdout.split("\0").filter(Boolean);
}

function checkFiles(root, files, rules, skip = []) {
  let hits = [];
  for (const rel of files) {
    if (rel.startsWith(".git/")) continue;
    const full = join(root, rel);
    let stat = null;
    try { stat = statSync(full); } catch { continue; }
    if (!stat.isFile()) continue;
    let content = null;
    try { content = readFileSync(full, "utf8"); } catch { continue; }
    if (content != null) hits = hits.concat(scanText(content, rules, rel, skip));
  }
  return hits;
}

function printHits(hits) {
  for (const h of hits) {
    const tag = h.level === "error" ? "x" : "!";
    console.log(tag + " [" + h.level + "] " + h.source + ":" + h.line + "  " + h.id + " — " + h.msg);
    console.log("    " + h.context.trim());
  }
}

function cmdCheck(opts) {
  const root = findRepoRoot(opts.dir);
  if (!root) { console.error("gitguard: not inside a git repository"); process.exit(1); }
  const { rules, ignore, skip } = loadConfig(root);
  const files = (opts.files && opts.files.length ? opts.files : gitFiles(root, opts.staged)).filter((f) => !ignore.some((p) => f.replace(/\\/g, '/').startsWith(p.replace(/\\/g, '/'))));
  const hits = checkFiles(root, files, rules, skip);
  printHits(hits);
  const errors = hits.filter((h) => h.level === "error").length;
  const warnings = hits.filter((h) => h.level === "warning").length;
  const scope = opts.files && opts.files.length ? "selected files" : (opts.staged ? "staged files" : "tracked files");
  console.log((errors + warnings) + " hit(s) in " + scope + " — " + errors + " error(s), " + warnings + " warning(s)");
  if (errors > 0) { console.error("gitguard: blocking — fix the files or configure gitguard.json"); process.exit(1); }
}

function hookScript(cliPath, mode) {
  // mode: "staged" (pre-commit) or "all" (pre-push)
  const flag = mode === "staged" ? "--staged" : "";
  return [
    "#!/bin/sh",
    "# gitguard hook (installed by gitguard install)",
    "ROOT=\"${GITGUARD_ROOT:-$PWD}\"",
    "exec node \"" + cliPath + "\" check " + flag + " --dir \"$ROOT\"",
    ""
  ].join("\n");
}

function cmdInstall(opts) {
  const root = findRepoRoot(opts.dir);
  if (!root) { console.error("gitguard: not inside a git repository"); process.exit(1); }
  const hooksDir = join(root, ".git", "hooks");
  mkdirSync(hooksDir, { recursive: true });
  const cliPath = fileURLToPath(import.meta.url);
  const plan = [ ["pre-commit", "staged"], ["pre-push", "all"] ];
  for (const [name, mode] of plan) {
    const target = join(hooksDir, name);
    const exists = existsSync(target);
    if (exists && !opts.force) {
      console.log("gitguard: " + name + " already exists — pass --force to overwrite");
      continue;
    }
    writeFileSync(target, hookScript(cliPath, mode), { mode: 0o755 });
    console.log("gitguard: installed " + name + " hook -> " + target);
  }
}

function cmdUninstall(opts) {
  const root = findRepoRoot(opts.dir);
  if (!root) { console.error("gitguard: not inside a git repository"); process.exit(1); }
  for (const name of ["pre-commit", "pre-push"]) {
    const target = join(root, ".git", "hooks", name);
    if (!existsSync(target)) continue;
    const content = readFileSync(target, "utf8");
    if (!content.includes("gitguard")) { console.log("gitguard: " + name + " was not installed by gitguard — skipped"); continue; }
    rmSync(target);
    console.log("gitguard: removed " + name + " hook");
  }
}

function cmdConfig(opts) {
  const root = findRepoRoot(opts.dir) || process.cwd();
  const { rules, cfgPath } = loadConfig(root);
  console.log("gitguard v" + VERSION + (cfgPath ? " — config: " + cfgPath : " — default rules"));
  for (const r of rules) console.log("  [" + r.level + "] " + r.id + "  " + r.msg);
}

function usage() {
  return [
    "gitguard v" + VERSION + " — block personal-environment fingerprints from reaching GitHub",
    "",
    "Usage:",
    "  gitguard check [--staged] [--dir <repo>] [--files <path...>]   scan files; exit 1 on errors",
    "  gitguard install [--force] [--dir <repo>]                      install pre-commit + pre-push hooks",
    "  gitguard uninstall [--dir <repo>]                             remove gitguard hooks",
    "  gitguard config                                               print effective rules",
    "  gitguard -v | --version                                       version",
    "  gitguard -h | --help                                          this help",
    "",
    "Configure: add gitguard.json (rules / disabled) next to .git (see README).",
    ""
  ].join("\n");
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const opts = { dir: null, staged: false, force: false, files: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--staged") opts.staged = true;
    else if (a === "--force") opts.force = true;
    else if (a === "--dir") opts.dir = rest[++i];
    else if (a === "--files") { while (i + 1 < rest.length && !rest[i + 1].startsWith("--")) opts.files.push(rest[++i]); }
    else if (a === "-v" || a === "--version") { console.log("gitguard v" + VERSION); process.exit(0); }
    else if (a === "-h" || a === "--help" || a === "-?") { process.stdout.write(usage()); process.exit(0); }
  }
  switch (cmd) {
    case "check": cmdCheck(opts); break;
    case "install": cmdInstall(opts); break;
    case "uninstall": cmdUninstall(opts); break;
    case "config": cmdConfig(opts); break;
    default:
      process.stdout.write(usage());
      process.exit(cmd ? 1 : 0);
  }
}

main(process.argv.slice(2));
