# Mobile 扫码登录：预期效果与验证

> **Plan**: MSL-20261027
> **Owner**: Identity and Access

## Outcome Comparison Contract

```json
{
  "kind": "peers-touch-outcome-comparison-contract",
  "schemaVersion": 1,
  "planId": "MSL-20261027",
  "plannedSectionDigest": "sha256:009da54d824ffecf6bb83315225720ccc6a5bd323e42ebdb66449eaf379cb86b",
  "criteria": [
    {"id": "MSL-O01", "dimension": "user-experience", "title": "无需手输站点的原生扫码", "taskIds": ["MSL-03", "MSL-06", "MSL-07"], "gateIds": []},
    {"id": "MSL-O02", "dimension": "product-capability", "title": "多个独立设备同时使用同一账号", "taskIds": ["MSL-01", "MSL-05", "MSL-08"], "gateIds": ["station-access-session-class-suite-e2e"]},
    {"id": "MSL-O03", "dimension": "architecture", "title": "统一 Schema 与既有领域真源", "taskIds": ["MSL-02", "MSL-04", "MSL-05"], "gateIds": []},
    {"id": "MSL-O04", "dimension": "technology", "title": "受限网络引导、签名加密与原子提交", "taskIds": ["MSL-03", "MSL-04", "MSL-05", "MSL-07"], "gateIds": []},
    {"id": "MSL-O05", "dimension": "quality-operations", "title": "当前源码与原生平台分格证据", "taskIds": ["MSL-01", "MSL-02", "MSL-06", "MSL-07", "MSL-08"], "gateIds": ["station-access-session-class-suite-e2e"]}
  ]
}
```

## Planned Outcome Comparison

### MSL-O01：无需手输站点的原生扫码

SOURCE_FACT：现有连接入口接受 ptc1 与 connect 链接，未发现连续 QR 登录解码。
目标是 Android/iOS 相机扫描 Desktop 屏幕码，验证同一 Station root，
再展示核对和 Access 动作，安全保存后进入正常 PIN/Shell。
预期降低站点输入和凭据输入成本，保留不可达、取消、权限与重试反馈。
Direct/Circuit 可达性由手机现场验证；不承诺任意网络穿透。

### MSL-O02：多个独立设备同时使用同一账号

SOURCE_FACT：原 active Session 索引按 actor 与 client class 唯一。
目标按 Station、Actor、device 唯一，两台手机与多个 Desktop 独立在线；
同设备重登只轮换自身，设备撤销只作用于该设备。
预期添加第二台手机不会踢掉第一台；原消息投递仍使用独立 inbox。
不复制历史数据库、ratchet 或 Recovery master。

### MSL-O03：统一 Schema 与既有领域真源

SOURCE_FACT：旧 DeepURL 与三个 qrcode.react 消费者分散在各入口。
目标使用 typed proto、共享 codec 和 qr-code-styling 单一引擎，删除旧 helper
与依赖。Device Link 仅协调，Access、Session、Actor Identity 和 Connectivity
继续各自拥有决策与真源；无双写、平行设备表或中心短链。
预期链接质量和二维码安全约束只维护一次，外部载荷保留原字节。

### MSL-O04：受限网络引导、签名加密与原子提交

SOURCE_FACT：现有原生身份签名需要 Actor seed，Relay sealed blob 尚不存在。
目标由已注册 Desktop 设备签名完整 transcript，标准 HPKE 给选定 Mobile
传递 seed；每码有限 source/claim，先可信取 blob 再兑换私有 grant。
Access 当前策略、profile 和 approver 从同一 PG 事务读取；
凭据 inactive，安全保存与 PoP ack 后原子激活设备和 Session。
预期防身份替换、抢扫自动授权、重放与部分提交；不声称撤销能远程抹去 seed。

### MSL-O05：当前源码与原生平台分格证据

SOURCE_FACT：源码检查与模拟器 receiver Suite 不能证明原生相机或真机扫码。
目标逐项记录源码、结构、UX、功能、正式 Acceptance 的不同证据强度，
Android/iOS、Direct/Circuit、多设备、重启和 ack 丢失格分别验证。
预期可定位真实未证范围；五个客户端只在 Suite 范围预置一次，
后续场景 attach-only，owned 资源最终清理。新正式 Gate 需显式修订冻结计划。

## Actual Outcome Results

尚未形成此计划的 current-source runtime evidence，全部保持 UNPROVEN。

## Outcome Comparison Results

```json
{
  "kind": "peers-touch-outcome-comparison-results",
  "schemaVersion": 1,
  "planId": "MSL-20261027",
  "sourceIdentity": null,
  "items": [
    {"id": "MSL-O01", "status": "UNPROVEN", "actualEffect": "原生扫码和登录待验证", "evidenceRefs": [], "deviation": "暂无运行证明"},
    {"id": "MSL-O02", "status": "UNPROVEN", "actualEffect": "原生多设备共存待验证", "evidenceRefs": [], "deviation": "已有源码检查不替代运行证明"},
    {"id": "MSL-O03", "status": "UNPROVEN", "actualEffect": "共享消费者切换待验证", "evidenceRefs": [], "deviation": "暂无完整切换证明"},
    {"id": "MSL-O04", "status": "UNPROVEN", "actualEffect": "网络与授权原子链待验证", "evidenceRefs": [], "deviation": "暂无运行证明"},
    {"id": "MSL-O05", "status": "UNPROVEN", "actualEffect": "分格当前源码证据待生成", "evidenceRefs": [], "deviation": "未运行格保持未证"}
  ]
}
```
