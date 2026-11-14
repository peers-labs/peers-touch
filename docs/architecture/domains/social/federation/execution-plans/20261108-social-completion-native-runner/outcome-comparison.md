# Social 能力闭合效果合同

> **Plan**: AFL-20261106
> **Version**: 20261108-social-completion-native-runner
> **Owner**: Social / Federation / Desktop / Mobile

原 AFL 计划区与其 `sha256:757f90dff17d1991e89b7198c4840f4ea9eec998610499e0f5acd05d2e788ee9`
不修改。本版本保留全部十一条 v1 标准，补充 IC-J01..04 与 IC-A01..06。
源码事实、原型观察、FUNCTIONAL_CHECK 和 ACCEPTANCE_PROOF 分开记录。

## Outcome Comparison Contract

```json
{
  "kind": "peers-touch-outcome-comparison-contract",
  "schemaVersion": 1,
  "planId": "AFL-20261106",
  "plannedSectionDigest": "sha256:5e8f3e7fb559cfd2598ef1bf20db3722e06cfc993c44cfc88c5db0f91247de80",
  "criteria": [
    {"id": "AFL-O01", "dimension": "user-experience", "title": "Desktop glass 动态/圈友形态与全 peers-ui", "taskIds": ["IC-01", "IC-02", "IC-03", "IC-05"], "gateIds": ["social-public-feed-native-e2e", "social-private-desktop-e2e"]},
    {"id": "AFL-O02", "dimension": "user-experience", "title": "公开完整操作与私密分流端到端可用", "taskIds": ["IC-01", "IC-02", "IC-03", "IC-05"], "gateIds": ["social-public-feed-native-e2e", "social-private-desktop-e2e"]},
    {"id": "AFL-O04", "dimension": "product-capability", "title": "跨站同步和非关注者互动进入线程", "taskIds": ["IC-01", "IC-02", "IC-05"], "gateIds": ["social-public-feed-source", "social-public-feed-native-e2e"]},
    {"id": "AFL-O06", "dimension": "product-capability", "title": "旧公开写与第二设备 typed 拒绝，Mobile 私密可用", "taskIds": ["IC-04", "IC-05"], "gateIds": ["social-public-feed-native-e2e", "mobile-simulator-moments-e2e", "mobile-native-moments-e2e"]},
    {"id": "AFL-O07", "dimension": "architecture", "title": "公开签名日志唯一权威，SQL 为投影", "taskIds": ["IC-01", "IC-02", "IC-05"], "gateIds": ["social-public-feed-source", "social-public-feed-native-e2e"]},
    {"id": "AFL-O08", "dimension": "architecture", "title": "共享 signed-log 原语，治理与社交不共享链", "taskIds": ["IC-05", "IC-06"], "gateIds": ["social-public-feed-source", "station-api-ownership"]},
    {"id": "AFL-O09", "dimension": "architecture", "title": "原 Delivery 复用和 Relay opaque", "taskIds": ["IC-01", "IC-02", "IC-03", "IC-05"], "gateIds": ["social-public-feed-source", "social-cross-station-interaction", "social-public-feed-native-e2e"]},
    {"id": "AFL-O10", "dimension": "technology", "title": "proto-first、canonical 与全部生成消费者一致", "taskIds": ["IC-01", "IC-02", "IC-03", "IC-04"], "gateIds": ["social-public-feed-source", "social-cross-station-interaction", "social-content-search-contract", "social-content-search-mobile-native-e2e"]},
    {"id": "AFL-O13", "dimension": "quality-operations", "title": "全范围真实 Journey、可比性能与完整清理", "taskIds": ["IC-04", "IC-05", "IC-06"], "gateIds": ["social-public-feed-native-e2e", "social-private-desktop-e2e", "social-content-search-mobile-native-e2e"]},
    {"id": "AFL-O14", "dimension": "quality-operations", "title": "公开零遗留、私密零回归与回滚", "taskIds": ["IC-01", "IC-02", "IC-03", "IC-04", "IC-05", "IC-06"], "gateIds": ["social-public-feed-source", "social-private-desktop-e2e", "mobile-simulator-moments-e2e", "mobile-native-moments-e2e", "station-api-ownership"]},
    {"id": "AFL-O15", "dimension": "quality-operations", "title": "原型钉版、零临时 UI、零产品假数据", "taskIds": ["IC-01", "IC-02", "IC-03", "IC-05"], "gateIds": ["social-public-feed-source", "social-public-feed-native-e2e"]},
    {"id": "IC-O01", "dimension": "user-experience", "title": "评论点赞、单多选投票、提交与恢复状态真实可用", "taskIds": ["IC-01", "IC-02", "IC-03"], "gateIds": ["social-public-feed-native-e2e", "social-private-desktop-e2e"]},
    {"id": "IC-O02", "dimension": "architecture", "title": "作者站截止接纳、原权限 Owner 与 Native 双重验证", "taskIds": ["IC-01", "IC-02", "IC-03"], "gateIds": ["social-public-feed-source", "social-cross-station-interaction", "social-public-feed-native-e2e", "social-private-desktop-e2e"]},
    {"id": "IC-O03", "dimension": "product-capability", "title": "Mobile Search 从预备 Desktop 签名作者取得真实公开种子", "taskIds": ["IC-04"], "gateIds": ["social-content-search-contract", "social-content-search-mobile-native-e2e"]},
    {"id": "IC-O04", "dimension": "quality-operations", "title": "Hook 只读路由、非空验收映射和证据强度可靠", "taskIds": ["IC-06"], "gateIds": ["social-public-feed-source", "station-api-ownership"]}
  ]
}
```

