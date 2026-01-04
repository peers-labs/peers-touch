# SubServer 开发标准

## 目录结构规范

```
app/subserver/<module>/
├── README.md              # 模块说明文档
├── plugin.go              # 插件注册与生命周期工厂
├── options.go             # 配置选项与依赖注入
├── <module>.go            # SubServer 接口实现（核心逻辑）
├── handler.go             # HTTP/Hertz 路由处理函数
├── auth.go                # 认证与权限控制（可选）
├── db/                    # 数据访问层（可选）
│   ├── model/            # 数据模型定义（GORM/Proto）
│   └── repo/             # 数据库操作封装
└── service/               # 业务逻辑层（可选）
```

## 文件职责

### 1. plugin.go - 插件注册
- 定义配置结构体（使用 `pconf` 标签）
- 实现 `plugin.SubserverPlugin` 接口
- 在 `init()` 中注册到 `plugin.SubserverPlugins`
- 负责配置映射和插件工厂

```go
var <module>Options struct {
    Peers struct {
        Node struct {
            Server struct {
                Subserver struct {
                    <Module> struct {
                        Enabled bool   `pconf:"enabled"`
                        // 其他配置字段
                    } `pconf:"<module>"`
                } `pconf:"subserver"`
            } `pconf:"server"`
        } `pconf:"node"`
    } `pconf:"peers"`
}

type <module>Plugin struct{}

func (p *<module>Plugin) Name() string { return "<module>" }
func (p *<module>Plugin) Enabled() bool { return <module>Options.Peers.Node.Server.Subserver.<Module>.Enabled }
func (p *<module>Plugin) Options() []option.Option {
    return []option.Option{
        // 返回配置选项
    }
}
func (p *<module>Plugin) New(opts ...option.Option) server.Subserver {
    opts = append(opts, p.Options()...)
    return New(opts...)
}

func init() {
    config.RegisterOptions(&<module>Options)
    plugin.SubserverPlugins["<module>"] = &<module>Plugin{}
}
```

### 2. options.go - 配置选项
- 定义 `<module>Options` 结构体
- 使用 `option.NewWrapper` 创建包装器
- 提供 `WithXxx` 函数
- 提供 `getOptions` 辅助函数

```go
type <module>Options struct {
    DBName string
    // 其他选项
}

var <module>Wrapper = option.NewWrapper("<module>", func(o *option.Options) *<module>Options {
    return &<module>Options{}
})

func WithDBName(name string) option.Option {
    return <module>Wrapper.Wrap(func(o *<module>Options) {
        o.DBName = name
    })
}

func getOptions(opts ...option.Option) *<module>Options {
    o := option.GetOptions(opts...)
    if o.Ctx().Value("<module>") == nil {
        return &<module>Options{}
    }
    return o.Ctx().Value("<module>").(*<module>Options)
}
```

### 3. <module>.go - SubServer 实现
- 实现 `server.Subserver` 接口
- 必须实现所有方法：`Init`, `Start`, `Stop`, `Name`, `Type`, `Address`, `Status`, `Handlers`
- 使用小写命名：`<module>SubServer`
- 状态管理：`stopped` → `starting` → `running` → `stopping` → `stopped`

```go
type <module>SubServer struct {
    opts   *<module>Options
    addrs  []string
    status server.Status
}

func New(opts ...option.Option) server.Subserver {
    o := getOptions(opts...)
    s := &<module>SubServer{
        opts:   o,
        addrs:  []string{},
        status: server.StatusStopped,
    }
    return s
}

func (s *<module>SubServer) Init(ctx context.Context, opts ...option.Option) error {
    s.status = server.StatusStarting
    // 初始化逻辑
    return nil
}

func (s *<module>SubServer) Start(ctx context.Context, opts ...option.Option) error {
    s.status = server.StatusRunning
    // 启动逻辑
    return nil
}

func (s *<module>SubServer) Stop(ctx context.Context) error {
    s.status = server.StatusStopped
    // 停止逻辑
    return nil
}

func (s *<module>SubServer) Name() string { return "<module>" }
func (s *<module>SubServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *<module>SubServer) Status() server.Status { return s.status }
func (s *<module>SubServer) Address() server.SubserverAddress {
    return server.SubserverAddress{Address: s.addrs}
}
```

