package registry

import (
	"context"
	"fmt"
	"sync"
	"time"
	
	"github.com/peers-touch/peers-touch-go/core/logger"
	"github.com/peers-touch/peers-touch-go/core/option"
)

// Registry 统一注册接口 - V2极简设计
type Registry interface {
	// 基础生命周期
	Init(ctx context.Context, opts ...option.Option) error
	Options() Options
	String() string
	
	// 注册操作 - 采用Option模式理念
	Register(ctx context.Context, registration *Registration, opts ...RegisterOption) error
	Deregister(ctx context.Context, id string, opts ...DeregisterOption) error
	
	// 查询操作 - 统一Query接口
	Query(ctx context.Context, opts ...QueryOption) ([]*Registration, error)
	
	// Watch操作 - fire-and-forget模式
	Watch(ctx context.Context, callback WatchCallback, opts ...WatchOption) error
}

// V2全局管理器
type v2RegistryManager struct {
	mu              sync.Mutex
	registries      map[string]Registry // 名称 -> Registry
	defaultRegistry Registry              // 默认registry
}

var (
	// 全局registry管理器
	globalManager = &v2RegistryManager{
		registries: make(map[string]Registry),
	}
)

// Register 注册registry实现
func Register(registry Registry) {
	globalManager.mu.Lock()
	defer globalManager.mu.Unlock()

	name := registry.String()
	if _, exists := globalManager.registries[name]; exists {
		logger.Errorf(context.Background(), "registry %s already registered", name)
		return
	}

	globalManager.registries[name] = registry

	// 如果是第一个registry或者设置了IsDefault，则设为默认
	if globalManager.defaultRegistry == nil || registry.Options().IsDefault {
		globalManager.defaultRegistry = registry
		logger.Infof(context.Background(), "Set %s as default registry", name)
	}
}

// GetDefaultRegistry 获取默认的registry
func GetDefaultRegistry() Registry {
	globalManager.mu.Lock()
	defer globalManager.mu.Unlock()
	return globalManager.defaultRegistry
}

// GetRegistry 获取指定名称的registry
func GetRegistry(name string) (Registry, error) {
	globalManager.mu.Lock()
	defer globalManager.mu.Unlock()
	
	registry, exists := globalManager.registries[name]
	if !exists {
		return nil, fmt.Errorf("registry not found: %s", name)
	}
	return registry, nil
}

// GetAllRegistries 获取所有registries
func GetAllRegistries() map[string]Registry {
	globalManager.mu.Lock()
	defer globalManager.mu.Unlock()
	
	// 返回副本避免外部修改
	result := make(map[string]Registry)
	for k, v := range globalManager.registries {
		result[k] = v
	}
	return result
}

// SetDefaultRegistry 设置默认registry
func SetDefaultRegistry(name string) error {
	globalManager.mu.Lock()
	defer globalManager.mu.Unlock()
	
	registry, exists := globalManager.registries[name]
	if !exists {
		return fmt.Errorf("registry not found: %s", name)
	}
	
	globalManager.defaultRegistry = registry
	logger.Infof(context.Background(), "Set %s as default registry", name)
	return nil
}

// 全局便捷函数 - 使用默认registry

// RegisterGlobal 使用默认registry注册
func RegisterGlobal(ctx context.Context, registration *Registration, opts ...RegisterOption) error {
	registry := GetDefaultRegistry()
	if registry == nil {
		return fmt.Errorf("no default registry set")
	}
	return registry.Register(ctx, registration, opts...)
}

// QueryGlobal 使用默认registry查询
func QueryGlobal(ctx context.Context, opts ...QueryOption) ([]*Registration, error) {
	registry := GetDefaultRegistry()
	if registry == nil {
		return nil, fmt.Errorf("no default registry set")
	}
	return registry.Query(ctx, opts...)
}

// WatchGlobal 使用默认registry观察
func WatchGlobal(ctx context.Context, callback WatchCallback, opts ...WatchOption) error {
	registry := GetDefaultRegistry()
	if registry == nil {
		return fmt.Errorf("no default registry set")
	}
	return registry.Watch(ctx, callback, opts...)
}

// DeregisterGlobal 使用默认registry注销
func DeregisterGlobal(ctx context.Context, id string, opts ...DeregisterOption) error {
	registry := GetDefaultRegistry()
	if registry == nil {
		return fmt.Errorf("no default registry set")
	}
	return registry.Deregister(ctx, id, opts...)
}

// Registration 注册信息 - V2极简设计
type Registration struct {
	ID          string                 // 唯一标识
	Name        string                 // 显示名称
	Type        string                 // 类型: bootstrap, registry, turn, peer
	Namespaces  []string               // 支持多namespace注册
	Addresses   []string               // 网络地址
	Metadata    map[string]interface{} // 扩展元数据
	TTL         time.Duration          // 生存时间
	CreatedAt   interface{}            // 创建时间，具体类型由实现决定
	UpdatedAt   interface{}            // 更新时间，具体类型由实现决定
}

// WatchEvent 观察事件 - V2设计
type WatchEvent struct {
	Type         WatchEventType // 事件类型
	Registration *Registration  // 注册信息
	Timestamp    interface{}    // 时间戳，具体类型由实现决定
	Namespace    string         // 触发事件的namespace
}

// WatchEventType 事件类型
type WatchEventType string

const (
	WatchEventAdd    WatchEventType = "ADD"
	WatchEventUpdate WatchEventType = "UPDATE" 
	WatchEventDelete WatchEventType = "DELETE"
)

// WatchCallback 观察回调
type WatchCallback func(event WatchEvent)

// 标准命名空间 - V2平权理念
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
