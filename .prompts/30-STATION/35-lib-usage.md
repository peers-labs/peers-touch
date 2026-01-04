# Station 库使用规范

本文档规定 Station 项目中核心库的使用规范，确保代码一致性和可维护性。

## 日志库 (Logger)

### 强制规范

- **必须使用**：`github.com/peers-labs/peers-touch/station/frame/core/logger`
- **禁止使用**：
  - `frame/core/util/log`（已废弃）
  - `log`（标准库）
  - `gorm.io/gorm/logger`（仅供 GORM 内部使用）
  - 任何第三方日志库

### 函数签名

所有日志函数的**第一个参数必须是 `context.Context`**：

```go
func Info(ctx context.Context, args ...interface{})
func Infof(ctx context.Context, template string, args ...interface{})
func Warn(ctx context.Context, args ...interface{})
func Warnf(ctx context.Context, template string, args ...interface{})
func Error(ctx context.Context, args ...interface{})
func Errorf(ctx context.Context, template string, args ...interface{})
func Debug(ctx context.Context, args ...interface{})
func Debugf(ctx context.Context, template string, args ...interface{})
```

### 使用示例

```go
import (
    "context"
    "github.com/peers-labs/peers-touch/station/frame/core/logger"
)

func DoSomething(ctx context.Context) error {
    // 简单日志
    logger.Info(ctx, "starting operation")
    
    // 格式化日志
    logger.Infof(ctx, "processing user: %s", userID)
    
    // 错误日志
    if err := someOperation(); err != nil {
        logger.Errorf(ctx, "operation failed: %v", err)
        return err
    }
    
    // 警告日志
    logger.Warnf(ctx, "deprecated API called by %s", caller)
    
    logger.Info(ctx, "operation completed successfully")
    return nil
}
```

### 日志级别使用指南

| 级别 | 使用场景 | 示例 |
|------|---------|------|
| **Debug** | 开发调试信息 | 详细的变量值、函数调用栈 |
| **Info** | 正常运行信息 | 服务启动、请求处理、状态变更 |
| **Warn** | 警告但不影响运行 | 使用废弃 API、配置缺失但有默认值 |
| **Error** | 错误但可恢复 | 请求失败、数据库查询错误 |

### 最佳实践

1. **始终传递 context**
   ```go
   // ✅ 正确
   logger.Info(ctx, "message")
   
   // ❌ 错误
   logger.Info("message")  // 编译错误
   ```

2. **使用格式化函数**
   ```go
   // ✅ 推荐
   logger.Infof(ctx, "user %s logged in from %s", userID, ip)
   
   // ❌ 不推荐
   logger.Info(ctx, "user " + userID + " logged in from " + ip)
   ```

3. **错误日志包含上下文**
   ```go
   // ✅ 好
   logger.Errorf(ctx, "failed to save user %s: %v", userID, err)
   
   // ❌ 差
   logger.Error(ctx, err)
   ```

4. **避免敏感信息**
   ```go
   // ❌ 危险
   logger.Infof(ctx, "password: %s", password)
   
   // ✅ 安全
   logger.Infof(ctx, "user authenticated: %s", userID)
   ```

---

## 配置库 (Config)

### 强制规范

- **必须使用**：`github.com/peers-labs/peers-touch/station/frame/core/config`
- 配置结构体使用 `pconf` 标签
- 在 `init()` 中注册配置

### 使用示例

```go
import "github.com/peers-labs/peers-touch/station/frame/core/config"

var myOptions struct {
    Peers struct {
        Node struct {
            MyService struct {
                Enabled bool   `pconf:"enabled"`
                Port    int    `pconf:"port"`
                Host    string `pconf:"host"`
            } `pconf:"my-service"`
        } `pconf:"node"`
    } `pconf:"peers"`
}

func init() {
    config.RegisterOptions(&myOptions)
}
```

---

## 数据库库 (Store)

### 强制规范

- **必须使用**：`github.com/peers-labs/peers-touch/station/frame/core/store`
- 使用 `GetRDS()` 获取数据库连接
- 数据模型使用 GORM 标签

### 使用示例

```go
import (
    "context"
    "github.com/peers-labs/peers-touch/station/frame/core/store"
    "gorm.io/gorm"
)

type User struct {
    ID        uint      `gorm:"primaryKey"`
    Name      string    `gorm:"index"`
    Email     string    `gorm:"uniqueIndex"`
    CreatedAt time.Time
}

func GetUser(ctx context.Context, id uint) (*User, error) {
    rds, err := store.GetRDS(ctx, store.WithRDSDBName("station.db"))
    if err != nil {
        return nil, err
    }
    
    var user User
    if err := rds.First(&user, id).Error; err != nil {
        return nil, err
    }
    
    return &user, nil
}

// 注册表迁移
func init() {
    store.InitTableHooks(func(ctx context.Context, rds *gorm.DB) {
        _ = rds.AutoMigrate(&User{})
    })
}
```

---

## 选项库 (Option)

### 强制规范

