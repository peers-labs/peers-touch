# 开发流程工具重构实施计划

> **Plan ID**: DWF-REBUILD-20261013
> **Version ID**: 20261014-lightweight
> **Created**: 2026-10-14T00:00:00.000Z
> **Owner**: Platform Team

本计划包含用户确认的轻量化修订；不使用旧 PlanMount、开发登记或 Hook grant 建立执行权。
版本标识只用于文档 schema，不是新流程产品版本。授权范围见 Plan Version；
提交、push、PR、部署、reset、环境创建、历史改写和真实 Hook rollout 均未授权。

## 目标与边界

**北极星：** 在用户选择的既有 worktree 中，以尽量少的机械前置，把每个已授权
需求持续转化为当前源码上可验证的实际结果，同时不降低真实权限、数据和共享资源保护。

落实[重构设计](../../design.md)：普通修改不依赖 Hook、OWNER、机器任务总账、
PlanMount 或通用关闭回执；复杂任务可恢复，真实运行保护和当前源码证据继续有效。
实施只面向明确选定的目标 worktree，不读取或比较目标外 worktree 的实现，
也不修改目标外工作区、全局 Hook 或共享 descriptor。

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "DWF-REBUILD-20261013",
  "versionId": "20261014-lightweight",
  "createdAt": "2026-10-14T00:00:00.000Z",
  "workClass": "refactor",
  "architecture": {
    "sources": [
      "docs/architecture/engineering/development-workflow/README.md",
      "docs/architecture/engineering/development-workflow/design.md",
      "docs/architecture/engineering/development-workflow/data-model.md",
      "docs/architecture/engineering/development-workflow/decisions.md",
      "docs/architecture/engineering/development-workflow/module-layout.md",
      "docs/architecture/engineering/development-workflow/integration.md"
    ],
    "decisions": ["DWF-D46"]
  },
  "scope": {
    "sourceClaims": [
      {"pathPrefix": "AGENTS.md", "mode": "exclusive-write"},
      {"pathPrefix": ".trae", "mode": "exclusive-write"},
      {"pathPrefix": "docs/README.md", "mode": "exclusive-write"},
      {"pathPrefix": "docs/global/workflow.md", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/engineering/development-workflow", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/engineering/local-dev", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/engineering/toolchain", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/engineering/architecture-governance", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/engineering/acceptance", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/engineering/quality", "mode": "exclusive-write"},
      {"pathPrefix": "docs/knowledge", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/local-dev", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/plan", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/lib", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/README.md", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/architecture", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/review", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/acceptance-gap-detect.py", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/acceptance-gap-detect-test.py", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/quality-evidence.py", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/quality-evidence-test.py", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/agent-integration-control.py", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/agent-integration-audit.py", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/agent-integration-audit-test.py", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/install-agent-integration.sh", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/acceptance-run.py", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/acceptance-validate.py", "mode": "shared-read"},
      {"pathPrefix": "tooling/scripts/acceptance-plan-test.py", "mode": "shared-read"},
      {"pathPrefix": "tooling/skills", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/plugins/pt-ew-plugin", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/make/acceptance.mk", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/make/local-dev.mk", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/make/review.mk", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/make/setup.mk", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/devctl", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/acceptance", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/development/secure_content", "mode": "exclusive-write"}
    ],
    "nonGoals": [
      "改变 Station、Desktop、Mobile 业务行为或另建流程引擎",
      "引入外部流程引擎或增加快任务 Make 入口",
      "读取、比较或修改目标外 worktree，修改全局 Hook 或共享 workspace descriptor",
      "没有用户显式要求时创建 worktree，或因任务、计划、冲突、脏状态、验证、恢复而隐式创建 worktree",
      "删除机器历史记录，终止其他任务或放弃真实资源锁",
      "创建环境、自主重置 stable、部署、发布、提交或改写历史",
      "将工具自测或文档校验当成真实 IDE 或业务验收"
    ]
  },
  "tasks": [
    {"id": "FLOW-01", "workstreamId": "FLOW-RUNTIME", "path": "tasks/FLOW-01.md", "dependsOn": []},
    {"id": "FLOW-02", "workstreamId": "FLOW-TASKS", "path": "tasks/FLOW-02.md", "dependsOn": ["FLOW-01"]},
    {"id": "FLOW-03", "workstreamId": "FLOW-EVIDENCE", "path": "tasks/FLOW-03.md", "dependsOn": ["FLOW-02"]},
    {"id": "FLOW-03B", "workstreamId": "FLOW-EVIDENCE", "path": "tasks/FLOW-03B.md", "dependsOn": ["FLOW-03"]},
    {"id": "FLOW-04", "workstreamId": "FLOW-GUIDANCE", "path": "tasks/FLOW-04.md", "dependsOn": ["FLOW-03B"]},
    {"id": "FLOW-05", "workstreamId": "FLOW-INSTALL", "path": "tasks/FLOW-05.md", "dependsOn": ["FLOW-04"]},
    {"id": "FLOW-06", "workstreamId": "FLOW-PROOF", "path": "tasks/FLOW-06.md", "dependsOn": ["FLOW-05"]},
    {"id": "FLOW-07", "workstreamId": "FLOW-ROLLOUT", "path": "tasks/FLOW-07.md", "dependsOn": ["FLOW-06"]}
  ],
  "authorization": {
    "checkpoint": {"localCommit": "denied", "amend": "denied"},
    "delivery": {"push": "denied", "pullRequest": "denied"},
    "runtime": {"deployProfiles": [], "destructiveResetScopes": []},
    "history": {"rewrite": "denied"}
  }
}
```

## 实施顺序与交付

1. **FLOW-01：运行请求独立。** 先解除 Runtime 对任务登记的依赖，保持权限、
   stable、目标、资源键和真实锁。这样后续删除总账不会拆掉运行保护。
2. **FLOW-02：可选记录与计划。** 使用单一原子任务快照，去掉 mount 和全工作区关闭
   前提；完成明确选择、多任务和中断恢复。迁移完成前不删除仍有消费者的模块。
3. **FLOW-03：审查与状态独立。** Completion Review、状态、Doctor 和只读投影
   使用明确范围与当前源码，解除 Session、登记和 mount 的机械前置。
4. **FLOW-03B：Acceptance 与质量消费者独立。** Acceptance runner 和 Gap Detector
   各自解析明确范围与正式证据；删除重复 admission owner，不降低业务断言。
5. **FLOW-04：提示与普通工作。** Hook 中性输出，工作组织 Skill 使用统一规范；
   已无调用模块当项删除；仍被 installer 使用的 OWNER/grant/总账/mount
   在 FLOW-05 迁移其最后消费者后删除，同时处理 Make、Gate 和知识规则。
6. **FLOW-05：选定范围安装。** 安装和审计不读旧准入账本；绝对解释器、原文
   回放、配置归属及提示降级通过临时目录检查后，才可按授权更新真实安装。
7. **FLOW-06：整体证明。** 使用临时目录、合成 workspace fixture 或独立临时
   Git 仓库验证无 Hook、隔离、恢复、真实权限/锁、证据新鲜度、共享环境复用
   和安装切换，并证明未显式授权时没有 `git worktree add`；
   不读取现有目标外 worktree，现场宿主另做实际验证。
8. **FLOW-07：宿主支持性观察。** 保留选定工作区安装审计和可选现场 smoke，
   用于诊断宿主差异；不进入整体完成门，也不需要仓库内真实 Hook 捕获器。

共享文件与集成由一个实施者串行处理；并行调查和评审只读。每项先从真实
消费者补齐直接/间接引用，再核对本项修改集，不因目录授权而顺手改无关模块。
集成与现场验证不能替实施项补造通过。代码各批完成迁移后才删除旧路径，不保留兼容开关。

Plan 中的目录级 source claim 只是写入上限，不是实际改动清单。每个 Task 动手前
必须生成当前源码直接/间接消费者 inventory，并冻结该 Task 的精确 changed-file
allowlist；新增路径先修订 Plan，Completion Review 拒绝 allowlist 外改动。

## 原子切换、删除与回退

以下负清单必须由当前源码扫描和行为检查同时证明，不能只改文档或测试字符串：

- 普通工作、状态、审查和 Runtime 不再导入 `dev-work-ledger.mjs` 取得准入；
- 新任务不再调用 `assertDevelopmentCloseAdmission`，关闭记录只影响本任务收尾；
- 普通工作、Runtime 和 Completion Auditor 不再读取 PlanMount 作为权限或可用性前提；
- Hook/host adapter 对普通工具不再产生 workflow `DENY`，Stop 不因流程记录阻断；
- Skill、Make、Acceptance 和安装器不要求 OWNER、Action Receipt、mount 或全机 idle；
- 无用户显式要求时，仓库内流程路径不存在 `git worktree add` 调用；
- 被删除模块在非历史源码、测试、Gate、Make 和 Skill 中活引用为零。

每项先完成消费者迁移和 focused check，再删除旧 owner。失败回退只使用 Git 恢复
该 Task 的源码；不能保留新旧双写或重新启用兼容开关。安装切换失败时，只恢复
本项目安装前配置和已知源码，不删除机器历史、不重置环境、不释放其他任务资源。

## 验证安排

任务中的命令是当前验证合同。`development-flow.integration.test.mjs` 与正式
Gate 共同证明工具闭环；运行结果不写回 frozen Plan。

工具验证使用临时仓库、目录、受控进程和替身，不写本机历史，不连接真实 Station。
真实部署边界只使用明确选定且已授权环境；本计划不授予安装、部署、重置或占用
前台权限。不能以 runtimeClass=source-only 宣称 Native 产品通过。

每个复用 Gate 必须在 registry 命令中直接执行带对应 `FLOW-Axx` ID 的 test case，
并由 Gate 结果列出已执行场景；仅因同一测试文件内其他用例通过、description 提到
能力、命令退出零或另一个 Gate 已通过，都不能满足本计划 closure。

正式 Gate 沿用当前相关标识并使用 `development-flow-tool-e2e` 覆盖工具闭环。
真实宿主 smoke 是支持性诊断，不登记为完成 Gate。场景映射见
[验收清单](../../acceptance-matrix.md)。

## Acceptance Execution

```json
{
  "closures": {
    "runtime-independent": ["machine-dev-registry-self"],
    "optional-task-recovery": ["development-workflow-control-plane"],
    "evidence-independent": ["development-workflow-control-plane"],
    "acceptance-evidence-independent": ["acceptance-infra-validation", "acceptance-plan-self", "acceptance-workflow-contract"],
    "ordinary-work-guidance": ["development-workflow-control-plane", "architecture-module-governance"],
    "selected-install": ["acceptance-workflow-contract"],
    "flow-end-to-end": ["development-flow-tool-e2e", "machine-dev-registry-self", "development-workflow-control-plane", "acceptance-workflow-contract", "acceptance-runtime-provisioning-self"],
    "host-observation-support": []
  },
  "completion": ["development-flow-tool-e2e", "machine-dev-registry-self", "development-workflow-control-plane", "acceptance-infra-validation", "acceptance-plan-self", "acceptance-workflow-contract", "acceptance-runtime-provisioning-self", "architecture-module-governance"],
  "full": ["development-flow-tool-e2e", "machine-dev-registry-self", "development-workflow-control-plane", "acceptance-infra-validation", "acceptance-plan-self", "acceptance-workflow-contract", "acceptance-runtime-provisioning-self", "architecture-module-governance"]
}
```

## 完成与审批边界

设计与计划已经确认。本 frozen Plan Version 只有在 `make plan-validate` 和 module
governance 均通过后才能开始 FLOW-01。设计确认不自动授权提交、push、PR、部署、
环境创建、reset、真实 Hook rollout 或其他工作区修改；已有精确授权仅按原范围复用。

实施完成需要本计划工具场景的有效结果、删除 inventory、同步规范、Skill、
知识及 registry。FLOW-07 只保留可选现场观察，不阻塞整体落地。
正式实现状态只在对应验收满足后调整；计划冻结不能被解释为实现或 PASS。
