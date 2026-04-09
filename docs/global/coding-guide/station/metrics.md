# Station 指标监控指南

> 源码位置: `apps/station/frame/core/metrics/`, `apps/station/frame/core/debug/actuator/`

---

## 1. 架构概览

Station 的指标系统采用 **Provider 抽象 + 全局单例** 模式, 默认为 no-op 实现 (零开销), 引入 Prometheus 包后自动替换为真实指标采集:

```
应用代码
    │
    ▼
metrics.Get().Counter/Gauge/Histogram  ← 全局 Provider 单例
    │
    ├── noopProvider (默认, 无任何开销)
    └── prometheus.Provider (引入后自动注册)
            │
            ├── 本地 /metrics 端点 (promhttp)
            └── remote_write 推送 (Grafana Cloud 等)
```

Actuator 模块提供调试/健康检查端点, 作为 Subserver 挂载到主服务:

```
debugSubServer
    │
    ├── /debug/registered-peers   — 查询已注册的节点
    ├── /debug/list-all-handlers  — 列出所有路由
    └── /debug/get-peer-by-id    — 按 ID 查询节点
```

---

## 2. Provider 接口

> 源码: `frame/core/metrics/metrics.go`

### 2.1 核心接口定义

```go
type Provider interface {
    Counter(name, help string, labels ...string) Counter
    Gauge(name, help string, labels ...string) Gauge
    Histogram(name, help string, buckets []float64, labels ...string) Histogram
    Handler() http.Handler
}
```

| 方法 | 说明 |
|---|---|
| `Counter` | 创建或获取一个计数器 (只增不减) |
| `Gauge` | 创建或获取一个仪表盘 (可增可减) |
| `Histogram` | 创建或获取一个直方图 (分桶统计) |
| `Handler` | 返回指标暴露的 HTTP Handler (如 `/metrics`) |

### 2.2 Counter 接口

```go
type Counter interface {
    Inc(labels ...string)
    Add(v float64, labels ...string)
}
```

| 方法 | 说明 |
|---|---|
| `Inc` | 计数器 +1, 按 label 值区分维度 |
| `Add` | 计数器 +v, v 必须 >= 0 |

### 2.3 Gauge 接口

```go
type Gauge interface {
    Set(v float64, labels ...string)
    Inc(labels ...string)
    Dec(labels ...string)
    Add(v float64, labels ...string)
}
```

| 方法 | 说明 |
|---|---|
| `Set` | 设置为指定值 |
| `Inc` | +1 |
| `Dec` | -1 |
| `Add` | +v (v 可为负数) |

### 2.4 Histogram 接口

```go
type Histogram interface {
    Observe(v float64, labels ...string)
}
```

| 方法 | 说明 |
|---|---|
| `Observe` | 记录一次观测值, 落入对应的分桶 |

---

## 3. 全局单例

### 3.1 注册与获取

```go
var (
    mu       sync.RWMutex
    provider Provider = &noopProvider{} // 默认 no-op
)

// 安装全局 Provider, 必须在创建任何指标之前调用 (通常在 init() 中)
func SetProvider(p Provider) {
    mu.Lock()
    defer mu.Unlock()
    provider = p
}

// 获取全局 Provider
func Get() Provider {
    mu.RLock()
    defer mu.RUnlock()
    return provider
}
```

使用方式:

```go
// 在业务代码中直接获取 Provider 并创建指标
counter := metrics.Get().Counter(
    "http_requests_total",
    "Total HTTP requests",
    "method", "path", "status",
)

// 记录一次请求
counter.Inc("GET", "/api/v1/users", "200")
```

### 3.2 线程安全

`SetProvider` 和 `Get` 均通过 `sync.RWMutex` 保护. `Get` 使用读锁, 允许并发读取; `SetProvider` 使用写锁, 确保注册安全.

---

## 4. Noop 实现

当没有任何 Provider 注册时, 默认使用 no-op 实现, 所有方法为空操作:

```go
type noopProvider struct{}

func (noopProvider) Counter(string, string, ...string) Counter                    { return noopCounter{} }
func (noopProvider) Gauge(string, string, ...string) Gauge                        { return noopGauge{} }
func (noopProvider) Histogram(string, string, []float64, ...string) Histogram     { return noopHistogram{} }
func (noopProvider) Handler() http.Handler                                         { return http.NotFoundHandler() }

type noopCounter struct{}
func (noopCounter) Inc(...string)          {}
func (noopCounter) Add(float64, ...string) {}

type noopGauge struct{}
func (noopGauge) Set(float64, ...string) {}
func (noopGauge) Inc(...string)          {}
func (noopGauge) Dec(...string)          {}
func (noopGauge) Add(float64, ...string) {}

type noopHistogram struct{}
func (noopHistogram) Observe(float64, ...string) {}
```

