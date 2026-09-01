import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../cli.mjs", import.meta.url));

function makeRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), "gitguard-test-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    if (name.includes("/")) mkdirSync(join(dir, name.split("/")[0]), { recursive: true });
    writeFileSync(full, content);
  }
  spawnSync("git", ["add", "-A"], { cwd: dir });
  return dir;
}

function runCheck(dir, extra = []) {
  const r = spawnSync(process.execPath, [CLI, "check", "--staged", "--dir", dir, ...extra], { encoding: "utf8" });
  return r;
}

test("blocks windows absolute path in staged file", () => {
  const dir = makeRepo({ "a.txt": "deploy to C:\\Users\\someone\\app\n" });
  try {
    const r = runCheck(dir);
    assert.notEqual(r.status, 0, "expected block");
    assert.match(r.stdout, /win-drive-path/);
    assert.match(r.stdout, /win-user-profile/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("blocks API key shapes", () => {
  const dir = makeRepo({ "k.txt": "key = sk-abcdef1234567890abcdef1234567890\n" });
  try {
    const r = runCheck(dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /sk-style-key/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("passes clean files", () => {
  const dir = makeRepo({ "ok.md": "# hello\n\npath: <repo-root>/config\n" });
  try {
    const r = runCheck(dir);
    assert.equal(r.status, 0, "clean file should pass: " + r.stdout);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("respects gitguard.json ignore for test fixtures", () => {
  const dir = makeRepo({
    "gitguard.json": JSON.stringify({ ignore: ["fixtures/"] }, null, 2),
    "fixtures/sample.ts": "const s = \"cron:\\n  - 0 9\";\n",
  });
  try {
    const r = runCheck(dir);
    assert.equal(r.status, 0, "ignored fixture should pass: " + r.stdout);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("skip rule suppresses matching lines", () => {
  const dir = makeRepo({
    "gitguard.json": JSON.stringify({ skip: [{ file: "docs/", line: ">\\*C:" }] }, null, 2),
    "docs/notes.md": "deny pattern: >*C:\\*\n",
  });
  try {
    const r = runCheck(dir);
    assert.equal(r.status, 0, "skipped line should pass: " + r.stdout);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("custom rules from gitguard.json are enforced", () => {
  const dir = makeRepo({
    "gitguard.json": JSON.stringify({ rules: [{ id: "my-provider", level: "error", pattern: "myprovider\\.ai", msg: "private provider" }] }, null, 2),
    "c.txt": "endpoint: https://myprovider.ai/v1\n",
  });
  try {
    const r = runCheck(dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /my-provider/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
