# Device Login Approval — 模块目录结构

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-11-12 | **Updated**: 2026-11-12
> **Owner**: Identity and Access

## 目标目录树

```text
model/domain/auth/
├── device_link.proto                 # 保留：扫码引导事务
└── login_approval.proto              # 新增：claimant-first 登录审批事务

apps/station/
├── app/subserver/login_approval/     # 新增业务 subserver
│   ├── subserver.go                  # 组合根，注册一次
│   ├── status_handlers.go            # 无会话/认证两组 HTTP 入口
│   ├── application/
│   │   ├── service.go                # 协调器：创建/查询/批准/拒绝/取消/ack
│   │   ├── approval.go               # approver 资格与 CAS 批准
│   │   ├── delivery.go               # 身份密文暂存与凭据交付
│   │   ├── lifecycle.go              # TTL 回收与终态收敛
│   │   └── owner_errors.go           # 类型化错误
│   ├── domain/
│   │   ├── transcript.go             # approval transcript 规则
│   │   ├── protocol.go               # 状态机与预算常量
│   │   └── capability.go             # possession secret 哈希校验
│   └── infrastructure/
│       ├── persistence/
│       │   └── models.go             # 事务/capability/audit 表
│       └── hpke.go                   # 复用 device-link-core 的验证端口
└── frame/touch/accessgate/           # 改造：新增 DEVICE_APPROVAL_REQUIRED 要求
    └── （既有 owner，不新增并行决策链）

packages/device-link-core/            # 复用：HPKE/transcript/指纹原语（不新建 crate）

apps/desktop/src-tauri/src/
├── application/login_approval/       # 新增：claimant 持票、approver 密封签名
├── interface/tauri_commands/
│   └── login_approval.rs             # 只发布去秘密投影
└── infrastructure/（通知复用 objc2-user-notifications）

apps/desktop/src/
├── runtimes/loginApprovalRuntime.ts  # 新增：单 flight 轮询、sessionEpoch fence
├── store/loginApproval.ts            # 新增：claimant/approver 双投影
├── components/shell/
│   └── LoginApprovalDialogHost.tsx   # 新增：Shell 全局审批弹窗
├── pages/login/views/
│   └── LoginApprovalWaitingView.tsx  # 新增：登录卡等待态（含折叠兜底入口）
└── components/chat/
    └── MessagingRecoveryGate.tsx     # 删除（恢复入口迁登录面/Settings）

apps/mobile/src-tauri/src/runtime/
└── login_approval/                   # 新增：intake/delivery/actions/protocol/projection

apps/mobile/src/
├── runtimes/loginApprovalRuntime.ts  # 新增
├── features/auth/
│   ├── loginApprovalStore.ts         # 新增
│   ├── LoginApprovalWaitingCard.tsx  # 新增：AccessGateHost 容器内等待面
│   └── LoginApprovalApproverDialog.tsx # 新增：移动审批弹窗
└── platform/push_bridge.rs           # 复用：后台通知（扇出接线后置，DLA-D08）
```

## 文件职责

| 路径 | 职责 |
|------|------|
| `login_approval.proto` | 无会话/认证两面消息、状态枚举、错误码的唯一 wire 真源 |
| Station `application/service.go` | 事务生命周期编排，只通过端口调用 Access/Session/Actor Identity |
| Station `domain/transcript.go` | approval transcript 规范化与 purpose 域分隔 |
| Station `infrastructure/persistence` | 事务表、capability 哈希、audit 追加写 |
| `device-link-core`（既有） | HPKE 固定 suite、身份指纹、密文验证；本模块零新增密码学实现 |
| Desktop/Mobile native runtime | 密钥生成与安全存储、持票持久化、PoP 签名、native 通知调度 |
| `loginApprovalRuntime.ts`（两端） | 投影轮询、终态处理、scope fence；不拥有事务真源 |
| `LoginApprovalDialogHost` | approver 前台模态；由 runtime 投影驱动，无 mount 轮询 |
| `LoginApprovalWaitingView/Card` | claimant 等待态、核对码、取消与折叠兜底入口 |
| Access Gate 改造点 | 输出 `DEVICE_APPROVAL_REQUIRED` 并在终态后接受重裁 |

## 依赖关系

允许方向：

```text
login_approval subserver -> Access / Session / Actor Identity（端口）
client runtime -> 本端 native application -> Station HTTP
login_approval 模块 -> device-link-core（密码学原语）
login_approval 模块 -> shared-schema（如后续需要 deep-link，非 v1 必需）
```

禁止方向：

- frame 认证设施反向导入 `app/subserver/login_approval`。
- 客户端 UI 直接 import Station HTTP 细节或绕过 runtime 轮询。
- `login_approval` 依赖 `device_link` subserver 的内部包（只允许共享 core 与 proto 级别复用）。
- Relay role 加载本 subserver。

## 与现有模块的 registry 关系

模块 ID 规划为 `device-login-approval`，特征为
protocol/stateMachine/persistence/ownership/moduleLayout/crossRuntime/integration 全 true，
requiredDocuments 为 README/design/decisions/data-model/module-layout/integration。
与 `mobile-scan-login` 的 governedPaths 不重叠：新 proto、新 subserver、新 runtime 目录；
Access Gate 改造路径在 integration.md 中登记为跨模块影响，不夺取其 ownership。
