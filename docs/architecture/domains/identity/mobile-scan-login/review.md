# Mobile Scan Login — Design Review

> **Status**: accepted
> **Version**: v1.0
> **Created**: 2026-10-27 | **Updated**: 2026-10-27
> **Owner**: Identity and Access

## Findings-first 审查合同

审查对象为本目录与[Schema](../../../shared/schema/README.md)的目标合同。
核查：

1. 同root与同URL是否混淆；手机独立路线、localhost、私有Relay是否闭合。
2. 引用是否可在兑换grant之前下载，role与TLS信任是否有独立owner。
3. QR、source PoP、claim、设备批准、Access、Session是否各守权限。
4. E2EE连续性是否与现有seed/prekey源码一致，撤销是否夸大。
5. 并发抢扫、取消、ack丢失、重启、超时与bounded admission是否明确。
6. Schema是否真正统一codec/render，是否出现第二业务/网络owner。
7. UI是否继承原登录与全局Settings；是否遗漏本设备Session冲突、权限拒绝与恢复。
8. 证据是否区分源码、原型、Android和iOS真机，是否虚构已通过的Gate。
9. 单offer批准对象是否被误写成账号设备上限；Session唯一性与撤销是否真正按
   device隔离，全部登录入口是否共同使用该owner合同。

## 独立审查结论

结论：目标合同通过源码对照审查，可以在用户“review下，没有问题就实现吧”
的授权范围内实施。主要约束：

- Session 基线类别唯一索引确实阻断多手机；全部认证路径共用按设备替换，
  不为扫码开例外。迁移只合并同设备重复行，缺失绑定要求重新认证。
- Actor enrollment 与预密钥签名确实需要已有 Actor 身份 seed。
  HPKE 只做加密，必须另验 Desktop Device transcript 签名；
  指纹沿用现有公钥 SHA-256。不能宣称撤销会远程擦除已传递 seed。
- 设备注册与 Session 激活必须复用 owner 的 transaction-aware 端口，
  从同一事务读取 current policy/profile/revocation；统一锁序并避免第二 DB 连接。
- Device Link 位于业务 `app/subserver/device_link`，调用 frame 认证设施，
  不反向依赖其业务协调器；Relay 只接收有限网络引导 blob，不加载登录路由。
- `peers-touch:safety/v1` 和外部频道 QR 保留原字节语义。
  Schema 有明确的 presentation-only 外部协议输入，不能把它们解释成登录动作。
- 短引用必须在私有 grant 兑换前可取回；无安全引导能力时降级为有界内联，
  超过密度预算则明确失败。scoped TLS 与原生成功率必须取得现场证据。

## 验证边界

已执行的 Session/Access/Auth 聚焦测试，以及 OAuth 同设备替换与取消回归，
只属于 `SOURCE_CHECK`。它们不证明原生扫码、两部手机收件效果或 Direct/Circuit
接入。每个 required 能力仍须其当前源码的 UI、Native、数据库与收件证据。

待实现能力：Device Link事务与native camera；actor-policy下的fresh grant；
私有Station的sealed bootstrap引用；生产endpoint-scoped TLS引导；
身份安全交付、Session准备端口与双端 runtime/交互。未运行的验收保持 `UNPROVEN`。

两个新目录在真实消费路径完成前仍为 documentCollections，不能从设计接受
推导 active 能力或原生验收结果。没有 push、PR、merge 或发布授权。
