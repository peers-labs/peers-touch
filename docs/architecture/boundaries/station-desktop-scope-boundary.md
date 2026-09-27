# Station/Desktop 职责边界与功能分配架构

> **Status**: active
> **Version**: v2.0
> **Created**: 2026-04-20 | **Updated**: 2026-09-27
> **Owner**: Architecture Team
> **Module**: `apps/station/`, `apps/desktop/`

---

## 1. 文档目标

- 定义 `apps/station` 与 `apps/desktop` 的职责边界。
- 明确每个能力的 Owner 与 Source of Truth。
- 为跨端架构模块提供上游约束。

Mobile 的接入细节由
`docs/architecture/station-access-lifecycle/README.md` 与平台文档定义。

## 2. 一句话边界

- Station 负责共享业务能力与系统事实。
- Desktop 负责设备交互体验与本地执行编排。

## 3. 设计原则

- 单一真源：跨端可见状态只能有一个权威 owner。
- 领域归属：业务规则、状态机、权限策略属于 Station domain。
- 端侧编排：Desktop 不维护独立业务真相。
- 接口收敛：Desktop 只调用 capability registry 登记的 Station API。
- 设备特权隔离：窗口、托盘、文件和本地安全存储留在 Desktop。

## 4. Scope

### 4.1 Station

- 业务域模型与状态机。
- 身份、权限、审计、限流与配额。
- 跨端一致的数据与事件流。
- 对外 API 契约与版本。
- 关键业务流程的最终裁决。

### 4.2 Desktop

- 页面渲染、交互流程与可用性体验。
- 系统能力适配。
- scope-bound 本地缓存与会话加速。
- API 调用编排、重试和降级展示。
- 设备态配置与偏好。

## 5. 能力分配

| 能力域 | Station 职责 | Desktop 职责 | 真源 |
|---|---|---|---|
| Conversation | 会话、成员、事件和投递语义 | 会话 UI 与本地投影 | Station |
| Social | 关系、发现和策略 | 入口、交互与本地展示 | Station |
| Access | Station identity、Access Gate、Session | gate 呈现、输入和 runtime bootstrap | Station |
| Federation | context、membership、Ledger、transport | context 选择与状态展示 | Station |
| Agent | provider、run、artifact 与协作事实 | 工作台和本地宿主能力 | Station |
| Storage | 对象协议、共享元数据和访问策略 | 上传交互、缓存与设备文件 | 按资源 owner |
| 系统能力 | 不承载 | 窗口、托盘、通知、剪贴板和文件选择 | Desktop |
| 设备偏好 | 可选全局策略 | 本地 UI 和设备配置 | Desktop |

## 6. 当前代码入口

### 6.1 Station

- 组合入口：`apps/station/app/main.go`
- Domain owners：`apps/station/app/subserver/`
- Framework owners：`apps/station/frame/`
- 公共能力 registry：
  `docs/architecture/api-ownership/station-api-capabilities.yaml`

### 6.2 Desktop

- 前端能力 facade：`apps/desktop/src/services/desktop_api.ts`
- Runtime owners：`apps/desktop/src/runtimes/`
- 本地命令注册：`apps/desktop/src-tauri/src/main.rs`
- 页面与设置：`apps/desktop/src/pages/`、`apps/desktop/src/components/`

## 7. 决策规则

1. 跨端共享数据、状态或策略默认由 Station 拥有。
2. 设备特权由 Desktop 拥有，并通过窄 Host adapter 暴露。
3. 每个公共能力必须有唯一 capability ID、owner、contract 和 truth source。
4. 未登记接口或同一能力的第二 owner 阻断合入。

## 8. 认证与接入

Desktop 认证必须遵循 Station Access Lifecycle：

```text
signed Station identity
  -> protobuf Access Gate
  -> Station-issued session
  -> Station/Actor/Device scope
  -> runtime bootstrap
```

OAuth、密码、邀请或其他 gate 只是在同一 Access Gate 状态机中的 typed action，
不形成独立认证体系。

## 9. 验收标准

- 每个能力域都有明确 Owner、contract 与真源。
- Desktop 不承载跨端业务真相。
- Station API 与 Desktop consumer 能通过 capability ID 一一映射。
- 新功能评审附带职责归属与允许依赖结论。
- Station Access 变更通过对应架构与原生 Acceptance。
