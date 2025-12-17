# Auth 重构与统一接入任务清单

## 概览
- 目标：统一认证内核（core/auth），为任意协议提供适配器；touch 层仅保留账号与会话编排。
- 验收方式：逐项执行并提交变更，每项包含代码位置与验证说明。

## 阶段 0：基础内核与适配器（已完成）
- [x] 创建 core/auth 抽象与 JWT Provider（`station/frame/core/auth/*`）
- [x] 提供 HTTP/Hertz 适配器（`station/frame/core/auth/adapter/*`）
- [x] 强制密钥存在性校验（`core/auth/config.go:Get()`、`touch/auth/config.go:Get()`）
- [x] 扩展服务层以支持 Hertz 中间件与 wrappers 组合（`core/server/*`）
- [x] touch 登录编排改为调用 core Provider（`touch/auth/auth.go:LoginWithSession`）
- [x] Mastodon 路由示例注入鉴权中间件（待统一到 core 适配器）

## 阶段 1：统一路由级鉴权接入
- [x] 识别需鉴权的 Hertz 端点并注入 `core/auth/adapter/hertz.RequireJWT(provider)`
  - Mastodon：verify_credentials、发帖、收藏/取消、转发/取消、home 时间线（`station/frame/touch/mastodon_router.go`）
  - ActivityPub：个人资料读写、用户 inbox/outbox POST、发帖与媒体上传（`station/frame/touch/activitypub_handler.go` + `activitypub_router.go`）
- [x] 为 `http.Handler` 子服务注入 `core/auth/adapter/http.RequireJWT(provider)`
  - OSS 上传（`station/app/subserver/oss/handler.go`），Chat 的所有 POST 操作（`station/app/subserver/chat/chat.go`）
- [x] 移除硬编码 `your-secret-key`，统一使用 `core/auth` Provider
  - 已清理 `activitypub_handler.go` 的校验逻辑并改为 `core/auth` Provider

## 阶段 2：touch 层编排收敛
- [x] 移除 `touch/auth/jwt.go`（本地 JWTProvider）
- [x] 移除/停用 `touch/auth/middleware.go`，统一用 core 适配器
- [x] 清理 handler 内散落的手工 `Authorization` 校验逻辑（改造 `activitypub_handler.go:resolveActorID`）

## 阶段 3：会话存储可插拔
- [x] Memory 与 LocalDisk 存储实现（`PEERS_SESSION_STORE=memory|disk`，`PEERS_SESSION_TTL`，`PEERS_SESSION_DIR`）
- [x] 登录编排接入工厂 `NewSessionStoreFromEnv`
- [x] 预留 Redis 存储键位（`PEERS_SESSION_STORE=redis` 返回未实现错误），待后续实现
- [ ] 验证跨实例会话有效性

## 阶段 4：令牌与密钥策略升级
- [ ] 新增 `RS256/ES256` Provider（核心），支持私钥挂载/KMS/Vault
- [ ] 设计与实现刷新策略或短 TTL 滚动方案
- [ ] 支持双密钥验证窗口以便轮换

## 阶段 5：p2p/其它协议认证抽象
- [ ] 定义 `TransportVerifier` 接口（核心），适配 libp2p 握手
- [ ] 在 `adapter/p2p` 实现对等方验证与 `Subject` 绑定

## 阶段 6：测试与文档
- [ ] Provider/适配器单元测试：有效/过期/签名错误
- [ ] 路由级集成测试：401/200 行为覆盖（Hertz/HTTP）
- [ ] 更新设计文档与使用指南（README/DEVELOPMENT_DAILY）

## 执行与验收
- 每完成一项：
  - 提交代码位置与简要说明
  - 运行编译或测试验证
  - 在本文件标记为 [x] 并附验证方法
