# Device Login Approval：预期效果与验证

> **Plan**: DLA-20261112
> **Owner**: Identity and Access

## Outcome Comparison Contract

```json
{
  "kind": "peers-touch-outcome-comparison-contract",
  "schemaVersion": 1,
  "planId": "DLA-20261112",
  "plannedSectionDigest": "sha256:3e926b5420801f55f5d2132bcbadf05414358a88ec44812d1ec17329dadeb2d3",
  "criteria": [
    {"id": "DLA-O01", "dimension": "user-experience", "title": "登录卡等待审批与折叠兜底", "taskIds": ["DLA-04", "DLA-06"], "gateIds": []},
    {"id": "DLA-O02", "dimension": "user-experience", "title": "审批全局弹窗与 chat 恢复门禁移除", "taskIds": ["DLA-04", "DLA-06", "DLA-07"], "gateIds": ["dla-chat-recovery-gate-removed-e2e"]},
    {"id": "DLA-O03", "dimension": "product-capability", "title": "全对称设备审批登录与多设备会话并存", "taskIds": ["DLA-01", "DLA-02", "DLA-03", "DLA-04", "DLA-05", "DLA-06", "DLA-07"], "gateIds": ["dla-approval-cross-device-native-e2e"]},
    {"id": "DLA-O04", "dimension": "architecture", "title": "独立审批事务 owner 与既有真源复用", "taskIds": ["DLA-01", "DLA-02", "DLA-03", "DLA-05"], "gateIds": []},
    {"id": "DLA-O05", "dimension": "technology", "title": "无会话持票面、HPKE 交付与 CAS/TTL/限流", "taskIds": ["DLA-01", "DLA-02", "DLA-03", "DLA-05"], "gateIds": ["dla-approval-failure-semantics-native-e2e"]},
    {"id": "DLA-O06", "dimension": "quality-operations", "title": "原生证据、治理登记与可回滚切换", "taskIds": ["DLA-04", "DLA-06", "DLA-07"], "gateIds": ["dla-approval-cross-device-native-e2e", "dla-approval-failure-semantics-native-e2e", "dla-chat-recovery-gate-removed-e2e"]}
  ]
}
```

## Planned Outcome Comparison

### DLA-O01：登录卡等待审批与折叠兜底

SOURCE_FACT：新设备当前只有扫码主入口，审批能力埋在 Settings 设备面板；24 词恢复短语
通过 chat 表面的 MessagingRecoveryGate 硬阻断出现。
目标是新设备在登录卡输凭据后进入等待态，显示核对码、取消与一行折叠的
“无法使用其他设备？”入口；主路径任何阶段不预渲染恢复短语输入。
预期用户在任意设备独立发起登录，等待另一台设备放行，兜底手段不可见直到主动展开。
首设备无已登记设备时不触发审批，避免无设备可批的死锁。

### DLA-O02：审批全局弹窗与 chat 恢复门禁移除

SOURCE_FACT：审批 UI 仅由 AccountTab 挂载的 DeviceLinkPanel 承担；chat 路由存在
恢复短语硬门禁，批准后的身份闭合没有专属呈现位置。
目标是已登录设备 Shell 层全局弹窗（前台）加系统通知（后台）承载审批，Settings 只保留
设备管理；chat 路由删除 MessagingRecoveryGate，短语输入只在登录兜底面与 Settings 出现。
预期审批不再干扰聊天表面，用户不会在正常业务流遇到恢复卡；后台送达时延按 DLA-D08
如实披露，v1 回前台单 flight 读取补偿。

### DLA-O03：全对称设备审批登录与多设备会话并存

SOURCE_FACT：活跃会话唯一索引已是 (station_peer_id, user_id, device_id)，
存储层支持异设备并存；产品层只有桌面审批手机一个方向。
目标是任意平台设备可申请、任意同 Actor 已登录设备可批准，批准后 HPKE 交付 Actor seed，
 claimant 经 Access 重裁与 PIN/Shell 取得独立 Session、inbox 与撤销边界。
预期手机批桌面、桌面批手机两条 Journey 均会话并存且 device_id 不同；同设备重登只替换
自身。设备数量上限走显式 Station 策略，不按类别隐式踢人。

