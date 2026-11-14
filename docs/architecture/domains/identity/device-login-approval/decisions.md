# Device Login Approval — 设计决策

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-11-12 | **Updated**: 2026-11-12
> **Owner**: Identity and Access

以下决策已于 2026-11-12 经架构评审接受（accepted）。MSL-D01 至 MSL-D07 继续有效，
本文件只登记发起方向、UX 归属与兜底定位的新决策。文档级 Status 仍为 draft，
待实现落地、governedPaths 存在后转 active 并登记模块 registry。

## 决策索引

| ID | 决策 | 状态 |
|----|------|------|
| DLA-D01 | claimant-first：凭据先行、登录卡等待审批 | accepted |
| DLA-D02 | 独立 login_approval proto 与 subserver，复用 device-link-core 密码学 | accepted |
| DLA-D03 | 全对称审批：任意设备可申请、任意已登录设备可批准 | accepted |
| DLA-D04 | Access Gate 新增 DEVICE_APPROVAL_REQUIRED，审批不绕过终裁 | accepted |
| DLA-D05 | 审批呈现为 Shell 全局弹窗 + 系统通知，设置只做设备管理 | accepted |
| DLA-D06 | 恢复短语降为兜底，移除 chat 恢复硬门禁 | accepted |
| DLA-D07 | 无设备可审批时走邮箱强校验；邮箱挑战是待建能力 | accepted |
| DLA-D08 | v1 用有界轮询送达审批请求，Station 推送扇出后置 | accepted |

---

## DLA-D01：claimant-first，凭据先行、登录卡等待审批

**Status**: accepted
**Date**: 2026-11-12

### Context

现有 Device Link 由已登录设备在 Settings 面板发起二维码，新设备只能扫码进入；
新设备没有“输凭据 → 等批准”的入口，审批动作埋在设置里，登录链路断裂。

### Decision

新设备在登录卡选择 Station、提交凭据；凭据通过后由 Station 创建登录审批事务，
登录卡进入等待态，直到任一已登录设备批准或事务终态。

### Rationale

用户心智是“我在哪台设备都能登，另一台设备放行即可”；发起方属于要登录的设备，
审批方只做放行，不需要预先操作。

### Alternatives Considered

保留扫码发起、仅优化面板入口：扫码仍要求两台设备物理同处且老设备先行操作，
不解决“新设备独立发起”的产品诉求。

### Consequences

Station 需要无会话但凭据绑定的新事务面；登录卡新增 waiting 阶段与取消/兜底入口。

---

## DLA-D02：独立 proto 与 subserver，复用 device-link-core

**Status**: accepted
**Date**: 2026-11-12

### Context

`device_link.proto` 的 offer 由认证设备创建，载荷含 QR locator、scan capability 与
网络引导材料；新流程的发起方无会话、持票访问，信任姿态与限流模型不同。

### Decision

新增 `model/domain/auth/login_approval.proto` 与 Station subserver
`app/subserver/login_approval/`；HPKE suite、transcript 域分隔、指纹与 CAS 原语
继续由 `packages/device-link-core` 唯一提供。

### Rationale

协议边界表达信任边界：无会话面的攻击面（枚举、刷事务、持票重试）需要独立限流与
审计，混入会污染扫码事务的不变量；密码学实现保持单一真源满足复用原则。

### Alternatives Considered

扩展 device_link.proto 增加 claimant-first 模式：一套状态机承载两种认证姿态，
条件分支与权限校验容易漏检，且 QR 引导字段在新流程中是死载荷。

### Consequences

新增一套 proto 与 subserver 骨架；两端 runtime 多一个模块；Device Link 文档中
与发起方向耦合的段落需在集成文档标注替代关系。

---

## DLA-D03：全对称审批

**Status**: accepted
**Date**: 2026-11-12

### Context

当前只有桌面能审批手机。用户要求任意设备均可作为新设备登录，也均可作为审批方。

### Decision

审批方资格定义为“同 Actor、active session、已 enrolled、device_id 不同于 claimant”，
不区分平台；手机可以审批桌面登录，反之亦然。

### Rationale

per-device Session 与 Actor seed 交付本身是平台中立的；按平台限制审批资格没有
安全收益，只制造能力缺口。

### Alternatives Considered

仅反转方向（手机申请、桌面审批）：桌面作为新设备时无路可走，模型不对称，后续仍要返工。

### Consequences

Mobile 需新增 approver 弹窗与密封/签名 UI（目前只有 claimant 实现）；
Desktop 需新增 claimant 等待态。两端工作量对称增加。

---

## DLA-D04：Access Gate 拥有 DEVICE_APPROVAL_REQUIRED

**Status**: accepted
**Date**: 2026-11-12

### Context

MSL-D02 已确立 Station 协调授权、Access 保留终裁；新流程不能让审批本身变成准入。

### Decision

Access 决策新增 `DEVICE_APPROVAL_REQUIRED` 要求：凭据通过但设备未登记时决策保持
非 GRANTED 并创建审批事务；事务完成后 claimant 重新提交 Access，当前策略 GRANTED
才激活 Session。首设备（无已登记设备）不触发该要求。

### Rationale

策略更新、维护窗口、allowlist、terms 等既有 gate 在批准前后都持续生效；
审批与准入是两个独立决策点。

### Alternatives Considered