- **必须使用**：`github.com/peers-labs/peers-touch/station/frame/core/option`
- 使用 `option.NewWrapper` 创建类型安全的选项
- 提供 `WithXxx` 函数

### 使用示例

```go
import "github.com/peers-labs/peers-touch/station/frame/core/option"

type MyOptions struct {
    Host string
    Port int
}

var myWrapper = option.NewWrapper("my-service", func(o *option.Options) *MyOptions {
    return &MyOptions{
        Host: "localhost",
        Port: 8080,
    }
})

func WithHost(host string) option.Option {
    return myWrapper.Wrap(func(o *MyOptions) {
        o.Host = host
    })
}

func WithPort(port int) option.Option {
    return myWrapper.Wrap(func(o *MyOptions) {
        o.Port = port
    })
}

func getOptions(opts ...option.Option) *MyOptions {
    o := option.GetOptions(opts...)
    if o.Ctx().Value("my-service") == nil {
        return &MyOptions{}
    }
    return o.Ctx().Value("my-service").(*MyOptions)
}
```

---

## HTTP 服务库 (Server)

### 强制规范

- **必须使用**：`github.com/peers-labs/peers-touch/station/frame/core/server`
- Handler 使用标准 `http.HandlerFunc` 签名
- 使用 `server.NewHandler` 注册路由

### 使用示例

```go
import (
    "context"
    "encoding/json"
    "net/http"
    "github.com/peers-labs/peers-touch/station/frame/core/server"
)

type myURL struct {
    name string
    path string
}

func (u myURL) Name() string    { return u.name }
func (u myURL) Path() string    { return u.path }
func (u myURL) SubPath() string { return u.path }

func (s *myServer) Handlers() []server.Handler {
    return []server.Handler{
        server.NewHandler(
            myURL{name: "my-endpoint", path: "/api/my/endpoint"},
            http.HandlerFunc(s.handleEndpoint),
            server.WithMethod(server.GET),
        ),
    }
}

func (s *myServer) handleEndpoint(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    
    // 处理逻辑
    result := map[string]string{"status": "ok"}
    
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusOK)
    json.NewEncoder(w).Encode(result)
}
```

---

## 认证库 (Auth)

### 强制规范

- **必须使用**：`github.com/peers-labs/peers-touch/station/frame/core/auth`
- HTTP 中间件使用 `auth/http` 包

### 使用示例

```go
import (
    "github.com/peers-labs/peers-touch/station/frame/core/auth"
    authhttp "github.com/peers-labs/peers-touch/station/frame/core/auth/http"
)

func (s *myServer) Handlers() []server.Handler {
    // 需要认证的处理器
    protectedHandler := http.Handler(http.HandlerFunc(s.handleProtected))
    if s.authProvider != nil {
        protectedHandler = authhttp.RequireJWT(s.authProvider)(protectedHandler)
    }
    
    return []server.Handler{
        server.NewHandler(
            myURL{name: "protected", path: "/api/protected"},
            protectedHandler,
            server.WithMethod(server.GET),
        ),
    }
}
```

---

## 插件库 (Plugin)

### 强制规范

- **必须使用**：`github.com/peers-labs/peers-touch/station/frame/core/plugin`
- SubServer 插件注册到 `plugin.SubserverPlugins`

### 使用示例

```go
import (
    "github.com/peers-labs/peers-touch/station/frame/core/plugin"
    "github.com/peers-labs/peers-touch/station/frame/core/server"
)

type myPlugin struct{}

func (p *myPlugin) Name() string { return "my-service" }
func (p *myPlugin) Enabled() bool { return myOptions.Enabled }
func (p *myPlugin) Options() []option.Option {
    return []option.Option{
        WithHost(myOptions.Host),
        WithPort(myOptions.Port),
    }
}
func (p *myPlugin) New(opts ...option.Option) server.Subserver {
    opts = append(opts, p.Options()...)
    return NewMyServer(opts...)
}

func init() {
    plugin.SubserverPlugins["my-service"] = &myPlugin{}
}
```

---

## 禁止使用的库

以下库已废弃或不应在新代码中使用：

| 库 | 状态 | 替代方案 |
|----|------|---------|
| `frame/core/util/log` | ❌ 已废弃 | `frame/core/logger` |
| `log` (标准库) | ❌ 禁止 | `frame/core/logger` |
| `fmt.Println` | ❌ 禁止用于日志 | `frame/core/logger` |

---

## 检查清单

在提交代码前，请确认：

- [ ] 所有日志使用 `frame/core/logger`
- [ ] 所有日志函数第一个参数是 `context.Context`
- [ ] 配置使用 `pconf` 标签并已注册
- [ ] 数据库操作使用 `store.GetRDS()`
- [ ] HTTP Handler 使用标准签名
- [ ] 没有使用禁止的库

---

## 参考文档

- [Station Base](./30-station-base.md)
- [Go Standards](./31-go-standards.md)
- [SubServer Standard](./34-subserver-standard.md)
