# Station 统一接入生命周期 - 产品定义

> **Status**: active
> **Version**: v2.0
> **Created**: 2026-09-26 | **Updated**: 2026-10-06
> **Owner**: Identity and Access

---

## 1. 产品命题

用户在 Desktop 或 Mobile 输入一个接入地址后，无需知道它是 Station 还是 Relay。
客户端先验证 endpoint role，再确认目标 Home Station 的签名身份，最后始终通过该
Station 的 Access Gate 登录。Relay 只是可替换的连接路径，不改变用户登录到哪个
Station，也不获得业务数据或账号权限。

## 2. 硬约束

- 接入层只接受 capability registry 登记的当前 route、Proto 和 storage key。
- URL、DNS、TLS 可达性和 Relay 声明都不是 Station 身份；签名
  `station_peer_id` 才是最终身份。
- Access Gate、Session 和业务授权仍由 Home Station 唯一裁决。
- Relay 不解密客户端的 Station Session credential 或业务请求/响应。
- 客户端 registry 以 `station_peer_id` 为主键；route URL 只是候选传输。
- 私有 Station 默认不公开列出，公开发现必须由 Station 显式签名授权。
- 普通客户端不管理 Relay invite、mount、credential、证书或配额。
- 双端统一语义、状态、错误与持久结果，不要求 UI 组件同构。

## 3. 能力

| ID | 能力 | 产品结果 |
|---|---|---|
| SAL-C01 | 可信 Home Station | 凭据提交前验证签名 identity，并显式确认首次固定或身份替换 |
| SAL-C02 | 统一 Access Gate | canonical protobuf endpoint 驱动全部登录方式 |
| SAL-C03 | Scope 隔离 | Session、Messaging、Federation 与本地投影共享 Station/Actor/Device scope |
| SAL-C04 | Federation context | 用户可查看或选择 context，并用于 scoped 业务 |
| SAL-C05 | 基础设施收口 | 普通客户端无 Federation 治理或 Relay 管理入口 |
| SAL-C06 | 能力完整性治理 | capability 有唯一 owner、contract 与双端 consumer |
| SAL-C07 | 统一接入地址 | 同一输入自动识别直连 Station、Relay 目录或私有连接材料 |
| SAL-C08 | Route-aware binding | 同一 Station 可在已验证 route 间切换，不复制 registry 或业务 runtime |
| SAL-C09 | 安全 Relay 隧道 | Relay 只见 route、长度、时序和配额元数据，不见业务明文与客户端 Station Session credential |
| SAL-C10 | Station Relay 生命周期 | operator 可完成注册、轮换、撤销、恢复和审计，所有动作绑定 Station host key |
| SAL-C11 | 客户端类别会话 | 同一账号可同时保留一个 Desktop 和一个 Mobile Session；同一客户端类别的新登录必须接管并撤销旧 Session |

Desktop 与 Mobile 均为 `required`；Browser 不在本模块范围。

## 4. 用户可见结果

1. 输入 HTTPS 接入地址或 Station 签发的连接链接/代码。
2. 客户端自动显示“直连”或“经 Relay”，但身份主标题始终是目标 Station。
3. Relay 只返回一个可用 Station 时自动选中；返回多个时展示 Station 选择器。
4. 私有 Station 不出现在公共目录，只有有效连接材料才能解析。
5. 客户端验证 Station 签名和 route attestation 后进入相同 Access Gate。
6. 同一 Station 从直连切到 Relay 或反向切换时，用户账号与业务 scope 不变。
7. 账号或 Station 身份变化时完整停止旧 runtime 并清空旧 projection。
8. 登录后显示当前 Station 与 Federation context。
9. 同一账号的 Desktop 与 Mobile 可同时使用；第二个 Desktop 或第二个 Mobile
   登录后，旧同类端收到 `kicked` 并回到登录态，异类端保持可用。

## 5. 非目标

- 不创建 Relay 专属客户端、第二套 Station registry 或第二套业务 API。
- 不把 Federation membership 与 Relay route 混为同一概念。
- 不让普通用户创建、加入、离开或删除 Federation。
- 不展示 Relay admin credential、invite、mount、seed 或内部 endpoint。
- 不自研通用 VPN、Service Mesh、区块链或新传输框架。
- 不保留现有任意路径 `/relay/forward/*` 作为兼容客户端入口。
- 不设计 Dashboard/CLI 运维流程。
- 不修改 Conversation authority、Chat 删除语义或本机存储。
- 不支持 registry 之外的 Station 或客户端 wire。

## 6. 成功指标

| 结果 | 目标 |
|---|---|
| 双端接入语义差异 | 0 |
| 凭据提交前未验证 Station identity | 0 |
| Relay 可读取的客户端 Station Session credential 或业务明文 | 0 |
| 未签名或过期 route 被接受 | 0 |
| 被撤销 mount 继续建立新流 | 0 |
| 普通客户端 Relay 管理入口 | 0 |
| 同一 Station 因换路产生重复 registry/scope | 0 |
| required 原生 E2E 与安全负向覆盖 | 100% |

## 7. 产品门

当前 v2 产品目标由本次 Owner 输入确定；实现开始前仍需批准对应 Plan Version。
原型不是前置条件：本次只扩展既有 Station Picker/Settings 信息结构，不新增独立
产品页面，最终以 Desktop/Mobile 原生 Journey 为准。