批准即发 Session：绕过批准后的策略重求值，扩大账号接管边界，违背 MSL-D02。

### Consequences

Access gate proto 与 Station 求值链需要新增一种决策要求；客户端 AccessGateHost
需要能渲染等待态并在终态后自动续接。

---

## DLA-D05：审批呈现为 Shell 全局弹窗 + 系统通知

**Status**: accepted
**Date**: 2026-11-12

### Context

审批入口埋在 Settings 面板导致请求无人感知；用户明确要求审批不出现在 chat，
而在已登录设备的显著表面等待处理。

### Decision

已登录设备在 Shell 层挂载全局 `LoginApprovalDialogHost`：前台直接弹模态审批框
（设备名 + 核对码 + 允许/拒绝）；窗口失焦或应用后台时发系统通知
（桌面 `objc2-user-notifications`，移动既有 `push_bridge`），点击拉起弹窗。
Settings 仅保留已授权设备的查看与撤销。

### Rationale

审批是安全决策，需要与聊天内容分离的聚焦表面；运行时单 flight 轮询保证弹窗由
投影驱动而非组件自取数。

### Alternatives Considered

通知铃铛红点 + 设置内处理：打扰小但容易漏批，claimant 会无意义干等。

### Consequences

需要定义弹窗与现有 modal/Toast 的层级合同及 i18n 键；后台通知的 Station 扇出
能力未就绪部分见 DLA-D08。

---

## DLA-D06：恢复短语降为兜底，移除 chat 硬门禁

**Status**: accepted
**Date**: 2026-11-12

### Context

`MessagingRecoveryGate` 在 chat 表面硬阻断未通过连续性校验的设备，24 词短语从
兜底变成日常路障；而审批登录本来就交付 Actor seed，正常路径连续性应当闭合。

### Decision

- 批准路径完成 seed 交付后，消息引擎连续性必须 active；若仍 recovery_required，
  按缺陷处理并在登录面提示，不得在 chat 再立门禁。
- 删除 chat 路由上的 `MessagingRecoveryGate`；短语输入只存在于登录兜底面与
  Settings 的恢复管理。
- 兜底直登（无 seed）进入受限模式：HTTP 业务可用，E2EE 消息区给非阻断式内联
  恢复入口，用户可跳过并保留数据。

### Rationale

兜底手段不能占据主业务流；阻断式 chat 门禁使用户把正常登录感知为“设备不可用”。

### Alternatives Considered

保留门禁只改文案：症状不变，且与审批登录的身份闭合承诺矛盾。

### Consequences

需要原生 Journey 证明“审批登录后引擎 active”；受限模式的消息区空状态是新增 UX 合同，
需产品确认文案与可达性；短语能力本身不删除。

---

## DLA-D07：无设备可审批走邮箱强校验；邮箱挑战是待建能力

**Status**: accepted
**Date**: 2026-11-12

### Context

首设备之后的设备全丢场景需要兜底。用户选择邮箱强校验直登；源码核实 Station 当前
只有 OAuth 的 `email_verified` 声明，没有邮箱验证码/挑战端点与邮件投递设施。

### Decision

兜底折叠入口（“无法使用其他设备？”）通向邮箱强校验：密码 + 一次性邮箱挑战，
通过后允许无审批登录并进入 DLA-D06 的受限模式。邮箱挑战的 proto、Station 端点、
邮件投递与限流作为本模块声明的**新能力缺口**单列验收，未落地前兜底仅提供
“密码 + 24 词短语恢复”（短语备份存在时）。

### Rationale

如实区分已有能力与待建能力，避免把不存在的邮箱 OTP 写成既有合同；兜底可见但不阻塞
主路径开发。

### Alternatives Considered

只保留短语恢复：无备份用户在设备全丢时永久锁出，不可接受；
接入第三方认证 App TOTP：需要额外注册流程，超出当前需求。

### Consequences

新增邮件投递基础设施依赖（发信通道、模板、退信处理），其运维归属与 Station 部署
形态需要单独评审；在它落地前产品文案不得承诺邮箱直登已可用。

---

## DLA-D08：v1 有界轮询，推送扇出后置

**Status**: accepted
**Date**: 2026-11-12

### Context

Mobile 已有 push bridge，但 Station 把“登录审批请求”扇出到所有同 Actor 设备的
推送链路尚未接线；桌面端无后台常驻推送。

### Decision

v1 送达机制：claimant ≥2s 持票轮询；approver 在 Shell 活跃期 ≥5s 认证轮询，
后台停止轮询、回前台立即单 flight 读取；前台弹窗 + 本地系统通知。
基于 Station 推送的后台实时送达列为后续增强，复用 mobile push bridge 注册通道，
不新建推送服务。

### Rationale

轮询复用现有 runtime 模式即可闭环主 Journey，避免在登录重设计里捆绑推送改造；
审批事务 TTL 内用户回前台即可处理，延迟可接受。

### Alternatives Considered

首版即做全量推送扇出：跨 Station/Relay/APNs/FCM 的链路长，会把登录 UX 改造拖入
基础设施项目。

### Consequences

应用完全杀进程时不会实时收到审批告警；需要在审批弹窗与文档中如实说明，
并把“后台送达时延”列入质量观测指标与反转触发条件（用户实测不可接受则提前做扇出）。
