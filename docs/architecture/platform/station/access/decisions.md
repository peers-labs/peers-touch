# Station 接入生命周期 - 设计决策

> **Status**: active
> **Version**: v2.0
> **Created**: 2026-09-26 | **Updated**: 2026-10-08
> **Owner**: Identity and Access

---

## 决策索引

| ID | 决策 | 状态 |
|---|---|---|
| SAL-D01 | 双端统一按语义和结果衡量 | accepted |
| SAL-D02 | 只维护当前接入契约 | accepted |
| SAL-D03 | 签名 Station identity + Access Gate 是唯一接入路径 | accepted |
| SAL-D04 | Federation governance 与普通客户端分离 | accepted |
| SAL-D05 | Relay 不参与客户端接入 | superseded by SAL-D07 |
| SAL-D06 | 完整 E2E 与当前接口完整性共同决定完成 | accepted |
| SAL-D07 | 一个接入地址自动识别 Station 或 Relay | accepted |
| SAL-D08 | Station binding 以身份为主键、route 为候选 | accepted |
| SAL-D09 | Relay 只转发端到端加密 opaque tunnel | accepted |
| SAL-D10 | Station enrollment 必须证明 host-key possession | accepted |
| SAL-D11 | Relay 使用显式最小运行角色 | accepted |
| SAL-D12 | 一个 actor 每个 canonical client class 只保留一个 active Session | accepted |
| SAL-D13 | Relay 服务宿主仅支持 Linux/POSIX | accepted |

## SAL-D01：双端统一按语义和结果衡量

**Status**: accepted
**Date**: 2026-09-26

### Context

Desktop 与 Mobile 的宿主能力和 UI 结构不同，但必须向用户提供一致的接入结果。

### Decision

Desktop 与 Mobile 共享 capability ID、协议、状态、错误、作用域和持久结果。宿主
command 数量、组件结构和交互控件可以不同。

**Rationale**

代码镜像会把平台差异推入业务层；只对齐页面又无法约束协议和终态。

**Alternatives Considered**

- 完全同构代码：拒绝。
- 只做 UI 对齐：拒绝。

**Consequences**

需要 machine-readable applicability registry 与显式 platform exception。

---

## SAL-D02：只维护当前接入契约

**Status**: accepted
**Date**: 2026-09-26

### Context

多套接入 route、wire 或 parser 会产生无法判定的 owner 和失败语义。

### Decision

接入架构只维护当前 route、command、DTO、key、parser、test、fixture 和 schema。

**Rationale**

单一当前契约能消除双 owner，并让未知接口直接 fail closed。

**Alternatives Considered**

- 并行维护多套接入契约：拒绝。
- 由客户端猜测 wire shape：拒绝。

**Consequences**

客户端与 Station 必须使用同一 capability registry 和 protobuf schema。

---

## SAL-D03：唯一可信接入路径

**Status**: accepted
**Date**: 2026-09-26

### Context

网络可达性不能证明 Station 身份，客户端自定义接入流程也无法执行 Station policy。

### Decision

双端先验证签名 Station identity，再使用四个 protobuf Access Gate endpoint。
所有请求与响应只通过 generated codec。

**Rationale**

可达性不等于身份；多个入口会绕过 Station policy。

**Alternatives Considered**

- 增加未登记的备用入口：拒绝。
- 接收非 canonical wire shape：拒绝。

**Consequences**

客户端需要统一 generated decoder 与 typed error。

---

## SAL-D04：Federation governance 与客户端分离

**Status**: accepted
**Date**: 2026-09-26

### Context

普通客户端需要 Federation context 完成业务操作，但不拥有 Station membership
与 topology 的治理职责。

### Decision

普通客户端只消费或选择 Station 已提供的 Federation context。create/join/leave/
delete/member-station 属于 Dashboard/CLI 运维面。本决策接受后 supersede
Federation D-05 的 Settings Join/Leave 条款。

**Rationale**

Federation membership 是 Station 拓扑治理，不是普通用户高频任务。

**Alternatives Considered**

