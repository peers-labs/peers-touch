# Actor Feed Log：执行前后效果对比

> **Plan**: `AFL-20261106`
> **Version**: `20261107-actor-owned-moments-r5`
> **用途**: 实施前确认预期效果，实施后按当前源码核对 Journey、零遗留与跨站证据
> **当前阶段**: Rust 内核、Go 后端、Desktop 签名事件消费/公开编辑及 Mobile Moments active 契约已实施；客户端源码检查通过。公开编辑原型保存/取消与来源焦点已观察，双站公开搜索及 tombstone 已编排。双站 Native 尚未实跑；故障、Mobile Search 公开种子和完整原型产品化仍有缺口，完整产品效果保持 UNPROVEN。
> **v2 延期标准**：原 O03（多设备）、O05（密文子链）、O11（checkpoint 时钟序）、O12（私链元数据隔离）、O16（助记词回灌）移出 v1 合同，随 AFL-04/05B/07/07B 在 v2 重新冻结。

## Outcome Comparison Contract

```json
{
  "kind": "peers-touch-outcome-comparison-contract",
  "schemaVersion": 1,
  "planId": "AFL-20261106",
  "plannedSectionDigest": "sha256:757f90dff17d1991e89b7198c4840f4ea9eec998610499e0f5acd05d2e788ee9",
  "criteria": [
    { "id": "AFL-O01", "dimension": "user-experience", "title": "Desktop 呈现钉版 glass 原型的动态/圈友产品形态，全用 peers-ui", "taskIds": ["AFL-08A", "AFL-08B", "AFL-08C"], "gateIds": [] },
    { "id": "AFL-O02", "dimension": "user-experience", "title": "公开对象（发帖/编辑/tombstone/reaction/comment/受众公开帖/搜索/跨站浏览）端到端可用；非公开受众 v1 分流在役 E2EE 网关", "taskIds": ["AFL-03B", "AFL-08B", "AFL-08C"], "gateIds": [] },
    { "id": "AFL-O04", "dimension": "product-capability", "title": "公开内容经帧总线跨站同步（通知+拉取补齐），非关注者互动可入线程", "taskIds": ["AFL-05", "AFL-06"], "gateIds": [] },
    { "id": "AFL-O06", "dimension": "product-capability", "title": "clean cut：未升级端（含 Mobile 公开发帖）typed 拒绝，在役验收契约不断红；第二设备公开写 v1 typed 拒绝", "taskIds": ["AFL-03B"], "gateIds": [] },
    { "id": "AFL-O07", "dimension": "architecture", "title": "公开对象唯一权威是设备签名日志，公开 CRUD 全部为可重建投影", "taskIds": ["AFL-02", "AFL-03A", "AFL-03B"], "gateIds": [] },
    { "id": "AFL-O08", "dimension": "architecture", "title": "治理链与朋友圈链共享无业务类型 signed-log 内核但不共享链", "taskIds": ["AFL-01"], "gateIds": [] },
    { "id": "AFL-O09", "dimension": "architecture", "title": "跨站复用在役 /federation/delivery 帧总线；Relay 不参与复制决策、不见明文", "taskIds": ["AFL-05", "AFL-06"], "gateIds": [] },
    { "id": "AFL-O10", "dimension": "technology", "title": "proto-first；canonical 编码流派完成裁决，三端验签一致", "taskIds": ["AFL-01", "AFL-02"], "gateIds": [] },
    { "id": "AFL-O13", "dimension": "quality-operations", "title": "v1 五类 Journey 全部 FUNCTIONAL_PROOF（篡改/跨站/硬切/线程/在役私密不回归），性能先测基线", "taskIds": ["AFL-09"], "gateIds": [] },
    { "id": "AFL-O14", "dimension": "quality-operations", "title": "公开旧直写零遗留；在役 E2EE 私密管线零回归；回滚=revert", "taskIds": ["AFL-03B", "AFL-09"], "gateIds": [] },
    { "id": "AFL-O15", "dimension": "quality-operations", "title": "产品零临时 UI 组件，原型版本钉死，缺件全部沉淀进 peers-ui，假人数据不进产品", "taskIds": ["AFL-08A", "AFL-08B"], "gateIds": [] }
  ]
}
```

## Planned Outcome Comparison

### AFL-O01: Desktop 呈现钉版 glass 原型，全用 peers-ui

基线：Moments 为既有功能型页面，与新原型不一致。目标：按钉版 `packages/prototypes/shared/ui-system/moments/`（DesignDirections「松绿 · 北极星」glass 皮肤，动态/圈友两范围，含 IdentityCard 与七个复合件差距处置）产品化，组件全部来自 peers-ui。不变项：其他模块。

### AFL-O02: 公开对象操作在 Desktop 端到端可用，非公开受众走在役 E2EE

