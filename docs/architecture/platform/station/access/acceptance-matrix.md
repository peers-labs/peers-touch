# Station 统一接入生命周期 - 验收矩阵

> **Status**: active
> **Version**: v2.0
> **Created**: 2026-09-26 | **Updated**: 2026-10-06
> **Owner**: Identity and Access

---

## 1. 验收规则

- 所有 required capability 必须由同一精确源码完成 Desktop、Mobile、两台
  Station 和一个 Relay 的真实运行证明。
- 双端比较产品语义、状态、错误、安全结果和持久结果，不比较组件树。
- 安全负向用例与 happy path 同等阻断；unit test 不能替代原生 Journey。
- Relay 运行单元必须证明不包含 Station 业务 route，且看不到 tunnel 内明文。
- 当前接口 inventory、owner、contract 或 consumer 任一缺口均失败。

## 2. Capability Crosswalk

| Capability | Journey | 基线状态 | Gate |
|---|---|---|---|
| SAL-C01-C04 | SAL-J01-J05 | 直连已完成，需回归 | SAL-G01/G02 |
| SAL-C05-C06 | 全部 | 已有边界，需扩展 inventory | SAL-G00/G07 |
| SAL-C07 统一接入地址 | SAL-J01/J06/J07 | 未实现 | SAL-G03 |
| SAL-C08 Route-aware binding | SAL-J02/J03/J09 | 未实现 | SAL-G04 |
| SAL-C09 安全 Relay 隧道 | SAL-J06/J07/J09 | 未实现 | SAL-G05 |
| SAL-C10 Station Relay 生命周期 | SAL-J08 | 原型不足 | SAL-G06 |
| SAL-C11 客户端类别会话 | SAL-J10 | 已实现，待聚合证明 | SAL-G08 |

## 3. Gates

### SAL-G00：能力与角色契约

- endpoint discovery、route attestation、mount enrollment、opaque tunnel 和
  Access Gate 均有唯一 owner、Proto contract 与 consumer。
- Relay role 的启动 allowlist 不包含 Actor、OAuth、Chat、Social、Agent 或
  Federation governance 业务 route。
- 无生产 consumer 的 `/api/v1/relay/client-token`、任意路径 forward、DTO 和
  credential path 在 cutover 后为零。

### SAL-G01：可信 Station 与 Access Gate 回归

- Desktop 与 Mobile 从 clean install 验证相同签名 Station identity。
- 两端通过 canonical protobuf Access Gate 登录。
- 签名错误、PeerID 变化、unknown gate 与 attempt expiry 均 fail closed。

### SAL-G02：Scope 隔离

- Session、Messaging、Federation 与本地 projection 的 Station/Actor/Device 一致。
- 账号、Station 切换和重启不泄漏其他 scope。
- route 变化只改变 `route_revision`，Station 变化才改变
  `lifecycle_generation`。

### SAL-G03：统一 endpoint discovery

- 同一输入自动识别直连 Station 与 Relay。
- Relay 一个公开候选自动选中，多个候选要求用户选择。
- 私有 Station 不被目录枚举；有效连接材料可解析，过期/重放失败。
- Relay 伪造、替换或降级 Station attestation 时双端均在登录前拒绝。

### SAL-G04：双端 route continuity

- Desktop 与 Mobile registry 均以 `station_peer_id` 为主键并持有多个 route。
- 同 Station 在 direct/relay 间切换后 actor、session、conversation 与本地数据
  连续；旧 route 异步结果被 revision fence 丢弃。
- 不同 Station identity 必须显式替换并完整清理 scope。
- 安装态和开发态使用相同 discovery schema 与 migration 结果。

### SAL-G05：Relay 数据面安全

- Client 到 Station 使用经 Station identity 绑定的端到端 TLS 1.3。
- Relay 抓包、日志和 tracing 只包含 Relay 控制面 credential、route ID、帧大小、
  时序、配额与错误类别，不包含客户端 Station Session credential。
- 错误证书、错误 SPKI pin、重放 nonce、跨 Station route 与篡改 frame 均失败。
- 请求/响应大小、并发、速率、时长和取消都受硬限制，不静默截断。

### SAL-G06：Station enrollment 与撤销

- invite 只显示一次并仅持久化 hash；并发注册只能成功一次。
- Relay 从 Station host-key proof 推导 `station_peer_id`，不信任请求头。
- mount credential 具有独立 issuer/audience/scope/jti/expiry/generation。
- 删除或撤销 mount 原子关闭流、递增 epoch，并拒绝刷新和重连。
- 过期缓存能进入显式重新 enrollment，不产生伪 `running` 状态。

### SAL-G07：聚合与零遗产

- 两台 Station、一个 Relay、Desktop、Mobile 完成 direct、relay、显式换路、
  restart、revoke、overload 和 cross-Station 业务 Journey。
- 删除硬编码外部 debug egress；网络出站 inventory 无未声明目的地。
- 现有 Station-to-Station relay 只接受 typed capability manifest。
- 架构治理、API ownership、release build 和 Acceptance aggregate 全部通过。

### SAL-G08：客户端类别会话矩阵

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
| Relay role | 最小 route allowlist、TLS、operator auth、配额与审计 |
| Station A / B | enrollment、轮换、撤销、重连与 typed federation transport |
| Desktop native | direct/relay 自动识别、选择、登录、换路、安装态恢复 |
| Mobile native | 与 Desktop 相同语义的 iOS Simulator 证明 |
| Adversarial client | forgery、replay、wrong-route、oversize、overload 与 cancellation |
| Relay observer | 无客户端 Station Session credential、Access payload 或业务明文 |
| Mixed same-Station | 不同账号 Desktop↔Mobile Chat；同一账号 Desktop+Mobile 并存 |
| Same-class takeover | 双 Desktop 和双 Mobile 分别证明新 Session 接管旧同类端 |
| Mixed cross-Station | 显式 Federation context 与 Relay 隔离 |
| Fresh install/reset | 仅依赖当前 scoped key、route 与 schema |

## 5. 完成条件

`UNIFIED_RELAY_STATION_ACCESS_ACCEPTED` 仅在 SAL-G00..SAL-G08 对同一精确源码
全部通过、全部 Task 为 `done`、旧任意转发入口删除、运行资源释放且工作树干净时成立。