- 给 Mobile 补齐治理 UI：拒绝。
- 删除所有治理 API：拒绝，运维仍需真实 consumer。

**Consequences**

Desktop Federation 设置页收缩为 context 与状态。

---

## SAL-D05：Relay 不参与客户端接入

**Status**: superseded
**Date**: 2026-09-26

### Context

Relay 的 token、mount 和 routing 属于 Station 连通性实现，不是普通客户端业务
概念。

### Decision

原决策禁止客户端把 Relay 当作接入 endpoint。该限制由 SAL-D07 与 SAL-D09
替代：客户端可以连接 Relay transport，但 Relay 仍不是 Station 业务 API 或信任
authority，普通客户端仍不管理 token、mount、invite 或内部 forwarding endpoint。

**Rationale**

Relay 没有普通客户端业务语义，暴露它会制造错误 owner 和安全面。

**Alternatives Considered**

- 把 Relay 作为高级设置：拒绝。

**Consequences**

Relay 运维仍只存在于 operator surface；客户端只看到接入方式摘要。

---

## SAL-D06：E2E 与当前接口完整性共同完成

**Status**: accepted
**Date**: 2026-09-26

### Context

运行时结果和静态接口完整性证明不同风险，任一证据单独通过都不足以关闭模块。

### Decision

Desktop/Mobile 首次接入、恢复、切换、same/cross-Station context E2E 全部通过，
且 route、contract、owner 与双端 consumer 的正向 inventory 完整，模块才可完成。

**Rationale**

静态契约不能证明用户结果，E2E 也不能证明接口 inventory 完整。

**Alternatives Considered**

- 只运行 build/unit tests：拒绝。

**Consequences**

最终 Gate 必须基于同一精确源码和真实原生客户端。

---

## SAL-D07：一个接入地址自动识别 Station 或 Relay

**Status**: accepted
**Date**: 2026-10-06

### Context

要求用户先理解并选择 Station/Relay 类型，会把部署拓扑泄漏为产品流程，也无法让
同一入口在网络变化后平滑换路。

### Decision

Desktop 与 Mobile 保留一个接入输入。客户端只通过签名 endpoint discovery 自动
分类 `DIRECT_STATION` 或 `RELAY`。Relay 单候选自动选中，多候选显式选择；私有
Station 使用 Station 签发的连接材料走同一输入。

### Rationale

统一输入降低用户心智，同时签名 role 避免通过 URL 形态或探测响应猜测 endpoint。

### Alternatives Considered

- 分别提供 Station URL 与 Relay URL：拒绝，会形成两套接入流程。
- 依次探测多组历史 endpoint：拒绝，会产生降级与歧义攻击面。

### Consequences

需要一个 canonical protobuf discovery capability 和一致的 typed outcomes。

---

## SAL-D08：Station binding 以身份为主键、route 为候选

**Status**: accepted
**Date**: 2026-10-06

### Context

URL-keyed registry 会把同一 Station 的直连和 Relay 地址误判成两个业务身份，并让
Session、缓存和 runtime 随网络路径复制。

### Decision

客户端 registry 以已验证 `station_peer_id` 为主键，保存多个签名 route candidate。
route 变化只增加 `route_revision`；Station identity 变化才触发完整 scope teardown
和显式替换。

### Rationale

身份与位置解耦后，网络 failover 不会污染业务 scope，Desktop 与 Mobile 也能共享
同一生命周期语义。

### Alternatives Considered

- 为 Relay 新建 registry/runtime：拒绝，属于烟囱架构。
- 继续以 URL 为主键并用 alias 关联：拒绝，会保留双真源。

### Consequences

Desktop URL-keyed registry 必须硬切；Mobile 现有 `station_peer_id` registry 需要
扩展 route candidates。所有 URL-keyed 业务持久化需按 owner 审计和迁移。

---

## SAL-D09：Relay 只转发端到端加密 opaque tunnel

**Status**: accepted
**Date**: 2026-10-06

### Context