设计意图:
- 业务代码可以无条件调用 `metrics.Get().Counter(...)` 而不需要判断是否注册了 Provider
- 未引入 Prometheus 依赖时, 零开销, 零副作用
- `Handler()` 返回 `http.NotFoundHandler()`, 访问 `/metrics` 得到 404

---

## 5. Prometheus 集成

> 源码: `frame/core/metrics/prometheus/`

### 5.1 Provider 实现 (prometheus.go)

```go
type Provider struct {
    registry *prometheus.Registry
    mu       sync.Mutex
    counters map[string]*prometheus.CounterVec
    gauges   map[string]*prometheus.GaugeVec
    histos   map[string]*prometheus.HistogramVec
}

func New() *Provider {
    return &Provider{
        registry: prometheus.NewRegistry(),
        counters: make(map[string]*prometheus.CounterVec),
        gauges:   make(map[string]*prometheus.GaugeVec),
        histos:   make(map[string]*prometheus.HistogramVec),
    }
}
```

关键设计:
- 使用独立的 `prometheus.NewRegistry()` 而非全局默认 registry, 避免与其他库冲突
- 内部维护 `map[string]*Vec` 缓存, 同名指标只注册一次
- 通过 `sync.Mutex` 保护注册操作

### 5.2 Counter 创建示例

```go
func (p *Provider) Counter(name, help string, labels ...string) metrics.Counter {
    p.mu.Lock()
    defer p.mu.Unlock()

    // 已存在则复用
    if cv, ok := p.counters[name]; ok {
        return &counterAdapter{cv: cv}
    }

    // 首次创建并注册到 registry
    cv := prometheus.NewCounterVec(prometheus.CounterOpts{
        Name: name,
        Help: help,
    }, labels)
    p.registry.MustRegister(cv)
    p.counters[name] = cv
    return &counterAdapter{cv: cv}
}
```

Gauge 和 Histogram 的创建逻辑完全一致. Histogram 额外支持自定义 buckets, 为空时使用 `prometheus.DefBuckets`:

```go
func (p *Provider) Histogram(name, help string, buckets []float64, labels ...string) metrics.Histogram {
    p.mu.Lock()
    defer p.mu.Unlock()

    if hv, ok := p.histos[name]; ok {
        return &histogramAdapter{hv: hv}
    }

    if len(buckets) == 0 {
        buckets = prometheus.DefBuckets // {.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10}
    }

    hv := prometheus.NewHistogramVec(prometheus.HistogramOpts{
        Name:    name,
        Help:    help,
        Buckets: buckets,
    }, labels)
    p.registry.MustRegister(hv)
    p.histos[name] = hv
    return &histogramAdapter{hv: hv}
}
```

### 5.3 Adapter 模式

Prometheus 的 `CounterVec`/`GaugeVec`/`HistogramVec` 通过 adapter 桥接到 `metrics.Counter`/`Gauge`/`Histogram` 接口:

```go
type counterAdapter struct {
    cv *prometheus.CounterVec
}

func (c *counterAdapter) Inc(labels ...string) {
    c.cv.WithLabelValues(labels...).Inc()
}

func (c *counterAdapter) Add(v float64, labels ...string) {
    c.cv.WithLabelValues(labels...).Add(v)
}

type gaugeAdapter struct {
    gv *prometheus.GaugeVec
}

func (g *gaugeAdapter) Set(v float64, labels ...string) {
    g.gv.WithLabelValues(labels...).Set(v)
}

func (g *gaugeAdapter) Inc(labels ...string) {
    g.gv.WithLabelValues(labels...).Inc()
}

func (g *gaugeAdapter) Dec(labels ...string) {
    g.gv.WithLabelValues(labels...).Dec()
}

func (g *gaugeAdapter) Add(v float64, labels ...string) {
    g.gv.WithLabelValues(labels...).Add(v)
}

type histogramAdapter struct {
    hv *prometheus.HistogramVec
}

func (h *histogramAdapter) Observe(v float64, labels ...string) {
    h.hv.WithLabelValues(labels...).Observe(v)
}
```

### 5.4 HTTP Handler

```go
func (p *Provider) Handler() http.Handler {
    return promhttp.HandlerFor(p.registry, promhttp.HandlerOpts{})
}
```

返回标准的 Prometheus metrics 暴露端点, 挂载到服务后可通过 `GET /metrics` 获取 Prometheus 格式的指标数据.

---

## 6. 自动注册与配置

> 源码: `frame/core/metrics/prometheus/init.go`

### 6.1 init() 自动注册

