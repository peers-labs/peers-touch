# Profile 资源 ID 分配与共享效果对比

> **Owner**: Platform Team
> **Plan**: LDCP-RES-20261114

## Outcome Comparison Contract

```json
{
  "kind": "peers-touch-outcome-comparison-contract",
  "schemaVersion": 1,
  "planId": "LDCP-RES-20261114",
  "plannedSectionDigest": "sha256:556a5f52809bba92e91acb00b33ee597defe20c4854a2495ebd643b5a2215278",
  "criteria": [
    {"id": "RES-ID-O1", "dimension": "user-experience", "title": "用户分配和具体覆盖通知", "taskIds": ["RES-01", "RES-02", "RES-03"], "gateIds": ["profile-resource-overwrite-native-e2e"]},
    {"id": "RES-ID-O2", "dimension": "product-capability", "title": "Profile 内自由安排和 ID 共享", "taskIds": ["RES-01", "RES-03", "RES-04"], "gateIds": ["profile-resource-id-sharing-native-e2e"]},
    {"id": "RES-ID-O3", "dimension": "architecture", "title": "唯一 ID/assignment/content owner", "taskIds": ["RES-01", "RES-04"], "gateIds": ["machine-dev-registry-self", "profile-resource-id-sharing-native-e2e"]},
    {"id": "RES-ID-O4", "dimension": "technology", "title": "物理锁、具体 force、竞态和恢复", "taskIds": ["RES-02", "RES-04"], "gateIds": ["profile-resource-overwrite-native-e2e"]},
    {"id": "RES-ID-O5", "dimension": "quality-operations", "title": "共享资源保留和 current-source proof", "taskIds": ["RES-03", "RES-04", "RES-05"], "gateIds": ["machine-dev-registry-self", "profile-resource-id-sharing-native-e2e", "profile-resource-overwrite-native-e2e"]}
  ]
}
```

## Planned Outcome Comparison

### RES-ID-O1 用户分配和具体覆盖通知

基线（verified_fact）：启动器只持 slot lease，原设计候选以数量/角色组织设备；
用户明确指定每个 Profile 的分配及具体覆盖决定。
目标：用户选择 ID 集合，普通引用/读取不提示覆盖；冲突说明 ID、共享方、
内容/影响，用户选择 force/decline；拒绝/未响应不改动。
效果：用户掌握分配和覆盖，共享不变成默许替换。RES-01/02/03，overwrite Gate。
风险：锁前后影响变化需要新通知。无业务 UI 重设计，通知由开发入口/原 owner 承载。

### RES-ID-O2 Profile 内自由安排和 ID 共享

基线（verified_fact）：`mobile_simulator.py` 原 iOS 客户端各建独立设备；
launcher/Provisioner 缺统一 Profile-to-ID 引用关系。
目标：A 有 `[ios-a, ios-b]`、B 有 `[ios-b]` 时都看见 `ios-b` 的共享方与实际状态。
数量是输入/集合 cardinality，场景自由安排；不作为身份。
效果：Profile 独立安排且明确共用，无默认上限/固定角色。RES-01/03/04，sharing Gate。
共享实际内容可被已确认操作改变，不假定隔离副本；Android 不在初始证明范围。

### RES-ID-O3 唯一 ID/assignment/content owner

基线（verified_fact）：LDCP-D03 分开 env 和 machine allocation；machine-dev
当前仅 slot/Station 操作，resource assignments/content 未实现。
目标：machine assignment 是 reference set 真源，reverse view 派生；instance
唯一拥有 provider/content，全部 consumer 消费同一投影。
效果：去掉 consumer allocator/数量择机，共享 env 不存本机 UUID。
RES-01/04，owner self/sharing Gate。无新增服务、端口、task ledger/PlanMount；
序列化/API 是待实现交付项，概念模型不冒充已有 schema。

### RES-ID-O4 物理锁、具体 force、竞态和恢复

基线（verified_fact）：slot 不保护 UUID；fresh-device 策略回避 Keychain 残留，
缺共享 ID 的覆盖决定/锁后重验；memory cleanup 不足以恢复 create crash。
目标：冻结 exact effects，具体决定后物理锁下重验；变化重新通知；canonical
content/last writer 对所有 Profile 可见，preparation/failed state 可恢复。
效果：force 不绕锁、不默认，拒绝不写，Keychain/data effect 准确读回。
RES-02/04，overwrite Gate。风险：被动共享不保证隔离；partial failure 必须可见；
活跃进程停止须具体许可，不能从设计修订推导。

### RES-ID-O5 共享资源保留和 current-source proof

基线（verified_fact）：原 cleanup 关机/删除 per-run devices；Mobile Make 的
connect 检查后调用 Station deploy；新 resource Gate 不存在。
目标：detach/lease release 保留别人的引用/内容，physical delete 单独授权及
provider absence proof；native connect-only，全部 cut 后 current-source Gate 验证。
效果：一个 Profile/Suite 结束不破坏共享资源，引用/锁/进程/设备/目录结果分开。
RES-03/04/05，三个 Gate。历史设备不接管，four 手动验收维持；
不承诺释放磁盘空间，不新增真实 Profile 配置。

## Actual Outcome Results

只有架构与计划修订，运行效果均未证实。

## Outcome Comparison Results

```json
{
  "kind": "peers-touch-outcome-comparison-results",
  "schemaVersion": 1,
  "planId": "LDCP-RES-20261114",
  "sourceIdentity": null,
  "items": [
    {"id": "RES-ID-O1", "status": "UNPROVEN", "actualEffect": "运行代码未实现，无效果证据。", "evidenceRefs": [], "deviation": "仅完成用户指定的架构/计划修订。"},
    {"id": "RES-ID-O2", "status": "UNPROVEN", "actualEffect": "运行代码未实现，无效果证据。", "evidenceRefs": [], "deviation": "仅完成用户指定的架构/计划修订。"},
    {"id": "RES-ID-O3", "status": "UNPROVEN", "actualEffect": "运行代码未实现，无效果证据。", "evidenceRefs": [], "deviation": "仅完成用户指定的架构/计划修订。"},
    {"id": "RES-ID-O4", "status": "UNPROVEN", "actualEffect": "运行代码未实现，无效果证据。", "evidenceRefs": [], "deviation": "仅完成用户指定的架构/计划修订。"},
    {"id": "RES-ID-O5", "status": "UNPROVEN", "actualEffect": "运行代码未实现，无效果证据。", "evidenceRefs": [], "deviation": "仅完成用户指定的架构/计划修订。"}
  ]
}
```
