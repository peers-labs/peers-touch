# Peers UI — Agent UI/UX 效果比较

## Outcome Comparison Contract

```json
{
  "kind": "peers-touch-outcome-comparison-contract",
  "schemaVersion": 1,
  "planId": "UI-20261028",
  "plannedSectionDigest": "sha256:ce005f05759f7374c8828e56683b9c366b39f59adca44e743cde79b0f46cc27f",
  "criteria": [
    {"id": "UI-UX", "dimension": "user-experience", "title": "可读、可比较、逐项确认",
     "taskIds": ["UI-F01", "UI-F02", "UI-F03", "UI-F04", "UI-F05", "UI-F06", "UI-F07"],
     "gateIds": []},
    {"id": "UI-PRODUCT", "dimension": "product-capability", "title": "完整目录成为有界的设计依据",
     "taskIds": ["UI-F01", "UI-F02", "UI-F03", "UI-F04", "UI-F05", "UI-F06", "UI-F07"],
     "gateIds": []},
    {"id": "UI-ARCH", "dimension": "architecture", "title": "UI基准进入既有EDX控制面",
     "taskIds": ["UI-F01", "UI-F02", "UI-F03", "UI-F04", "UI-F05", "UI-F06", "UI-F07"],
     "gateIds": []},
    {"id": "UI-TECH", "dimension": "technology", "title": "一份候选数据与同内容renderer",
     "taskIds": ["UI-F01", "UI-F02", "UI-F03", "UI-F04", "UI-F05", "UI-F06", "UI-F07"],
     "gateIds": []},
    {"id": "UI-QUALITY", "dimension": "quality-operations", "title": "按来源和强度记录可证伪效果",
     "taskIds": ["UI-F01", "UI-F02", "UI-F03", "UI-F04", "UI-F05", "UI-F06", "UI-F07"],
     "gateIds": []}
  ]
}
```

## Planned Outcome Comparison

### UI-UX: 可读、可比较、逐项确认

- Before: 用户尚未认可视觉方向，参考表达还没有落到自己的 Agent 内容。
- Target: Agent Groups 成员选择、输入与动作、协作组预览；借鉴参考的排版/明暗/选中/对象关系，保留方圆。
- Expected effect: 用户能直接判断参考风格在实际 Agent 元素上的效果，并逐项反馈；认可及选型效果需真实任务证据。
- Risk: 借鉴可能退化为配色变化或内容复刻；技术操作检查不能代替视觉判断。
- Unchanged: 业务状态和消费者；当前只制作基础探索。

### UI-PRODUCT: 完整目录成为有界的设计依据

- Before: 全量目录存在，但外观接受状态与框架可用依据尚未闭合。
- Target: 每项能找到用途、合法组合、禁用模式、样本及明确确认范围。
- Expected effect: Agent在选型、设计、评审、纠偏与执行中复用同一依据；按任务测量误用和遗漏。
- Risk: 目录存在不等于能力已实现，未制作与未确认项必须显式返回缺口。
- Unchanged: 130项纯语义目录，业务projection/action与资源Owner。

### UI-ARCH: UI基准进入既有EDX控制面

- Before: EDX已拥有推理、Grammar与CER，UI-D04已规定目录和证据分离。
- Target: UI System作为基准输入，确认结果进入UI Identity；既有Skills与EDX消费。
- Expected effect: 同一来源贯通选择、评审、纠偏；减少跨层漂移，由源码链及独立任务证据验证。
- Risk: 私有候选库或平行审批会形成第二真源。
- Unchanged: EDX推理/ReviewResult/CER与原审批权限；不另建框架。

### UI-TECH: 一份候选数据与同内容renderer

- Before: 旧基础样本直接消费当前active token，无法在不迁移消费者时比较设计方向。
- Target: UI数值Owner保存显式draft表达候选；复用Button/TextField/TextArea/Avatar/Icon；一个本地协作组草稿驱动选择、输入、摘要和讨论。
- Expected effect: 保留组件语义和方圆几何，仅变更表达层；维护一份材质数值并可绑定精确摘要。
- Risk: 局部变量可能污染active主题；检查生产token不引用候选。
- Unchanged: 当前active token值和生产消费者；没有第三方高层UI兜底。

### UI-QUALITY: 按来源和强度记录可证伪效果

- Before: 旧浏览和构建结果只证明旧样本，不能继承成当前设计或框架收益。
- Target: 本轮真实截图/操作绑定当前源码；正式收益沿既有EDX/CER独立比较。
- Expected effect: 清楚区分已制作、已确认、技术证明与用户/Agent实际效果，避免虚假PASS。
- Risk: 作者自评、缺失独立审核、不同Oracle与过预算均可能削弱证据。
- Unchanged: 所有未执行范围UNPROVEN；无提交、发布、原生或接收端证明。

## Actual Outcome Results

```json outcome-comparison-results
{
  "kind": "peers-touch-outcome-comparison-results",
  "schemaVersion": 1,
  "planId": "UI-20261028",
  "sourceIdentity": null,
  "items": [
    {"id": "UI-UX", "status": "UNPROVEN", "actualEffect": "Agent 元素已呈现，输入、选择与预览同步；用户尚未认可。", "evidenceRefs": ["/tmp/peers-agent-style-evidence-20261029/result.json"], "deviation": "视觉方向仍待认可。"},
    {"id": "UI-PRODUCT", "status": "UNPROVEN", "actualEffect": "Agent Groups 字段和现有 Agent 身份支持三个有界样本；130目录保留。", "evidenceRefs": ["/tmp/peers-agent-style-evidence-20261029/result.json"], "deviation": "创建与讨论是本地示例；实际业务runtime和后继阶段未展开。"},
    {"id": "UI-ARCH", "status": "UNPROVEN", "actualEffect": "候选仍属于 UI-F01 / EDX 基准输入，同一计划体系内修订。", "evidenceRefs": ["/tmp/peers-agent-style-plan.json"], "deviation": "集成文档不证明框架收益。"},
    {"id": "UI-TECH", "status": "UNPROVEN", "actualEffect": "公共控件、方圆几何、派生计数、主题隔离、类型检查与构建通过。", "evidenceRefs": ["/tmp/peers-agent-style-evidence-20261029/result.json", "/tmp/peers-agent-style-build.log"], "deviation": "维护和实际使用效果尚未测量。"},
    {"id": "UI-QUALITY", "status": "UNPROVEN", "actualEffect": "37项浏览检查与7张已检视截图绑定当前样本源码。", "evidenceRefs": ["/tmp/peers-agent-style-evidence-20261029/result.json"], "deviation": "EDX独立准入、审美品质和CER收益均未证明。"}
  ]
}
```
