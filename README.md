# skillc — write once, compile to every agent harness / 一次编写，编译到所有 agent 底盘

```
skill.src/                      skillc build+sync
├── skill.yaml    (metadata)    ├── .claude/skills/<name>/SKILL.md   ← Claude Code
├── SKILL.md      (body)        ├── .codex/… + AGENTS.md  (marker)   ← Codex
└── tools/*.json  (QM-compatible) └── skills/<name>/SKILL.md          ← DSH
```

**EN.** skillc is a local-first compiler for personal agent skills. You maintain ONE
skill source; skillc compiles it into each harness's native format, degrades
capabilities honestly (web-fetch on Codex becomes 'ask the user to paste'), and writes
results safely: it never overwrites a file it did not write itself, and injects into
user-owned files only inside marked blocks. It is a compiler, not an installer —
'gh skill install' moves files; skillc translates meaning.

**中文.** skillc 是面向个人开发者的本地优先 agent 技能编译器。你只维护一份技能源；
skillc 编译出每个 harness 的原生格式，能力缺失时明确降级（如 Codex 无 web-fetch 时
改写为请用户粘贴内容），并安全写入：绝不覆盖非 skillc 写的文件，对用户自有的文件
只在标记块内注入。它是编译器，不是安装器——gh skill install 搬运文件，skillc 翻译语义。

## Status / 状态

MVP milestone 1 (this repo): source parsing, IR, compat diagnostics, Claude Code
emitter, safe sync with lockfile, doctor, build/sync CLI. M2: Codex (AGENTS.md
injection) + DSH emitters. M3: pack/unpack reverse import, upgrade, docs polish.
See docs/FORMAT.md for the source format spec.

## Quick start / 快速开始

```bash
npm install && npm run build
node dist/cli.js doctor --src examples/deploy-qm/skill.src
node dist/cli.js build  --src examples/deploy-qm/skill.src --root <your-project>
node dist/cli.js sync   --src examples/deploy-qm/skill.src --root <your-project>          # dry-run
node dist/cli.js sync   --src examples/deploy-qm/skill.src --root <your-project> --write  # apply
```

Commands / 命令:
- build — compile to .skillc/plan.json (nothing else written) / 编译为计划，不落盘
- sync  — apply plan (dry-run default; --write applies; --force overrides) / 应用（默认空跑）
- doctor — validate source + per-target compatibility / 校验源与目标兼容性

## Why not just copy files? / 为什么不是复制文件

| copy | skillc |
|---|---|
| same text everywhere, even when a harness lacks the capability | capability IR per target; degrades or fails at compile time / 按目标能力降级，编译期暴露 |
| no record of what it wrote | lockfile + marker blocks; refuses to clobber manual edits / 锁文件+标记块，拒绝覆盖手工修改 |
| cron/triggers lost silently | declared, compiled out with a visible info line / 触发器显式编译排除并提示 |

## Design boundary / 边界

No registry service, no GUI, no runtime, no org features. A pure local compiler —
the neutral layer between skill authors and harness owners. / 无注册中心、无 GUI、
无运行时、无组织功能——纯本地编译器，技能作者与 harness 之间的中立层。

License: MIT.
