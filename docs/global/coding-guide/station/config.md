# Station 配置系统指南

> 源码位置: `apps/station/frame/core/config/`

## 1. 架构概览

Station 的配置系统采用**分层堆叠**设计, 通过 `stackConfig` 将多个配置源 (YAML 文件、环境变量、CLI 参数等) 合并为统一的配置树.
核心能力包括:

- 多源加载与合并 (Sources)
- 按路径获取配置值 (`Get`)
- 结构体自动注入 (`pconf` 标签)
- 配置热更新 (Watch)

数据流:

```
配置源 (YAML/Env/CLI)
       │
       ▼
  config.Load(sources...)
       │
       ▼
  reader 合并为统一 JSON 树
       │
       ▼
  stackConfig (全局单例 _sugar)
       │
       ├── Get(path...) → Value
       └── injectAutowired() → 按 pconf 标签自动注入到注册的 Options 结构体
```

---

## 2. Config 接口

```go
// frame/core/config/config.go
type Config interface {
    reader.Values                         // 内嵌 Values 接口
    Init(opts ...option.Option) error     // 初始化配置
    Close() error                         // 关闭并清理
}
```

其中 `reader.Values` 定义于 `frame/core/pkg/config/reader/reader.go`:

```go
type Values interface {
    Bytes() []byte
    Get(path ...string) Value
    Map() map[string]interface{}
    Scan(v interface{}) error
}
```

`reader.Value` 提供了类型安全的取值方法:

```go
type Value interface {
    Bool(def bool) bool
    Int(def int) int
    String(def string) string
    Float64(def float64) float64
    Duration(def time.Duration) time.Duration
    StringSlice(def []string) []string
    StringMap(def map[string]string) map[string]string
    Scan(val interface{}) error
    Bytes() []byte
}
```

每个方法都接受一个默认值参数, 当路径不存在或类型不匹配时返回该默认值.

---

## 3. stackConfig 实现

`stackConfig` 是 `Config` 接口的唯一实现:

```go
type stackConfig struct {
    config config.Config   // 底层 pkg/config 实例
    opts   *Options        // 配置选项
}
```

### 3.1 初始化流程

```go
func (c *stackConfig) Init(opts ...option.Option) error {
    // 1. 应用选项
    for _, opt := range opts { c.opts.Apply(opt) }

    // 2. 创建底层 config 实例
    cfg, _ := config.NewConfig(
        config.Storage(c.opts.Storage),
        config.Watch(c.opts.Watch),
    )

    // 3. 加载所有配置源
    cfg.Load(c.opts.Sources...)

    // 4. 缓存为全局 sugar
    _sugar = c

    // 5. 触发 pconf 自动注入
    injectAutowired(c.opts.Ctx())
}
```

### 3.2 Get 方法与层级分隔符

`Get` 支持两种调用方式:

```go
// 方式一: 多参数路径
config.Get("peers", "node", "server", "address").String(":8080")

// 方式二: 点分隔字符串 (自动拆分)
config.Get("peers.node.server.address").String(":8080")
```

实现中会检测单参数是否包含 `.`, 如果包含则自动按 `DefaultHierarchySeparator` 拆分:

```go
func (c *stackConfig) Get(path ...string) reader.Value {
    tempPath := path
    if len(path) == 1 {
        if strings.Contains(path[0], DefaultHierarchySeparator) {
            tempPath = strings.Split(path[0], DefaultHierarchySeparator)
        }
    }
    return c.config.Get(tempPath...)
}
```

---

## 4. 全局 Sugar 访问器

`config_sugar.go` 提供了全局快捷访问:

```go
// frame/core/config/config_sugar.go
var _sugar Config

func Get(path ...string) reader.Value {
    return _sugar.Get(path...)
}
```

在业务代码中可以直接使用:

