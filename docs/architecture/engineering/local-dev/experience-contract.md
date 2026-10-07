# Workflow Snapshot 体验契约

> **Status**: active
> **Version**: v3.0
> **Created**: 2026-09-23 | **Updated**: 2026-10-04
> **Owner**: Platform Team
> **Module**: `tooling/scripts/local-dev/workflow-snapshot.mjs`

---

## 1. User Journey

研发人员或 Agent 通过一次命令读取所有 worktree 的当前开发状态：

```bash
make workflow-snapshot
```

命令输出一个有界 JSON 文档后退出。它不启动服务、不监听端口、不打开
Browser，也不持有刷新状态。

## 2. Information Hierarchy

每个 worktree 投影只表达一个 `workspaceId`，并按以下顺序组织：

1. 当前 Git 身份：name、workspaceId、branch、HEAD、dirty。
2. 当前 PlanMount、ExecutionRun、Task、Session 与 active-work 一致性。
3. declaration、profile、slot、runtime claim 与 lease 健康。
4. observation、registration、declaration、Session 和 Git 的独立时间戳。
5. typed findings、workflow verdict 与 Plan Run decision。

Git discovery 是当前 branch/HEAD 的唯一投影来源。Worktree creation
provenance 提供 `createdBy.rootChatId`，当前 OWNER binding、registration、
declaration、active-work 和 Session 提供 `workflowOwner.rootChatId`。这些
owner 只能提供各自拥有的事实，不得覆盖 Git 身份或互相修复；Git actor
也不得替代主会话身份。

## 3. State Vocabulary

- `HEALTHY`: 所有必需 owner 投影一致。
- `BLOCKED`: 已验证 blocker 阻止继续执行。
- `DRIFT`: owner 数据存在可定位的不一致。
- `SUSPENDED`: 当前执行被显式暂停或挂起。
- `CONTINUE`: Plan Run 仍有合法 frontier。
- `HARD_BLOCK`: 只有真实 hard boundary 或身份无效阻止推进。
- `COMPLETE`: 当前 mounted run 已终态。

缺失实体使用 `none`，未启动的当前 Session 使用 `not-started`，可选遥测缺失
使用 `not-observed`。只有信息不完整或互相矛盾时才使用 `UNKNOWN`。

## 4. Freshness Contract

Snapshot 保留每个 owner 的独立时钟：

- Git `checkedAt`;
- observation `reportedAt`;
- registration `updatedAt`;
- declaration `heartbeatAt`;
- active-work `updatedAt`;
- Session 当前事件时间；
- runtime/lease observation 时间。

这些时钟不得合并成一个伪造的“最后更新时间”。stale 状态可见，但不获得
资源、Plan 或执行权。

## 5. Safety Contract

- Snapshot 是只读 join，不写 PlanMount、ExecutionRun、Task、Session、
  declaration、active-work、registry、profile 或 lease。
- 单个损坏记录产生 typed finding，不抑制其他 worktree。
- 输出不包含 canonical root、凭据、日志正文、产品数据或 Acceptance payload。
  主会话 ID 是本机工作流关联标识，不是 credential；仅从权限为 `0600` 的
  owner state 投影。
- worktree observation 只用于诊断，不注册 workspace、不选择 Plan、不证明运行。
- Snapshot 不提供删除 worktree、分配 profile、部署、重置或启动 runtime 的操作。

## 6. Failure And Recovery

- 一个 owner 文件缺失或损坏时，保留其他 owner 的有效投影并报告精确路径类别。
- Git discovery 失败时不得用历史 branch/HEAD 冒充当前 Git 身份。
- PlanMount、run、Task、declaration、Session 或 active-work 不一致时返回
  `DRIFT` 或 `BLOCKED`，不得自动修复。
- 再次运行命令会从当前 owner 状态重新计算；不存在轮询缓存或服务重启步骤。

## 7. Acceptance

- `make workflow-snapshot` 输出一个 JSON 文档并退出。
- 同一读取可列出多个 worktree，且每行 `workspaceId` 与 Git discovery 一致。
- Plan 与 Environment 健康独立投影。
- 损坏单行不影响其他有效行。
- 命令不创建 listener、PID、端口、runtime lease 或机器状态 mutation。
- 仓库不存在 `apps/dev` Web 资产、HTTP server、固定 `4177` 资源或 Browser Gate。
