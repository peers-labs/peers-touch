# Registry V2 合并设计

## 核心改进

基于现有registry包，融合V2的极简设计理念，创建统一、向后兼容的registry接口规范。

## 主要变化

### 1. 统一接口设计
- **合并Query和Get**: 一个`Query`方法处理所有查询场景
- **支持多namespace**: `Registration`结构支持多namespace注册
- **Fire-and-forget Watch**: 简化watch机制，无需管理生命周期

### 2. 新增数据结构

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

### 3. 标准命名空间
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
	
	// 向后兼容
	DefaultPeersNetworkNamespace = "pst" // 原有的默认namespace
)
```

### 4. 新增Option函数

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

### 5. 后端适配器接口
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

## 使用示例

### 1. 注册（向后兼容 + 新特性）
```go
// 传统方式（向后兼容）
registry.Register(ctx, peer, registry.WithTTL(30*time.Minute))

// 新方式（多namespace）
registry.RegisterV2Global(ctx, &registry.Registration{
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
results, err := registry.QueryV2Global(ctx, registry.WithID("node-123"))

// 查询特定namespace
results, err := registry.QueryV2Global(ctx,
	registry.WithNamespacesV2("pt1/prod/bootstrap"),
	registry.WithTypesV2("bootstrap"),
	registry.WithActiveOnlyV2(true),
)

// 递归查询多个namespace
results, err := registry.QueryV2Global(ctx,
	registry.WithNamespacesV2("pt1/prod", "pt1/staging"),
	registry.WithRecursiveV2(true),
	registry.WithTypesV2("bootstrap", "registry"),
)
```

### 3. Watch（fire-and-forget）
```go
err := registry.WatchV2Global(ctx, func(event registry.WatchEvent) {
	switch event.Type {
	case registry.WatchEventAdd:
		fmt.Printf("Component added: %s\n", event.Registration.Name)
	case registry.WatchEventUpdate:
		fmt.Printf("Component updated: %s\n", event.Registration.Name)
	case registry.WatchEventDelete:
		fmt.Printf("Component deleted: %s\n", event.Registration.Name)
	}
},
	registry.WithWatchNamespacesV2("pt1/prod/bootstrap"),
	registry.WithWatchTypesV2("bootstrap"),
	registry.WithWatchActiveOnlyV2(true),
)
```

## 文件结构

```
registry/
├── registry.go          # 核心接口定义
├── types.go            # 基础类型定义
├── options.go          # 原有选项（向后兼容）
├── options_v2.go       # V2选项（新增功能）
├── query_v2.go         # 查询选项（统一Query和Get）
├── watch_v2.go         # Watch选项（fire-and-forget）
├── registry_v2.go       # V2类型定义
├── backend.go          # 后端适配器接口
├── errors.go           # 错误定义
├── watcher.go          # 原有Watcher接口（向后兼容）
├── DESIGN_V2.md        # V2设计文档
└── MERGE_SUMMARY.md    # 合并总结
```

## 关键优势

1. **向后兼容**: 现有代码无需修改即可继续使用
2. **API统一**: 一个Query方法处理所有查询场景
3. **多namespace支持**: 支持层次化namespace设计
4. **Fire-and-forget Watch**: 简化watch使用，无需管理生命周期
5. **实现解耦**: 通过Backend接口支持不同中间件（mDNS、Consul、etcd等）
6. **Option模式**: 灵活配置，易于扩展

## 迁移路径

1. **保持现有接口**: 确保向后兼容
2. **新增V2接口**: 提供更强大的功能
3. **统一实现**: 一个实现同时支持新旧接口
4. **逐步迁移**: 新代码使用新接口，老代码逐步迁移

这个合并设计既保持了向后兼容性，又引入了V2的极简理念，达到了统一和进步的目标。