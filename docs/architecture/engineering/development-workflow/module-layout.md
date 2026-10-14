# 现有模块如何调整

> **Status**: active
> **Created**: 2026-09-16 | **Updated**: 2026-10-14
> **Owner**: Platform Team

本文列出[重构设计](./design.md)涉及的现有模块，供实施与检查使用。不能按目录名把 `local-dev/` 全删；其中有实际运行入口、资源锁和正式验证依赖。

## 1. 文档职责

- `docs/global/workflow.md`：唯一规范研发流程。
- 本目录 `design.md`：工具的职责、调用关系和失败处理。
- `data-model.md`：可选任务记录、操作记录、证据与恢复要求。
- `integration.md`：调用方清单、切换范围和具体保留检查。
- `decisions.md`：目标设计决定及其理由，旧决定按状态区分。
- `execution-plans/20261013-development-flow-rebuild-accepted/plan.md`：这次改造的冻结实施顺序与验收。
- `local-dev/`：运行资源的独占、权限、Profile 与清理实现；实施时同步删除任务准入耦合。
- `toolchain/`：跨平台运行入口和依赖约定，已有 `devctl` 继续使用。

## 2. 工作组织与记录

**`dev-work.mjs`。** 只提供可选任务的 start、update、status 和 status-all；
使用明确 task 选择、原子快照、checksum 与 revision/CAS，不创建通用资源登记，
也不从 Hook 解析执行权限。

**`development-close.mjs`。** 这是唯一公开关闭入口。收尾只检查本任务证据和资源，
直接更新同一 `task.json`；没有独立 close store、关闭回执或 workspace 新任务守卫。

**处理 `active-work*`、`workflow-state-inspector.mjs`、`workflow-snapshot*`。** 删除独立 active-work 真源及多账本强一致准入；状态查询显式读取可选任务和实际运行事实，不能因一个工作区记录坏了屏蔽所有工作区。

**删除 `dev-work-ledger.mjs`、`dev-work-schema.mjs` 的通用任务登记责任。** 其中路径包含检查、冲突判断或工具函数有独立价值时移到唯一实际使用者；完成全部引用迁移后删除空壳，不保留同名兼容门禁。

**新增 `development-flow-residue.mjs` 及测试。** 只检查当前非历史源码中的负清单：
旧 ledger/mount/binding/grant 准入、普通工具 DENY、全机 idle 前置和未授权
`git worktree add`。历史文档排除必须显式列出并受测试约束，不能用宽泛目录忽略隐藏残留。

## 3. 计划与评审

**改 `plan-package.mjs`、`planctl.mjs`。** 保留文档解析、依赖检查和显式计划选择；计划是需求实施安排，不占用整个 worktree。进度归可选任务记录；命令结果不能推导执行授权。

**删除 `plan-mount.mjs` 的机器占用职责。** 所有消费者改用明确计划引用与任务选择；不留隐式 mount 兼容读取。已存在的机器历史不在源码删除中顺手清理。

**改 `completion-review.mjs` 与 Completion Auditor。** 审查直接接收明确范围、当前源码和证据，保留真实性与新鲜度检查；不要求由 Session/OWNER/mount 生成请求。多个审查记录不得变成普通编辑的启动门禁。

## 4. Hook 与安装

**改 `tooling/plugins/pt-ew-plugin/scripts/hook-entry.mjs` 及当前 host adapters。** 保留现有事件入口和上下文输出，删除通用工具拒绝、Stop 自动阻断、OWNER grant 和 authority 构造。未知事件或工具返回中性结果。

**删除 `workflow-binding*`、`workflow-action-store.mjs` 中会话权限与 grant 机制。** 可复用的诊断关联、耗时和事件字段留在观察实现，不以新名字重建同一权限链。

**`workflow-kernel.mjs` 与 host adapters。** 只保留工作区选择、上下文生成和
`ALLOW | CONTEXT | NOOP` 输出。`workflow-tool-intent.mjs` 没有剩余 owner，已连同
测试删除；Hook 不解析 shell 权限，也不捕获真实宿主证明。

**改现有安装器、审计器、`install-agent-integration.sh`。** 解释器发现、正确引号和安装路径回放统一实现。Skill 投影不读机器任务账本，不要求 Hook 签发安装授权；保留路径安全与非项目配置。项目级安装不扩展为全局安装。

## 5. 运行资源

**保留并改 `machine-dev-registry.mjs`、`machine-dev.mjs`。** Profile、实际部署目标、slot 和 capability 继续判断；删除 `validateRuntimeIntent` 对开发登记和计划器回执的依赖，改由具体运行请求与实际授权判断。

**保留 `machine-dev-lease.py`。** OS 锁、PID/启动时间、锁内复查及进程组终止属于真正资源保护。仅在实际接口变化时修改，不能把它一起退役。

**改 `dev-resource-plan.mjs`。** 资源复用和依赖准备只为需要运行的任务服务，交给既有 Runtime/Suite 统一生命周期；删除全机 source claims 和 PlanMount 的前置条件。

**核对 `tooling/devctl/`、`station-dev.sh`、`desktop-dev.sh`、Mobile/Relay 与部署脚本。** 运行目标、权限、健康、源码/产物身份、数据范围和所有权清理不可删；如依赖旧 declaration/mount，迁移在对应能力切换中完成。

## 6. Skill、Make 与 Acceptance

- 改 `pt-dev-workflow`、`pt-god-view`：按规范组织工作，小改动直接选编码和小修 Skill；不再先跑登记。
- 所有工作组织、调度和 host adapter Skill 保留 `git worktree add` 禁令：
  只有用户显式要求创建 worktree 才能调用，计划、冲突、脏状态、验证或恢复均不能隐式授权。
- 改 `pt-plan-and-document`、两类架构方法论：稳定方案与计划照常记录，不要求挂载才能使用。
- 改调度、Guardian、Context Anchor 与 host adapters：调度按依赖及实际冲突；规范和授权由明确来源决定，不由 Hook receipt 决定。
- 改 Runtime Handoff、Completion Auditor、Quality 和 Review：继续审查代码和真实证据，解除不相关的任务状态准入。
- 保留小修纪律、结构审查、`pt-read-before-edit` 和业务开发 Skill；有机械流程耦合才修改，不为“收敛技能数”删除有用标准。
- 改 `tooling/make/local-dev.mk`、`setup.mk`：保留既有启动和任务入口，删除无剩余使用者的低层 grant/mount/active-work 目标，不新增快任务入口。
- Acceptance runner 直接解析显式 Gate、Plan、completion 或 full 范围后再创建 run；
  Gap Detector 直接消费变更范围、Plan 和 run。独立 `acceptance-admission.*` owner
  已删除；正式 Runtime、Evidence Store 和业务断言保持不变。
- 改 `tooling/development/secure_content/schema_activation.py` 等现有消费者：不恢复旧准入；产品 schema 激活和权限仍按自身合同检查。

## 7. 实施完成检查

上述清单是已查明的主要调用面。每批动手前从实际源码补齐直接和间接引用、测试、Gate、文档及 Skill；不能拿这份初始清单当作“全仓已经清干净”的证明。

共享 Make、registry、工具函数和安装入口由一个实施者负责集成。可并行的调查和评审保持只读；实现按互不重叠写范围拆分，最终调用迁移和运行验收由同一个集成步骤完成。

被删除模块的活引用必须为零。保留模块不允许导入旧会话权限或全机任务账本。知识条目废止用 superseded 标记保留来由，源码与当前正式文档不留双路实现。
