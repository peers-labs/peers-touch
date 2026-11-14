# 执行计划 — Agent 工作目录选择（本地目录 / Worktree / Station）

日期：2026-11-06。分支：`feat/agent-task-workbench-20261102`。Owner 选择范围 C：与 Terminal 对齐的完整双宿主目录合同。

## 1. 问题

Agent 的文件/命令工具今天只在一个设备私有沙箱根（`app-data/agent-workspaces/<actor-device hash>`）内执行；产品没有“为这次任务选择项目目录”的入口。Terminal 子系统已具备 `workspaceRoot + cwd + allowedRoots[]` 的本地+Station 双宿主合同，但没有接到文件/命令能力的 resource grant 上。结果：agent 无法在用户真实仓库（如 peers-touch）里迭代。

事实依据：

- 工具执行根来自 capability session 的唯一 workspace grant：`desktop_executor_worker/workspace_grants.rs::provision_actor_workspace`（注释明示“one default workspace root per actor/device”）；`local_executor.rs:132-145` 以首个 resource locator 为 cwd、全部 locator 为 allowed_roots。
- Station 每个 capability session 的每个工具能力只钉一个活动 grant：`client_resource_grant_service.go::activeResourceGrantTx`（`Take`，无显式排序）。
- grant locator 对 Station 不透明（设备本地保存、整组完整性哈希），Station 不看路径。
- Terminal 已有本地 worker PTY 与 Station sandbox 分配两套放置（`desktop_api.ts terminalWorkerCreate/terminalResolveActiveSandboxes`）；WORKSPACE_SANDBOX 工具执行目标已全链可用（tw-o12-sandbox 8/8）。

## 2. 产品模型（与 Trae/opencode 对齐）

一次 agent 会话（capability session）同一时刻只有一个活动工作目录，三态：

| target | 含义 | cwd 根 |
| --- | --- | --- |
| `local-sandbox`（默认） | 设备私有隔离工作区，现状行为 | provisioned `agent-workspaces/<hash>` |
| `local-project` | 用户显式选择的本机目录（rfd 文件夹选择）；git 仓库可选“在此目录 / 新建 worktree” | canonicalize 后的目录或 worktree 路径 |
| `station-sandbox` | Station 侧 WORKSPACE_SANDBOX 分配（复用既有 sandbox 能力与 sandboxRef） | provisioner 容器内工作区 |

授权语义（安全边界，不可协商）：

1. 选择 `local-project` 是**每会话显式授权动作**：必须经用户选择/确认，不做全局永久放权；会话结束授权随 grant 到期失效，目录选择记录（label/locator）可留存以便再次选择（再次使用仍需重新激活授权）。
2. 路径必须 canonicalize 为真实目录；符号链接解析后仍须落在用户所选目录内；root 外读写/`..`/绝对路径越界继续 fail-closed（既有 `approved_roots` 与 shell 白名单不变）。
3. Agent 工具的 git 写禁令不变（commit/push/merge 等仍拒绝）；**worktree 创建**走用户发起的 tauri 命令（等同用户自己在终端执行），不经 agent 工具面。
4. 同一时刻只有一个活动项目（newest active grant wins）；切换/停用回到 `local-sandbox` 默认根。
5. 选择 UI 必须展示：目标类型、真实绝对路径、git 分支/worktree、授权作用域（本会话）与撤回入口。

## 3. 技术方案（不新增第三套目录概念）

复用既有 resource grant 机制，不引入新的快照合同或执行信封字段：

- grant locator 仍设备本地不透明；Station 只把“最新未过期 grant”钉到信封。
- `resource_refs`/完整性哈希/session 作用域/过期 skew 全部沿用。

### 3.1 Desktop Rust

1. **工作区选择存储**（actor 设备域，L2 加密 db，新增 domain）：
   - `WorkspaceChoice { id, kind: local-project, label, locator(canonical absolute), is_git, worktree_base?, branch?, created_at, last_used_at }`。
   - CRUD：list / upsert / delete；`local-sandbox` 与 `station-sandbox` 不落选择表（系统目标）。
2. **选择命令（用户发起）**：
   - `agent_workspace_pick_directory`：rfd 文件夹选择（同款 `rfd::AsyncFileDialog`）→ canonicalize → 探测 git（`.git` 存在则 `is_git`）→ 写选择。
   - `agent_workspace_create_worktree { base_locator, name }`：仅当 base 是 git 目录；执行 `git -C <base> worktree add <base>/.peers-worktrees/<name> <new-branch-or-name>`（命令固定、参数白名单、禁止 `..`/绝对外溢）→ 写选择。
   - `agent_workspace_list_choices` / `agent_workspace_remove_choice`。
