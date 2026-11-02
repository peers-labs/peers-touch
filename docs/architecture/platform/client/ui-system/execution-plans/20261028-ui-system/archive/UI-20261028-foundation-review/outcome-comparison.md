# Peers UI — Agent UI/UX 效果比较

## Outcome Comparison Contract

```json
{
  "kind": "peers-touch-outcome-comparison-contract",
  "schemaVersion": 1,
  "planId": "UI-20261028",
  "plannedSectionDigest": "sha256:5c5d5724b12f4cf39efaf310ee993bbe386832db206138caa38a01bb57944eb2",
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

- Before: Frontend Eles 有130项定义与20项旧外观；用户拒绝当前视觉，无认可基准。
- Target: 同内容三方向与六基础维度；基础、组件、交互逐项确认后推进。
- Expected effect: 降低比较时的内容干扰，支持稳定阅读与明确反馈；真实选型任务验证。
- Risk: 三方向可能只增加选择负担；没有独立任务证据就不声称改进。
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
- Target: UI数值Owner保存显式draft候选，Gallery仅在局部provider使用，同一renderer切换。
- Expected effect: 相同内容与语义隔离表达变量；维护一份候选数据并可绑定精确摘要。
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
    {"id": "UI-UX", "status": "UNPROVEN", "actualEffect": "已制作三方向/六维同内容候选；尚无用户确认或独立选型效果证据。", "evidenceRefs": ["/tmp/peers-foundation-review-20261028/result.json"], "deviation": "当前仅基础探索。"},
    {"id": "UI-PRODUCT", "status": "UNPROVEN", "actualEffect": "130项目录可达；组件样本与Agent完整可用依据尚未形成。", "evidenceRefs": ["/tmp/peers-foundation-review-20261028/result.json"], "deviation": "后续阶段待确认。"},
    {"id": "UI-ARCH", "status": "UNPROVEN", "actualEffect": "UI-F01及后续依赖已在同一UI计划关联EDX；实际Agent consumer尚未执行。", "evidenceRefs": ["/tmp/peers-foundation-plan-inspect.json"], "deviation": "集成文档和计划验证不证明框架收益。"},
    {"id": "UI-TECH", "status": "UNPROVEN", "actualEffect": "候选由UI数值Owner派生，同renderer与局部provider展示；类型、构建及主题隔离检查通过。", "evidenceRefs": ["/tmp/peers-foundation-review-20261028/result.json", "/tmp/peers-foundation-portal-build.log"], "deviation": "维护成本与完整使用效果尚未测量。"},
    {"id": "UI-QUALITY", "status": "UNPROVEN", "actualEffect": "当前展示有源码摘要、221项浏览断言和16张已检视截图；没有独立效果证据。", "evidenceRefs": ["/tmp/peers-foundation-review-20261028/result.json"], "deviation": "EDX独立准入和CER收益均未证明。"}
  ]
}
```
