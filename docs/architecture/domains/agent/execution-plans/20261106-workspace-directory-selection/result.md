# 结果 — Agent 工作目录选择（本地目录 / Worktree）

日期：2026-11-06。分支：`feat/agent-task-workbench-20261102`。

提交：

- `e57fe6a0d` feat(desktop): per-session agent workspace directory activation
- `f441c4d80` test(tooling): tw-workspace-directory closure C1-C6
- `0fca2191a` feat(desktop): composer working-directory selector

## 1. 交付内容

| 切片 | 状态 | 证据 |
| --- | --- | --- |
| Desktop Rust：选择存储 + 用户命令 + 活动 worker 授权重建 | 完成 | 闭包 C1–C6；`workspace_choices` 3 单测通过 |
| Station Go | **零改动**（见 §2） | 源码事实 + 闭包 C6 |
| Headless 闭包 | C1–C6 全过（6/6） | `tooling/acceptance/reports/task-workbench/tw-workspace-directory.json` |
| 生产 UI：composer 工作目录选择器（本地沙箱/本地项目/worktree） | 完成 | `pnpm run check` 通过 |
| 生产 UI：station-sandbox 三态入口 | **未做，见 §5 偏差** | — |

## 2. Station 零改动的源码事实（修正方案 §3.2）

方案 §3.2 原计划把 `activeResourceGrantTx` 的无序 `Take` 改为 `ORDER BY declared_at DESC`。实施时核验源码，该改动不需要：

- `client_resource_grant_service.go:146-160` 对 `(session_id, capability_id)` 做 `clause.OnConflict … DoUpdates`：一次 declare 对每个能力**原子替换单行**，同一 capability session 的同一能力在表中至多一行。
- `activeResourceGrantTx` 的 `Take` 因此恒命中至多一行；设备侧重声明即新授权，旧 root grant 不存在「多行待自然过期」窗口。
- 闭包 C6 用直连 Postgres 两次快照（project root → sandbox root）实证：切换后每个能力的行立即变为新 locator 的 integrity_hash。

未新增 Go 单测（无行为变更）。

## 3. 验收结果（headless cell tw-d1，强模型 ARK）

`tw-workspace-directory.mjs` 最终轮 6/6 PASS：

- C1 add+activate：真实目录 canonicalize 后成为 currentRoot，缺失目录被拒，readiness 六个本地能力 READY。
- C2 governed turn：`local_file_write`/`local_shell_exec` 在项目根落盘与执行；node 从绝对路径独立读到精确字节，shell `ls` 输出包含项目文件。
- C3 fail-closed：模型对 `../escape-*.txt` 的写调用被设备端以 `CLIENT_CAPABILITY_PATH_OUTSIDE_ROOT` 拒绝；外部文件未落；Station `agent_tool_results.error_code` 钉定同一错误码。
- C4 回到沙箱：写入只落沙箱根、ls 列不到项目文件，项目根零泄漏。
- C5 worktree：用户命令 `git worktree add -b peers/<name> <base>/.peers-worktrees/<name>` 后激活，写入只落 worktree，base 工作树无变更。
- C6 Station 行不透明：`resource_ref`/`permission_grant_id` 均不含 locator；`integrity_hash == sha256("workspace\n<locator>")`；project→sandbox 重声明后六个能力行全部换新。
- C7 station-sandbox 由既有 `tw-o12-sandbox` 当前证据承接。

过程中暴露的产品事实（非本切片缺陷，闭包据此断言）：

1. shell 白名单不含 `pwd`（`is_allowlisted_shell_command`：find/grep/rg/cat/ls/make/pnpm/npm/go/cargo/git），闭包改用 `ls`/`cat`。
2. 本地工具执行失败（含越界拒绝）的终端收据令批次置 blocked 并中断 turn（`tool_dispatch_service.go:4622-4624` + `settleBlockedToolBatches`），不会把错误回灌给模型继续——fail-closed 语义成立，C3 以此为验收口径。

## 4. Rust 设计要点

- `desired_roots: actor\0device → PathBuf` 存待激活根；worker 未启动时激活只落记忆，注册时由 `workspace_root_for_registration` 使用；所选目录在注册时已消失则警告并 fail-closed 回沙箱（不阻塞整个 worker）。
- 活动 worker 走 supervisor 线程内 mpsc 队列：`redeclare_workspace` 先用候选根构建/注册/声明 grants，声明失败回滚 `workspace_root`，保证「激活失败不替换现授权」。
- grant 重建完全复用既有 `refresh_workspace_grants`：确定性 ID（含 locator 哈希）、24h lease skew、Station 端 upsert。
- worktree 创建固定命令形式 + 名称白名单 `[A-Za-z0-9_-]{1,64}`；本轮修复实现缺陷：`git worktree add` 新建分支选项是 `-b`（误用 `--branch`，首轮 C5 失败即此）。

