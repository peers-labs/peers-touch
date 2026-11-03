# Peers UI — Agent UI/UX 效果比较

## Outcome Comparison Contract

```json
{
  "kind": "peers-touch-outcome-comparison-contract",
  "schemaVersion": 1,
  "planId": "UI-20261028",
  "plannedSectionDigest": "sha256:bcbcc959a2969cc83f024e47d0245fd128336c47e85d13f5f15b871bcf01b40a",
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

- Before: 独立元素板无法表达内容附着与共享上下文，用户尚未认可视觉方向。
- Target: 一张共享任务画布，内容选择、附着摘要、输入与参与者协同；保留方圆骨架和目录。
- Expected effect: 用户能观察资料、成果与讨论的明确关系和视觉节奏，并逐项反馈；认可及选型效果需真实任务证据。
- Risk: 附着图层可能遮挡内容或在窄屏失去归属；概念图不能当作真实业务数据，作者不能自行批准视觉。
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
- Target: UI数值Owner保存显式draft表达候选；复用Button/TextArea/Avatar/Icon；一份本地内容数据驱动选择、图形、摘要、草稿与讨论。
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
    {"id": "UI-UX", "status": "UNPROVEN", "actualEffect": "共享画布可看可点，内容、观察、摘要与讨论关系经浏览验证；用户尚未认可。", "evidenceRefs": ["/tmp/peers-content-canvas-evidence-20261029/result.json"], "deviation": "视觉方向与选型收益仍为draft。"},
    {"id": "UI-PRODUCT", "status": "UNPROVEN", "actualEffect": "三份示例资料、SVG概念草图、附着摘要与本地讨论可操作；130目录保留。", "evidenceRefs": ["/tmp/peers-content-canvas-evidence-20261029/result.json"], "deviation": "实际业务runtime与后续组件阶段未展开；生成摄影接口无可用认证，本轮使用代码概念成果。"},
    {"id": "UI-ARCH", "status": "UNPROVEN", "actualEffect": "研究和样本继续归属UI-F01，同一计划修订已校验；Agent消费尚未执行。", "evidenceRefs": ["/tmp/peers-content-canvas-plan.json"], "deviation": "集成文档不证明框架收益。"},
    {"id": "UI-TECH", "status": "UNPROVEN", "actualEffect": "公共控件与局部候选、8px输入/观察控制、主题隔离、源码检查与构建通过。", "evidenceRefs": ["/tmp/peers-content-canvas-evidence-20261029/result.json", "/tmp/peers-content-canvas-build.log"], "deviation": "维护和实际使用效果尚未测量。"},
    {"id": "UI-QUALITY", "status": "UNPROVEN", "actualEffect": "89项浏览检查、13张已打开截图与当前样本源码摘要已采集。", "evidenceRefs": ["/tmp/peers-content-canvas-evidence-20261029/result.json"], "deviation": "EDX独立准入、审美品质和CER收益均未证明。"}
  ]
}
```
