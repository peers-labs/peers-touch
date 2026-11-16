# Local Dev Control Plane

> **Status**: active
> **Version**: v2.1
> **Created**: 2026-09-13 | **Updated**: 2026-11-15
> **Owner**: Platform Team
> **Module**: `tooling/scripts/local-dev/`

---

## 1. Document Scope

本文档集定义：

- 单机多 worktree 开发环境的全局控制面。
- 环境定义、worktree 绑定、本机 slot、Station 权限和运行租约的唯一 Owner。
- `~/.peers-touch/dev/` 的机器级持久化边界。
- Acceptance Evidence Store 的开发期持久化边界。
- 每个 worktree 独立选择 profile、slot 和 Station 使用方式的身份模型。
- Profile 同级声明 Station 与 Simulator 依赖，以及 Machine Dev 的实例分配、
  物理锁、可读资源选择、跨 Profile 共享、覆盖确认和回收契约（LDCP-D23/D25/D26/D27）。

本文档集不定义：

- Station、Relay 或 Desktop 产品数据。
- 具体 profile 的 Station/Relay 拓扑内容；它们仍由兄弟 `env` 仓定义。
- 实施阶段和迁移顺序；架构确认后另行制定执行计划。

## 2. 背景与问题

现有规范声明多个 worktree 共享 `.local`，实际本机审计发现：

- 被审计 worktree 使用独立或缺失的 `.local`，没有统一机器级 Owner。
- 两个 worktree 同时选择 `chat-native-four`，但没有长期分配账本。
- profile 静态携带 `PT_DEV_SLOT`，多个 profile 复用 slot 2、3、4。
- Acceptance 运行期存在临时 `ProfileLease`，但不能回答当前机器长期由谁占用
  profile、slot、Station 部署权和重置权。
- `env` 仓定义环境拓扑，却不应持有某台开发机上的 worktree 分配状态。

本机已存在 `~/.peers-touch` 产品/Agent 数据根，但此前没有 `dev/` 控制面子域。
历史 Evidence Store 位于
`~/Library/Application Support/PeersTouch/acceptance`。该路径属于正式产品的
Application Support namespace，不适合承载开发期产物；目标路径统一为
`~/.peers-touch/dev/acceptance`。

## 3. 设计目标

1. 以 `~/.peers-touch/dev/` 作为单机开发控制面的唯一持久化根。
2. 以 canonical worktree path 派生的 `workspaceId` 作为绑定键，禁止 basename 冲突。
3. 让每个 worktree 独立选择 profile 和本机 slot。
4. 将环境拓扑定义与本机资源分配分离。
5. 区分 Station 共享连接、独占部署和独占重置权限。
6. 用 Workflow Snapshot 按 worktree 投影需求/Journey、branch、profile、
   slot、Station、Relay、database、进程和租约。
7. 将 Acceptance Evidence Store 收敛到同一 Dev Control Plane 根。
8. 所有冲突 fail closed，不依赖人工记忆或 worktree 私有缓存。
9. 让所有 worktree 在实际资源入口看到已持有的 OS lease 和冲突。
10. 已评审非 stable Profile 直接授权 capability 覆盖的开发环境操作；
    worktree-local Profile 可由 canonical `profile-init` 直接创建。
11. 仅由 canonical Profile ID 派生 reset 策略：大小写不敏感、以
    `stable` 结尾的 Profile 禁止 Agent 自主 reset，其余已评审 Profile 允许
    Agent 在能力、精确 scope、当前源码和 lease 约束下选择 reset。
12. Workflow Snapshot 通过按需 CLI/API 提供只读开发状态，不启动常驻服务、
    不占用端口，也不成为控制面真源。
13. Workflow Snapshot 将可选任务状态与环境健康分开；旧声明可见但不拥有
    资源。
14. Peers Dev browser dashboard、固定 4177 endpoint 和 browser Gate 不属于
    Local Dev Control Plane。
15. 现有非 stable Profile 的 reset 不要求人工授权；已有 Profile 的 deploy
    与 reset 都不得因内部能力刷新或执行边界重复询问。