### DLA-O04：独立审批事务 owner 与既有真源复用

SOURCE_FACT：device_link 事务由认证设备发起，载荷含 QR locator 与网络引导材料；
Access、Session、Actor Identity 各自 owner 已稳定。
目标是新增 login_approval subserver 与 proto 拥有 claimant-first 事务状态，只通过端口
调用既有 owner；HPKE/transcript/指纹复用 device-link-core 唯一实现，不建平行 Session、
Actor Device 表或第二套密码学。
预期信任边界随协议边界清晰表达，无会话面攻击面（枚举、刷事务）由独立限流与审计覆盖，
mobile-scan-login 的 MSL-D01 至 MSL-D07 密码学合同继续有效。

### DLA-O05：无会话持票面、HPKE 交付与 CAS/TTL/限流

SOURCE_FACT：Station 无邮箱 OTP 能力；Device Link 已实现 CAS revision、TTL 回收与
HPKE 固定 suite。
目标是 claimant 凭 256-bit capability（Station 仅存哈希）访问自己的事务，状态迁移在
PG 事务内 CAS 推进，10 分钟 TTL、每 Actor 3 个并发 PENDING、持票 ≥2s/认证 ≥5s 轮询预算；
approver 批准的 HPKE 密文绑定独立 purpose 的 approval transcript。
预期并发批准只产生一个 COMMITTED，坏 capability、revision 冲突、approver 撤销均 fail-closed；
邮箱强校验作为 DLA-D07 待建能力独立排期，未落地前兜底仅密码加短语且文案不夸大。

### DLA-O06：原生证据、治理登记与可回滚切换

SOURCE_FACT：模块治理 registry 只接受 active 且 governedPaths 已存在的模块；
架构治理当前存在与本计划无关的 runtime-secrets 漂移。
目标是新 Gate 经 pt-acceptance-engineering 注册，跨设备审批、失败语义、chat 门禁移除
三条原生 E2E 绑定 current-source evidence；实现落地的同一变更将文档转 active 并登记
registry，更正 mobile-scan-login design.md 的过时索引表述。
预期每个闭环有聚焦源码检查与一条原生 Journey，未运行格保持 UNPROVEN；clean-cut 替换
的回滚是 cut commit 的 VCS revert，不保留无限期双路径。

## Actual Outcome Results

计划冻结时无任何执行证据，六项 criterion 全部 UNPROVEN。执行中仅按
current-source evidence 更新下述机器可读结果，PASS/PARTIAL 必须附带
sourceIdentity 与证据引用。

## Outcome Comparison Results

```json
{
  "kind": "peers-touch-outcome-comparison-results",
  "schemaVersion": 1,
  "planId": "DLA-20261112",
  "sourceIdentity": null,
  "items": [
    {"id": "DLA-O01", "status": "UNPROVEN", "actualEffect": "计划已冻结，等待面与折叠兜底尚未实现，无执行证据", "evidenceRefs": [], "deviation": "无；尚未进入执行"},
    {"id": "DLA-O02", "status": "UNPROVEN", "actualEffect": "计划已冻结，全局审批弹窗与 chat 门禁移除尚未实现，无执行证据", "evidenceRefs": [], "deviation": "无；尚未进入执行"},
    {"id": "DLA-O03", "status": "UNPROVEN", "actualEffect": "计划已冻结，全对称审批与跨设备 Journey 未运行", "evidenceRefs": [], "deviation": "无；尚未进入执行"},
    {"id": "DLA-O04", "status": "UNPROVEN", "actualEffect": "计划已冻结，新 subserver 与 proto 尚未落地", "evidenceRefs": [], "deviation": "无；尚未进入执行"},
    {"id": "DLA-O05", "status": "UNPROVEN", "actualEffect": "计划已冻结，持票面与失败语义格未验证", "evidenceRefs": [], "deviation": "无；尚未进入执行"},
    {"id": "DLA-O06", "status": "UNPROVEN", "actualEffect": "计划已冻结，原生 Gate 未注册、registry 未登记", "evidenceRefs": [], "deviation": "无；尚未进入执行"}
  ]
}
```
