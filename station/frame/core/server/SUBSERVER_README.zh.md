# SubServer 风格全览

该规范用于限定 Subserver 的编码风格。

## 设计目标与原则

- 面向“子服务组件化”：每个 SubServer 提供清晰的生命周期、独立配置与可插拔能力。
- 与主服务解耦：通过统一接口与 Options 注入，主服务仅负责编排与治理。
- 稳健并发与可观测：显式状态管理、优雅启动/停止、完善日志与运维接口。
- 安全优先：密钥、命名空间、网络交互遵循最小权限与校验约束。

## 接口与生命周期

- 必备方法：`Init(ctx, opts...)`、`Start(ctx, opts...)`、`Stop(ctx)`、`Name()`、`Address()`、`Status()`、`Handlers()`、`Type()`。
- 状态枚举：`stopped`、`starting`、`running`、`stopping`、`error`；状态切换必须原子、可追踪。
- 生命周期约束：
  - Init 只做资源构建与依赖注入；不得启动后台循环。
  - Start 进入运行态，启动调度/监听；需并发安全，重复调用应被保护。
  - Stop 优雅关闭所有资源与后台任务，确保幂等。

## 插件与配置集成

- 通过插件注册创建具体子服务：`SubserverPlugin.Enabled/Options/New`。
- 配置解析使用结构体映射与 `pconf` 标签，转换为框架 `option.Option` 注入。
- Server 侧通过 `WithSubServer(name, newFunc, subServerOptions...)` 完成注册与编排。

## 目录结构与命名规范

- 标准结构：
  - `README.md`：模块说明文档
  - `options.go`：配置选项与依赖注入
  - `plugin.go`：插件注册与生命周期工厂
  - `<module>.go`：SubServer 接口实现（核心逻辑）
  - `handler.go`：HTTP/Hertz 路由处理函数
  - `auth.go`：认证与权限控制（可选）
  - `db/`：数据访问层
    - `model/`：数据模型定义（GORM/Proto）
    - `repo/`：数据库操作封装（可选，复杂逻辑建议抽取）
  - `service/`：业务逻辑层
- 文件职责：
  - `options.go`: 定义 `Options` 结构体、`WithXxx` 函数、`getOptions` 辅助函数。
  - `plugin.go`: 实现 `plugin.Plugin` 接口，注册到 `plugin.SubserverPlugins`，负责配置映射。
  - `<module>.go`: 实现 `server.Subserver` 接口 (`Init`, `Start`, `Stop`, `Name`, `Type` 等)，持有状态。
  - `handler.go`: 实现 `server.Handler` 定义的方法，处理 HTTP 请求，调用 Service/Repo。
- 类型命名：实现结构统一命名 `<Module>SubServer`，私有结构体首字母小写（如 `ossSubServer`）。
- 路由前缀：`/sub-<name>/...`，如 `/sub-bootstrap`、`/sub-oss`。

## 架构分层原则

为了保持代码整洁和可维护性，建议采用以下分层架构：

1.  **接口层 (Handlers)**: `handler.go`
    - 负责 HTTP 请求解析、参数校验、Auth 中间件集成。
    - 调用业务层逻辑。
    - 返回标准 HTTP 响应。
    - **禁止**在此层直接操作数据库或处理复杂业务逻辑。

2.  **业务层 (Service)**: `service/` (可选)
    - 负责核心业务逻辑、事务控制、第三方服务调用。
    - 被接口层调用。
    - 对于简单的 CRUD 子服务，此层可省略，逻辑合并入 Handler 或直接调用 Repo。

3.  **数据层 (Repo/DB)**: `db/`
    - `db/model/`: 定义数据库实体 (struct tags, gorm tags)。
    - `db/repo/`: (可选) 封装 GORM 查询，提供语义化的数据访问接口 (e.g., `FindUserByEmail`)。
    - **禁止**在 Handler 层直接编写 SQL 或复杂的 GORM 链式调用。

4.  **配置与插件层 (Config/Plugin)**: `options.go`, `plugin.go`
    - 负责与框架集成，解析 `pconf` 配置，注入依赖 (Auth Provider, Storage Backend 等)。
    - 确保子服务的独立性，不直接依赖全局变量。

## 路由与接口规范

- 管理/运维接口由 `Handlers()` 返回，主服务统一挂载。
- HTTP 响应统一采用框架成功/失败响应封装，或 `ctx.JSON` 标准输出。
- 读写边界清晰：运维接口应只读或有限写入，避免破坏运行态数据一致性。

## 并发与状态管理

- 并发保护：在 `Start/Stop` 使用互斥锁或原子标志防重复调用与竞态。
- 后台调度：
  - 需要周期任务时使用 `time.Ticker` 与 `select`；在 `ctx.Done()` 收到后退出。
  - 即刻触发与定时触发可分离两个 goroutine，避免启动抖动。
- 优雅退出：所有 goroutine 必须在 `Stop` 中可控终止，释放网络/文件/DB 等资源。

## 日志与错误处理

- 日志级别：Trace/Debug/Info/Warn/Error，统一前缀与上下文，关键路径记录参数与结果。
- 错误分类：Init/Start/Stop 返回错误；不可恢复错误置 `StatusError` 并记录详细日志。
- 外部库日志需适配到框架日志体系，保持一致的格式与采样策略。

## 安全与密钥管理

- 私钥加载必须限制在工作目录或受控路径下；拒绝越权访问。
- 网络输入校验必须严格（PeerID、地址格式、命名空间）。
- 默认最小权限：关闭不必要的 Insecure/调试开关，需显式配置开启。

## DHT Hook 约束（如 Bootstrap）

- Hook 仅允许只读观察与记录，禁止修改底层 `Stream` 或请求对象。
- 默认 Hook 记录键/值与来源信息，便于审计与问题定位。

## 命名空间与键格式

- 网络命名空间采用统一前缀（如 `"/pst"`），模块可追加后缀（如 `":pb"` 用于引导）。
- 键格式统一：`"<namespace>/<peer-id>"`，并对 `peer-id` 做解码校验。

## 可观测性与运维

- 暴露必要的健康检查、基本信息、连接/拓扑查询接口，路径置于模块前缀下。
- 日志包含重要事件：连接/断开、监听变更、错误与重试、周期任务结果。
- 如需信号处理（如 TURN），在 `Start` 中注册并与 `Stop` 协作实现优雅退出。

## 性能与资源管理

- 周期任务间隔可配置，避免过密刷新导致负载升高。
- 缓存与地址生成需考虑去重与过期策略，减少无效拨号。
- 关闭顺序遵循“高层→底层”的资源依赖，防止悬挂或泄漏。

## 测试与示例

- 为关键路径与运维接口提供单元测试或集成测试；并发与退出路径需覆盖。
- 示例配置与启动脚本放置在模块 `config/` 或框架示例目录；保持可复制性。

## 兼容性与版本约定

- 外部依赖库版本锁定并定期评估升级；变更需在文档中注明影响与迁移步骤。
- 配置字段演进遵循向后兼容策略，废弃字段需标注并提供过渡期。

## 文档与提交规范

- 每个子服务需在模块目录下维护 README，描述能力、配置、路由与运维要点。
- 代码提交应对齐本风格，全局命名与日志格式保持一致；含重大行为变更需在文档补充说明。

