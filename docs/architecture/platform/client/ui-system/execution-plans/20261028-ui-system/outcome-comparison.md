# Peers UI — Agent UI/UX 效果比较

## Outcome Comparison Contract

```json
{
  "kind": "peers-touch-outcome-comparison-contract",
  "schemaVersion": 1,
  "planId": "UI-20261028",
  "plannedSectionDigest": "sha256:57ec68e2234d426ffdccf076d6aa2dd955f603be83b9cec6827d11bbb47e0ffe",
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

- Before: 用户对当前Agent表达方向反馈“还不错”，指出控件边界不足；20项基础只有定义，未展开此版样本。
- Target: 修正公共动作和选择边界，一次展示20项基础组件的暖白/薄荷/灰青/琥珀材质表达，保留方圆；总览、单项、长文案与禁用样本可操作。
- Expected effect: 用户能直接判断参考风格在实际 Agent 元素上的效果，并逐项反馈；认可及选型效果需真实任务证据。
- Risk: 材质可能遮蔽主体、层次可能退化为装饰；技术操作检查不能代替视觉判断。
- Unchanged: 业务状态和消费者；方向反馈不替代逐项基准和组件确认。

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
- Target: UI数值Owner保存显式draft表达候选；Web Owner集中基础材质样式和动作/选择边界；20样本复用目录导出，不引入高级全集依赖。
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
    {"id": "UI-UX", "status": "UNPROVEN", "actualEffect": "20基础样本可在总览与单项查看；quiet hover和分段焦点边界已修正。", "evidenceRefs": ["/tmp/peers-basic-material-evidence-20261029/result.json"], "deviation": "方向获得正向反馈，各组件审美及使用效果仍待用户审阅。"},
    {"id": "UI-PRODUCT", "status": "UNPROVEN", "actualEffect": "20基础ID精确覆盖，标准/长文案/禁用与本地动作可操作，130目录保留。", "evidenceRefs": ["/tmp/peers-basic-material-evidence-20261029/result.json"], "deviation": "样本不代表全部变体或真实业务；高级、业务组合及后继阶段未展开。"},
    {"id": "UI-ARCH", "status": "UNPROVEN", "actualEffect": "同一计划UI-F01边界与UI-F03整批样本；材质和选择边界由公共UI Owner管理。", "evidenceRefs": ["/tmp/peers-basic-material-plan.json"], "deviation": "基准输入可审阅，不证明EDX框架收益或已接受Grammar。"},
    {"id": "UI-TECH", "status": "UNPROVEN", "actualEffect": "共享renderer、类型与Portal构建通过；菜单分支/Escape回焦点，outside保留用户选中的新焦点。", "evidenceRefs": ["/tmp/peers-basic-material-evidence-20261029/result.json", "/tmp/peers-basic-material-build.log"], "deviation": "维护效率、生产消费者和原生平台效果未测量。"},
    {"id": "UI-QUALITY", "status": "UNPROVEN", "actualEffect": "49项真实浏览检查与31张采集截图绑定当前基础样本源码；实际检视集合另记外部视觉结果。", "evidenceRefs": ["/tmp/peers-basic-material-evidence-20261029/result.json", "/tmp/peers-basic-material-evidence-20261029/visual-review.json"], "deviation": "EDX独立准入、完整Accessibility、审美品质和CER收益均未证明。"}
  ]
}
```
