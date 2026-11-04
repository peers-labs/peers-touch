# Peers UI — Agent UI/UX 基准执行计划

> **Plan ID**: UI-20261028
> **Version ID**: UI-20261029-agent-material-expression
> **Created**: 2026-10-29T03:00:00.000Z

## Goal And Framework Position

服务于 [Experience Design Control Plane](../../../../../engineering/experience-design/README.md)
既有 Agent UI/UX 思维执行框架。UI System 提供它的设计基准输入：
有限目录 → 使用合同 → 图形与动效语法 → 可运行样本 → Agent 查询与评审。
EDX 继续拥有推理、Finding、ReviewResult 和 CER；本计划不另建推理或审批流程。

用户批准 UI-F01 将 外部参考的样式、风格用于我们的 Agent 元素。
内容使用现有 Agent Groups 字段和 Agent 身份。用户批准在同一版完整落实
配色、材质、排版、空间与状态表达：暖白/奶油底层、薄荷与灰青表面、
琥珀选中态、局部色彩弥散与透光身份层、细边界和短阴影、轻重排版、
对象关系与附着摘要、焦点/禁用/创建反馈。保持既有方圆形状；
基础、组件、高级和交互逐步推进。
仅 UI-F01 当前获准实施。UI-F02 需要基础逐项确认；后续各阶段需要对应的
逐项确认和推进指令。任何候选都不能由 Agent 自行晋升为 accepted。
消费者替换需要后续明确授权和新的 frozen Plan delta。

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "UI-20261028",
  "versionId": "UI-20261029-agent-material-expression",
  "createdAt": "2026-10-29T03:00:00.000Z",
  "workClass": "refactor",
  "architecture": {
    "sources": [
      "docs/architecture/platform/client/ui-system/README.md",
      "docs/architecture/platform/client/ui-system/design.md",
      "docs/architecture/platform/client/ui-system/decisions.md",
      "docs/architecture/platform/client/ui-system/integration.md",
      "docs/architecture/platform/client/ui-system/prototype/foundations.md",
      "docs/architecture/platform/client/ui-system/prototype/README.md",
      "docs/architecture/engineering/experience-design/README.md",
      "docs/architecture/engineering/experience-design/decisions.md",
      "docs/client/common/ui-identity/README.md"
    ],
    "decisions": ["UI-D01", "UI-D02", "UI-D03", "UI-D04", "EDX-D01", "EDX-D05", "EDX-D06", "CER-D07"]
  },
  "scope": {
    "sourceClaims": [
      {"pathPrefix": "packages/ui", "mode": "exclusive-write"},
      {"pathPrefix": "packages/prototypes/shared/ui-system", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/platform/client/ui-system", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/engineering/experience-design/integration.md", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/engineering/experience-design", "mode": "shared-read"},
      {"pathPrefix": "docs/architecture/engineering/prototypes/README.md", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/engineering/architecture-governance/architecture-modules.json", "mode": "exclusive-write"},
      {"pathPrefix": "docs/client/common/ui-identity", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/skills", "mode": "exclusive-write"}
    ],
    "nonGoals": [
      "Consumer migration or changing active public token values",
      "Automatically approve a candidate or proceed beyond UI-F01",
      "A second Agent reasoning, review or approval workflow",
      "Claim Apple craft parity or framework benefit from screenshots",
      "Commit, push, PR, merge, publish or spawn subagents",
      "Native runtime and receiver proof from Gallery"
    ]
  },
  "tasks": [
    {"id": "UI-F01", "workstreamId": "UI", "path": "tasks/UI-F01.md", "dependsOn": []},
    {"id": "UI-F02", "workstreamId": "UI", "path": "tasks/UI-F02.md", "dependsOn": ["UI-F01"]},
    {"id": "UI-F03", "workstreamId": "UI", "path": "tasks/UI-F03.md", "dependsOn": ["UI-F02"]},
    {"id": "UI-F04", "workstreamId": "UI", "path": "tasks/UI-F04.md", "dependsOn": ["UI-F03"]},
    {"id": "UI-F05", "workstreamId": "UI", "path": "tasks/UI-F05.md", "dependsOn": ["UI-F04"]},
    {"id": "UI-F06", "workstreamId": "UI", "path": "tasks/UI-F06.md", "dependsOn": ["UI-F02"]},
    {"id": "UI-F07", "workstreamId": "UI", "path": "tasks/UI-F07.md", "dependsOn": ["UI-F03", "UI-F04", "UI-F05", "UI-F06"]}
  ],
  "outcomeComparison": {"path": "outcome-comparison.md"},
  "authorization": {
    "checkpoint": {"localCommit": "denied", "amend": "denied"},
    "delivery": {"push": "denied", "pullRequest": "denied"},
    "runtime": {"deployProfiles": [], "destructiveResetScopes": []},
    "history": {"rewrite": "denied"}
  }
}
```

## Acceptance Execution

```json
{
  "closures": {
    "ui-foundation-candidates": [],
    "ui-foundation-baseline": [],
    "ui-basic-specimens": [],
    "ui-advanced-specimens": [],
    "ui-interaction-grammar": [],
    "ui-agent-discovery": [],
    "ui-framework-outcome": []
  },
  "completion": [],
  "full": []
}
```

## Dependencies And Proof Boundaries

UI-F01 在 Frontend Eles 展示 Agent Groups 的三个有界样本：成员选择、
输入与动作、协作组预览。名称/描述/编排方式来自现有产品字段，身份与专长
来自现有 Agent 原型；摘要计数跟随成员和示例讨论，所有动作只作用于本地样本。
身份图形是相同 Agent 标记的代码材质表达；关系区域由当前成员和编排方式派生，
不表示实际运行或完成状态。材质数值仍由 UI token Owner 的显式 draft 候选管理。
只迁移参考的表达原则，不导入地图、外部业务域、第三方品牌和业务模型。
保留六维基础拆解和130项目录；视觉与产品页面替换均需逐项认可。
UI-F02 仅将明确认可的基础形成 UI Identity/Grammar 的基准。
UI-F03 逐批做基础组件；UI-F04 逐批做高级与业务组合；
UI-F05 最后展开动作、状态、恢复及动效。每批未确认不进入下一批。
UI-F06 消费已确认基准，将样本/使用与禁用合同接入既有 Agent Skill，
允许查询 draft，但必须返回 draft 与 allowed-use 限制。
UI-F07 通过既有 EDX/CER 的独立、冻结 Oracle 比较设计选择、评审和执行效果。

本 frozen 版本仅绑定 source/functional 检查，Acceptance closure 明确为空。
UI-F01 可用真实浏览器检查与目视证据证明展示范围；后续正式 Gate 在对应
Owner 绑定完整入口、独立审核与当前证据并修订 Plan 前为 UNPROVEN。构建和图库不能证明审美品质、
Agent 收益、生产替换或原生产品行为。

运行时使用既有 Portal，单次验证有预算与清理预留；结果、截图、Task 进度
在 machine-local Evidence Store，不写入 Task Slice 或增加第二套 active 状态文件。
原冻结包完整保留于 archive，不参与当前发现。