现有 Relay 复制 method/path/header/body，并在 Station loopback 恢复
`Authorization`。把该入口开放给客户端会让 Relay 看到 Session credential 和业务
明文，也扩大任意路径代理面。

### Decision

客户端经 Relay 时建立 outer TLS，再在 opaque byte stream 内建立 client-to-Station
TLS 1.3。inner certificate SPKI 由 Station host-key 签名 route attestation 固定。
Relay 只处理 tunnel lifecycle、route、字节、时序和配额，不解析 HTTP。

### Rationale

标准 TLS 能复用成熟实现并把业务认证留在 Station，无需自研加密协议或第二套 API。

### Alternatives Considered

- 直接复用透明 `/relay/forward/*`：拒绝，Relay 可见明文和凭据。
- 仅依赖 client-to-Relay TLS：拒绝，Relay 仍是明文终止点。
- 自研 AEAD/Noise 变体：拒绝，密码协议风险和维护成本过高。

### Consequences

需要 Station 内部 TLS ingress、opaque framing、SPKI attestation 和 bounded
backpressure；旧 transparent forward 在迁移完成后删除。

---

## SAL-D10：Station enrollment 必须证明 host-key possession

**Status**: accepted
**Date**: 2026-10-06

### Context

invite 或 `X-Station-Peer-ID` 只能表达声明，不能证明注册者控制对应 Station 私钥。
删除 mount 但保留可刷新 credential 也不能实现撤销。

### Decision

Relay 发出 challenge，Station 使用其 host key 对 challenge、invite、Relay identity
和请求参数签名。Relay 从 public key 推导 `station_peer_id`，并原子消费 invite、
创建 mount generation。短期 credential 使用独立非对称 issuer 和
`aud/scope/jti/exp/generation`；撤销递增 epoch 并关闭流。

### Rationale

proof-of-possession 把 enrollment 与现有 Station identity 绑定；generation 让撤销
和轮换具备可验证语义。

### Alternatives Considered

- 继续信任 header 中的 PeerID：拒绝，可冒充未定向 Station。
- 全局 HS256 secret：拒绝，跨角色共享密钥扩大泄漏半径。
- 仅删除数据库 mount：拒绝，旧 token 可重建状态。

### Consequences

invite 只存 hash 且明文只返回一次；注册、刷新、撤销和恢复需专门的并发与重放测试。

---

## SAL-D11：Relay 使用显式最小运行角色

**Status**: accepted
**Date**: 2026-10-06

### Context

当前 Relay 与 Station 使用同一 image/config，Relay 可能同时暴露不需要的业务
subserver。网络边界上的 Relay 不应拥有 Station 业务攻击面。

### Decision

保留同一代码库和 binary，通过显式 `relay` role allowlist 只装配 health、discovery、
operator admin、mount control、opaque tunnel 和 metrics。生产 Relay 缺少经评审的
外层 TLS boundary、signing key、operator policy 或配额时部署失败；使用外部
terminator 时，Relay 明文 upstream 只能绑定共享网络命名空间的 loopback。

### Rationale

同源构建避免烟囱库，最小运行角色降低攻击面并使 route inventory 可机械验证。

### Alternatives Considered

- 新建独立 Relay 仓库：拒绝，会复制协议、发布和安全治理。
- 同一进程默认加载所有 Station handler：拒绝，攻击面不可控。

### Consequences

部署配置、启动检查、API ownership 和 Acceptance 都必须按 role 证明允许与禁止项。

---

## SAL-D12：按 canonical client class 原子接管 Session

**Status**: accepted
**Date**: 2026-10-06

### Context

Station 旧 `CreateWithKick` 按 `device_type` 撤销同类 Session，允许 Desktop 与
Mobile 并存。后续 Access Gate password finalizer 改成按 `device_id` 替换，
OAuth acknowledgement 又撤销 actor 的全部 Session；Desktop restore/takeover
还提交 `desktop-native`。三个入口因此对同一产品语义使用三个不同槽定义，
既可能允许两个 Desktop 并存，也可能错误踢掉 Mobile。

### Decision

