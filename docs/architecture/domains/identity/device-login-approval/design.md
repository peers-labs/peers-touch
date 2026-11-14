# Device Login Approval — 架构设计

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-11-12 | **Updated**: 2026-11-12
> **Owner**: Identity and Access

---

## 1. 证据台账

| Claim | Class | Evidence | Confidence | Missing proof |
|---|---|---|---|---|
| 活跃会话唯一索引为 `(station_peer_id, user_id, device_id) WHERE revoked=false`，同设备替换、异设备并存 | verified_fact | `apps/station/frame/core/facility/session/db_store.go` 索引 DDL 与 `RevokeReplacedDeviceSessions`；旧 client-class 索引不存在有测试断言 | 高 | — |
| Device Link 事务（claim/approve/HPKE 交付/Access/ack/CAS）已存在且为已登录设备发起 | verified_fact | `model/domain/auth/device_link.proto`；Station `app/subserver/device_link/`；两端 native runtime | 高 | — |
| 审批 UI 仅存在于 Settings 设备面板，无 Shell 级审批入口 | verified_fact | `DeviceLinkPanel.tsx` 仅由 `AccountTab.tsx` 挂载；`deviceLinkRuntime` 面板打开时轮询 | 高 | — |
| 移动新设备只有扫码主入口，但凭据登录链独立存在 | verified_fact | `App.tsx` access-gate-chain 渲染 `AccessGateHost`，同时提供 `onLogin` 与 `onScan` | 高 | — |
| chat 表面存在恢复短语硬门禁，触发条件为引擎连续性被拒 | verified_fact | `MessagingRecoveryGate.tsx`；`messaging-recovery-service.ts` readiness 注释 | 高 | — |
| 移动侧已有 push bridge；桌面已有 macOS 用户通知依赖 | verified_fact | `apps/mobile/src-tauri/src/platform/push_bridge.rs`；desktop Cargo `objc2-user-notifications` | 高 | 后台审批推送的 Station 扇出未接线 |
| Station 无邮箱验证码/OTP 能力，只有 OAuth `email_verified` 声明 | verified_fact | 全仓 grep 无 email challenge/OTP 端点与 proto | 高 | — |
| 审批登录交付同一 Actor seed 后，引擎连续性应通过，不再触发 recovery_required | inference | 连续性校验针对 Actor 身份一致性；seed 交付即同身份（MSL-D03） | 中 | 需原生 Journey 实测闭合 |
| 用户遇到的“批了仍不可用”是 COMMITTED 后 Access/PIN/连续性摩擦的叠加 | hypothesis | invariant 明确 COMMITTED≠GRANTED；无当时 trace | 低 | 诊断 Gate 复现完整死路 |
| claimant-first 事务、全对称审批、chat 门禁移除 | accepted_decision | DLA-D01 至 DLA-D08，2026-11-12 评审接受 | 高 | 实现与原生 Journey 证据 |

## 2. 核心原则

1. **凭据先行，审批后置，Station 终裁。** 新设备先过既有 Access Gate 凭据校验；
   审批是设备授权策略，不是凭据替代品；Access 保留 GRANTED 终裁权（继承 MSL-D02）。
2. **一个事务只授权一台设备。** 每次登录申请绑定单一安装实例的 HPKE 公钥与 device_id；
   任一已登录设备批准即终局，其他审批请求随之失效。
3. **身份随审批闭合，恢复短语退兜底。** 批准路径加密交付 Actor seed，身份连续性在登录
   瞬间闭合；24 词短语只服务于“无设备可审批”的罕见场景。
4. **呈现位置是架构合同。** 申请等待态只属于登录卡；审批弹窗只属于已登录设备的 Shell
   全局层；两者都不得进入 chat 表面或设置主路径。
5. **无会话面最小暴露。** 无认证端点只接受凭据已通过的 access attempt 绑定请求，持票
   （capability）访问，限流、限期、限量，不暴露账号设备清单。
6. **首设备不审批。** Actor 尚无已登记设备时（注册/首登），不产生审批事务，避免死锁。

## 3. 系统架构

运行拓扑沿用现有 Client ↔ Station 关系，不新增云代理；Model 是双方消费的契约底座，
不是运行时节点。现行拓扑见 [runtime-topology.svg](../../../runtime-topology.svg)
（viewpoint: Runtime Topology，箭头表示在线调用）。