## Planned Outcome Comparison

### AFL-O01: glass 形态和 peers-ui

基线：共享展示组件、Circle 完整分页与取消草稿已在源码，原型场景已观察，产品未证明。
目标：钉版 show `2e7bcc9e19a8f7e2df52e45b965df60f27bf0262` 的动态/圈友形态
与 Desktop 完整接入，所有产品组件归 peers-ui；新增评论/投票同源复用，零产品假人。
效应：布局、焦点、取消、pending/error 和长期列表生命周期一致。无关模块保持原 Owner。

### AFL-O15: 原型与产品复用

基线与目标继承 AFL-O01。额外验证产品零临时 UI、原型钉版和测试假人不进产品，
新增交互展示共用 peers-ui，功能 Scene 的观察与 Native 产品证明分别记录。

### AFL-O02: 完整交互

基线：公开帖子/编辑/删除/评论/反应签名路径已在源码；评论点赞缺目标，投票未执行。
目标：完整公开操作和私密分流，加根评论/回复点赞取消、单选/多选完整选票提交与替换。
效应：跨站、重启和回读状态一致；未知提交保留精确字节，迟到 epoch 回调不污染当前账号。

### IC-O01: 评论点赞和投票

基线与目标继承 AFL-O02；按 IC-A01/A02 独立证伪根评论/回复点赞取消、
单选/多选、替换、重复提交、invalid/deadline 与恢复状态，防止展示当成交互。

### AFL-O04: 跨站同步

基线：通知、订阅 revision、周期补拉、线程分页和 ACK 状态已在源码，双站未实跑。
目标：原 Delivery 承载全部交互，晚关注、非关注者、丢通知、撤订、Relay opaque 实证。
效应：原有界 Store/Fanout/Delivery 闭合，无第二网络栈或交互服务；回执不承诺汇总完整。

### AFL-O09: 原 Delivery 与 Relay opaque

基线与目标继承 AFL-O04。明确核验通知/互动/订阅均复用原 Delivery，
抓取实际 Relay 路径 opaque 传输证据，不能仅用本机直连源码测试代替。

### AFL-O06: Mobile 硬切边界

基线：Mobile 公开拒绝与私密 Moments 种子已在源码；Search 仍调用被拒绝的公开旧写。
目标：原 Suite 准备期一次性组合真实 Desktop 作者、两平台和22条历史评论；Search
打开历史锚/返回/删除清除，继续公开写拒绝、私密、outage/block/撤销和账号隔离证明。
效应：既有 Mobile 消费能力可用；AD-08 第二设备和 Mobile 公开写仍 typed 拒绝。

### IC-O03: Mobile Search

基线与目标继承 AFL-O06。作者、22条历史评论、两个平台全部在 prepare 建立，
原 Search Suite 证明历史锚/返回/删除清除与账号、权限和 outage 生命周期。

### AFL-O07: 公开权威与信任

基线：Actor 根签、固定设备链、SQL 重放、Native journal/head 已在源码；新选票尚无准入。
目标：公开对象只有原签名日志权威，治理只复用字节原语；作者 Home Station 原事务
产生截止接纳回执，Native 验 Actor 选票和独立可信站签名；私密保留原权限/opaque 路径。
效应：伪造目标、旧序号、错定义、已截止、错误回执/计数拒绝。站时钟/遗漏/停机
仍为显式边界；不承诺匿名公开投票、零副本恢复或此前未见尾部完整。

### AFL-O08: 共享原语与独立链

基线与目标继承 AFL-O07；审查 Frame signedlog 的 byte-only 原语、
Social 领域准入与治理原 wire/ordering 不变，并保留等价回归证据。

