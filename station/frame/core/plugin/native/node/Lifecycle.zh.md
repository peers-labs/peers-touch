# Node 生命周期

## 目标与边界
- 定义节点在“构建 → 初始化 → 运行 → 停止”的完整生命周期，统一重要成员（libp2p `host`、`DHT`、mDNS 等）的准备与装配方式。
- 重要成员的“构建不初始化”落地在 `station/frame/core/plugin/native/node/native_base_comp.go`，用于提供可注入的实例；各组件在各自 `Init/Start/Stop` 生命周期中再完成初始化与运行。
- 组件角色：
  - 网络栈成员：`host`、`DHT`、mDNS 服务（仅在 native 下存在）。
  - 服务组件：`registry`（自公告/查询）、`server`（HTTP 运维）、`subserver/bootstrap`（引导入口）。

## 生命周期阶段

### 1. 构建（Build/Assemble）
- 加载配置（密钥、监听、网络前缀、引导节点等），准备 libp2p 选项集。
- 构建但不初始化：
  - 构建 `host`（生成身份、配置传输与 NAT/HolePunch/AutoRelay）。
  - 构建 `DHT`（准备 `Mode` 与 `ProtocolPrefix`，不调用 `Bootstrap()`）。
  - 构建 mDNS 服务（命名空间与域名，未 `Start()`）。
- 暂存成员至容器（`native_base_comp.go`），提供只读获取接口用于后续注入。

### 2. 初始化（Init）
- Registry 初始化：
  - 注入 `host/DHT` 与存储，注册验证器与命名空间（例如 `"/pst"` 前缀；`station/frame/core/plugin/native/registry/native.go:185`）。
  - 设置自注册周期任务（`station/frame/core/plugin/native/registry/native.go:388-426`）。
- Server 初始化：
  - 配置 HTTP 服务与路由（`station/frame/core/plugin/native/server/native.go:27-83`）。
- Bootstrap 子服务初始化：
  - 默认使用独立 `host/DHT`，或按开关复用主实例；建立 mDNS 服务与发现回调（`station/frame/core/plugin/native/subserver/bootstrap/bootstrap.go:56-114`）。
- mDNS 初始化：
  - 创建服务并注册 Watch 回调（`station/frame/core/plugin/native/registry/native.go:246-259`）。

### 3. 运行（Run/Start）
- Server 启动：`ListenAndServe`（`station/frame/core/plugin/native/server/native.go:85-94`）。
- Registry 周期自注册：
  - DHT `Provide` + `PutValue` 公告（`station/frame/core/plugin/native/registry/native.go:713-773`）。
  - 定期 `DHT.Bootstrap()` 与路由刷新（`station/frame/core/plugin/native/registry/native.go:796-829, 831-840`）。
- Bootstrap 子服务启动：
  - 周期 `DHT.Bootstrap()` 与对外查询接口（`station/frame/core/plugin/native/subserver/bootstrap/bootstrap.go:121-166, 217-232`）。
- mDNS 服务运行：
  - 定时发现与回调处理（`station/frame/core/plugin/native/internal/mdns/mdns.go:190-213, 215-270`）。

### 4. 停止（Stop/Shutdown）
- 停止顺序建议：
  1) `subserver/bootstrap.Stop`（关闭 mDNS、`DHT` 与 `host`；`station/frame/core/plugin/native/subserver/bootstrap/bootstrap.go:168-201`）。
  2) `server.Stop`（关闭 HTTP；`station/frame/core/plugin/native/server/native.go:96-103`）。
  3) `registry` 停止周期任务、关闭 mDNS 服务与释放网络成员（若持有）。
- 资源释放：关闭所有 `stream`、`host` 与 `DHT`，停止 mDNS，清理缓存与 Peerstore。

## 组件装配与依赖
- Host 与 DHT 的拥有者：
  - 建议由 `native_base_comp.go` 构建并作为“节点级成员”供注入；保持“构建与初始化分离”。
  - `bootstrap` 默认使用独立实例（生产推荐）；`registry` 与 `transport` 各自使用注入的实例或自建（当前实现参考）。
- 网络前缀与键空间：
  - DHT 键空间前缀由 `ProtocolPrefix` 决定，默认 `"/pst"`（`station/frame/core/registry/types.go:69`；`station/frame/core/plugin/native/registry/namespace.go:14-22`）。
  - 键格式 `"%s/%s"`（命名空间/PeerID）。

## 状态机
- 状态集合：`New → Built → Initialized → Running → Stopped → Error`。
- 约束：
  - 每阶段幂等；禁止跨阶段跳跃（如未 `Built` 不得 `Init`）。
  - `Init` 后才允许 `Start`；`Stop` 只能从 `Running` 或 `Error` 进入。

## 异步任务与退避
- 周期自注册与 `DHT.Bootstrap()` 定时器；遇到失败采用指数退避，避免过载 DHT。
- 路由表刷新与 mDNS 发现各自维护独立时钟；关闭时优雅停机。

## 安全与验证
- DHT 值签名与时间戳：序列化时加入签名/时间戳（`station/frame/core/plugin/native/registry/native.go:955-1004`）。
- 命名空间验证器：校验键空间与 PeerID；选择器基于 `timestamp/seq` 选最新（`station/frame/core/plugin/native/registry/namespace.go:27-45`）。

## 配置建议
- 统一网络命名空间（作用于 DHT/mDNS），例如 `pt1/prod`、`pt1/staging`；引导节点从 `peers.yml` 注入（`station/app/conf/peers.yml:24-25`）。
- 默认启用 DHT 与 mDNS；Rendezvous 与 PubSub 宣告作为可选策略后续扩展。

## 参考代码位置
- Registry 周期注册入口：`station/frame/core/plugin/native/registry/native.go:388-426`。
- DHT 公告与键值写入：`station/frame/core/plugin/native/registry/native.go:713-773`。
- DHT 前缀与命名空间：`station/frame/core/plugin/native/registry/namespace.go:14-22`。
- mDNS 服务与发现：`station/frame/core/plugin/native/internal/mdns/mdns.go:102-156, 190-213, 215-270, 272-305`。
- Server 启停：`station/frame/core/plugin/native/server/native.go:85-103`。
- Bootstrap 初始化与启动：`station/frame/core/plugin/native/subserver/bootstrap/bootstrap.go:56-114, 121-166, 168-201, 257-306`。