```go
func init() {
    config.RegisterOptions(&metricsConfig)
    metrics.SetProvider(New())
}
```

只要在代码中 import prometheus 包, `init()` 自动执行:
1. 注册配置结构体到 pconf 配置系统
2. 创建 Prometheus Provider 并设为全局 Provider

```go
import _ "github.com/peers-labs/peers-touch/station/frame/core/metrics/prometheus"
```

### 6.2 配置结构体

```go
var metricsConfig struct {
    Peers struct {
        Metrics struct {
            Prometheus struct {
                RemoteWrite struct {
                    Enabled  bool   `pconf:"enabled"`
                    Endpoint string `pconf:"endpoint"`
                    Username string `pconf:"username"`
                    Password string `pconf:"password"`
                    Interval string `pconf:"interval"`
                } `pconf:"remote-write"`
            } `pconf:"prometheus"`
        } `pconf:"metrics"`
    } `pconf:"peers"`
}
```

对应的 YAML 配置 (`metrics.yml`):

```yaml
peers:
  metrics:
    prometheus:
      remote-write:
        enabled: true
        endpoint: "https://prometheus-prod-01.grafana.net/api/prom/push"
        username: "123456"
        password: "your-api-key"
        interval: "15s"
```

---

## 7. Remote Write

> 源码: `frame/core/metrics/prometheus/remote_write.go`

### 7.1 启动入口

在应用生命周期的 `AfterStart` 钩子中调用:

```go
prometheus.TryStartRemoteWrite(ctx)
```

`TryStartRemoteWrite` 读取 pconf 注入的配置, 如果启用则启动后台推送协程:

```go
func TryStartRemoteWrite(ctx context.Context) {
    cfg := metricsConfig.Peers.Metrics.Prometheus.RemoteWrite
    if !cfg.Enabled || cfg.Endpoint == "" {
        return
    }

    provider, ok := metrics.Get().(*Provider)
    if !ok {
        logger.Warnf(ctx, "[metrics] provider is not Prometheus, skipping remote_write")
        return
    }

    interval := 15 * time.Second
    if cfg.Interval != "" {
        if d, err := time.ParseDuration(cfg.Interval); err == nil {
            interval = d
        }
    }

    provider.StartRemoteWrite(ctx, RemoteWriteConfig{
        Enabled:  true,
        Endpoint: cfg.Endpoint,
        Username: cfg.Username,
        Password: cfg.Password,
        Interval: interval,
    })
}
```

### 7.2 推送循环

```go
func (p *Provider) remoteWriteLoop(ctx context.Context, cfg RemoteWriteConfig) {
    ticker := time.NewTicker(cfg.Interval)
    defer ticker.Stop()

    client := &http.Client{Timeout: 10 * time.Second}

    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            if err := p.pushOnce(ctx, client, cfg); err != nil {
                logger.Warnf(ctx, "[metrics] remote_write push failed: %v", err)
            }
        }
    }
}
```

每个推送周期执行一次 `pushOnce`:
1. 从 registry 收集所有指标 (`registry.Gather()`)
2. 转换为 `prompb.WriteRequest` (Prometheus remote_write v1 协议)
3. `proto.Marshal` + `snappy.Encode` 压缩
4. POST 到 remote_write endpoint

### 7.3 指标转换

`gatherToWriteRequest` 将 Prometheus client_model 的 `MetricFamily` 转换为 `prompb.TimeSeries`:

```go
func gatherToWriteRequest(mfs []*dto.MetricFamily) *prompb.WriteRequest {
    nowMs := time.Now().UnixMilli()
    var timeseries []*prompb.TimeSeries

    for _, mf := range mfs {
        name := mf.GetName()
        for _, m := range mf.GetMetric() {
            baseLabels := buildPrompbLabels(name, m.GetLabel())

            switch mf.GetType() {
            case dto.MetricType_COUNTER:
                // 直接取值
                timeseries = append(timeseries, newTimeSeries(baseLabels, c.GetValue(), nowMs))

            case dto.MetricType_HISTOGRAM:
                // 每个 bucket 一条 timeseries, 加上 _sum 和 _count
                for _, b := range h.GetBucket() {
                    bucketLabels := appendLabel(baseLabels, "le", formatFloat(b.GetUpperBound()))
                    timeseries = append(timeseries, newTimeSeries(bucketLabels, ...))
                }
                // +Inf bucket
                // _sum, _count

            case dto.MetricType_GAUGE:
                // 直接取值

            case dto.MetricType_SUMMARY:
                // 每个 quantile 一条 timeseries, 加上 _sum 和 _count
            }
        }
    }

    return &prompb.WriteRequest{Timeseries: timeseries}
}
```

