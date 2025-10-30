# Registry V2 合并设计总结

## 核心改进

### 1. 统一接口设计
- **合并Query和Get**: 一个`Query`方法处理所有查询场景
- **支持多namespace**: `Registration`结构支持多namespace注册
- **Fire-and-forget Watch**: 简化watch机制，无需管理生命周期

### 2. 接口对比

| 操作 | V1原有接口 | V2合并后接口 |
|------|------------|--------------|
| 注册 | `Register(peer, opts...)` | `Register(registration, opts...)` |
| 查询 | `GetPeer(opts...)` + `ListPeers(opts...)` | `Query(opts...)` |
| 观察 | `Watch(opts...)` (返回Watcher) | `Watch(callback, opts...)` (fire-and-forget) |
| 注销 | `Deregister(peer, opts...)` | `Deregister(id, opts...)` |

### 3. 新增Option函数

#### 注册Option（V2理念）
```go
WithNamespaces(namespaces ...string)  // 支持多namespace
WithType(typeStr string)             // 设置类型
WithName(name string)                // 设置名称
WithMetadata(metadata map[string]interface{}) // 设置元数据
```

#### 查询Option（统一Query和Get）
```go
WithID(id string)                    // 通过ID查询（替代Get）
WithNamespaces(namespaces ...string) // 查询多个namespace
WithTypes(types ...string)           // 类型过滤
WithRecursive(recursive bool)        // 递归查询
WithActiveOnly(active bool)          // 只查活跃的
WithMaxResults(max int)              // 最大结果数
```

#### WatchOption（fire-and-forget）
```go
WithWatchNamespaces(namespaces ...string) // 观察多个namespace
WithWatchTypes(types ...string)          // 观察类型
WithWatchActiveOnly(active bool)         // 只观察活跃的
WithWatchRecursive(recursive bool)       // 递归观察
```

### 4. 新的数据结构

#### Registration（融合V2理念）
```go
type Registration struct {
	ID          string                 // 唯一标识
	Name        string                 // 显示名称
	Type        string                 // 类型: bootstrap, registry, turn, peer
	Namespaces  []string               // 支持多namespace注册
	Addresses   []string               // 网络地址
	Metadata    map[string]interface{} // 扩展元数据
	TTL         time.Duration          // 生存时间
	CreatedAt   interface{}            // 创建时间
	UpdatedAt   interface{}            // 更新时间
	
	// 向后兼容现有字段
	Version     string                 // 版本信息
	Signature   []byte                 // 签名信息
	EndStation  map[string]*EndStation // 终端站点信息
}
```

#### WatchEvent（简化版）
```go
type WatchEvent struct {
	Type         WatchEventType // 事件类型
	Registration *Registration  // 注册信息
	Timestamp    interface{}    // 时间戳
	Namespace    string         // 触发事件的namespace
}

type WatchEventType string
const (
	WatchEventAdd    WatchEventType = "ADD"
	WatchEventUpdate WatchEventType = "UPDATE" 
	WatchEventDelete WatchEventType = "DELETE"
)
```

### 5. 标准命名空间

```go
const (
	// 基础命名空间
	NamespaceGlobal   = "global"
	NamespaceLocal    = "local"
	NamespaceInternal = "internal"
	
	// 版本化命名空间
	NamespaceV1Prefix     = "pt1"
	NamespaceV1Global     = "pt1/global"
	NamespaceV1Local      = "pt1/local"
	NamespaceV1Prod       = "pt1/prod"
	NamespaceV1Staging    = "pt1/staging"
	NamespaceV1Test       = "pt1/test"
	
	// 组件命名空间
	NamespaceV1Bootstrap  = "pt1/bootstrap"
	NamespaceV1Registry   = "pt1/registry"
	NamespaceV1Turn       = "pt1/turn"
)
```

### 6. 后端适配器接口

```go
type Backend interface {
	Name() string
	DiscoveryMethods() []string
	Register(ctx context.Context, reg *Registration) error
	Deregister(ctx context.Context, id string) error
	Query(ctx context.Context, namespaces []string, opts QueryOptions) ([]*Registration, error)
	Watch(ctx context.Context, namespaces []string, opts WatchOptions) (<-chan WatchEvent, error)
	Close() error
}
```

### 7. 使用示例对比

#### 原有使用方式（仍然支持）
```go
// 注册
registry.Register(ctx, peer, registry.WithTTL(30*time.Minute))

// 查询
peer, err := registry.GetPeer(ctx, registry.WithId("node-123"))
peers, err := registry.ListPeers(ctx, registry.WithName("bootstrap"))

// 观察
watcher, err := registry.Watch(ctx)
go handleWatcher(watcher)
```

#### 新的使用方式（推荐）
```go
// 注册
registration := &registry.Registration{
	ID:         host.ID().String(),
	Name:       "bootstrap-service",
	Type:       "bootstrap",
	Namespaces: []string{"pt1/prod/bootstrap", "global"},
	Addresses:  []string{"/ip4/192.168.1.100/tcp/4001"},
}
registry.Register(ctx, registration, registry.WithTTL(30*time.Minute))

// 查询
results, err := registry.Query(ctx,
	registry.WithID("node-123"),                    // 通过ID查询
	registry.WithNamespaces("pt1/prod/bootstrap"),  // namespace过滤
	registry.WithTypes("bootstrap"),                // 类型过滤
	registry.WithActiveOnly(true),                  // 只查活跃的
)

// 观察
registry.Watch(ctx, func(event registry.WatchEvent) {
	switch event.Type {
	case registry.WatchEventAdd:
		handleAdded(event.Registration)
	case registry.WatchEventUpdate:
		handleUpdated(event.Registration)
	case registry.WatchEventDelete:
		handleDeleted(event.Registration)
	}
},
	registry.WithWatchNamespaces("pt1/prod"),
	registry.WithWatchTypes("bootstrap"),
	registry.WithWatchRecursive(true),
)
```

## 关键优势

1. **向后兼容**: 现有代码无需修改
2. **API统一**: 一个Query方法处理所有查询场景
3. **多namespace支持**: 支持层次化namespace设计
4. **Fire-and-forget Watch**: 简化watch使用，无需管理生命周期
5. **实现解耦**: 通过Backend接口支持不同中间件
6. **Option模式**: 灵活配置，易于扩展

## 迁移路径

1. **保持现有接口**: 确保向后兼容
2. **新增V2接口**: 提供更强大的功能
3. **统一实现**: 一个实现同时支持新旧接口
4. **逐步迁移**: 新代码使用新接口，老代码逐步迁移

这个合并设计既保持了向后兼容性，又引入了V2的极简理念，达到了统一和进步的目标。