目标态的权威归属（viewpoint: Authority Map，文字投影；canonical 图在状态升 active 前补画）：

| 状态/决策 | Owner | 客户端角色 |
|---|---|---|
| Access attempt 与凭据裁决、`DEVICE_APPROVAL_REQUIRED` 策略 | Station Access Gate | 提交、只读投影 |
| 登录审批事务、CAS revision、TTL、限流 | Station Login Approval 协调器（新 subserver） |  claimant 持票轮询；approver 认证轮询 |
| Actor seed HPKE 密封与审批 transcript 签名 | 审批设备 native（复用 `packages/device-link-core`） | 私钥不出端 |
| Actor Device enrollment、profile revision | Station Actor Identity | claimant 证明设备 |
| Session 准备/激活/撤销 | Station Session DBStore（既有 per-device 合同） | 经原 identity/PIN pipeline 接纳 |
| 登录卡等待态、Shell 审批弹窗、系统通知 | 各端 runtime + 页面 | UI 仅投影，不持事务真源 |
| 24 词恢复短语 | Settings 与登录兜底面；messaging recovery 服务不变 | chat 不再承载 |

## 4. 动态流程

下图为辅助说明（非 canonical 图）。实线为主路径，`alt` 为互斥分支。

```text
claimant(新设备)            Station Access/Approval          approver(已登录设备)
      |                              |                              |
      |-- 1. access attempt + 凭据 -->|                              |
      |                              |-- 凭据校验                    |
      |          alt 首设备/无已登记设备 --> GRANTED，直接发 Session  |
      |          alt 已有设备且 device_id 未知                       |
      |<-- 2. DEVICE_APPROVAL_REQUIRED + 事务ID + claimant capability|
      |                              |-- 3. 待审批投影对同 Actor 会话可见
      |                              |----------------------------->|
      |                              |              4. Shell 弹窗/系统通知
      |                              |<----- 5. allow(HPKE 密文+签名)/deny
      |-- 6. 持票轮询状态 ----------->|                              |
      |<-- 7. APPROVED + 身份密文 ----|                              |
      |-- 8. 解封 seed、enroll 设备 ->|                              |
      |                              |-- 9. Access 重裁 GRANTED      |
      |<-- 10. 凭据交付，ack --------|                              |
      |-- 11. 原 PIN/Shell pipeline ->|                              |
      |          else 无设备可审批：折叠兜底入口（邮箱强校验/短语恢复）|
```

关键顺序约束：

- 步骤 2 的事务创建与凭据裁决在同一 Access 决策修订内；无凭据通过不得创建事务。
- 步骤 5 与步骤 9 之间，Station 重新求值当前 policy 与审批设备会话有效性；
  审批设备在批准前被撤销 → 事务失败为 `APPROVER_REVOKED`，不交付任何材料。
- 步骤 10 的 ack 是 Session 原子激活的前置（继承 Device Link 提交语义）。
- 步骤 11 之后才进入 PIN/Shell；本事务不拥有生命周期（invariant: COMMITTED≠GRANTED）。

## 5. 核心契约

### 5.1 协议归属

新增 `model/domain/auth/login_approval.proto`，与 `device_link.proto` 并列。
理由见 DLA-D02：无会话发起面的信任姿态、限流与持票模型不同，不并入扫码事务。
HPKE suite、transcript 域分隔、身份指纹算法与 Device Link 完全一致，由
`packages/device-link-core` 提供唯一实现，禁止第二套密码学。

### 5.2 两面三端点

```text
无会话面（claimant，持 capability）：
  POST /auth/login-approval/create   绑定 credential-passed access attempt
  POST /auth/login-approval/status   持票读自己的事务投影
  POST /auth/login-approval/cancel   持票取消

认证面（approver，active session + enrolled actor device，同 Actor）：
  POST /auth/login-approval/list-pending
  POST /auth/login-approval/approve  HPKE identity material + transcript 签名
  POST /auth/login-approval/deny
```

- claimant capability 为随机 256-bit possession secret， Station 仅存哈希；
  投影不含 capability、seed、token。
- approver 端点强制校验 session 绑定的 device_id 与 claimant 不同，且 Actor 一致。
- 所有写命令携带 request_id 幂等键与 observed_revision；冲突返回 `REVISION_CONFLICT`。

### 5.3 状态机