3. **激活/撤回（作用于当前 capability worker/session）**：
   - `agent_workspace_activate { target }`：
     - local-sandbox：用 `provision_actor_workspace` 根（现状）；
     - local-project：以选中 locator 为根；
     - station-sandbox：不在本地 grant 链（走 sandbox 绑定，另见 3.3）。
   - 泛化 `supervisor::refresh_workspace_grants(root)`：支持对**活动 worker**按给定根重建 grants → 写本地 registry → `declare_resource_grants` 到 Station。引擎未启动则记录“待激活根”，启动注册时使用该根而非默认根。
   - gateway 增加 `agent_workspace_pick/list/create-worktree/activate/current` arms；其中 pick 在无头 cell 下不可用（无显示会话），activate/list 可由路径直接驱动以支持闭包。
4. **执行器**：无需改 cwd/allowed_roots 逻辑——它已经消费 envelope 上钉定的 locator。补一个保证：选中项目根不存在/不可访问时，激活失败且不替换现有授权（原子）。

### 3.2 Station Go

- `activeResourceGrantTx`：把无序列 `Take` 改为确定性“最新活动 grant 胜出”——`ORDER BY declared_at DESC, id DESC LIMIT 1`。旧根 grant 行保留至自然过期，不影响选择。
- 不改 grant 校验、lease skew、max 32、不可变性与 readiness 快照。
- 新增单元测试：连续 declare 两个不同（不透明）grant 后，dispatch 钉定最新；旧的过期后回退。

### 3.3 Station 目录（sandbox）

- 不新建目录浏览面：`station-sandbox` 目标复用既有 WORKSPACE_SANDBOX 执行目标与 `sandboxRef`（tw-o12-sandbox 已证）。
- 选择器选 Station 时，前端把会话工具作用域收敛到 `workspace.sandbox.*`（闭包已有 converge 模式）；sandbox 分配内的工作区根即 Station 侧目录。
- “浏览 Station 文件树选子目录”列为后续增强，不在本切片。

### 3.4 Desktop UI（生产，最小可用，不做视觉重设计）

- Composer 工具/作用域区新增「工作目录」选择器：三态分段/菜单——本地沙箱（默认）/ 本地项目（选目录…、最近项目、worktree…）/ Station 沙箱；
- 选中 local-project：显示路径、git 分支、“本会话授权中”状态与撤回；
- 选中前先确保 capability session（与既有引擎引导一致）；切换时调用 activate；
- Station 目标走 sandbox 收敛；
- 文案走 i18n，无硬编码 UI 字符串。
- peers-ui 重构原型（task-workbench）随后补同一选择器，但生产功能不依赖原型 confirmed。

## 4. 验收（headless，真实设备 + 直连 SQL）

新增闭包 `tw-workspace-directory.mjs`（desktop-native headless gateway）：

- C1 `activate` 选中 cell 内一个临时项目目录 → readiness READY；
- C2 governed turn：`local_file_write/local_file_edit/local_shell_exec` 在**该项目根**落盘与执行成功，node 独立从该绝对路径读到字节；
- C3 同 turn 尝试 root 外路径（`..`/绝对路径）被 fail-closed 拒绝；
- C4 切回 local-sandbox → 项目根不可见、cwd 回到沙箱根；
- C5 worktree：对一个临时 git 仓 create-worktree → activate → 写入只落在 worktree、base 工作树无变更；
- C6 直连 Postgres：activity 钉定的 resource grant integrity_hash 与 locator 一致（locator 不回传 Station 的约束保持）；
- C7 station-sandbox 目标：sandbox 收敛后调用 execution_owner=station（复用 tw-o12-sandbox 断言，不重复实现）。

通过标准：C1–C6 全过；C7 由既有 sandbox 闭包当前证据承接。Go/Rust 单元测试：newest-wins、路径 canonicalize/越界拒绝、worktree 命令参数校验。

## 5. 边界

- 不做 Station 端文件树浏览；不做跨会话持久授权（每次会话重新激活）；不放开 agent 的 git 写操作；不改 readiness 快照/信封 proto。
- 生产 GUI 完整键盘/AT/暗色沿用组件合同，本轮以功能正确+既有检查为先。
- 不 push、不提 MR。

## 6. 提交序列（预计）

1. `feat(desktop)`: workspace choice 存储 + pick/worktree 命令 + activate 重建 grant（Rust 单测）
2. `fix(station)`: active resource grant newest-wins（Go 单测）
3. `test(tooling)`: tw-workspace-directory 闭包 + 证据
4. `feat(desktop)`: composer 工作目录选择器（i18n）
5. docs：本计划结果文档
