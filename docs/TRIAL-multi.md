# skillc 多运行时集成试跑记录 — Codex / Claude Code / Hermes / OpenClaw（2026-08-31）

> 结论速览：skillc 产物（agentskills SKILL.md + 工具描述符 + 注入块）在 4 个真实运行时中**全部完成 发现→读取→遵从 链路**；4 组同模型 A/B 对照一致表明——**接入后 agent 行为立即收敛到技能权威链**（直接读技能、零随机搜盘），**无技能基线全部出现大范围/越界搜盘**（最多 1.17M input tokens、≥9 次越界搜索）。全部 8 次试跑无一执行部署（遵守"只解释"边界），且**基线臂无一能补齐缺失的 deployment.md**——skillc 资源捆绑缺口（M3.5）在 4 个运行时被同等地、诚实地暴露。

## 1. 方法（锁定协议）

- 同一提示词逐字投喂两臂：

  > This project has a deploy-qm skill installed. Read the skill instructions, then answer: if deploying QM to Fly.io, what are the first 3 steps? Explain only - do NOT execute any deployment.

- 同一技能源：`examples/deploy-qm/skill.src`（skillc 0.1.0 编译产物）。
- **每对 A/B 用同一模型同一 provider**（对内同模型，跨运行时不要求同模型）。
- 度量：tokens、工具调用次数、越界行为、答案质量。
- 臂 A = skillc 产物已安装；臂 B = 空工作区基线。
- 试跑现场：`skillc/tmp-trial/*`（gitignored）。

## 2. 环境总表

| 运行时 | 版本 | 接入方式 | 模型（两臂一致） | provider |
|---|---|---|---|---|
| Codex CLI | 0.149.0 | AGENTS.md 注入块 + `.codex/skills/` | `[opencode]deepseek-v4-flash` | vsllm |
| Claude Code | 2.1.227 | `.claude/skills/`（agentskills 目录） | `glm-5.3-flash` | b.ai |
| Hermes Agent | 0.20.6 (2026.8.27) | `skills.external_dirs` → 工作区 `.hermes/skills/` | `[opencode]deepseek-v4-flash` | vsllm |
| OpenClaw | 2026.7.2 | `--profile` 隔离 + `skills.load.extraDirs` → agentskills 技能目录 | `[opencode]deepseek-v4-flash` | vsllm |

## 3. 数据对照表

| 运行时 | 臂 | tokens | 工具调用 | 耗时 | 行为 | 答案质量 |
|---|---|---|---|---|---|---|
| Codex | A | 13,620 | 0 搜盘 | — | 注入块 → 直接读 SKILL.md | 诚实止步于缺失的 deployment.md |
| Codex | B | 17,687 | ≥9 次搜盘 | — | 越界至用户主目录 + 父目录树，靠碰运气找到原始文档 | 全对（依赖本机恰好存在文档） |
| Claude Code | A | in 477,069 / out 2,033 | 11 轮 | 74.8s | 直接读 `.claude/skills/deploy-qm/SKILL.md` + `.skillc/lock.json` 验证 | 诚实 + 指出资源缺口 + 给出两条修复路径 |
| Claude Code | B | in 1,167,521 / out 3,184 | 20 轮 | 161.8s | 读 git 对象库找到 skill.src；尝试读 `~/.claude/skills` 被沙箱拦截 | 诚实；token 为臂 A 的 **2.4 倍** |
| Hermes | A | in 22,954 / cacheR 136,064 / out 2,249 | 8 | 64s | `skill_view` 正式加载 deploy-qm，随后在技能目录内检索 | 诚实报告技能存根缺 deployment.md |
| Hermes | B | in 120,911 / cacheR 25,600 / out 2,273 | 10（12 次搜索 + 6 次读取） | 102s | **越界翻进 skillc 仓库树**（examples/、tmp-codex-run 残留）拼出技能内容 | 诚实，但过程冗长 |
| OpenClaw | A | prompt 25,677 | 12（2 失败） | 136.7s | 直读技能目录（尝试读 skill 内 deployment.md），再搜仓库确认缺失 | 诚实拒绝编造，主动提出去部署仓库找 |
| OpenClaw | B | prompt 40,927 | **43（18 失败）** | 391.6s | 翻遍仓库全部技能残留（examples/、.codex/.claude/.dsh/.hermes 安装副本、skillpack JSON） | 诚实，列出元指令 |

## 4. OpenClaw 臂 B 补充

- 基线过程成本是接入臂的 **3.6 倍调用、1.6 倍 prompt tokens、2.9 倍耗时**（43/18 失败 vs 12/2 失败）。
- 臂 B 的工具面板含 write/edit，但经输出与工作区核查**未发生任何写文件**（工作区仅 `agents add` 脚手架，时间戳早于运行）。
- 2026.7.2 CLI 怪癖：`agent --local --json` 在结果 JSON 落盘后进程可能不退出（臂 A/B 各挂一次），数据完整，手动结束即可。

## 5. 每运行时接入细节

### 5.1 Hermes（本次新增安装）