基线：删除是 Station 软删，**编辑当前不存在**（UpdatePostRequest 有 proto 无路由，POST_UPDATED 是新能力）；公开内容无跨站；非公开受众 W11 后只走 E2EE prepare/submit。目标：公开帖/编辑/tombstone/reaction/comment/搜索/跨站浏览走设备签名事件链；composer 对非公开受众分流到在役私密网关，v1 不换其权威。

### AFL-O04: 公开内容经帧总线跨站同步且非关注者互动可达

基线：公开动态仅本站持久化，无公开 PayloadKind；域中立帧总线在役（15 类报文）。目标：新增公开 feed 通知/互动 PayloadKind + receiver，outbox 按 follow∩Audience 扇出，缺口经有界拉取 peer route 补齐；入站互动经同一总线路由进帖主线程。

### AFL-O06: clean cut 且验收契约不断红

基线：无存量用户（决策），但 mobile-moments-participation 是 active 契约含 publish 断言。目标：旧公开写 typed 拒绝（含 v1 第二台设备）；同提交缩窄/暂停 mobile publish 断言并新增 reject 断言，无必挂 gate；在役私密 gate 不受影响。

### AFL-O07: 公开日志唯一权威，公开 CRUD 为投影

基线：social_public_posts 是 Station 权威当前态。目标：公开对象由设备签名链追加、projector 重放，表可重建；实时 SSE 桥在 live apply 触发、rebuild 不重放。

### AFL-O08: 共享 signed-log 内核但不共享链

基线：哈希/验签绑定 federation pb、内聚在 federation domain。目标：内核只收 canonical bytes；author-ordered 为新增策略；治理链消费内核且等价回归。

### AFL-O09: 帧总线复用与 Relay opaque

基线：跨站投递只有域中立帧总线（在役）与私密专用 receiver；公开无种类。目标：公开通知/互动只新增 PayloadKind/receiver 与一个拉取 route，零新投递设施；Relay 路径抓包不见明文、不含复制目标决策。

### AFL-O10: proto-first 与 canonical 一致性

基线：deterministic-marshal 与 securecontent 手写 protowire 两套传统并存。目标：AFL-01 产出统一或域分隔裁决并落文档，Rust 侧验签落点明确，三端一致。

### AFL-O13: v1 Journey 全可证伪

基线：能力只有局部 Journey。目标：篡改/跨站（通知+拉取+Relay opaque）/硬切拒收（含 Mobile 与第二设备）/线程发现/在役私密不回归五类 FUNCTIONAL_PROOF，性能先测基线。多设备、密文隔离、助记词回灌随 v2 证明。

### AFL-O14: 公开零遗留、私密零回归与回滚

基线：公开直写仓储、死结构体、TS/Rust 旧调用存在；私密直写在役。目标：公开在 03B cut 同批删除（GORM 感知机械判据）；在役 E2EE prepare/submit、跨站私密投递、撤回与 native private gates 零变化（密文写路径替换是 v2 事项）；回滚=revert。

### AFL-O15: 零临时组件与原型钉版

基线：原型与 show HEAD 已分叉，缺件清单偏小。目标：开工前以 commit hash 钉死单一原型源；MomentCard/AuthorCard/IdentityCard/七复合件全部有去向；假人数据不进产品。

**明确风险**：

- 公开 tombstone 不可真正收回，是已批准信用承诺，需产品文案告知。
- Mobile Moments 公开发帖在其 UI 计划前 typed 拒绝（无用户，可接受）；Mobile 私密不受影响。
- v1 单设备：第二台设备公开写 typed 拒绝，多设备合流是 v2 能力。
- 投影重放性能必须在真实数据量下验证；不达标只允许缓存优化，不恢复第二权威。
- 零副本毁站在 v1 物理丢失；助记词回灌恢复随 v2。

## Actual Outcome Results

