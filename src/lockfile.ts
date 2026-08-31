import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface LockEntry {
  version: string;
  /** standalone: hash of the whole file. injection: hash of the inner block. */
  hash: string;
}

export interface Lockfile {
  skillc: 1;
  skill: string;
  skillVersion: string;
  generatedAt: string;
  targets: Record<string, Record<string, LockEntry>>;
}

export const LOCK_DIR = ".skillc";
export const LOCK_FILE = "lock.json";

export function readLockfile(root: string): Lockfile | null {
  const p = join(root, LOCK_DIR, LOCK_FILE);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Lockfile;
  } catch {
    return null;
  }
}

export function writeLockfile(root: string, lock: Lockfile): void {
  const p = join(root, LOCK_DIR, LOCK_FILE);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(lock, null, 2) + "\n", "utf8");
}

export function mergeLock(
  base: Lockfile | null,
  skill: string,
  skillVersion: string,
  patch: Record<string, Record<string, LockEntry>>
): Lockfile {
  const lock: Lockfile =
    base && base.skill === skill
      ? { ...base, targets: { ...(base.targets ?? {}) } }
      : { skillc: 1, skill, skillVersion, generatedAt: "", targets: {} };
  lock.skillc = 1;
  lock.skill = skill;
  lock.skillVersion = skillVersion;
  lock.generatedAt = new Date().toISOString();
  for (const [target, files] of Object.entries(patch)) {
    lock.targets[target] = { ...(lock.targets[target] ?? {}), ...files };
  }
  return lock;
}