- 安装：官方脚本 v0.20.6，数据目录 `~/.hermes`（安装器 `-HermesHome` 播种）。运行时默认 home 是 `%LOCALAPPDATA%\hermes`，**用户级环境变量 `HERMES_HOME` 已指向 `~/.hermes`** 使其读 cc-switch 管理的配置（新开的终端生效）。
- 模型接入（`~/.hermes/config.yaml`，legacy `custom_providers` 格式，与 cc-switch 兼容）：保留原有 deepseek/sensenova，新增 **bai**（`https://api.b.ai/v1`，chat_completions，glm-5.3-flash/deepseek-v4-flash/qwen3.8-flash）与 **vsllm**（`[opencode]deepseek-v4-flash`、gemini-3.7-flash）。默认模型 = bai/glm-5.3-flash（用户要求 b.ai 与 vsllm 为主）。
- **C 盘写入禁令**：`approvals.deny`（fnmatch 命令文本匹配，`--yolo` 也拦）+ `approvals.smart_policy` 文本 + `SOUL.md` 硬边界段，三层防护。deny 覆盖重定向（`>*C:\*`、`>*C:/*`、`>*/c/*`）、PowerShell 写类（Set-Content/New-Item/Copy-Item/Remove-Item/Out-File 等）、cmd/bash 类（del/md/copy/move、rm/mv/cp/mkdir/touch/tee 的 /c/ 形式）。
- 冒烟：`hermes chat -q "Reply with exactly: OK" --oneshot` → 23s 正常应答。
- 试跑隔离：A/B 各用独立 `HERMES_HOME`（`tmp-trial/hermes-home-{a,b}`），环境变量覆盖实测有效。

### 5.2 Claude Code

- 技能即 agentskills 目录 `.claude/skills/deploy-qm/`，`claude -p <prompt> --output-format json` 非交互；b.ai 经 `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_MODEL` 环境变量注入（cc-switch `bai-1788166479263` 凭据）。
- 沙箱默认拦截工作区外读取（臂 B 实测 `~/.claude/skills` 读取被拦且**未绕过**）。

### 5.3 OpenClaw

- 用户主配置 `~/.openclaw/openclaw.json` **当前已损坏**：`skills.load.extraDirs` 中文路径 mojibake 且缺收尾引号，严格 JSON 解析失败（"Unterminated string"）。本试跑**未改动**用户配置，改用 `--profile trial-a/b` 隔离（`~/.openclaw-trial-{a,b}/openclaw.json`，写入 vsllm provider + agentskills 技能目录）。
- 非交互 `agents add` **必须带 agent id**（`openclaw --profile <p> agents add <id> --workspace <dir> --non-interactive`），否则报 "Agent name is required"。
- one-shot：`openclaw --profile <p> agent --local --agent <id> --message-file <path> --json --timeout 600`。

## 6. 发现与后续

1. **资源捆绑缺口 = 4 运行时共同结论**（最重磅）：skill.src 只有 SKILL.md + skill.yaml；SKILL.md 指定的 `deployment.md` 与 `references/fly.md` 从未随产物发布。4 个臂 A 全部**诚实止步**（拒绝编造），部分还定位到修复路径（claude A 直接读 `.skillc/lock.json` 确认 4 目标产物文件清单）。→ M3.5（`skill.src/resources/**` 原样拷入）从 backlog 升级为**证据充分**。
2. **基线臂的边界行为是系统性风险**：无技能时 codex 越界到用户主目录、hermes/openclaw 越界到父仓库树翻检试验残留、claude 尝试用户主目录（被沙箱拦下）。生产环境中这类搜盘既是信息泄露面也不可复现。接入 skillc 后 4 个运行时**全部收敛到技能目录内**。
3. **Hermes 非确定性记录**：臂 A 第一次运行（420s 超时截断）曾越界搜到 `qm-deploy-test` 仓库并读了真实 deployment.md；重跑（正式记录）未复现该路径。单次试跑不能替代重复实验，表中数据为完成会话。
4. **token 口径**：Claude Code/Codex 由 CLI 直接给出；Hermes 取自 `state.db` `sessions` 表（in/out/cacheR 分列）；OpenClaw 取 JSON `toolSummary` + `promptTokens`。cache 命中结构不同（Hermes 臂 A cacheR 显著更高），横向只比同运行时 A/B。
5. **后续清单**：修 openclaw.json mojibake（需用户确认）；M3.5 资源捆绑后 4 运行时重跑一轮看"全对率"；HDS/DSH 侧集成仍按用户指示暂缓。

## 7. 边界遵守

- HDS/DSH 运行时零接触（本次全程未读写 `deepseek-harness-master`）。
- 所有 agent 试跑工作区在 `skillc/tmp-trial`（G 盘）；对 C: 的写入仅限用户明确要求的配置文件（`~/.hermes/config.yaml`、`SOUL.md`、`~/.openclaw-trial-{a,b}/`、用户环境变量 `HERMES_HOME`）。
- API 密钥只写入本地配置（`~/.hermes/config.yaml` 等），未进入本仓库任何被提交文件；`tmp-cc/` 下 cc-switch 探针脚本均为只读（`readOnly: true`）。
