# skillc 集成试跑记录 — Codex 先行（2026-08-31）

> 结论速览：skillc 的 codex 产物（AGENTS.md 注入块 + `.codex/skills/<name>/SKILL.md`）在真实 codex-cli 0.149.0 中**发现→注入→遵从全链路生效**；同模型对照显示无技能基线需要 **≥9 次越界搜盘**才靠运气找到原始文档，而接入后**零搜盘、token 更省**。HDS（DSH 运行时）集成已调研清楚，按用户要求**暂缓执行**（详见 §5）。

## 1. 背景与边界

- 目标：把 skillc 编译产物接入真实 agent 运行时并做接入前后同模型对比。
- 用户指令：暂不动 HDS（不重启、不写入）；先在 Codex 上试；全程记录；清除 DSH 侧改动。
- 边界遵守：harness 检出（deepseek-harness-master）经 `git status --porcelain` 验证**零改动**（本会话只读取过源码）；`tmp-e2e/.dsh/` 与 lockfile 中 dsh 条目已删除；所有试跑都在 `skillc/tmp-*` 工作区（gitignored）。

## 2. 环境

| 项 | 值 |
|---|---|
| codex-cli | 0.149.0（`D:\npm\global\codex.ps1`） |
| 模型 | `[opencode]deepseek-v4-flash`（用户自定义 provider，两臂完全一致 → 满足同模型对比） |
| 沙箱 | `--sandbox read-only`，`--skip-git-repo-check`，非交互 `codex exec` |
| 技能源 | `examples/deploy-qm/skill.src`（skillc 编译，版本 0.1.0） |

## 3. 臂 A — 接入 skillc 产物（`tmp-codex-run`）

部署方式 = skillc 真实产物：`node dist/cli.js sync --src examples/deploy-qm/skill.src --root tmp-codex-run --target codex --write`，得到：

- `AGENTS.md`：用户手写规则原样保留 + `<!-- skillc:begin name=deploy-qm version=0.1.0 hash=c2f19772a1fe5a32 -->` 注入块
- `.codex/skills/deploy-qm/SKILL.md`（frontmatter + 正文 + Capability notes）
- `.codex/skills/deploy-qm/tools/example-tool/tool.json`（QM 兼容工具描述符）

提问（与臂 B 逐字相同）：

> This project has a deploy-qm skill installed. Read the skill instructions, then answer: if deploying QM to Fly.io, what are the first 3 steps? Explain only - do NOT execute any deployment.

**结果**：模型直接沿 AGENTS.md 注入块 → 读取 `.codex/skills/deploy-qm/SKILL.md`，回答中逐字引用编译产物指令：`npm exec qm -- <command>`、base-model key 与登录方式同轮收集、`deployment.md` 为权威流程。因 fixture 未附带 `deployment.md`（skillc 尚不支持资源捆绑），模型**诚实止步**并声明 "No deployment was executed"（同时遵守试跑区规则 2）。无任何搜盘行为。tokens used：**13,620**。

## 4. 臂 B — 无技能基线（`tmp-codex-baseline`）

同目录结构但只有手写 AGENTS.md（无 skillc 块、无 `.codex/`），同 prompt。

**结果**：模型宣称"技能已安装"却找不到，随即开始全盘搜索（≥9 次 exec）：

1. 工作区递归找 `SKILL.md` → 只有 AGENTS.md
2. 越界到 `C:\Users\JianXi\.codex\skills`（用户主目录）
3. 越界到 `G:\project\deepseek-harness\work_hds\skillc` 递归（**父目录树**，超出其项目根）
4. 最终靠搜到 `qm-deploy-test` 里的**原始 QM 文档**（deployment.md + references/fly.md）才答对（内容正确、含 §1/§2/§3 与精确命令）

tokens used：**17,687**。

### 对比

| 维度 | 臂 A（接入 skillc） | 臂 B（无技能） |
|---|---|---|
| 技能发现 | 确定性指针（AGENTS.md 注入块） | ≥9 次搜盘碰运气 |
| 项目边界 | 未越界 | 越界至用户主目录 + 父目录树（生产环境=信息泄露面） |
| tokens | 13,620 | 17,687（+30%） |
| 答案质量 | 流程正确但止于缺失的 deployment.md（诚实） | 全对，但依赖本机恰好存在原始文档 |
| 可靠性 | 可复现（产物即事实） | 不可复现（换台机器即失败/幻觉） |

