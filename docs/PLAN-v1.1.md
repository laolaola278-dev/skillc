# skillc v1.1 计划：用真实 codex 项目落地（2026-08-31）

> 背景：4 运行时 A/B 试跑（TRIAL-multi.md）证明接入价值（确定性/速度/稳健），同时暴露 3 个实际问题：M3.5 资源捆绑缺口（最重）、技能组合缺失、MCP 配置无共享机制。本计划以用户真实 codex 开发项目为试验场，先修问题再接入开发，最后用真实数据补对照。

## 当前状态（2026-08-31 核对）

- skill 已装载位置：**仅试跑工作区**（项目级安装）；用户 codex 全局 `~/.codex/skills/` 无 deploy-qm，`~/.codex/AGENTS.md` 无注入块。
- skillc CLI：`dist/cli.js` 就绪，bin=skillc，未全局链接（npm publish 未做）。
- 测试基线：12/12。

## Phase 0 · CLI 全局化（5 分钟）

- `pnpm link --global`（或文档化 `node <repo-root>/dist/cli.js` 调用方式）。
- 验收：任意目录 `skillc --help` 可用。

## Phase 1 · M3.5 资源捆绑（半天）

解决：SKILL.md 引用的 workflow/references 文档不随产物发布（4 运行时共同撞上的缺口）。

- 设计：`skill.yaml` 增加 `resources:` 显式声明列表；未声明时自动捆绑 skill.src 下全部非 SKILL.md/skill.yaml 文件（两者取一，倾向显式+自动兜底）。
- 编译：资源按相对路径拷入每目标技能目录；pack/unpack 保留资源；sync 对资源做 hash 增量更新；lockfile 记录资源清单。
- 测试：新增资源捆绑用例，保持 12/12 → N/N 全绿。
- 验证：重新发布 deploy-qm 产物，codex + claude 两运行时复跑同一 prompt，确认不再出现 "deployment.md 缺失" 止步，记录"全对率"。

## Phase 2 · 用户 codex 项目接入（1 天，待项目信息）

待用户提供：项目名、技术栈、开发目标。

- 项目根建 `skill.src/`：SKILL.md（技术栈约定、目录结构、常用命令、验收标准、禁止事项）、skill.yaml（name/version/targets: codex；按需 tools 声明含 MCP 描述符）。
- `skillc sync` → `.codex/skills/<name>/` + AGENTS.md 注入块。
- 验收：codex 会话内提问项目约定，agent 直接引用 SKILL.md 作答（发现→读取→遵从链路）。
- 边界：不写 C 盘；skillc 仓库本身不动生产项目代码。

## Phase 3 · 真实项目 A/B 对照（半天，可选）

- 同一开发任务开/关技能各一次，记录 tokens/轮数/耗时/边界违规/结果质量。
- 产出：TRIAL-real-codex.md，把证据从示例技能升级为真实项目数据。

## Phase 4 · backlog（不阻塞开发）

- skill references（`uses: [other-skill@semver]`）技能组合
- 共享 MCP 注册表（多技能引用同一 MCP 定义）
- npm publish + DESIGN.md（已交付契约/显式非目标/路线图）