### IC-O02: 作者站接纳与私密权限

基线与目标继承 AFL-O07；回执独立绑定事件哈希、定义哈希和作者站接受时间，
Native 不信站计数。私密 target/opaque ballot 留在原权限事务，撤销/block/删除拒绝。

### AFL-O10: 协议与消费者

基线：Feed 跨语言向量和 Go/Rust 验签已有；评论反应和 poll 的新字段尚未完整迁移。
目标：proto-first 更新全部 Go/Rust/TS/Mobile 消费者，目标/定义纳入 canonical、签名与去重。
效应：各端拒绝同类篡改；Mobile 的公开消费与拒绝证明不能解释成公开写能力。

### AFL-O13: 质量与性能

基线：源码检查与原型观察不能证明 Native；旧 Hook 越界写已修复，原 Plan Gate 映射全空。
目标：实际丢 ACK/通知、撤订、第二 writer、body/head 篡改与私密回归在原 Suite；
Circle>20/save/cancel/failure/block/epoch，提交到绘制延迟/回读次数/有界分页/重试和清理。
效应：当前源码证据逐项核销，旧直写/假动作/平行路径零遗留，本地 checkpoint 可追踪；
Hook 真回调与非空 Gate crosswalk 防止未执行误判完成。全仓任务外缺口明确报告。

### AFL-O14: 零遗留与回归

基线与目标继承 AFL-O13；树级检查公开旧直写、假动作、孤儿导出和未迁移消费者，
同源私密全生命周期回归，保留回滚为完整 cut revert 与任务资源清理证明。

### IC-O04: 可靠流程

基线与目标继承 AFL-O13；当前 Hook 源码回归和实际事件回调均为只读路由，
每个 closure/outcome 映射实际 Gate，证据缺失不核销，结构通过不替代真实执行。

## Actual Outcome Results

```json outcome-comparison-results
{
  "kind": "peers-touch-outcome-comparison-results", "schemaVersion": 1,
  "planId": "AFL-20261106", "sourceIdentity": null,
  "items": [
    {"id": "AFL-O01", "status": "UNPROVEN", "actualEffect": "待当前源码产品证明", "evidenceRefs": [], "deviation": "未核销"},
    {"id": "AFL-O02", "status": "UNPROVEN", "actualEffect": "待当前源码产品证明", "evidenceRefs": [], "deviation": "未核销"},
    {"id": "AFL-O04", "status": "UNPROVEN", "actualEffect": "待当前源码双站证明", "evidenceRefs": [], "deviation": "未核销"},
    {"id": "AFL-O06", "status": "UNPROVEN", "actualEffect": "待当前源码硬切与私密证明", "evidenceRefs": [], "deviation": "未核销"},
    {"id": "AFL-O07", "status": "UNPROVEN", "actualEffect": "待当前源码权威证明", "evidenceRefs": [], "deviation": "未核销"},
    {"id": "AFL-O08", "status": "UNPROVEN", "actualEffect": "待当前源码原语/治理审计", "evidenceRefs": [], "deviation": "未核销"},
    {"id": "AFL-O09", "status": "UNPROVEN", "actualEffect": "待当前源码 Delivery/Relay 证明", "evidenceRefs": [], "deviation": "未核销"},
    {"id": "AFL-O10", "status": "UNPROVEN", "actualEffect": "待全部生成消费者检查", "evidenceRefs": [], "deviation": "未核销"},
    {"id": "AFL-O13", "status": "UNPROVEN", "actualEffect": "待全范围 Journey 与性能证明", "evidenceRefs": [], "deviation": "未核销"},
    {"id": "AFL-O14", "status": "UNPROVEN", "actualEffect": "待零遗留/回归/清理证明", "evidenceRefs": [], "deviation": "未核销"},
    {"id": "AFL-O15", "status": "UNPROVEN", "actualEffect": "待原型和产品一致性证明", "evidenceRefs": [], "deviation": "未核销"},
    {"id": "IC-O01", "status": "UNPROVEN", "actualEffect": "新交互实施中", "evidenceRefs": [], "deviation": "未核销"},
    {"id": "IC-O02", "status": "UNPROVEN", "actualEffect": "新交互实施中", "evidenceRefs": [], "deviation": "未核销"},
    {"id": "IC-O03", "status": "UNPROVEN", "actualEffect": "准备期组合待实施", "evidenceRefs": [], "deviation": "未核销"},
    {"id": "IC-O04", "status": "UNPROVEN", "actualEffect": "待当前源码流程审计", "evidenceRefs": [], "deviation": "未核销"}
  ]
}
```
