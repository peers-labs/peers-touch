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

源码已接入 Station、Desktop、Mobile 和 Schema 原 owner。26 项 Mobile
生命周期测试、iOS Rust 检查、前端构建和明确 Simulator destination 的 Xcode
原生构建通过。Desktop 11 项聚焦回归与 Station application 模块测试通过，
覆盖旧认证 pending 的 scope 隔离和失效原 Session 的 offer 清理。
Schema 消费者统一与旧 helper/依赖移除已有源码证据。
这些仅支持源码收敛和检查产物；相机扫码、两手机业务、真实路线、
PG 并发、gate/PIN/Shell 及 receiver 效果仍未证明。

MSL-O03、MSL-O05 为 PARTIAL，只表示源码边界与证据整理有实际产物。
其余结果保持 UNPROVEN。完整 source snapshot、文件指纹、日志与清理结果
见下述外部 Development 诊断，正式 Acceptance 尚未执行。
详见 [验证范围](../../verification.md)。

## Outcome Comparison Results

```json
{
  "kind": "peers-touch-outcome-comparison-results",
  "schemaVersion": 1,
  "planId": "MSL-20261027",
  "sourceIdentity": "file:///tmp/peers-relay-msl-review-20261027/source-snapshot.json",
  "items": [
    {"id": "MSL-O01", "status": "UNPROVEN", "actualEffect": "原生源码与 iOS 模拟器包已形成，现场扫码登录未运行", "evidenceRefs": ["file:///tmp/peers-relay-msl-ios-xcode-build.log"], "deviation": "打包不证明相机、gate、PIN 或 Shell"},
    {"id": "MSL-O02", "status": "UNPROVEN", "actualEffect": "按设备 Session 与多手机授权源码已接入", "evidenceRefs": [], "deviation": "五客户端 Suite 与真实两手机收消息/撤销未运行"},
    {"id": "MSL-O03", "status": "PARTIAL", "actualEffect": "Schema 统一消费者、删除旧 helper/依赖，业务决策保留原 owner", "evidenceRefs": ["file:///tmp/peers-relay-msl-review-20261027/source-snapshot.json", "file:///tmp/peers-relay-msl-review-20261027/verification-summary.json"], "deviation": "全链原生运行效果仍为 UNPROVEN"},
    {"id": "MSL-O04", "status": "UNPROVEN", "actualEffect": "固定路线、受限清理恢复与原子提交源码和聚焦测试已形成", "evidenceRefs": ["file:///tmp/peers-relay-msl-route-check.log"], "deviation": "真实 Direct/Circuit、PG 并发与故障恢复未运行"},
    {"id": "MSL-O05", "status": "PARTIAL", "actualEffect": "当前源码、构建、审查、资源清理和未证格已分别登记", "evidenceRefs": ["file:///tmp/peers-relay-msl-review-20261027/verification-summary.json"], "deviation": "正式 Acceptance 无有效 plan/run；Android、真机及 receiver 格未证"}
  ]
}
```
