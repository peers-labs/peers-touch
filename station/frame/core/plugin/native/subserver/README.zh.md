# SubServer 目录技术总结

## 模块概览

- `bootstrap/`：基于 libp2p 的网络引导子服务，创建 Host、DHT，支持 mDNS 发现与周期性 DHT 引导；提供运维接口查询网络与 DHT 信息。
- `turn/`：基于 Pion TURN 的 NAT 穿透子服务，TCP/UDP 监听，提供中继能力与简单的鉴权适配。

## 生命周期与接口

- 两者均实现统一接口：`Init(ctx, opts...)`、`Start(ctx, opts...)`、`Stop(ctx)`、`Name()`、`Address()`、`Status()`、`Handlers()`、`Type()`。
- 状态管理：`stopped`→`starting`→`running`→`stopping`，异常置 `error`。

## Bootstrap 子服务要点

- 能力：
  - 构建 `libp2p Host` 与 `DHT`，注册网络事件回调（连接/断开/监听）。
  - 可选 `mDNS` 服务进行局域网邻居发现。
  - 周期执行 `DHT.Bootstrap`，并维护拨号地址缓存。
- 关键文件：
  - `bootstrap.go`（实现与并发调度）、`handler.go`（HTTP 运维路由）、`host_notifee.go`（事件回调）、`store.go`+`model/*`（持久化）、`namespace.go`（命名空间校验）、`dht_hook*.go`（只读 Hook）。
- 配置示例字段：
  - `enable-mdns`、`identity-key`、`listen-addrs`、`bootstrap-nodes`、`dht-refresh-interval`、`libp2p-insecure`。
- 路由前缀：`/sub-bootstrap/*`，例如 `list`、`dht`、`info`。
- 示例配置：`station/frame/example/bootstrap/conf/bootstrap.yml`、`station/app/conf/sub_bootstrap.yml`。

## TURN 子服务要点

- 能力：
  - 构建 Pion TURN Server，TCP/UDP 双栈监听，支持静态中继地址生成。
  - OS 信号监听实现优雅关闭，统一日志适配到框架。
- 关键文件：
  - `turn.go`（实现与监听）、`options.go`（选项注入）、`plugin.go`（注册与解析）、`logger.go`（日志适配）、`config/turn.yml`（示例配置）。
- 配置示例字段：
  - `enabled`、`port`、`realm`、`public-ip`、`auth-secret`。
- 路由前缀：`/sub-turn/*`（如有对外接口时统一此前缀）。

## 并发与安全约束

- 并发：`Start/Stop` 使用锁或原子标志防重入；周期任务基于 `Ticker`+`select`，在 `ctx.Done()` 退出。
- 安全：
  - 私钥读取限制在工作目录受控路径；命名空间/PeerID 严格校验。
  - Hook 只读，不得修改底层 `Stream` 或请求对象。

## 运维与日志

- 运维接口由 `Handlers()` 提供并由主服务统一挂载；统一成功/失败响应封装。
- 日志级别与格式统一，关键事件需记录（连接、断开、错误、重试、引导结果）。