```go
import "github.com/peers-labs/peers-touch/station/frame/core/config"

addr := config.Get("peers.node.server.address").String(":8080")
enabled := config.Get("peers.node.server.subserver.ai-chat.enabled").Bool(false)
interval := config.Get("peers.registry.retry-interval").Duration(10 * time.Second)
```

---

## 5. config.Options

```go
// frame/core/config/options.go
type Options struct {
    *option.Options

    Sources        []source.Source   // 配置源列表 (YAML、Env、CLI 等)
    Storage        bool              // 是否持久化到本地存储
    Watch          bool              // 是否启用配置热更新 (默认 true)
    HierarchyMerge bool             // 是否将多参数路径合并为点分隔
}
```

可用的选项函数:

```go
config.WithSources(source1, source2)   // 追加配置源
config.WithStorage(true)               // 启用持久化
config.WithWatch(false)                // 关闭热更新
config.WithHierarchyMerge(true)        // 开启层级合并
```

---

## 6. pconf 标签自动注入系统

这是 Station 配置系统最核心的特性. 通过 `pconf` struct tag, 配置值会在系统初始化时**自动注入**到注册的结构体字段中.

### 6.1 原理

1. 开发者定义一个带 `pconf` 标签的结构体, 标签值对应 YAML 配置树中的键名.
2. 通过 `config.RegisterOptions(&myOptions)` 注册该结构体指针.
3. 配置系统初始化后, `injectAutowired` 函数递归遍历结构体, 按标签路径从配置树中取值并赋值.
4. 后台协程每 3 秒刷新一次 (实现配置热更新).

### 6.2 标签语法

```
pconf:"<yaml-key-name>"
```

标签值直接对应 YAML 层级中的键名. 嵌套结构体的标签组合形成完整路径.

### 6.3 支持的字段类型

`config_autowired.go` 中的 `bindAutowiredValue` 支持以下类型:

| Go 类型 | 说明 |
|---------|------|
| `string` | 字符串 |
| `bool` | 布尔值 |
| `int/int8/.../int64` | 有符号整数 |
| `uint/uint8/.../uint64` | 无符号整数 |
| `[]string` | 字符串切片 |
| `[]Struct` | 结构体切片 (通过 JSON Scan) |
| `map[string]string` | 字符串映射 |
| `map[string]Struct` | 结构体映射 (通过 JSON Scan) |
| `time.Time` | 时间 (RFC3339 格式) |
| 嵌套 `struct` | 递归处理子字段 |

### 6.4 完整示例: AI Chat 插件

定义 Options 结构体:

```go
// app/subserver/ai_chat/plugin.go
var aiChatOptions struct {
    Peers struct {
        Node struct {
            Server struct {
                Subserver struct {
                    AIChat struct {
                        Enabled bool `pconf:"enabled"`
                    } `pconf:"ai-chat"`
                } `pconf:"subserver"`
            } `pconf:"server"`
        } `pconf:"node"`
    } `pconf:"peers"`
}
```

在 `init()` 中注册:

```go
func init() {
    config.RegisterOptions(&aiChatOptions)
    plugin.SubserverPlugins["ai-chat"] = &aiChatPlugin{}
}
```

对应的 YAML 配置:

```yaml
peers:
  node:
    server:
      subserver:
        ai-chat:
          enabled: true
```

使用注入的值:

```go
func (p *aiChatPlugin) Enabled() bool {
    return aiChatOptions.Peers.Node.Server.Subserver.AIChat.Enabled
}
```

### 6.5 更复杂的示例: OSS 插件

```go
var ossOptions struct {
    Peers struct {
        Node struct {
            Server struct {
                Subserver struct {
                    Oss struct {
                        Enabled    bool   `pconf:"enabled"`
                        Path       string `pconf:"path"`
                        DBName     string `pconf:"rds-name"`
                        StorePath  string `pconf:"store-path"`
                        SignSecret string `pconf:"sign-secret"`
                    } `pconf:"oss"`
                } `pconf:"subserver"`
            } `pconf:"server"`
        } `pconf:"node"`
    } `pconf:"peers"`
}
```