### 4. handler.go - HTTP 处理器
- 实现 `Handlers()` 方法返回路由
- 使用 `server.NewHandler` 创建处理器
- **路由规范**: `/<module>/...` (使用模块名作为路径前缀,与主服务器路由区分)
  - ✅ 正确: `/launcher/feed`, `/ai-box/provider/new`
  - ❌ 错误: `/api/launcher/feed` (会与 Mastodon API `/api/v1/...` 混淆)
  - ❌ 错误: `/activitypub/launcher/...` (会与 ActivityPub 主路由冲突)
  - **主服务器路由**: `/activitypub/...`, `/api/v1/...`, `/management/...`, `/peer/...`, `/conv/...`, `/.well-known/...`
  - **SubServer 路由**: 使用独立的模块名前缀,避免与主路由冲突
- 使用标准 `http.HandlerFunc` 签名

```go
type <module>URL struct {
    name string
    path string
}

func (u <module>URL) Name() string    { return u.name }
func (u <module>URL) Path() string    { return u.path }
func (u <module>URL) SubPath() string { return u.path }

func (s *<module>SubServer) Handlers() []server.Handler {
    return []server.Handler{
        server.NewHandler(
            <module>URL{name: "<module>-endpoint", path: "/<module>/endpoint"},
            http.HandlerFunc(s.handleEndpoint),
            server.WithMethod(server.GET),
        ),
    }
}

func (s *<module>SubServer) handleEndpoint(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    // 处理逻辑
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusOK)
    json.NewEncoder(w).Encode(response)
}
```

## 架构分层

1. **接口层 (handler.go)**: HTTP 请求处理
2. **业务层 (service/)**: 业务逻辑（可选）
3. **数据层 (db/)**: 数据访问（可选）
4. **配置层 (plugin.go, options.go)**: 框架集成

## 命名规范

- 结构体：`<module>SubServer`（小写开头）
- 插件：`<module>Plugin`
- 配置：`<module>Options`
- 路由：`/<module>/...` (直接使用模块名)
- 注册名：`<module>`（小写，用连字符）

## 生命周期

1. **Init**: 资源构建与依赖注入，不启动后台任务
2. **Start**: 进入运行态，启动调度/监听
3. **Stop**: 优雅关闭，释放资源

## 状态管理

- `StatusStopped`: 已停止
- `StatusStarting`: 启动中
- `StatusRunning`: 运行中
- `StatusStopping`: 停止中
- `StatusError`: 错误状态

## 日志规范

**必须遵守** [库使用规范 - 日志库](./35-lib-usage.md#日志库-logger)

关键要点：
- 使用 `frame/core/logger`
- 第一个参数必须是 `context.Context`
- 关键路径记录参数与结果
- 错误需详细记录上下文

示例：
```go
import "github.com/peers-labs/peers-touch/station/frame/core/logger"

func (s *subServer) Init(ctx context.Context, opts ...option.Option) error {
    logger.Info(ctx, "begin to initiate subserver")
    // 详细规范请参考 35-lib-usage.md
    return nil
}
```

## 配置集成

1. 在 `plugin.go` 中定义配置结构（`pconf` 标签）
2. 在 `init()` 中调用 `config.RegisterOptions`
3. 在 `Options()` 方法中转换为 `option.Option`
4. 在 `New()` 方法中合并配置

## 注册流程

```go
func init() {
    // 1. 注册配置
    config.RegisterOptions(&<module>Options)
    
    // 2. 注册数据库表（如需要）
    store.InitTableHooks(func(ctx context.Context, rds *gorm.DB) {
        _ = rds.AutoMigrate(&model.YourModel{})
    })
    
    // 3. 注册插件
    plugin.SubserverPlugins["<module>"] = &<module>Plugin{}
}
```

## 使用示例

### 配置文件 (config.yaml)
```yaml
peers:
  node:
    server:
      subserver:
        <module>:
          enabled: true
          # 其他配置
```

### 代码导入
```go
import _ "github.com/peers-labs/peers-touch/station/app/subserver/<module>"
```

框架会自动加载并启动已启用的 subserver。
