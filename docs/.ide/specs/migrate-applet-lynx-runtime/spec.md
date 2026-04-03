# Applet Lynx 化迁移 Spec

## Why
当前 Desktop Applet 运行链路仍基于 iframe 与前端消息桥，存在安全边界弱、权限控制分散、实现与“Rust 托管”目标不一致的问题。需要一次性迁移到 Lynx 托管运行时，消除历史双轨与技术债。

## What Changes
- 将 Applet 运行时从 iframe 方案迁移为 Lynx Host 托管方案。
- 将 Applet 调用链统一为 `applet-sdk -> Lynx Bridge -> Tauri(Rust) Capability Gateway`。
- 将 `packages/applets` 固定为唯一产物来源，主程序仅消费 `applets-dist` 与标准化 manifest/index。
- 移除前端 `postMessage` 消息桥与 iframe 沙箱相关实现。
- 在 Rust 侧建立统一权限与能力网关，按 manifest 进行 deny-by-default 校验。
- 建立 applet 协议与 manifest 的版本治理、校验与迁移约束。
- **BREAKING**: 不再兼容旧 iframe 运行模式与旧桥接协议（api-call/api-response）。
- **BREAKING**: 不再兼容未声明能力的 Applet 调用；不符合新 schema 的 applet 直接拒载。

## Impact
- Affected specs: Applet Runtime、Capability Gateway、Applet Manifest、Desktop 插件加载机制、安全模型
- Affected code: `apps/desktop/src/applet/*`、`apps/desktop/src/pages/AppletRuntimePage.tsx`、`apps/desktop/src/App.tsx`、`apps/desktop/src-tauri/src/interface/tauri_commands/applets.rs`、`apps/desktop/src-tauri/src/application/applets/mod.rs`、`packages/applet-sdk/*`、`packages/applets/build.js`、`packages/applets/dev-sync.js`

## ADDED Requirements
### Requirement: Lynx 托管运行时
系统 SHALL 使用 Lynx Host 作为 Desktop Applet 的唯一运行时，不允许通过 iframe 加载 applet UI。

#### Scenario: Applet 成功加载
- **WHEN** 用户在主程序中打开 `applet:<id>`
- **THEN** 主程序通过 Lynx Host 加载该 applet 的入口产物并渲染
- **AND** 不创建 iframe 容器

### Requirement: Rust 统一能力网关
系统 SHALL 在 Rust(Tauri) 侧提供统一的 applet 能力调用网关，并对每次调用执行权限校验、参数校验和审计记录。

#### Scenario: 权限允许的能力调用
- **WHEN** Applet 调用已声明且允许的 capability
- **THEN** Rust 网关执行能力并返回标准化结果
- **AND** 记录 applet_id、session_id、request_id 与调用结果

#### Scenario: 权限不允许的能力调用
- **WHEN** Applet 调用未声明或被禁用 capability
- **THEN** Rust 网关拒绝调用并返回 Forbidden 类错误
- **AND** 主程序不执行任何副作用操作

### Requirement: 产物与契约唯一真源
系统 SHALL 仅使用 `packages/applets` 构建产物作为运行来源，且必须通过标准化 `index.json + applet.json` 契约进行发现和加载。

#### Scenario: 合法产物被加载
- **WHEN** applet 产物满足 schema 与完整性校验
- **THEN** applet 出现在主程序列表并可运行

#### Scenario: 非法产物被拒绝
- **WHEN** applet 缺失必要字段、协议版本不兼容或校验失败
- **THEN** 主程序拒绝加载并提供可诊断错误

### Requirement: 协议版本治理
系统 SHALL 定义并执行 bridge protocol 版本策略，不支持的旧协议必须被明确拒绝。

#### Scenario: 旧协议调用
- **WHEN** applet 使用旧版 iframe/postMessage 协议
- **THEN** 主程序返回协议不兼容错误
- **AND** 不进入兼容分支

## MODIFIED Requirements
### Requirement: Applet 运行与通信机制
系统 SHALL 将原前端消息桥通信机制替换为 Lynx Native Bridge + Rust Gateway 通信机制；前端页面层仅负责生命周期与展示，不负责能力分发与权限判断。

## REMOVED Requirements
### Requirement: iframe Applet 运行模式
**Reason**: iframe 模式与 Rust 托管目标冲突，且存在可被滥用的跨上下文通信与边界不清问题。  
**Migration**: 删除 `LynxContainer` 中 iframe 实现与 `AppletManager` 的 postMessage 分发路径；applet 全量迁移至 Lynx Bridge 协议。
