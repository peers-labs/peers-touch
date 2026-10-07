# Station 接入生命周期 - 验收矩阵

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-09-26 | **Updated**: 2026-10-06
> **Owner**: Identity and Access

---

## 1. 验收规则

- 所有 required capability 必须由当前精确源码完成 Desktop 与 Mobile 原生证明。
- 双端比较产品语义、状态、错误和持久结果，不比较组件树或 command 数量。
- 接入失败路径必须证明不会调用 capability registry 之外的 route。
- 当前接口 inventory、owner、contract 或 consumer 任一缺口均失败。

## 2. Capability Crosswalk

| Capability | Journey | 当前状态 | Gate |
|---|---|---|---|
| SAL-C01 可信 Station | SAL-J01/J03/J05 | 已完成 | SAL-G01 |
| SAL-C02 Access Gate | SAL-J01/J02/J05 | 已完成 | SAL-G01 |
| SAL-C03 Scope 隔离 | SAL-J02/J03 | 已完成 | SAL-G02 |
| SAL-C04 Federation context | SAL-J04 | 已完成 | SAL-G03 |
| SAL-C05 基础设施收口 | SAL-J04/J05 | 已完成 | SAL-G03 |
| SAL-C06 能力完整性治理 | 全部 | 已完成 | SAL-G00/SAL-G04 |
| SAL-C07 客户端类别会话 | SAL-J06 | 待当前项目证明 | SAL-G05 |

## 3. Gates

### SAL-G00：能力契约

- 每个接入 capability 绑定产品 ID、Station owner、Proto contract 与平台适用性。
- 客户端 registry 不复制 Station method/path。
- 无生产 consumer 的 command、wrapper、DTO 和 mock 为零。

### SAL-G01：可信接入

- Desktop 与 Mobile 从新安装开始验证同一签名 Station identity。
- 两端分别通过四个 canonical protobuf endpoint 登录。
- 签名错误、PeerID 变化、404、unknown gate 与 attempt expiry 均 fail closed。
- 运行中只调用 registry 登记的 Access Gate capability。

Stable Gate：`station-access-auth-e2e`，环境
`station-access-native`（macOS Desktop + iOS Simulator，同一 source-attested
Station；每个 Gate 在已授权的 `chat-native-four` 上独立重置 Alice/Bob fixture）。

### SAL-G02：Scope 隔离

- Session、Messaging、Federation 与本地 projection 的 Station/Actor/Device 一致。
- 账号、Station 切换和重启不泄漏其他 scope 的 projection。
- 所有持久化 key 都绑定完整 scope tuple。

Stable Gate：`station-access-scope-isolation-e2e`，环境
`station-access-native`。

### SAL-G03：Federation 与 Relay 边界

- 双端查看或选择明确 `federation_id`，并完成 scoped search/resolve/Chat。
- 普通客户端无 Federation create/join/leave/delete/member-station。
- 普通客户端无 Relay token/invite/mount/endpoint。
- Station operator flows 仍可由真实 Dashboard/CLI consumer 完成。

### SAL-G04：当前接口完整性与聚合

- 四个 Access Gate capability 在 Station registry 中完整登记。
- Desktop 与 Mobile 的 client capability registry 均引用同一 capability ID。
- route、Proto request/response、owner root 和 consumer 均能从当前树解析。
- 受治理前缀下发现的接口必须全部存在于正向 registry。

### SAL-G05：客户端类别会话矩阵

- 同一测试账号在一个 Desktop 与一个 Mobile 上同时登录后，两端 Session 均有效。
- 两端使用不同 `device_id`，但共享相同 actor PTID，并能从同一 Station 读取、
  发送和接收 Conversation。
- 第二个 Desktop 使用不同安装/存储身份登录后，旧 Desktop 收到
  `session_revoked/kicked`，Mobile Session 保持有效。
- 第二个 Mobile 使用不同模拟器、安装和存储身份登录后，旧 Mobile 收敛到
  `session_revoked/kicked`，Desktop Session 保持有效。
- 密码 Access Gate、OAuth credential acknowledgement 和
  `/actor/session/takeover` 使用同一 canonical client-class slot。
- 两个同类别登录并发时，Station 最终最多保留一个未撤销 Session；不得通过
  `desktop-native`、窗口 label、设备型号或新 `device_id` 创建第二个类别槽。

## 4. 必需运行单元

| Cell | 证明 |
|---|---|
| Desktop native | 首次接入、恢复、切换、失败关闭 |
| Mobile native | 首次接入、恢复、切换、失败关闭 |
| Mixed same-Station | 不同账号 Desktop↔Mobile Chat；同一账号 Desktop+Mobile 并存 |
| Same-class takeover | 双 Desktop 和双 Mobile 分别证明新 Session 接管旧同类端 |
| Mixed cross-Station | 显式 Federation context 与 Relay 隔离 |
| Fresh install/reset | 仅依赖当前 scoped key、route 与 schema |

## 5. 完成条件

`STATION_ACCESS_LIFECYCLE_ACCEPTED` 仅在 SAL-G00..SAL-G05 全部通过、所有 Task
为 `done`、`CCU-20260922` 保持 completed 且最终工作树干净时成立。
