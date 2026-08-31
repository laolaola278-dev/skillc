import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Diagnostic, EmitFile, TargetId } from "./types.js";
import { sha256Text } from "./util.js";
import type { LockEntry, Lockfile } from "./lockfile.js";

const BEGIN_RE = /^<!-- skillc:begin name=([^\s]+) version=([^\s]+) hash=([^\s]+) -->\n/;
const END_TAG = "<!-- skillc:end -->";

export function markerBegin(name: string, version: string, hash: string): string {
  return `<!-- skillc:begin name=${name} version=${version} hash=${hash} -->`;
}

/** Build the full marked block for an injection into a user-owned file. */
export function injectionBlock(markerName: string, version: string, inner: string): string {
  return `${markerBegin(markerName, version, sha256Text(inner))}\n${inner}${END_TAG}\n`;
}

function extractInner(block: string): string {
  const m = BEGIN_RE.exec(block);
  const rest = m ? block.slice(m[0].length) : block;
  return rest.replace(/<!-- skillc:end -->\s*$/, "");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findBlock(text: string, markerName: string): { full: string; hash: string } | null {
  const esc = escapeRe(markerName);
  const re = new RegExp(
    `<!-- skillc:begin name=${esc} version=[^\\s]+ hash=[^\\s]+ -->\\n[\\s\\S]*?<!-- skillc:end -->`
  );
  const m = re.exec(text);
  if (!m) return null;
  const hashRe = new RegExp(`<!-- skillc:begin name=${esc} version=[^\\s]+ hash=([^\\s]+) -->`);
  const hm = hashRe.exec(m[0]);
  return { full: m[0], hash: hm ? hm[1] : "" };
}

export type SyncActionKind =
  | "create"
  | "replace"
  | "inject-replace"
  | "inject-append"
  | "unchanged"
  | "blocked";

export interface SyncAction {
  target: string;
  file: EmitFile;
  kind: SyncActionKind;
  reason?: string;
  /** For inject-replace: the exact old block text to swap out. */
  matched?: string;
}

export interface SyncPlan {
  actions: SyncAction[];
  diagnostics: Diagnostic[];
}

/**
 * Decide, per emitted file, what may be written. skillc never overwrites a
 * file it did not write itself unless --force is passed.
 */
export function planSync(
  target: string,
  files: EmitFile[],
  root: string,
  lock: Lockfile | null,
  opts: { force?: boolean } = {}
): SyncPlan {
  const actions: SyncAction[] = [];
  const diagnostics: Diagnostic[] = [];
  const targetLock = lock?.targets?.[target] ?? {};

  for (const file of files) {
    const abs = join(root, file.path);

    if (file.kind === "standalone") {
      if (!existsSync(abs)) {
        actions.push({ target, file, kind: "create" });
        continue;
      }
      const current = sha256Text(readFileSync(abs, "utf8"));
      if (current === sha256Text(file.content)) {
        actions.push({ target, file, kind: "unchanged" });
        continue;
      }
      const last = targetLock[file.path]?.hash;
      if (last && current === last) {
        actions.push({ target, file, kind: "replace" });
        continue;
      }
      if (opts.force) {
        actions.push({ target, file, kind: "replace", reason: "--force over a file changed outside skillc" });
        continue;
      }
      actions.push({
        target,
        file,
        kind: "blocked",
        reason: "changed outside skillc since the last sync; pass --force to overwrite"
      });
      continue;
    }

    // injection — the emitted content is one full marker block
    const name = file.markerName ?? "skill";
    if (!existsSync(abs)) {
      actions.push({ target, file, kind: "inject-append", reason: "file does not exist yet" });
      continue;
    }
    const text = readFileSync(abs, "utf8");
    const existing = findBlock(text, name);
    if (!existing) {
      const other = /<!-- skillc:begin name=[^\s]+ /.test(text);
      actions.push({
        target,
        file,
        kind: "inject-append",
        reason: other ? "appending next to another skill's block" : "no skillc block yet"
      });
      continue;
    }
    const newInnerHash = sha256Text(extractInner(file.content));
    if (existing.hash === newInnerHash) {
      actions.push({ target, file, kind: "unchanged" });
      continue;
    }
    actions.push({ target, file, kind: "inject-replace", matched: existing.full });
  }

  return { actions, diagnostics };
}

export function applyPlan(
  target: string,
  actions: SyncAction[],
  root: string,
  skillVersion: string
): { written: string[]; entries: Record<string, LockEntry>; diagnostics: Diagnostic[] } {
  const written: string[] = [];
  const entries: Record<string, LockEntry> = {};
  const diagnostics: Diagnostic[] = [];

  for (const a of actions) {
    if (a.kind === "unchanged") continue;
    if (a.kind === "blocked") {
      diagnostics.push({
        level: "warning",
        target: target as TargetId,
        code: "sync-blocked",
        message: `${a.file.path}: ${a.reason ?? "blocked"}`
      });
      continue;
    }
    const abs = join(root, a.file.path);
    mkdirSync(dirname(abs), { recursive: true });

    if (a.file.kind === "standalone") {
      writeFileSync(abs, a.file.content, "utf8");
      entries[a.file.path] = { version: skillVersion, hash: sha256Text(a.file.content) };
    } else {
      if (a.kind === "inject-replace" && a.matched) {
        const text = readFileSync(abs, "utf8");
        writeFileSync(abs, text.replace(a.matched, a.file.content.trimEnd()), "utf8");
      } else if (existsSync(abs)) {
        const text = readFileSync(abs, "utf8");
        const sep = text === "" ? "" : text.endsWith("\n") ? "\n" : "\n\n";
        writeFileSync(abs, text + sep + a.file.content.trimEnd() + "\n", "utf8");
      } else {
        writeFileSync(abs, a.file.content.trimEnd() + "\n", "utf8");
      }
      entries[a.file.path] = { version: skillVersion, hash: sha256Text(extractInner(a.file.content)) };
    }
    written.push(a.file.path);
  }

  return { written, entries, diagnostics };
}