Station Session authority 使用 canonical client class `desktop | mobile | web`
作为并发槽。一个 actor 在一个 Station 每个 class 最多有一个未撤销 Session；
新同类 Session 原子撤销旧同类 Session，不撤销其他 class。

密码 Access Gate、OAuth acknowledgement 与 session takeover 共用该策略。
`device_id` 继续标识安装实例并绑定 Messaging/OAuth/lifecycle，不决定并发槽。
Desktop 统一提交 `desktop`，Mobile 提交 `mobile`；非 canonical 运行时标签
fail closed。既有 `desktop-native` 行在迁移时一次性归一，不保留运行时 alias。

### Rationale

用户需要同账号跨 Desktop/Mobile 连续使用，同时避免同类客户端并发产生不明确的
当前端。把类别与设备身份分离后，Station 能同时保证跨类别共存、同类别单一 winner
和 Session/Messaging 设备绑定。

### Alternatives Considered

- 按 `device_id` 接管：拒绝，因为每个新安装都会获得新的并发槽。
- 每次登录撤销 actor 全部 Session：拒绝，因为破坏 Desktop+Mobile 共存。
- 接受 `desktop-native` 等 alias：拒绝，因为运行时标签会变成永久业务类别。
- 仅在客户端本地互斥：拒绝，因为多机器和多安装不能共享本地 registry。

### Consequences

- Session schema migration 必须归一历史类别并处理已存在的同类重复 active 行。
- 激活事务必须锁定 actor 行，并由 active class partial unique index 保证并发
  登录仍收敛到每类一个 winner。
- 被接管端通过既有 `session_revoked/kicked` 路径停止 runtime 并回到 Access Gate。
- Browser 保持独立 `web` 类别；本项目不声明 Browser 产品验收。

### Reversal Trigger

只有新的多实例产品合同明确允许同类并发，并同时定义 device picker、winner、
通知、写入冲突和撤销语义时，才可替换该策略。

---

## SAL-D13：Relay 服务宿主仅支持 Linux/POSIX

**Status**: accepted
**Date**: 2026-10-08

### Context

Relay 是长期运行的公网或内网基础设施服务。为 Windows Relay 单独维护 service
adapter、构建路径、部署 profile、密钥 ACL 和 Acceptance 会形成第二套服务端运行
合同，而 canonical Relay 环境及反向代理、证书、观测和运维设施均基于 Linux。

### Decision

Relay service host 的支持矩阵仅包含遵循 POSIX runtime contract 的 Linux 部署。
Windows 不作为 Relay 服务宿主选项，不实现 Windows Relay service adapter，不创建
Windows Relay deploy profile，不设置 Windows Relay 编译门，也不接受 Windows
Relay 运行证据。

Windows Desktop 继续作为客户端平台，并通过 Linux Relay 完成同一 discovery、
binding 和 tunnel journey。Windows Station 的支持边界由 Station 模块独立裁决，
不能成为扩展 Relay host 矩阵的依据。

### Rationale

单一 Linux 服务端合同可以复用成熟的进程监管、NGINX/Web PKI 终止、文件权限、
日志、指标和容量治理，避免为低概率部署形态长期维护分叉的安全与运维实现。

### Alternatives Considered

- 同时支持 Linux 与 Windows Relay：拒绝，会产生两套服务端部署和安全证明。
- 保留 Windows Relay 代码但不宣称支持：拒绝，死路径会继续扩大维护与误用风险。
- Windows 仅用于本地 Relay 模拟：拒绝，内网模拟也必须复用生产 Linux 行为。

### Consequences

- 所有当前执行 Plan、部署清单和 Acceptance 都必须删除 Windows Relay 宿主范围。
- canonical Relay 运行与证明绑定到已评审的 Linux profile。
- Windows Desktop Relay E2E 继续保留，但它证明的是 Windows 客户端连接 Linux
  Relay，不是 Windows 服务端兼容性。

### Reversal Trigger

只有新的产品合同明确要求 Windows Relay 宿主，并同时承担完整的部署、安全、升级、
观测和 Acceptance 长期成本时，才能通过新的架构决策替换本约束。