```text
PENDING -> APPROVED -> IDENTITY_DELIVERY -> DEVICE_PROVED
        -> ACCESS_PENDING -> CREDENTIAL_DELIVERY -> COMMITTED
PENDING -> DENIED | CANCELLED | EXPIRED
APPROVED -> EXPIRED（claimant 超时未取材料）
任意非终态 -> approver 会话失效 => APPROVER_REVOKED（归入 DENIED 终态 + reason）
```

状态单调、终态不可逆；全部迁移在 PostgreSQL 事务内 CAS 完成，禁止进程内内存裁决。

### 5.4 Access Gate 策略新增

Access 决策新增一项设备授权要求（不新增绕过通道）：

- Actor 已登记设备数为 0 → 不要求审批，沿用首登/注册。
- 凭据通过但 claimant `device_id` 未登记且 Actor 有已登记设备 →
  输出 `DEVICE_APPROVAL_REQUIRED`，创建审批事务，决策保持非 GRANTED。
- 设备数量上限若配置，属显式 Station 策略，达到上限返回 `DEVICE_LIMIT` 并给出
  已登记设备清单供撤销，禁止按 device_type 隐式踢人（继承 MSL-D07）。

## 6. 组件关系

### 6.1 Station

- 新 subserver `app/subserver/login_approval/`：application（协调器、CAS、TTL 回收）、
  domain（transcript/状态规则）、infrastructure（持久化、HPKE 验证端口）。
- 只通过端口调用 Access、Session、Actor Identity 既有 owner；frame 设施不反向导入业务
  协调器；Relay role 不加载本 subserver。
- 复用 Device Link 的 recovery 预算模式：终态回收、pending 上限、单请求有界调度。

### 6.2 Desktop

- Rust 新增 `application/login_approval/`：claimant 持票存储、approver 密封/签名、
  通知权限与 native 调度；Tauri 命令只发布去秘密投影。
- TS 新增 `runtimes/loginApprovalRuntime.ts` + `store/loginApproval.ts`：
  - claimant 等待态由登录卡（LoginPage 新 stage）消费，经 identityLifecycle 闭合。
  - approver 投影由 Shell 全局 `LoginApprovalDialogHost` 消费；运行时在 authenticated
    scope 内单 flight 轮询，随 sessionEpoch 销毁，禁止组件 mount 轮询。
- `MessagingRecoveryGate` 从 chat 移除；恢复入口只存在于登录兜底面与 Settings。

### 6.3 Mobile

- Rust 新增 `runtime/login_approval/`，结构对齐现有 device_link runtime
 （intake/delivery/actions/protocol/projection）。
-  claimant 等待态复用 `AccessGateHost` 卡片容器新增 waiting 面；approver 弹窗为新组件，
  后台告警经既有 `push_bridge`（Station 扇出接线列为 DLA-D08 的后续工作）。
- Session 与 Messaging 仍共享同一 device_id（invariant 不变）。

### 6.4 禁止关系

- 无会话端点不得返回账号已登记设备列表、设备名或其他账号枚举信息。
- 审批不得跳过 Access 重裁；approver 不得指定其他 Actor 或修改 claimant 密钥。
- UI 不得直连 Relay/Station HTTP 绕过 runtime；弹窗不得在 chat 路由内挂载。
- 不得新建平行 Session 表、平行 Actor Device 表或第二套 HPKE 实现。
- 兜底路径不得在主路径卡片上预渲染；用户不展开则不可见恢复短语输入。

## 7. 质量门（可证伪合同）

1. 手机申请 → 桌面批准 → 手机进 Shell 且消息引擎 active（无 recovery_required）。
2. 桌面申请 → 手机批准（全对称），同 Journey 断言两端会话并存、device_id 不同。
3. deny / cancel / TTL 过期 / approver 被撤销四类终态，claimant 卡片显示明确类型化原因。
4. 无审批设备兜底：折叠入口进入邮箱强校验/短语恢复；主路径任何阶段不出现短语输入卡。
5. chat 表面不再出现 `MessagingRecoveryGate`；批准登录后无硬阻断（契约测试 + 原生 Journey）。
6. 安全：无凭据创建被拒；持票错误访问被拒；并发批准只有一个 COMMITTED；pending 上限与
   限流在 Station 单测/集成测试可证。
7. 轮询预算：claimant ≥2s、approver ≥5s；后台不轮询；恢复前台立即单 flight 读取。
8. 以上 1–5 为原生 exact-source Journey，源码级测试不得替代产品证明。
