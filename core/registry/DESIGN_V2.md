# Registry V2 合并设计文档

## 核心设计目标

基于现有registry包，融合V2的极简设计理念，创建统一、向后兼容的registry接口规范。

## 主要改进

### 1. 统一接口设计
- **合并Query和Get**: 一个`Query`方法处理所有查询场景
- **简化注册**: 支持多namespace的`Registration`结构
- **Fire-and-forget Watch**: 简化watch机制，无需管理生命周期

### 2. Namespace平权设计
```go
// 标准命名空间（只是普通字符串，无特殊处理）
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

### 3. 新的Registration结构
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

### 4. 简化的Option模式
```go
// 注册Option - 支持多namespace
func WithNamespaces(namespaces ...string) RegisterOption
func WithType(typeStr string) RegisterOption
func WithName(name string) RegisterOption
func WithMetadata(metadata map[string]interface{}) RegisterOption

// 查询Option - 统一Query和Get
func WithID(id string) QueryOption                    // 替代原来的Get
func WithNamespaces(namespaces ...string) QueryOption // 支持多namespace
func WithTypes(types ...string) QueryOption          // 类型过滤
func WithRecursive(recursive bool) QueryOption       // 递归查询
func WithActiveOnly(active bool) QueryOption          // 只查活跃的

// WatchOption - fire-and-forget
func WithWatchNamespaces(namespaces ...string) WatchOption
func WithWatchTypes(types ...string) WatchOption
func WithWatchActiveOnly(active bool) WatchOption
func WithWatchRecursive(recursive bool) WatchOption
```

## 使用示例

### 1. 注册（向后兼容 + 新特性）
```go
// 传统方式（向后兼容）
registry.Register(ctx, peer, registry.WithTTL(30*time.Minute))

// 新方式（多namespace）
registry.Register(ctx, &registry.Registration{
	ID:         host.ID().String(),
	Name:       "bootstrap-service",
	Type:       "bootstrap",
	Namespaces: []string{"pt1/prod/bootstrap", "pt1/staging/bootstrap", "global"},
	Addresses:  []string{"/ip4/192.168.1.100/tcp/4001"},
	Metadata:   map[string]interface{}{"version": "1.0.0"},
})
```

### 2. 查询（统一接口）
```go
// 通过ID查询（替代原来的Get）
results, err := registry.Query(ctx, registry.WithID("node-123"))

// 查询特定namespace
results, err := registry.Query(ctx,
	registry.WithNamespaces("pt1/prod/bootstrap"),
	registry.WithTypes("bootstrap"),
	registry.WithActiveOnly(true),
)

// 递归查询多个namespace
results, err := registry.Query(ctx,
	registry.WithNamespaces("pt1/prod", "pt1/staging"),
	registry.WithRecursive(true),
	registry.WithTypes("bootstrap", "registry"),
)
```

### 3. Watch（fire-and-forget）
```go
err := registry.Watch(ctx, func(event registry.WatchEvent) {
	switch event.Type {
	case registry.WatchEventAdd:
		fmt.Printf("Component added: %s\n", event.Registration.Name)
	case registry.WatchEventUpdate:
		fmt.Printf("Component updated: %s\n", event.Registration.Name)
	case registry.WatchEventDelete:
		fmt.Printf("Component deleted: %s\n", event.Registration.Name)
	}
},
	registry.WithWatchNamespaces("pt1/prod/bootstrap"),
	registry.WithWatchTypes("bootstrap"),
	registry.WithWatchActiveOnly(true),
)
```

## 后端适配器设计

registry包只定义接口规范，具体实现由不同的后端适配器完成：

```go
// Backend 后端适配器接口
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

### 可能的实现
- **local**: 本地内存实现
- **mdns**: mDNS服务发现
- **consul**: Consul集成
- **etcd**: etcd集成
- **mixed**: 混合实现（本地 + mDNS + DHT）

## 迁移策略

1. **保持向后兼容**: 现有代码无需修改
2. **逐步迁移**: 新代码使用新接口
3. **统一实现**: 一个实现同时支持新旧接口
4. **平滑过渡**: 通过Option模式兼容过渡

## 设计原则

1. **极简主义**: 最少的接口，最多的功能
2. **向后兼容**: 保持现有API不变
3. **Option模式**: 灵活配置，向后兼容
4. **Namespace平权**: 所有namespace统一处理
5. **实现解耦**: 接口与实现完全分离