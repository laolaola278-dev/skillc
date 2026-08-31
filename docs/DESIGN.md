# skillc 设计边界（活文档）

> 一个 `skill.src` 编译到所有 agent 运行时。Write once, compile anywhere.
> 本文档声明：已交付契约 / 显式非目标 / 证据 / 路线图。范围判断以本文为准，不再依赖对话记忆。

## 1. 已交付契约（M0–M4 + M3.5，2026-08-31）

- **源格式**：`skill.src/` = `skill.yaml`（name/version/description/needs/optional/tools/triggers/targets/resources）+ `SKILL.md`（frontmatter + 正文）+ `tools/<id>/tool.json`（QM 兼容 {id, advertise, install?, mcp?}）+ 资源文件（deployment.md、references/ 等任意相对路径文件）。
- **资源捆绑**（M3.5）：显式 `resources:` 列表优先；缺省自动捆绑全部非源文件；空数组显式退出。资源逐目标原样落盘，sync/lockfile/pack 全链路 hash；SKILL.md 引用未捆绑文档 → 编译期 `missing-referenced-resource` 告警。
- **IR 与哈希**：全部源（含资源内容）进 canonical JSON → sha256（16 hex）→ 注入块 hash 与 lockfile，产物改动可审计。
- **发射器**（4 实现 + 3 计划）：claude-code（.claude/skills）、codex（.codex/skills + AGENTS.md 注入）、dsh（.dsh/skills）、hermes（.hermes/skills，agentskills 标准）；cursor/opencode/pi 声明即可探测、未实现即诊断。
- **能力模型**：`needs` vs TARGET_CAPS → 缺能力降级（web-fetch 在 codex → 附加"请用户粘贴"文本）或告警，不静默坏引用。
- **安全 sync**：standalone（自有权）/ injection（marker 块）两类；create/replace/inject-replace/inject-append/unchanged/blocked 六态；lockfile 外改 → blocked（--force 覆盖）；用户手写内容永不动。
- **生命周期**：build（纯计划）/ sync（dry-run→--write）/ upgrade（版本差报告）/ pack·unpack（单文件 .skillpack 往返）/ doctor（体检，零写入）。
- **CLI**：`npm link` 全局可用；`node dist/cli.js` 等价。

## 2. 显式非目标（v1 放弃，理由在此）

- **skill→skill 组合/依赖**：v1 是"单技能工具链"视角。技能组合（`uses: [other@semver]`）需要 lockfile 依赖闭包与循环检测，价值待真实多技能项目验证后再立项。
- **共享 MCP 注册表**：多技能引用同一 MCP 定义的去重。当前技能数少，每技能自带 mcp 描述符不构成实际漂移；等组合机制落地后再做。
- **运行时侧强制**：skillc 只负责"编译+安全落盘"，不监管运行时行为。边界/权限由各运行时自身机制承担（如 Hermes approvals.deny）。
- **资源通配符**：显式列表 + 自动兜底已覆盖需求，glob 引入删除语义歧义（sync 是否删除 glob 不再匹配的文件？），暂不做。
- **npm publish**：仓库本地 + npm link 已满足内部使用；公开发布待 API/格式稳定。

## 3. 证据

- `TRIAL-codex.md`：codex 0.149.0 发现→注入→遵从全链路；基线 ≥9 次越界搜盘 vs 接入零搜盘；M3.5 复验全对率达成（§6）。
- `TRIAL-multi.md`：4 运行时（codex/claude-code/hermes/openclaw）A/B 同模型对照——接入臂全部确定性收敛技能目录，基线全部大范围搜盘/越界；M3.5 资源缺口由 4 运行时共同证实后由本仓库 M3.5 闭合。

## 4. 路线图（证据驱动排序）

1. **真实项目接入**（进行中）：用户 codex 开发项目 skill.src 定义 → sync → 开发（PLAN-v1.1 Phase 2/3）。
2. **skill references**：`uses: [other-skill@semver]`，sync 校验依赖已装 + lockfile 记录闭包。
3. **共享 MCP 注册表**：`mcpServers:` 顶层声明，技能按 id 引用。
4. **cursor / opencode / pi 发射器**。
5. **npm publish**。
