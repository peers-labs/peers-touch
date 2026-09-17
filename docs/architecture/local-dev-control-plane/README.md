# Local Dev Control Plane

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-13 | **Updated**: 2026-09-13
> **Owner**: Platform Team
> **Module**: `tooling/scripts/local-dev/`

---

## 1. Document Scope

本文档集定义：

- 单机多 worktree 开发环境的全局控制面。
- Development Workflow 发布的机器级 source/runtime intent 公共账本。
- 环境定义、worktree 绑定、本机 slot、Station 权限和运行租约的唯一 Owner。
- `~/.peers-touch/dev/` 的机器级持久化边界。
- Acceptance Evidence Store 的开发期持久化边界。
- 每个 worktree 独立选择 profile、slot 和 Station 使用方式的身份模型。

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
6. 用机器可读账本统一展示 worktree、branch、profile、slot、Station、进程和租约。
7. 将 Acceptance Evidence Store 收敛到同一 Dev Control Plane 根。
8. 所有冲突 fail closed，不依赖人工记忆或 worktree 私有缓存。
9. 让所有 worktree 在首次写入或运行前看到其它任务的资源意图。
10. 环境创建必须由研发人员对精确名称和目标显式授权；Agent 不得自行生成授权。

## 4. Runtime Authority

The canonical implementation lives in `tooling/scripts/local-dev/` and stores
machine-local authority at:

```text
~/.peers-touch/dev/registry.json
~/.peers-touch/dev/leases/
```

An existing `authority: observed-snapshot` file remains diagnostic until an
Owner explicitly runs `make env-register`. That one operation promotes the
registry to `authority: machine-control-plane` and adds the verified current
workspace binding atomically. Discovery and legacy profile pointers never
perform promotion or registration.

Git worktree discovery does not create a registration. The initial registered
cohort is owner-declared; until that list is provided, the machine registry may
record observations but must keep `registrations` empty.

Normal `make profile`, `make config`, `make station`, Desktop, and Mobile
resolution now requires the authoritative binding. OS-held leases under
`leases/` are the only live owners for `local.slot`, `station.deploy`, and
`station.reset`; JSON in a lock file is diagnostic metadata only.

## 5. 文档导航

| 文档 | 说明 |
|------|------|
| [design.md](./design.md) | Owner、控制面、租约和失败语义 |
| [data-model.md](./data-model.md) | 机器注册表、worktree 绑定和租约模型 |
| [integration.md](./integration.md) | 与 env 仓、现有 `.local` 和 Make 入口的关系 |
| [decisions.md](./decisions.md) | 关键架构决策与替代方案 |

Development task sequencing, Journey state and functional/Acceptance
promotion belong to
[`docs/architecture/development-workflow/`](../development-workflow/README.md).
