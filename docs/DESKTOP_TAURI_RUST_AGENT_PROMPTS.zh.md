# Desktop Tauri Rust 并行执行 Prompt 包

## 使用方式
- 将本文件每个小节整体复制给一个独立 AI 执行。
- 每个 AI 仅处理自己分组，禁止越界改动目录。
- 所有组共享基线文档：[DESKTOP_TAURI_RUST_PARALLEL_PLAN.zh.md](file:///e:/Projects/peers-touch/peers-touch/docs/DESKTOP_TAURI_RUST_PARALLEL_PLAN.zh.md)。
- 执行节奏：S 先完成契约冻结，A 完成全域 stub 后，B/C/D/E/F/G 可全并发。

## 全局约束（每个 AI 都要附带）
```text
项目：peers-touch
目标：将 desktop 业务逻辑下沉到 apps/desktop/src-tauri（Rust），TS 仅保留 UI 与状态编排。
必须遵守：
1) 严格只改你被分配的目录；
2) command 命名使用 {domain}_{action}；
3) 返回结构统一：{ ok, data?, error? }；
4) 不在页面层新增业务 API 直连；
5) 提交结果必须包含：变更文件清单、接口清单、测试结果、风险与回滚点。
```

## Prompt-S（契约冻结组）
```text
你是 S 组（契约冻结组）。
目标：冻结全域契约，消除后续并行阻塞。

允许改动目录：
- apps/desktop/src-tauri/src/interface/contracts/**
- apps/desktop/src-tauri/src/error.rs（仅错误码）
- apps/desktop/src-tauri/src/state/mod.rs（仅最小字段）

任务：
1) 冻结 ErrorCode 与 AppResult<T>；
2) 冻结 command 列表、参数结构、返回结构；
3) 冻结 AppState 最小字段边界；
4) 输出不可变更规则：后续只允许补实现，不允许改签名。

验收：
- 契约文件齐全且可被 A-G 引用；
- 契约版本号已标注；
- 未引入业务实现代码。
```

## Prompt-A（平台骨架组）
```text
你是 A 组（平台骨架组）。
目标：建立 Tauri Rust 业务承载骨架与全域 stub，供后续并发替换实现。

允许改动目录：
- apps/desktop/src-tauri/src/main.rs
- apps/desktop/src-tauri/src/error.rs
- apps/desktop/src-tauri/src/state/**
- apps/desktop/src-tauri/src/interface/tauri_commands/mod.rs
- apps/desktop/src-tauri/src/interface/tauri_commands/*.rs（仅 stub）

任务：
1) 在 main.rs 完成 command 注册与 AppState 装配；
2) 按 S 组契约生成全域 command stub；
3) 每个 command 返回统一结构 NotImplemented；
4) TS 端可 invoke 所有 command，不因缺实现报接口不存在。

验收：
- cargo check 通过；
- TS 可 invoke 全域 command 并拿到统一返回结构；
- 业务组后续只需替换函数体，不改签名。
```

## Prompt-B（鉴权与会话组）
```text
你是 B 组（鉴权与会话组）。
目标：实现 auth 域 Rust 业务链路并接入 TS store。

允许改动目录：
- apps/desktop/src-tauri/src/application/auth/**
- apps/desktop/src-tauri/src/domain/auth/**
- apps/desktop/src-tauri/src/interface/tauri_commands/auth.rs
- apps/desktop/src/store/oauth2.ts
- apps/desktop/src/services/api.ts（仅限过渡桥接，禁止扩散）

任务：
1) 实现 auth_login/auth_logout/auth_restore_session/auth_validate_token；
2) 统一 401 处理策略并返回标准错误码；
3) 仅替换 auth 对应 stub 实现，不改命令签名；
4) TS 侧改为 invoke Rust command，页面不直接执行业务规则。

验收：
- 冷启动可恢复会话；
- token 过期后可回登录；
- 登出后本地敏感状态被清理。
```

## Prompt-C（设置与本地存储组）
```text
你是 C 组（设置与本地存储组）。
目标：实现 settings 域与本地存储基础设施。

允许改动目录：
- apps/desktop/src-tauri/src/application/settings/**
- apps/desktop/src-tauri/src/domain/settings/**
- apps/desktop/src-tauri/src/interface/tauri_commands/settings.rs
- apps/desktop/src-tauri/src/infrastructure/storage/**

任务：
1) 实现 settings_get/settings_set/settings_reset；
2) 支持默认值回填与基础校验；
3) 支持设置变更后的副作用回调入口；
4) 仅替换 settings 对应 stub 实现，不改命令签名。

验收：
- 配置修改后即时可读；
- 重启后配置保持一致；
- 错误码可区分“读失败/写失败/非法值”。
```

## Prompt-D（聊天核心组，含实时与P2P）
```text
你是 D 组（聊天核心组）。
目标：实现 chat 域主链路与实时/P2P 能力。

允许改动目录：
- apps/desktop/src-tauri/src/application/chat/**
- apps/desktop/src-tauri/src/domain/chat/**
- apps/desktop/src-tauri/src/interface/tauri_commands/chat.rs
- apps/desktop/src-tauri/src/infrastructure/realtime/**
- apps/desktop/src-tauri/src/infrastructure/p2p/**

迁移参考：
- client/desktop/lib/core/services/network_discovery/libp2p_network_service.dart
- client/desktop/lib/features/friend_chat/controller/friend_chat_controller.dart

任务：
1) 实现 chat_list_conversations/chat_list_messages/chat_send_message/chat_mark_read；
2) 实现失败重试与未读同步；
3) 接入实时更新；实现 P2P 不可用时 relay 降级；
4) 仅替换 chat 对应 stub 实现，不改命令签名。

验收：
- 收发可用；
- 断连后可恢复；
- 未读/已读状态一致；
- 降级路径可验证。
```

## Prompt-E（发现与资料组）
```text
你是 E 组（发现与资料组）。
目标：实现 timeline + profile 两个业务域。

允许改动目录：
- apps/desktop/src-tauri/src/application/timeline/**
- apps/desktop/src-tauri/src/domain/timeline/**
- apps/desktop/src-tauri/src/interface/tauri_commands/timeline.rs
- apps/desktop/src-tauri/src/application/profile/**
- apps/desktop/src-tauri/src/domain/profile/**
- apps/desktop/src-tauri/src/interface/tauri_commands/profile.rs

任务：
1) timeline：加载、点赞、评论、转发、乐观更新与回滚；
2) profile：资料更新、头像背景上传、隐私设置；
3) 仅替换 timeline/profile 对应 stub 实现，不改命令签名。

验收：
- timeline 互动状态前后保持一致；
- 上传失败可恢复；
- 返回结构完全遵循全局规范。
```

## Prompt-F（管理员与诊断组）
```text
你是 F 组（管理员与诊断组）。
目标：实现 admin 域并加门禁与审计。

允许改动目录：
- apps/desktop/src-tauri/src/application/admin/**
- apps/desktop/src-tauri/src/domain/admin/**
- apps/desktop/src-tauri/src/interface/tauri_commands/admin.rs

任务：
1) 实现 admin_health/admin_network_probe/admin_execute_action；
2) 加入 capability/role 门禁；
3) 为关键操作增加 request-id 日志；
4) 仅替换 admin 对应 stub 实现，不改命令签名。

验收：
- 非管理员调用被拒绝；
- 管理操作具备可追踪日志；
- 不影响普通业务命令。
```

## Prompt-G（TS 收口与契约测试组）
```text
你是 G 组（TS 收口与契约测试组）。
目标：把 TS 业务调用收口到 Rust command，并补契约测试。

允许改动目录：
- apps/desktop/src/store/**
- apps/desktop/src/services/api.ts
- apps/desktop/src/pages/**
- apps/desktop/src/test/**

任务：
1) 基于 S/A 产物先对接全域 stub，不等待业务实现；
2) 将页面/store 的业务动作改为 invoke Rust command；
3) 清理直连业务 API 的穿透调用；
4) 增加 TS↔Rust 契约测试（关键 command 必测）。

验收：
- 新业务路径无页面直连业务 API；
- 契约测试通过；
- 失败场景能展示统一 error code。
```

## 联调 Prompt（合并阶段）
```text
你负责联调整理。
任务：
1) 按 S->A->(B/C/D/E/F/G 并发)->联调 顺序合并；
2) 检查跨组契约一致性（ErrorCode/AppResult/AppState/消息模型）；
3) 运行 desktop 关键链路回归：鉴权、聊天、发现、资料、设置、管理员；
4) 输出阻塞清单与最终发布建议。
验收：
- 全链路通过；
- 存在回滚开关；
- 文档与实现一致。
```