> 以下记录实际源码效果；只有对应 Task doneWhen 与产品 Journey 同时满足才能核销完整标准。源码门禁日志见 [研发说明](../../actor-owned-moments-development.md#当前验证边界)，不能替代产品证据。

```json outcome-comparison-results
{
  "kind": "peers-touch-outcome-comparison-results",
  "schemaVersion": 1,
  "planId": "AFL-20261106",
  "sourceIdentity": null,
  "items": [
    {
      "id": "AFL-O01",
      "status": "UNPROVEN",
      "actualEffect": "Desktop 已共用 peers-ui 卡片、身份、媒体、评论、范围、排序、发布器和圈友展示；原型保存/取消、来源焦点与窄布局已观察。Circle 完整分页、取消草稿及原签名拉黑命令已接入；Social Runtime 负责完整拉黑名单和关系同步。",
      "evidenceRefs": [],
      "deviation": "尚需 AFL-08 产品接入与界面验收。"
    },
    {
      "id": "AFL-O02",
      "status": "UNPROVEN",
      "actualEffect": "Go 签名事件提交、公开投影及 Rust prepare/submit/status/read 已实施；Desktop 公开发布、编辑、删除标记、评论、反应、列表与详情经签名事件消费，私密受众仍分流在役 E2EE；接收站公开搜索与 tombstone 清除已编排。",
      "evidenceRefs": [],
      "deviation": "公开全操作、搜索与私密分流的 Native Journey 未运行。"
    },
    {
      "id": "AFL-O04",
      "status": "UNPROVEN",
      "actualEffect": "通知、订阅 revision、周期补拉、非关注者互动、历史线程分页和 ACK 后送达状态已实施；双站晚关注、非关注者互动和重启读取 Native 套件已编排并完成只读 preparation。",
      "evidenceRefs": [],
      "deviation": "未取得通知丢失、晚关注和非关注者线程的双站接收者可见证据。"
    },
    {
      "id": "AFL-O06",
      "status": "UNPROVEN",
      "actualEffect": "旧公开入口与无签名内部互动 typed 拒绝；固定根签 writer grant 限制单设备写入。Mobile composer 持久化草稿后拒绝公开发布，gateway 阻止旧请求；iOS/Android Moments active 种子转为 CUSTOM_ALLOW 私密流程并加入公开拒绝 oracle。",
      "evidenceRefs": [],
      "deviation": "Mobile Moments Native 拒绝与私密回归未实跑；Mobile Search 仍需 Runtime Owner 提供 Desktop 签名公开作者夹具，第二设备拒绝 Native 未运行。"
    },
    {
      "id": "AFL-O07",
      "status": "UNPROVEN",
      "actualEffect": "根签授权、设备签名链、原子追加与投影、fork 隔离、Rust journal 和原始事件缓存已实施；Desktop 从已验证字节重放正文并逐字段拒绝篡改的普通投影。",
      "evidenceRefs": [],
      "deviation": "Desktop 正文篡改源码变异检出并恢复通过；Native 产品篡改拒绝尚未运行。"
    },
    {
      "id": "AFL-O08",
      "status": "UNPROVEN",
      "actualEffect": "Frame signedlog 提供 canonical 字节、哈希和 Ed25519 原语；Social 与治理链保留独立策略和原有治理 wire，Go 回归通过。",
      "evidenceRefs": [],
      "deviation": "保留完整标准的源绑定交付审计，尚未核销 Task。"
    },
    {
      "id": "AFL-O09",
      "status": "UNPROVEN",
      "actualEffect": "公开通知、互动与订阅复用 delivery PayloadKind 16/17/18；仅补拉新增 peer read route。",
      "evidenceRefs": [],
      "deviation": "Relay 路径的当前源码双站抓包与产品观察未运行。"
    },
    {
      "id": "AFL-O10",
      "status": "UNPROVEN",
      "actualEffect": "Feed proto、Go/Rust 验签与固定跨语言向量已实现；Desktop 通过生成 TS 绑定消费 Native 验签字节，两端 TypeScript 检查通过。",
      "evidenceRefs": [],
      "deviation": "Mobile 不提供公开签名写入；三端产品验签一致性尚未证明。"
    },
    {
      "id": "AFL-O13",
      "status": "UNPROVEN",
      "actualEffect": "Desktop 34 项、Mobile 27 项与移动验收脚本 62 项源码检查通过；两端 TypeScript 通过。凭据冲突、过早送达、正文匹配和 Mobile 拒绝码的受控变异均被检出并恢复。",
      "evidenceRefs": [],
      "deviation": "AFL-J01..04 双站 Native Journey 与实际性能基线均未运行；全仓结构验证存在任务外 agent-memory-system 失效路径注册。"
    },
    {
      "id": "AFL-O14",
      "status": "UNPROVEN",
      "actualEffect": "生产旧 Moment Create/Delete 和 PublicPostRepository Create/Delete 已移除；公开生命周期测试通过签名 projector 夹具执行，Go 私密相关回归通过；Desktop 公开写入改走 Native 签名链，Mobile 旧公开发布请求在客户端被拒绝。",
      "evidenceRefs": [],
      "deviation": "未执行私密 Native 回归；Mobile Search 旧公开种子和完整 clean cut Native 验收尚未闭合。"
    },
    {
      "id": "AFL-O15",
      "status": "UNPROVEN",
      "actualEffect": "发布器、受众、圈友、卡片、名片、媒体、评论、范围和排序展示均消费共享 peers-ui，旧 app 展示路径已删除；取消草稿、长文案和窄布局原型场景已观察。Circle 与拉黑仍由原始数据/命令/Runtime Owner 接入，测试夹具只留在原型和测试。",
      "evidenceRefs": [],
      "deviation": "peers-ui 与钉版原型一致性由 AFL-08 产品 Owner 验证。"
    }
  ]
}
```
