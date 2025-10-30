# Registry V2 全局管理器设计

## 核心功能

Registry V2 提供了全局的registry管理功能，类似于老版本的default registry机制，但更加强大和灵活。

## 全局管理器API

### 1. Registry管理
```go
// 注册V2 registry实现
RegisterV2(registry RegistryV2)

// 获取默认的V2 registry
GetDefaultRegistryV2() RegistryV2

// 获取指定名称的V2 registry
GetRegistryV2(name string) (RegistryV2, error)

// 获取所有V2 registries
GetAllRegistriesV2() map[string]RegistryV2

// 设置默认V2 registry
SetDefaultRegistryV2(name string) error
```

### 2. 全局便捷函数
```go
// 使用默认V2 registry注册
RegisterV2Global(ctx context.Context, registration *Registration, opts ...RegisterOption) error

// 使用默认V2 registry查询
QueryV2Global(ctx context.Context, opts ...QueryOption) ([]*Registration, error)

// 使用默认V2 registry观察
WatchV2Global(ctx context.Context, callback WatchCallback, opts ...WatchOption) error

// 使用默认V2 registry注销
DeregisterV2Global(ctx context.Context, id string, opts ...DeregisterOption) error
```

### 3. Peer兼容函数（向后兼容）
```go
// 使用V2接口注册Peer（兼容转换）
RegisterV2Peer(ctx context.Context, peer *Peer, opts ...RegisterOption) error

// 使用V2接口查询Peer（兼容转换）
QueryV2Peer(ctx context.Context, opts ...QueryOption) (*Peer, error)

// 使用V2接口列出所有Peers（兼容转换）
ListV2Peers(ctx context.Context, opts ...QueryOption) ([]*Peer, error)
```

## 使用示例

### 1. 注册V2 Registry实现
```go
// 创建V2 registry实现
myRegistry := &MyV2Registry{ /* 初始化参数 */ }

// 注册到全局管理器
registry.RegisterV2(myRegistry)

// 或者设置特定名称为默认
registry.SetDefaultRegistryV2("my-registry")
```

### 2. 使用全局V2 Registry
```go
// 注册组件
err := registry.RegisterV2Global(ctx, &registry.Registration{
    ID:         "bootstrap-123",
    Name:       "Bootstrap Service",
    Type:       "bootstrap",
    Namespaces: []string{"pt1/prod/bootstrap", "global"},
    Addresses:  []string{"/ip4/192.168.1.100/tcp/4001"},
})

// 查询组件
results, err := registry.QueryV2Global(ctx,
    registry.WithNamespaces("pt1/prod/bootstrap"),
    registry.WithTypes("bootstrap"),
)

// 观察变化
err := registry.WatchV2Global(ctx, func(event registry.WatchEvent) {
    fmt.Printf("Event: %s, Component: %s\n", event.Type, event.Registration.Name)
})
```

### 3. Peer兼容使用（向后兼容）
```go
// 创建Peer（老版本方式）
peer := &registry.Peer{
    ID:   "peer-123",
    Name: "Test Peer",
    Metadata: map[string]interface{}{
        "type": "bootstrap",
        "version": "1.0.0",
    },
    EndStation: map[string]*registry.EndStation{
        "main": {
            NetAddress: "/ip4/192.168.1.100/tcp/4001",
        },
    },
}

// 使用V2接口注册Peer
err := registry.RegisterV2Peer(ctx, peer, registry.WithTTL(30*time.Minute))

// 使用V2接口查询Peer
peer, err := registry.QueryV2Peer(ctx, registry.WithID("peer-123"))

// 使用V2接口列出所有Peers
peers, err := registry.ListV2Peers(ctx, registry.WithTypes("bootstrap"))
```

## 与老版本的区别

| 功能 | 老版本 | V2版本 |
|------|--------|--------|
| 默认registry | 单个全局registry | 支持多个registry，可切换默认 |
| 注册接口 | `Register(peer, opts...)` | `RegisterV2Global(registration, opts...)` |
| 查询接口 | `GetPeer(opts...)` + `ListPeers(opts...)` | `QueryV2Global(opts...)` |
| Watch接口 | `Watch(opts...)` (返回Watcher) | `WatchV2Global(callback, opts...)` (fire-and-forget) |
| 数据结构 | `Peer` | `Registration` (支持多namespace) |
| 命名空间 | 单namespace | 多namespace支持 |

## 设计优势

1. **向后兼容**: 提供Peer兼容函数，老代码可以平滑迁移
2. **多registry支持**: 支持注册多个V2 registry实现
3. **动态切换**: 可以动态切换默认registry
4. **全局便捷**: 提供全局函数，使用简单
5. **线程安全**: 所有操作都是线程安全的
6. **错误处理**: 完善的错误处理和日志记录

这个设计既保持了老版本的便利性，又引入了V2的强大功能，实现了平滑的升级路径。