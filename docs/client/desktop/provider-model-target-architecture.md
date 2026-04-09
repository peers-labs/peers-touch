# Desktop Provider + Model 目标态架构

## 1. 目标
- Provider 列表由配置驱动，不再由代码 seed 硬编码。
- 协议作为一等公民，支持按 provider/model 切换协议适配器。
- 命令层、应用层、协议层分离，允许独立回归测试。

## 2. 分层模型

### 2.1 Provider Registry
- 输入源：
  - 内置预设：`providers.default.yaml`
  - 用户覆盖：本地持久化（后续）
  - 远端同步：Station（后续）
- 输出：
  - 统一 ProviderRecord + ModelRecord。

### 2.2 Adapter 三层
- Protocol Adapter：`openai-compatible` / `anthropic` / `gemini` / `ollama`。
- Provider Adapter：处理 base_url、鉴权头、模型发现策略、错误映射。
- Model Adapter：处理模型级特性（reasoning/tool/schema/vision）。

### 2.3 路由决策
- 优先级：
  - model 显式协议
  - provider 默认协议
  - 系统 fallback 协议

## 3. 当前代码映射
- Registry 数据源：  
  [providers.default.yaml](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch/apps/desktop/src-tauri/src/application/provider/providers.default.yaml)
- Provider 状态层：  
  [state.rs](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch/apps/desktop/src-tauri/src/application/provider/state.rs)
- Protocol Adapter 聚合：  
  [remote.rs](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch/apps/desktop/src-tauri/src/application/provider/remote.rs)
- Provider 命令入口：  
  [provider.rs](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch/apps/desktop/src-tauri/src/interface/tauri_commands/provider.rs)
- Models 命令入口：  
  [models.rs](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch/apps/desktop/src-tauri/src/interface/tauri_commands/models.rs)

## 4. 用户作用域设计
- ProviderStore 已升级为多作用域注册表（scope -> store），默认 scope 为 `__default__`。
- 应用层 Provider/Model 接口已统一增加 `scope: Option<&str>` 参数。
- 当前命令层已从会话解析 `session.actor_id` 作为 scope，未登录时回落 `__default__`。
- 该设计可以避免同一桌面端多用户共享同一 Provider 配置导致串配置。

## 5. 能力字段策略
- 能力矩阵不是前置阻塞项，但必须有统一字段规范：
  - chat/image/video/embedding/asr/tts
  - function_call/reasoning/search/vision
  - json_mode/structured_output/streaming
- UI 渲染与运行时校验都消费同一能力字段。

## 6. 演进路线
- P1：配置驱动 Provider Registry（已启动）。
- P2：协议适配器扩展到主流厂商并补齐错误映射。
- P3：Model Adapter 接管模型级能力差异。
- P4：接入 Station 真源与本地持久化分层。
- P5：统一可观测与协议契约测试。

## 7. 验收标准
- 默认安装可看到多 provider，且能完成 check/fetch。
- 同一 provider 可按协议切换并保持命令层不变。
- 命令层回归测试可在隔离靶中单独通过。
