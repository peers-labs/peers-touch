# Station 统一接入生命周期 - 体验契约

> **Status**: active
> **Version**: v2.0
> **Created**: 2026-09-26 | **Updated**: 2026-10-06
> **Owner**: Identity and Access

---

## 1. Journey 索引

| ID | Journey | 能力 |
|---|---|---|
| SAL-J01 | 通过直连 Station 首次接入 | SAL-C01-C03 |
| SAL-J02 | 冷启动、renderer reload 与恢复 | SAL-C02-C03/C08 |
| SAL-J03 | 切换账号或 Home Station | SAL-C01-C04/C08 |
| SAL-J04 | 选择 Federation context 并使用业务 | SAL-C04 |
| SAL-J05 | 接入失败与恢复 | SAL-C01-C10 |
| SAL-J06 | 输入 Relay 地址并自动选择 Station | SAL-C07-C09 |
| SAL-J07 | 用私有连接材料接入未公开 Station | SAL-C07-C09 |
| SAL-J08 | Station operator 注册、轮换与撤销 Relay mount | SAL-C10 |
| SAL-J09 | 同一 Station 在直连与 Relay 间换路 | SAL-C03/C08-C09 |
| SAL-J10 | 跨类别共存与同类别接管 | SAL-C03/C11 |

## 2. SAL-J01：直连接入

1. 用户输入接入地址。
2. 客户端调用统一 endpoint discovery，不因网络可达而建立信任。
3. endpoint 声明自身为 Station，并返回 challenge-bound 签名 Station identity。
4. 客户端验证 host public key、签名、有效期、capability 与
   `station_peer_id`，再要求首次固定确认。
5. 客户端通过该 route 调用 canonical Access Gate。
6. 仅当 Access Decision 为 `granted` 时建立 Session 并启动 runtime。

## 3. SAL-J06：Relay 公开发现

1. 用户在同一输入框填写 Relay HTTPS 地址。
2. 客户端验证 Relay endpoint identity，并将 role 分类为 `RELAY`。
3. Relay 只返回 opt-in、未过期、由 Station host key 签名的 route attestation。
4. 一个候选时自动选中；多个候选时展示 Station 名称、身份摘要和可达状态。
5. 客户端经 opaque tunnel 与目标 Station 完成端到端 TLS 和 Station identity 校验。
6. 后续 Access Gate、Session 和业务页面与直连路径完全相同。

UI 主标题始终是 Home Station。连接摘要只显示 `直连` 或 `经 <Relay label>`。

## 4. SAL-J07：Relay 私有发现

1. 用户粘贴 Station 签发的 `peers-touch://connect#...` 链接或 `ptc1:` 代码。
2. 客户端解析其中的 Relay origin、不可猜 route handle、Station route
   attestation 和短期 connection grant。
3. Relay 校验 grant 的 hash、有效期、scope 与使用次数后建立 tunnel，不公开该
   Station 的目录记录。
4. 客户端独立验证 Station 签名和 tunnel 内证书绑定。
5. 连接材料失效时显示可恢复的 typed failure，不退化为公共目录猜测。

连接材料位于 deep-link fragment 或本地输入值，不作为 HTTP URL query、Referer、
analytics 或日志字段发送。

## 5. SAL-J02 / SAL-J09：恢复与换路

- 冷启动和 renderer reload 走同一 endpoint/identity/access 状态机。
- registry 以 `station_peer_id` 恢复 route candidates；URL 不作为 scope key。
- 当前 route 失败时自动重试只限同一 route；从 Relay 切到直连或反向切换会改变
  可观察的网络路径，必须由用户显式确认。
- route 改变但 `station_peer_id` 相同时，只重建 transport，Session 与业务 scope
  保持；若 Station 要求重新认证，则由 Access Gate 明确决定。
- 新 route 返回不同 Station identity 时停止自动切换并要求显式替换。
- 安装态必须重新验证内置 schema、endpoint discovery 与 route migration，
  不能依赖开发态资源。

## 6. SAL-J03：切换 Home Station

1. 停止前一 scope 的长生命周期 runtime。
2. 清空前一 scope 的前端 projection。
3. 解析新接入地址并验证目标 Station identity。
4. 完成目标 Access Gate。
5. 新 scope 完整 ready 后才开放业务页面。

## 7. SAL-J08：Station 注册 Relay

1. Relay operator 创建定向、短期、一次性 invite，明文只显示一次。
2. Station 用 host key 对 Relay challenge、invite ID 和期望 Relay identity 签名。
3. Relay 验证 proof-of-possession，原子消费 invite 并创建新 mount generation。
4. Station 建立强制 TLS 的控制流，周期性轮换短期 mount credential。
5. operator 撤销 mount 后，Relay 立即关闭流并拒绝旧 generation 重连。
6. Station 可用新的 invite 显式恢复；过期缓存不得阻止重新 enrollment。

## 8. 失败与恢复

| 失败 | 用户或 operator 结果 |
|---|---|
| endpoint 不可达或 role 未知 | 保留输入，typed retry；不猜接口 |
| Relay identity、Station 签名或证书绑定不匹配 | 凭据提交前 fail closed |
| Relay 无候选 | 显示无可用 Station；不暴露 mount inventory |
| Relay 多候选 | 明确选择，不按返回顺序静默绑定 |
| route/grant 过期或撤销 | 停止该 route，保留同 Station 其他候选 |
| tunnel 中断 | bounded reconnect；不切换 Station identity |
| Access Gate 不支持或 attempt 过期 | canonical typed failure/restart |
| mount credential 过期 | Station 轮换或重新 enrollment；不信任非空缓存 |
| 配额耗尽 | typed overload + retry-after；不得静默截断 |

## 9. SAL-J10：跨类别共存与同类别接管

1. 同一账号先在 Desktop 登录，再在 Mobile 登录。
2. 两端 Session、Messaging 与 Actor Device 使用各自安装实例的 `device_id`，
   并共享同一 Station/Actor 业务事实。
3. Desktop 与 Mobile 均保持登录，可发送、接收和读取同一 Conversation。
4. 同一账号在第二个 Desktop 登录；旧 Desktop 收到 typed `kicked`，停止
   runtime 并回到登录态，Mobile 不受影响。
5. 同一账号在第二个 Mobile 登录；旧 Mobile 在下一次鉴权、事件恢复或显式
   resume 时收敛到 typed `kicked`，清除旧 projection 并回到登录态，Desktop
   不受影响。

密码、OAuth、冷启动恢复和 session takeover 必须使用同一个客户端类别槽。
运行时标签、窗口 label、设备型号和不同 `device_id` 不得绕过同类别接管。

## 10. 禁止体验

- 要求用户预先选择“Station 模式”或“Relay 模式”。
- probe 成功、Relay 列表或 URL 文本即被当作 Station identity。
- 为 Relay 新建独立账号、Session、Station 列表或业务页面。
- 路由变化导致同一 Station 的账号、Chat 或本地数据被复制或清空。
- 普通客户端出现 Relay invite、credential、mount 或 admin 控件。
- Relay 故障后绕过签名、TLS、Access Gate 或 capability registry。