## 5. 命令授权档（Full Access）— 后续追加切片

计划最初沿用「agent git 写禁令」旧设定。评审确认那是设备端**硬编码白名单**、与 Trae 式「Manual / Full Access」是两道独立闸门后，追加了用户可配置的命令授权：

- 设备端 `ShellMode { Standard, FullAccess }`：
  - Standard＝原硬白名单（find/grep/rg/cat/ls/make/pnpm/npm/go/cargo/git + 写类子命令禁令 + argv containment）。
  - Full Access＝execvp 直接执行任意 argv（含 git commit/push、依赖安装、`pwd` 等），cwd 仍钉在授权工作目录；不经 shell，argv 非注入向量。shell 超时 60s→10min、输出 64KB→1MB，构建/测试可跑。
  - 授权是本机用户每会话动作，存于 desktop worker 的 actor/device atomic，**Station/模型/工具信封都无法自行提权**；切换项目或重启回到 Standard。
- composer 工作目录菜单新增「Agent 权限」段（Standard / Full Access，Full Access 二次危险确认）；开启时同时把六个本地工具能力 binding 收敛到 Station AUTO（免逐条审批），关闭回到 MANUAL。
- 验收 `tw-workspace-shell-access` S1–S3（6/6，强模型）：Standard 拒绝 `pwd`（`CLIENT_CAPABILITY_COMMAND_NOT_ALLOWED` + 批次 blocked）；Full Access 下 `pwd` 与 `git add/commit` 成功（commit 真实进入 git log）；恢复 Standard 后 `pwd` 再次被拒。
- 提交：`17de4ab91`（Rust）、`87ca5e348`（UI/AUTO）、`31f4f64fc`（闭包 S1–S3）。

## 6. 偏差与边界

- **station-sandbox 生产入口延后**：渲染侧没有「把会话工具作用域收敛到 `workspace.sandbox.*`」的生产 action（目前仅 headless gateway 闭包使用）。把裸 binding upsert 直接塞进 composer 会绕过 agent capability store，需要独立设计（绑定版本/readiness/收敛事务）。本切片选择器只交付两个本地目标；Station 沙箱目标沿用既有 Terminal/sandbox 面。
- 未做 Station 文件树浏览、跨会话持久授权；不改 readiness 快照/信封 proto。
- Full Access 仍把命令 cwd 限在工作目录，不做整盘授权；不放开文件工具的 root containment（`..`/绝对路径仍 fail-closed）。
- 已知测试环境噪音：cell 内 `cargo test desktop_executor_worker` 有 1 个既有 MCP keyring I/O 失败（与本改动无关）；`tools` 模块 `file_write_and_edit_stay_inside_workspace` 在干净 HEAD 即失败（工具不自动建父目录、测试写 `docs/` 子目录），均非本切片引入；新增 `workspace_choices` 3 单测与 shell 分支测试通过。
- 高负载下「恢复沙箱」偶发命中 10s 激活队列窗口，重试即成功（闭包已带激活重试）；可后续在 UI 对 activate 做一次自动重试。

## 7. Linux 构建地板（影响「本机直接跑」）

Tauri 2 硬性依赖 `webkit2gtk-4.1` + `libsoup-3.0`（见 `tooling/devctl/desktop-install.mjs`）。Ubuntu 20.04（focal）官方/内部镜像均不提供这两个包（focal 只有 webkit2gtk-4.0、无 soup3），因此 **20.04 无法原生构建/运行 desktop app**；受支持的 Linux 地板是 Ubuntu 22.04+。本次验收在 Ubuntu 24.04 cell 内构建运行。要在本机 GUI 使用，需要 22.04+/macOS/Windows，或在 24.04 容器内做 X11 透传。

## 8. 后续

1. 生产 station-sandbox 选择器：在 agent capability store 增加 sandbox 收敛 action（绑定收敛 + readiness 等待），composer 补第三态。
2. 当前根在 worker 身份变化（重新登录）后的 UI 主动刷新（worker 重注册事件）；activate 失败一次自动重试。
3. 目录被外部删除后，选择记录保留但激活回沙箱；可在选择器上对失效记录做标记。
4. 文件工具可选「自动创建父目录」（修 §6 的既有测试不一致）。