### 7.4 请求格式

```go
req.Header.Set("Content-Type", "application/x-protobuf")
req.Header.Set("Content-Encoding", "snappy")
req.Header.Set("X-Prometheus-Remote-Write-Version", "0.1.0")
if cfg.Username != "" && cfg.Password != "" {
    req.SetBasicAuth(cfg.Username, cfg.Password)
}
```

符合 Prometheus remote_write v1 协议规范, 兼容 Grafana Cloud、Thanos、Cortex 等.

---

## 8. Actuator 调试端点

> 源码: `frame/core/debug/actuator/`

### 8.1 debugSubServer

Actuator 以 `server.Subserver` 形式挂载, 提供运维调试端点:

```go
type debugSubServer struct {
    opts *DebugServerOptions
}

func NewDebugSubServer(opts ...option.Option) server.Subserver {
    s := &debugSubServer{
        opts: option.GetOptions(opts...).Ctx().Value(debugServerOptionsKey{}).(*DebugServerOptions),
    }
    return s
}
```

### 8.2 可用端点

| 端点 | 方法 | 说明 |
|---|---|---|
| `/debug/registered-peers` | GET | 查询所有已注册的节点列表和数量 |
| `/debug/list-all-handlers` | GET | 列出所有路由 Handler 的名称、路径、方法 |
| `/debug/get-peer-by-id?id=xxx` | GET | 按 ID 查询指定节点信息 |

### 8.3 配置选项

```go
type DebugServerOptions struct {
    *option.Options
    path     string
    registry registry.Registry
}

// 注入 registry
WithDebugServerRegistry(reg registry.Registry) option.Option

// 设置路径前缀
WithDebugServerPath(path string) option.Option
```

### 8.4 使用示例

```go
import "github.com/peers-labs/peers-touch/station/frame/core/debug/actuator"

debugServer := actuator.NewDebugSubServer(
    actuator.WithDebugServerRegistry(reg),
    actuator.WithDebugServerPath("/debug"),
)
```

---

## 9. 实践指南

### 9.1 在业务代码中使用指标

```go
package myservice

import "github.com/peers-labs/peers-touch/station/frame/core/metrics"

// 在包级别创建指标 (惰性注册, 首次调用时创建)
var (
    requestCounter = metrics.Get().Counter(
        "myservice_requests_total",
        "Total requests to myservice",
        "method", "status",
    )

    requestDuration = metrics.Get().Histogram(
        "myservice_request_duration_seconds",
        "Request duration in seconds",
        []float64{0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5},
        "method",
    )

    activeConnections = metrics.Get().Gauge(
        "myservice_active_connections",
        "Number of active connections",
        "protocol",
    )
)

func HandleRequest(method string) {
    start := time.Now()
    defer func() {
        duration := time.Since(start).Seconds()
        requestDuration.Observe(duration, method)
    }()

    requestCounter.Inc(method, "200")
    activeConnections.Inc("http")
    defer activeConnections.Dec("http")

    // ... 业务逻辑
}
```

### 9.2 启用 Prometheus + Remote Write

```go
// main.go 或 init 文件中, 空导入即可激活
import _ "github.com/peers-labs/peers-touch/station/frame/core/metrics/prometheus"
```

配置文件 `metrics.yml`:

```yaml
peers:
  metrics:
    prometheus:
      remote-write:
        enabled: true
        endpoint: "https://prometheus-prod-01.grafana.net/api/prom/push"
        username: "123456"
        password: "<api-key>"
        interval: "15s"
```

在 AfterStart 钩子中启动:

```go
func afterStart(ctx context.Context) error {
    prometheus.TryStartRemoteWrite(ctx)
    return nil
}
```

### 9.3 指标命名规范

| 类型 | 命名模式 | 示例 |
|---|---|---|
| Counter | `<namespace>_<name>_total` | `station_http_requests_total` |
| Gauge | `<namespace>_<name>` | `station_active_websockets` |
| Histogram | `<namespace>_<name>_seconds` / `_bytes` | `station_request_duration_seconds` |

Label 命名建议:
- 使用小写下划线: `method`, `status_code`, `peer_id`
- 控制基数: 避免将高基数值 (如 user ID) 作为 label
- 保持一致: 同一维度在所有指标中使用相同的 label 名称

### 9.4 不引入 Prometheus 时的行为

如果不 import prometheus 包, 所有指标调用走 no-op 实现:
- `metrics.Get()` 返回 `noopProvider`
- 所有 `Inc()`/`Add()`/`Observe()` 调用为空函数, 零开销
- `Handler()` 返回 `http.NotFoundHandler()`
- 不产生任何 goroutine 或内存分配
