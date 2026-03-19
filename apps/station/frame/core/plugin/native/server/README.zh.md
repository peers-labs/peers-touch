# Peers Native Server 架构设计 (V2)

## 1. 核心思想：双引擎、统一注册、分离处理

`Server` 组件被设计为一个**容器**，其内部包含两个独立的、并行的“处理引擎”：一个 **HTTP 引擎**和一个 **P2P Stream (PS) 引擎**。`Server` 的核心职责是管理这两个引擎的生命周期，并为开发者提供一个统一的接口来注册服务，而无需关心底层的协议细节。

这种设计的目的是彻底解决协议处理的混乱问题，让每种协议（HTTP 和 P2P）的处理逻辑在清晰的边界内独立运行，从而提高代码的可维护性和扩展性。

## 2. 内部结构设计

`Server` 结构体包含以下核心组件：

- `transport transport.Transport`
  - **角色**: P2P 网络层。
  - **职责**: 仅负责监听和建立底层的 P2P 连接 (`Socket`)，供 **PS 引擎**使用。

- `httpServer *http.Server`
  - **角色**: **HTTP 引擎**的载体。
  - **职责**: 绑定一个 TCP 地址 (如 `:18080`)，管理 HTTP 连接的生命周期。

- `httpRouter *http.ServeMux`
  - **角色**: **HTTP 引擎**的核心路由。
  - **职责**: 存储所有 HTTP 路由规则 (如 `GET /users` -> `handleGetUser`)。`httpServer` 会将所有传入的 HTTP 请求都转发给它。

- `psRouter map[string]server.Handler`
  - **角色**: **PS 引擎**的核心路由。
  - **职责**: 存储所有 P2P Stream 服务的路由规则。`key` 是服务名 (如 `"chat.sendMessage"`)，`value` 是对应的处理器。

- `handlers []server.Handler` (位于 `BaseServer.Options()`)
  - **角色**: **统一的待处理注册列表**。
  - **职责**: `s.Handle()` 方法会将所有（不区分 HTTP 或 PS）的处理器先暂存到这个列表中，实现“先收集，后分发”的逻辑。

## 3. 工作流程

### 3.1. 注册阶段 (`s.Handle`)

`s.Handle(h)` 方法的行为非常简单：接收一个 `server.Handler` 对象，不进行任何判断，直接将其追加到 `s.Options().Handlers` 列表中。这为开发者提供了极其统一和简单的注册体验。

### 3.2. 启动阶段 (`s.Start`)

`s.Start()` 是整个架构的核心调度者，负责将注册的处理器“分发”到正确的引擎并启动它们：

1.  **遍历 `s.Options().Handlers` 列表**：
    -   检查每个 `handler` 的元信息（约定：`handler.Path()` 若以 `/` 开头，则为 HTTP 处理器；否则为 PS 处理器）。
    -   根据类型，将处理器分别注册到 `s.httpRouter` 或 `s.psRouter` 中。
2.  **启动 HTTP 引擎**: 在一个新的 goroutine 中调用 `s.httpServer.ListenAndServe()`。
3.  **启动 PS 引擎**: 在一个新的 goroutine 中调用 `s.transport.Listen()`，并循环 `Accept` 新的 `socket` 连接，交由 `s.handleSocket` 处理。

### 3.3. 请求处理阶段

#### P2P 请求 (`handleSocket`)

`handleSocket` 函数只为 P2P Stream 服务：

1.  **协议约定**: 客户端建立 `socket` 后，发送的**第一个数据包必须是包含服务名的控制消息** (如: `{ "service": "chat.sendMessage" }`)。
2.  `handleSocket` 在收到新 `socket` 后，首先读取此控制消息，解析出服务名。
3.  使用服务名在 `s.psRouter` 中查找对应的 `handler`。
4.  将 `socket` 的控制权完全交给找到的 `handler` 进行后续的业务数据收发。

#### HTTP 请求 (`ServeHTTP`)

`ServeHTTP` 方法的实现极其简单，完全符合 `http.Handler` 接口的定义。它的唯一职责就是将 `http.Server` 传来的请求，原封不动地交给 `s.httpRouter` 处理。

```go
func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    s.httpRouter.ServeHTTP(w, r)
}
```

## 4. 方案优势

- **清晰的职责边界**: 每个组件只做一件事。
- **协议隔离**: HTTP 和 P2P 的处理逻辑被完全隔离在两个独立的“引擎”中，互不影响。
- **高扩展性**: 未来支持新协议只需增加新的“引擎”和“路由”，无需改动现有代码。
- **统一的开发者体验**: 无论底层协议为何，开发者都通过统一的 `s.Handle()` 方法注册服务。