对应 YAML:

```yaml
peers:
  node:
    server:
      subserver:
        oss:
          enabled: true
          path: /api/v1/oss
          rds-name: oss
          store-path: ./data/oss
          sign-secret: my-secret
```

### 6.6 RegisterOptions 内部机制

```go
func RegisterOptions(options ...interface{}) {
    for _, o := range options {
        val := reflect.ValueOf(o)
        if val.Kind() != reflect.Ptr {
            log.Error("options must be a pointer")
            return
        }
        // 以调用者文件名+行号为 key, 确保唯一性
        _, file, line, _ := runtime.Caller(1)
        key := fmt.Sprintf("%s#L%d", file, line)
        optionsPool[key] = val
    }
}
```

注意: **必须传入指针**, 否则无法修改原始结构体.

---

## 7. YAML 配置层级规范

Station 的 YAML 配置遵循统一的层级结构:

```yaml
peers:
  # 运行模式
  run-mode: 2

  # 配置选项
  config:
    hierarchy-merge: true

  # 日志
  logger:
    name: slogrus

  # 存储
  store:
    rds:
      gorm:
        - name: sqlite
          driver: sqlite
          default: true
          enable: true
          dsn: "file:peers.db?cache=shared&_fk=1"

  # 节点层级
  node:
    # 服务器
    server:
      name: hertz
      address: ":8082"
      metadata:
        name: foo
        value: qux

      # 子服务配置 (每个 subserver 一个键)
      subserver:
        ai-chat:
          enabled: true
        oss:
          enabled: true
          path: /api/v1/oss
          rds-name: oss
        launcher:
          enabled: true
          rds-name: launcher
        oauth:
          enabled: true
          providers: [...]

    # 传输层
    transport:
      name: libp2p
      addrs:
        - /ip4/0.0.0.0/tcp/9000
```

子服务配置的标准路径格式: `peers.node.server.subserver.<module-name>`

---

## 8. 配置源类型

框架内置了多种配置源 (`frame/core/pkg/config/source/`):

| 源类型 | 说明 |
|--------|------|
| `file` | YAML/JSON 文件, 最常用 |
| `memory` | 内存配置, 用于测试 |
| `env` | 环境变量, 按 `_` 分隔映射到层级 |
| `cli` | 命令行参数 |

环境变量映射规则: `DATABASE_HOST` → `{"database": {"host": "..."}}`

---

## 9. 配置热更新 (Watch)

`injectAutowired` 启动了一个后台协程, 每 3 秒重新扫描 `optionsPool` 中的所有注册结构体并刷新字段值:

```go
func injectAutowired(ctx context.Context) {
    refresh := func() {
        for s, value := range optionsPool {
            bindAutowiredValue(ctx, value)
        }
    }

    // 首次刷新
    refresh()

    // 后台定时刷新
    go func() {
        for {
            select {
            case <-time.After(3 * time.Second):
                refresh()
            case <-ctx.Done():
                return
            }
        }
    }()
}
```

这意味着如果底层 YAML 文件被修改且配置源支持 Watch, 注册的 Options 结构体字段值会在 3 秒内自动更新.

---

## 10. 最佳实践

1. **结构体命名**: 推荐使用 `<module>Options` 或 `<module>PluginOptions` 命名, 保持在 `plugin.go` 或 `options.go` 中定义.

2. **init() 注册**: 在 `init()` 函数中调用 `config.RegisterOptions`, 确保在配置系统初始化时自动生效.

3. **路径一致性**: `pconf` 标签值必须与 YAML 键名完全一致 (使用 kebab-case, 如 `rds-name`).

4. **直接访问 vs pconf**: 简单的一次性读取用 `config.Get()`, 需要热更新或多处复用的配置用 `pconf` 标签.

5. **敏感信息**: 密钥等敏感信息应通过环境变量注入, 不要硬编码在 YAML 文件中.
