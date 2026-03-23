# Desktop Tauri Rust 业务迁移并行执行清单

## 1. 目标与边界
- 目标：将 `client/desktop` 的功能性业务逻辑迁移到 `apps/desktop/src-tauri`（Rust），`apps/desktop/src` 仅保留 UI 与状态编排。
- 非目标：本阶段不处理 UI 视觉重构、不处理设计语言统一、不处理移动端联动改造。
- 约束：
  - TS 页面层不直接承载业务规则；
  - 核心业务动作必须可追踪到 Rust `command -> application -> domain -> infrastructure`；
  - 迁移过程中保持现有 `/api` 可回退能力。

## 2. 当前基线（用于任务对齐）
- Tauri Rust 端当前仅最小启动壳：[apps/desktop/src-tauri/src/main.rs](file:///e:/Projects/peers-touch/peers-touch/apps/desktop/src-tauri/src/main.rs#L3-L6)。
- TS 端当前主要通过 `/api` 访问业务：[apps/desktop/src/services/api.ts](file:///e:/Projects/peers-touch/peers-touch/apps/desktop/src/services/api.ts#L1-L13)。
- 本地开发代理配置：[apps/desktop/vite.config.ts](file:///e:/Projects/peers-touch/peers-touch/apps/desktop/vite.config.ts#L13-L21)。
- 旧端业务主入口（迁移源）：
  - 鉴权：[auth_controller.dart](file:///e:/Projects/peers-touch/peers-touch/client/desktop/lib/features/auth/controller/auth_controller.dart)
  - 聊天：[friend_chat_controller.dart](file:///e:/Projects/peers-touch/peers-touch/client/desktop/lib/features/friend_chat/controller/friend_chat_controller.dart)
  - 发现：[discovery_controller.dart](file:///e:/Projects/peers-touch/peers-touch/client/desktop/lib/features/discovery/controller/discovery_controller.dart)
  - 资料：[profile_controller.dart](file:///e:/Projects/peers-touch/peers-touch/client/desktop/lib/features/profile/controller/profile_controller.dart)
  - 设置：[setting_controller.dart](file:///e:/Projects/peers-touch/peers-touch/client/desktop/lib/features/settings/controller/setting_controller.dart)
  - 管理员：[peers_admin_controller.dart](file:///e:/Projects/peers-touch/peers-touch/client/desktop/lib/features/peers_admin/controller/peers_admin_controller.dart)

## 3. 目标目录蓝图（Rust 业务分层）
```text
apps/desktop/src-tauri/src/
├─ main.rs
├─ error.rs
├─ state/
│  └─ mod.rs
├─ interface/
│  └─ tauri_commands/
│     ├─ mod.rs
│     ├─ auth.rs
│     ├─ chat.rs
│     ├─ timeline.rs
│     ├─ profile.rs
│     ├─ settings.rs
│     └─ admin.rs
├─ application/
│  ├─ auth/
│  ├─ chat/
│  ├─ timeline/
│  ├─ profile/
│  ├─ settings/
│  └─ admin/
├─ domain/
│  ├─ auth/
│  ├─ chat/
│  ├─ timeline/
│  ├─ profile/
│  ├─ settings/
│  └─ admin/
└─ infrastructure/
   ├─ http/
   ├─ storage/
   ├─ realtime/
   ├─ p2p/
   └─ files/
```

## 4. 并行执行编组（stub-first 真并行）

### 4.1 统一规则
- 每组只修改自己分配目录，跨组改动通过 `contracts` 先对齐。
- 命令命名统一：`{domain}_{action}`，例如 `auth_login`、`chat_send_message`。
- 返回结构统一：`{ ok: boolean, data?: T, error?: { code, message, details } }`。
- TS 禁止直接新增业务 API 直连；新功能必须优先走 Rust command。
- 采用 stub-first：先冻结契约与空实现，再并行填充业务实现。

### 4.2 S 组：契约冻结组（0 号先行，半天内完成）
- 范围：
  - `apps/desktop/src-tauri/src/interface/contracts/*`（可新建）
  - `apps/desktop/src-tauri/src/error.rs`（仅错误码枚举）
  - `apps/desktop/src-tauri/src/state/mod.rs`（仅字段定义）
- 产出：
  - `ErrorCode` 枚举冻结版
  - `AppResult<T>` 返回包装冻结版
  - Command 契约清单（命令名、入参、出参）
  - `AppState` 最小字段契约
- 前置依赖：无
- 被依赖方：A/B/C/D/E/F/G
- 完成标准：
  - 契约文档与代码可编译
  - 后续组不再改签名，仅实现逻辑
### 4.3 A 组：平台骨架组（stub 装配组）
- 范围：
  - `error.rs`、`state/mod.rs`（引用 S 组冻结契约）
  - `interface/tauri_commands/mod.rs`
  - `main.rs` 的命令注册与状态装配
- 产出：
  - 命令注册入口（所有域 command 都注册）
  - 全域 stub handler（返回 `NotImplemented` 但签名完整）
  - TS 可 invoke 的统一通道
- 前置依赖：S 组冻结契约
- 被依赖方：B/C/D/E/F/G
- 完成标准：
  - `cargo check` 通过
  - 所有已定义 command 都可 invoke 并返回统一结构
  - 后续业务组只替换实现，不改接口签名

### 4.4 B 组：鉴权与会话组
- 范围：
  - `application/auth/*`、`domain/auth/*`、`interface/tauri_commands/auth.rs`
  - TS 对接：`src/store/oauth2.ts` 与登录流程调用桥接
- 功能：
  - 登录/注册、会话恢复、登出、token 校验、401 处理
- 前置依赖：S + A（仅契约与 stub 可调用）
- 完成标准：
  - 冷启动恢复会话成功
  - token 失效后统一回登录
  - 登出后本地敏感数据清理

### 4.5 C 组：设置与本地存储组
- 范围：
  - `application/settings/*`、`domain/settings/*`、`interface/tauri_commands/settings.rs`
  - `infrastructure/storage/*`
- 功能：
  - 设置项读写、默认值回填、模块化设置注册、副作用触发
- 前置依赖：S + A（仅契约与 stub 可调用）
- 完成标准：
  - 配置改动即时生效
  - 重启后配置一致
  - 设置错误可定位（错误码明确）

### 4.6 D 组：聊天核心链路组（最大组，可再拆 D1/D2）
- 范围：
  - `application/chat/*`、`domain/chat/*`、`interface/tauri_commands/chat.rs`
  - `infrastructure/realtime/*`、`infrastructure/p2p/*`
- 功能：
  - 会话列表、历史消息、消息发送、未读同步、失败重试
  - 实时更新（SSE/WS）与 P2P/relay 降级策略
- 迁移参考：`libp2p_network_service.dart` 与 `friend_chat_controller.dart`
- 前置依赖：S + A（仅契约与 stub 可调用）
- 完成标准：
  - 收发链路稳定
  - 断连可恢复
  - 未读与已读回执一致

### 4.7 E 组：发现与资料组
- 范围：
  - `application/timeline/*`、`domain/timeline/*`、`interface/tauri_commands/timeline.rs`
  - `application/profile/*`、`domain/profile/*`、`interface/tauri_commands/profile.rs`
- 功能：
  - 时间线加载、点赞评论转发、乐观更新与回滚
  - 资料编辑、头像背景上传、隐私设置
- 前置依赖：S + A（仅契约与 stub 可调用）
- 完成标准：
  - 互动状态刷新前后保持一致
  - 上传失败可恢复与重试

### 4.8 F 组：管理员与诊断组
- 范围：
  - `application/admin/*`、`domain/admin/*`、`interface/tauri_commands/admin.rs`
- 功能：
  - 诊断命令、网络探测、管理动作聚合
  - 管理能力门禁（角色/capability）
- 前置依赖：S + A（仅契约与 stub 可调用）
- 完成标准：
  - 非管理员无法执行管理命令
  - 管理操作可审计（日志含 request-id）

### 4.9 G 组：TS 收口与契约测试组
- 范围：
  - `apps/desktop/src/store/*`、`apps/desktop/src/services/api.ts`
  - `apps/desktop/src/test/*` 或新增契约测试目录
- 功能：
  - 将页面业务调用改为 invoke Rust command
  - 清理/隔离直连业务 API 的调用点
  - 增加 TS↔Rust 契约测试
- 前置依赖：S + A（先接 stub，后替换真实实现）
- 完成标准：
  - 新增业务流程无页面直连业务 API
  - 关键命令有契约测试覆盖

## 5. 并行推进顺序（建议）
- 第 0 波（最短先行）：S（契约冻结）
- 第 1 波（最短先行）：A（全域 stub + 注册）
- 第 2 波（全并发）：B、C、D、E、F、G 同时开工
- 第 3 波（联调验收）：全组联合回归

## 6. 跨组契约清单（必须先冻结）
- `ErrorCode` 枚举与文案策略
- 统一响应包装 `AppResult<T>`
- `AppState` 字段边界（会话、连接、设置缓存）
- 鉴权上下文透传（命令如何取当前会话）
- 聊天消息模型字段（id、会话 id、时间戳、发送状态、重试状态）
- 时间线与互动动作结果模型
- 文件上传结果模型（url、mime、size、checksum）
- 命令签名不可变策略（迁移期禁止改命令名与参数结构）

## 7. 每组任务模板（直接复制给 AI）
```text
你负责 <组名>，只在以下目录改动：<目录列表>。
必须遵守：
1) 不修改其他组目录；若必须修改，先提交契约变更提案；
2) command 命名与返回结构遵循全局规范；
3) 提交前运行本地检查并附上结果；
4) 输出变更清单：文件、接口、测试、风险、回滚点。
完成标准：<该组完成标准>。
```

## 8. 验收矩阵（按功能）
- 鉴权：登录、恢复、过期、登出全链路
- 聊天：会话、收发、未读、重试、实时、降级
- 发现：加载、互动、回滚一致性
- 资料：更新、上传、隐私设置一致性
- 设置：持久化、生效、重启恢复
- 管理：门禁、诊断、审计日志

## 9. 风险与回滚
- 风险 1：跨组模型漂移
  - 缓解：S 组冻结契约后锁定签名，变更走契约专用 PR
- 风险 2：TS 与 Rust 双轨逻辑不一致
  - 缓解：新流程优先 Rust，TS 仅保留过渡开关
- 风险 3：聊天实时链路复杂导致联调阻塞
  - 缓解：D 组先交付核心命令可用实现，实时与 P2P 保持兼容 stub 渐进替换
- 回滚策略：
  - 命令级 feature flag（按域启停）
  - 保留 `/api` 旧链路作为短期兜底

## 10. 里程碑定义（用于管理）
- M0：S 完成（契约冻结）
- M1：A 完成（stub 全量可调用）
- M2：B/C/D/E/F/G 并行开发完成
- M3：全量回归通过并关闭旧链路

## 11. 建议 PR 切分
- PR-00：契约冻结（S 组）
- PR-01：骨架与全域 stub（A 组)
- PR-02：鉴权域（B 组）
- PR-03：设置域（C 组）
- PR-04：聊天域核心（D1）
- PR-05：聊天域实时/P2P（D2）
- PR-06：发现+资料（E 组）
- PR-07：管理员（F 组）
- PR-08：TS 收口与契约测试（G 组）

## 12. 最终完成判定
- 所有关键业务路径有且仅有一条 Rust 业务链路；
- TS 层不包含业务规则实现；
- 六大功能域验收项全部通过；
- 回滚开关可用，且演练通过。
