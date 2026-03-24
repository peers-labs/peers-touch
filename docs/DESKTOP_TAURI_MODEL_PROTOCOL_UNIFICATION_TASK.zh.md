# Desktop Tauri Model 协议统一任务

## 背景

- 当前 Desktop 端已统一到 `services/desktop_api.ts` 入口。
- `src-tauri/interface/contracts/mod.rs` 与 `tauri_commands/*` 仍是手写契约。
- `model/` 中 proto 覆盖了部分新架构域，但未覆盖全部 Desktop 能力。

## 目标

- 建立单一业务通道：Desktop 业务请求统一走 Rust command。
- 建立单一协议来源：Model proto 与 Rust 手写契约对齐，消除双轨语义。
- 建立单一验收口径：按域可核验“协议一致 + 通道一致 + 回归通过”。

## 现状基线

### Rust command 已落地域

- auth
- settings
- chat
- timeline
- profile
- admin

### Model 已覆盖但未严格对齐域

- ai_chat（session/message/provider/completion）
- auth
- social（timeline/post/relationship）
- oauth
- manage（health）

### 仍主要走 HTTP request 的 Desktop 域

- provider
- skills / market
- mcp
- cron
- channels
- memory
- tts
- notebooks
- applets
- 搜索与部分配置/统计

## 差异类型

### 协议语义差异

- Desktop chat 使用 `conversation_id`，Model ai_chat 主体使用 `session_id/topic_id`。
- Desktop 自定义命令语义（如 smart rename / stop）在 Model 中无等价 message。

### 结构层级差异

- 当前 Rust contracts 为手写 DTO，不是 model codegen 产物。
- 当前 Model build 只覆盖 Go/Dart，缺少 Rust 生成接入。

### 通道一致性差异

- Desktop API 层仍有大量 `request()` HTTP 直连路径。

## 任务分解

### T1 协议映射表冻结

- 输出 `model proto <-> rust contracts <-> desktop_api` 三向映射表。
- 标记每个字段状态：一致 / 可映射 / 缺失 / 冗余。
- 对 chat 的 `conversation_id/session_id/topic_id` 定义统一语义与转换规则。
- 当前产出：`docs/DESKTOP_TAURI_PROTOCOL_MAPPING_MATRIX.zh.md`（已完成首版冻结）。

### T2 Model 补齐新架构 Scope

- 为缺失能力补 proto（至少覆盖 provider/skills/mcp/cron/channels/memory/tts/notebooks）。
- 对现有 ai_chat 补 Desktop 必需消息语义（含 rename/duplicate/stop 等）。
- 保证命名、分页、错误码字段风格在 model 内一致。

### T3 Rust 协议接入重构

- 引入 model 到 Rust 的协议接入层（生成或适配层）。
- 将 `interface/contracts/mod.rs` 收敛为映射层，不再作为独立业务协议来源。
- 按域替换 tauri command 输入输出，统一协议版本管理。

### T4 Desktop 通道收口

- `desktop_api.ts` 中所有业务方法迁移为 Rust command 调用。
- 逐域删除 `request()` 业务调用，仅保留非业务静态资源场景。
- 页面/store 禁止直接 fetch 业务 API。

### T5 验收与回归

- Desktop：check/test/build 全绿。
- Tauri：cargo check 全绿。
- 协议：抽样命令做 TS↔Rust 契约测试回归。
- 文档：更新协议版本、映射表、迁移清单。

## 里程碑

### M1 协议冻结

- T1 完成并评审通过。

### M2 高优先域迁移

- chat/provider/auth/settings/admin 完成 model 对齐与命令化。

### M3 全域收口

- 所有业务域 command-only，HTTP 业务通道关闭。

### M4 发布门槛

- 回归通过，文档齐套，协议版本冻结。

## 验收标准

- 代码中不存在页面/store 到业务后端的直接 fetch。
- `desktop_api.ts` 不再承载业务 HTTP request 路径。
- Rust command 输入输出可回溯到 model 协议定义。
- Model 与手写协议不存在冲突字段语义。
