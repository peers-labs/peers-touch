# 任务进度与运行记录约定

> **Status**: active
> **Created**: 2026-09-13 | **Updated**: 2026-10-14
> **Owner**: Platform Team

本文是[重构设计](./design.md)的当前记录合同。它只服务内部研发恢复，不是跨应用 API，也不增加第二套状态真源。

## 1. 哪些信息需要保存

小改动不建立持久任务记录。复杂任务保存继承的北极星引用、本次贡献、目标、范围、
进度、下一步及引用；实际代码看 Git，服务占用看运行入口，正式验收看 Evidence Store。

任务文件不保存密码、token、用户消息、截图正文、完整命令输出或原始宿主会话 ID。只保存相关证据和授权的引用。

## 2. 任务选择与存储

复用已忽略的 `.dev-workflow/`：

```text
<worktree>/.dev-workflow/tasks/<task-id>/
├── task.json           # 唯一任务快照；revision + checksum
└── task.lock           # 仅本记录写入时使用的短锁
```

稳定的实施计划在 `docs/`；任务中只保存其路径和摘要。任务目录不是提交产物，也不是产品存储或正式 Acceptance 证据目录。

选择使用明确的 `taskId`。同工作区存在多任务时，不能按最新 mtime、当前分支或旧 active-work 猜选。Hook 只有获得明确任务选择时才记录相关动作；无选择只注入规范提示。

## 3. 一份任务记录包含什么

以下是存储合同示意，不是手写新业务模型的许可。共享给其他应用的模型仍需 Proto-first；研发工具内部字段按现有工具 schema 实现。

```text
TaskRecord
  taskId
  northStarRef?        accepted product/engineering source or explicit user goal
  contribution         this task's observable contribution to the north star
  goal
  workspaceId
  branch
  initialSource
  currentSource
  planRef?             repository-relative path + content digest
  scope                allowed source paths + explicit exclusions
  stage                intake | research | design | prepare |
                       implement | verify | deliver
  state                active | waiting-user | blocked |
                       completed | cancelled
  nextAction?
  authorizationRefs[]  explicit grant references, not secrets
  evidenceRefs[]       check class + source identity + result + reference
  resourceRefs[]       runtime identity + ownership + release/retain policy
  blocker?             affected action + reason + evidence
  revision
  updatedAt
  lastReason
  checksum
```

`workspaceId` 保留现有 canonical root 派生规则。分支与源码每次操作从 Git 读取，记录只用来判断发生了什么变化；不能用历史值覆盖当前 Git，也不因为其他 worktree 新增或删除而使当前任务失效。

记录有效不等于操作获准。写入范围、环境权限和部署授权分别由任务指令及具体入口判断，不能从 `state=active` 推导。

## 4. 进度怎么改变

按规范七步推进；小改动可以合并步骤，但不能跳过相关验证。Agent 调研和修复可以在同一次授权内继续，只有缺少决定或权限的具体动作等待。

`implement -> verify` 表示改动可检查，不表示功能通过。`verify -> deliver` 需要本次完成标准对应的有效证据；正式验收和源码检查不得相互替代。

`completed` 表示本任务约定的交付已完成。资源明确保留供用户测试时，记录其去向；资源未释放且结果不明时不能标为已关闭。

源码变化时失效的是受影响的证据和步骤。不能为了修正一个验证结果重建整个工作区登记，也不能用恢复任务擅自扩大计划范围。

## 5. 写记录时中断怎么办

更新在任务短锁内完成：读取当前 `task.json`，检查 revision，计算 checksum，
fsync 临时文件后原子替换。进程在替换前退出时旧快照保持有效；替换后退出时新快照
已经是唯一真源。超出短写入窗口的遗留锁可回收，不依赖 PID 身份或长租约。

checksum 不符或 JSON 损坏时，只报告该任务不可恢复，不推导或补写成功状态。
同任务多个写入者按 revision/CAS 检查，冲突要求重读再提交；不同任务不共用锁。
无关记录损坏不得变成整机或整 worktree 的拒绝条件。

## 6. 会产生副作用的操作

任务记录只引用实际操作记录；实际运行入口保存：

```text
OperationRecord
  operationId
  resourceKey
  workspaceId
  action
  sourceOrArtifactIdentity
  exactTarget
  requestedScope
  authorizationRef
  state                prepared | running | succeeded |
                       failed | outcome-unknown
  postconditionRef?
  acquiredResourceRefs[]
```

同一操作的重复请求保留原 `operationId`。先查询目标后置结果或幂等结果：已成功不重复执行，明确未执行才重试，结果不明则暂停该动作。

这不是一套全机开发账本。操作记录由具体 Runtime/Suite 持有，不能由 Hook 生成，不能以 task 已完成为依据自行重启、reset 或释放他人资源。

## 7. 真实资源的标识与持有

连接、部署、重置、设备和端口组按不同资源键判断。部署键来自已评审目标，reset 键来自实际 Station 和数据范围；不能只用本地文件名或任意 caller-supplied 字符串区分同一资源。

保留 OS-held lease、PID 与启动时间核对，以及有界进程组清理。锁文件 JSON 是诊断信息，真正持有以 OS 锁和对应进程为准。等待某资源时不得先拿着其他一组资源无限等待。

共享资源清理必须核对本操作所有权。任务进度损坏、聊天结束或租期到时，不等于资源安全可释放；遗留运行资源仍要现场核对。

## 8. 证据记录的最低要求

复用既有 `SOURCE_CHECK`、`STRUCTURAL_CHECK`、`UX_REVIEW`、`FUNCTIONAL_CHECK`、`ACCEPTANCE_PROOF` 分类；同一证据记录包含结果、源码或产物身份、场景、实际断言、时间和可验证引用。

无运行证据只支持已检查的源码结论。正式验收必须由正式入口写入，任意 JSON 文件、调用者传入 `PASS` 或任务状态不能建立正式证明。

审查读取显式范围与证据，不依赖 OWNER、PlanMount 或开发 Session。任务进度坏了，可以检查现有代码和证据；恢复进度未知仍如实报告，不能伪称任务整体已完成。

## 9. 旧记录如何处理

旧 `work.json`、OWNER、Action Receipt、PlanMount 和通用关闭记录不参与新流程准入。实施时删除正式入口的读取依赖，不能留新旧字段自动混读来猜权限。

本次设计不删除机器上的历史记录，不释放旧持有者的资源。现有活跃任务继续由旧实例完成或明确停下；经授权的切换只针对选定工作区。旧计划可作为普通设计输入读取，但必须明确指定并重新核对范围和授权，不能导入旧记录中的“已通过”作为新证据。

旧已关闭历史留作追溯；错误 schema 或其他工作区状态不得挡住新任务。需要清理机器历史时另列精确路径与授权，不作为新安装前提。