16. 用户指定数量、用途或选择可读设备名称；Agent/控制面查询设备清单并解析内部 ID。
    Profile 内部自由安排用途，同一内部 ID 可被多个 Profile 引用，共享关系可见。
17. 覆盖已安装内容或其他 Profile 的状态前，显式告知可读设备名称、共享方和影响，
    由用户决定是否强制覆盖；提示主文显示设备名称，数量不用于判定身份或冲突。
18. 原始 ID/UUID 属于内部标识和诊断细节，不能要求用户先查找、记忆或手工输入。
    清单展示可读名称、型号/系统、状态和共享 Profile；名称重复时明确区分。

## 4. Runtime Authority

The canonical implementation lives in `tooling/scripts/local-dev/` and stores
machine-local authority at:

```text
~/.peers-touch/dev/registry.json
~/.peers-touch/dev/leases/
```

An existing `authority: observed-snapshot` file remains diagnostic until the
canonical `make profile <name>` or `make env-register` action runs. Either
operation promotes the registry to `authority: machine-control-plane` and adds
the verified current workspace binding atomically. `make profile` allocates the
the lowest free slot and the Profile's minimum operational capabilities, never
`station.reset`; stable Profiles default to `station.connect` only.
`make env-register` remains available for explicit allocation.
Discovery and legacy profile pointers never perform promotion or registration.

Git worktree discovery does not create a registration. The initial registered
cohort is owner-declared; until that list is provided, the machine registry may
record observations but must keep `registrations` empty.

Normal `make config`, `make station`, Desktop, and Mobile resolution requires
the authoritative binding. `make profile` creates that binding on first
selection and updates it thereafter. OS-held leases under `leases/` are the
only live owners for `local.slot`, `station.deploy`, and `station.reset`; JSON
in a lock file is diagnostic metadata only.

当前资源目标以用户 2026-11-15 明确修订的 LDCP-D26 为准：
按资源 ID 分配与共享，取消默认整机数量限制和固定客户端角色。
Simulator 实例、Profile 分配映射、逐操作覆盖确认及两个 Mobile 入口和全部
iOS Provisioner 已切到 canonical machine owner；原生与数据证明仍需按选定 Gate 执行。
`runtime.profile` 也是需求契约，不能从文档推断当前 CLI 已支持该 lease kind。
当前运行事实与目标状态分别标注；没有原生证明时不得报告资源复用或回收 PASS。

The authoritative binding deliberately excludes Git HEAD. Commands capture
current source from Git at operation time. Lease acquisition snapshots branch
and HEAD, then revalidates that identity with the binding after the OS lock is
held and before the child command starts. Optional task progress, formal Plans,
host identity, and Hook output are not runtime authorization inputs.

## 5. 文档导航

| 文档 | 说明 |
|------|------|
| [design.md](./design.md) | Owner、控制面、租约和失败语义 |
| [data-model.md](./data-model.md) | 机器注册表、worktree 绑定和租约模型 |
| [integration.md](./integration.md) | 与 env 仓、现有 `.local` 和 Make 入口的关系 |
| [module-layout.md](./module-layout.md) | Workflow Snapshot 与 control-plane 模块职责 |
| [decisions.md](./decisions.md) | 关键架构决策与替代方案 |
| [product-definition.md](./product-definition.md) | 开发控制面产品能力、用户与可行性边界 |
| [experience-contract.md](./experience-contract.md) | 环境选择、状态检查与运行时操作 Journey |
| [product-state-model.md](./product-state-model.md) | Worktree、环境与资源可见状态 |
| [acceptance-matrix.md](./acceptance-matrix.md) | 控制面行为与证据映射 |
| [资源 ID 分配与共享执行计划](./execution-plans/20261115-profile-resource-id-sharing/plan.md) | 用户指定目标的垂直闭环、覆盖确认与证明要求 |

Development task sequencing, Journey state and functional/Acceptance
promotion belong to
[`docs/architecture/engineering/development-workflow/`](../development-workflow/README.md).
