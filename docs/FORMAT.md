# skillc source format (v0 draft) / skillc 源格式规范（v0 草案）

## Directory layout / 目录结构

```
skill.src/
├── skill.yaml            # required — metadata, capabilities, tools, targets
├── SKILL.md              # optional but recommended — instruction body (may carry frontmatter)
└── tools/<id>/tool.json  # optional — QM-compatible descriptors; override inline yaml tools
```

## skill.yaml

```yaml
name: deploy-qm            # required, kebab-case
version: 1.2.0             # required, semver
description: >-            # at most 1024 chars — this is what harnesses route on
  One-line description.
needs: [read-files, write-files, shell, web-fetch]   # hard capability requirements
optional: [subagents]                                # nice-to-have, informational
tools:                     # inline tools (merged with tools/ dir; dir wins on id conflict)
  - id: example-tool
    advertise: example-tool
    install: { binary: example-tool }
    mcp: { command: npx, args: ['-y', 'some-server'] }   # optional alternative
triggers:                  # optional personal-duty triggers (compiled out where unsupported)
  - cron: '0 9 * * 1'
    prompt: Check overnight CI failures and summarize blockers.
targets:                   # which targets to compile; unknown keys warn
  claude-code: {}
  codex: {}
  dsh: {}
```

### Capabilities / 能力词表

read-files / write-files / shell / web-fetch / subagents / memory / cron / mcp

Target support table lives in src/compat.ts. A needs entry missing on a target
produces a compile-time diagnostic: warning plus textual degradation (never silent).

## Markers / 标记块 (injections)

```html
<!-- skillc:begin name=SKILL version=X.Y.Z hash=INNERHASH -->
…generated content…
<!-- skillc:end -->
```

- hash = sha256-16 of the inner content; sync treats a hash match as unchanged.
- Same marker name present: block replace. No marker: append. Foreign markers coexist.
- Standalone emitted files are NOT marker-wrapped; their lockfile hash protects them.

## Lockfile / 锁文件 (.skillc/lock.json)

Per target, per path: { version, hash }. A standalone file whose disk hash differs
from BOTH the new content and the lockfile entry is blocked from sync unless --force.
One skill owns one project root (the lockfile records the skill name).

## IR hash

irHash = sha256-16 of the canonical JSON of all semantic fields — stable across runs;
later used for incremental builds and upgrade diffs.