## 5. HDS（DSH 运行时）集成调研 — 已完成，执行暂缓

只读调研 `packages/skill/skill-filesystem`（`src/index.ts`，1041 行），结论：

- **项目根约定**：`<projectRoot>/.dsh/skills/<name>/SKILL.md`（rank 100，最高优先）与 `.agents/skills`（rank 200）；用户根 `~/.dsh/skills`（400）、`~/.agents/skills`（500）；bundled（600）。projectRoot = 自 cwd 向上找 `.git`。
- **frontmatter 契约**：`name`（kebab，必填）+ `description`（必填）；可选 `whenToUse`、`disable-model-invocation`、`user-invocable`、`metadata`。skillc 的 dsh 发射器输出**天然兼容**（name/description 已符合）。
- **热更新**：chokidar watcher 默认开启（`watch: true`），新技能文件入册**无需重启**；host 写入还有 `fs/observed` 失效钩子。
- **resourceBase**：技能目录本身，正文相对路径可解析。

待用户批准后的执行清单（一次 sync 即可）：`node dist/cli.js sync --src examples/deploy-qm/skill.src --root <HDS项目根> --target dsh --write`，随后用 `skill` 工具验证 `deploy-qm` 可加载。**无需重启 HDS**。
## 6. M3.5 复验（2026-08-31，资源捆绑上线后）

skillc M3.5（commit `5526a1f`）实现资源捆绑：`skill.yaml` 显式 `resources:` 列表（空数组显式退出），缺省自动捆绑 skill.src 内全部非源文件；产物逐目标目录原样落盘，sync/lockfile/pack 全链路带 hash；SKILL.md 引用了未捆绑的 .md 时编译期告警（`missing-referenced-resource`）。测试 12→**16 全绿**。

重跑臂 A 工作区（`tmp-codex-run`，同模型 vsllm [opencode]deepseek-v4-flash、同 prompt）：

- sync 实况（升级路径 dogfood）：AGENTS.md 注入块 `~` inject-replace（0.1.0→0.2.0），SKILL.md `=` 幂等不变，3 个资源 `+` 新建。
- 模型沿 **SKILL.md → deployment.md（§1 凭据同轮收集）→ references/fly.md**，给出真实三步：① `fly launch --name <app> --no-deploy`（拒绝所有 add-on，fly.toml 权威）② `fly secrets set QM_BASE_MODEL_KEY/QM_SIGNIN_METHOD` ③ `fly deploy`；收尾再次声明 "No deployment was executed"。
- **全对率达成**：不再因 deployment.md 缺失而止步；且完全依赖本仓库产物，与基线 B"靠运气读到原始文档"有本质区别（可复现）。
- tokens used：**20,932**（A1 13,620 / B 17,687）。代价透明 = 链上多读 3 个资源文件；收益 = 答案从"流程正确但不完整"升级为**全对** + 行为确定性。
- CLI 全局化完成：`npm link` → `D:\npm\global`（PATH 已含），任意目录 `skillc --version` 通过（pnpm link 的全局 bin 不在 PATH，弃用）。


## 6. 发现与后续

1. **资源捆绑缺口**（本次最有价值的发现）：QM 技能依赖 `deployment.md` + `references/*.md`，skillc 目前只编译 SKILL.md + tools/。臂 A 诚实止步恰好证明模型遵从了技能权威链——但也说明产物不完整。→ 计划 M3.5：`skill.src/resources/**` 原样拷入各目标技能目录（standalone 文件，享受 lockfile 保护）。
2. codex 对注入块的消费是**被动**的（AGENTS.md 全文进上下文），与设计一致；`.skillc/` 目录对运行时不可见、零干扰。
3. `codex exec` 经 .ps1 shim 偶发瞬时 exit 1（provider 抖动），重定向到文件跑即可，属环境噪声非产物问题。

试跑现场保留：`tmp-codex-run/`（接入臂）、`tmp-codex-baseline/`（基线臂）、`tmp-baseline-out.txt`（基线原始输出）。

