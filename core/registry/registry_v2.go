package registry

import (
	"context"
	"fmt"
	"sync"
	"time"
	
	"github.com/peers-touch/peers-touch-go/core/logger"
	"github.com/peers-touch/peers-touch-go/core/option"
)

// RegistryV2 统一注册接口 - 合并V2设计的极简理念
type RegistryV2 interface {
	// 基础生命周期
	Init(ctx context.Context, opts ...option.Option) error
	Options() Options
	String() string
	
	// 注册操作 - 采用V2的Option模式理念
	Register(ctx context.Context, registration *Registration, opts ...RegisterOption) error
	Deregister(ctx context.Context, id string, opts ...DeregisterOption) error
	
	// 查询操作 - 统一Query接口（合并Get和List）
	Query(ctx context.Context, opts ...QueryOption) ([]*Registration, error)
	
	// Watch操作 - fire-and-forget模式
	Watch(ctx context.Context, callback WatchCallback, opts ...WatchOption) error
}

// V2全局管理器
type v2RegistryManager struct {
	mu              sync.Mutex
	registries      map[string]RegistryV2 // 名称 -> RegistryV2
	defaultRegistry RegistryV2              // 默认registry
}

var (
	// 全局V2 registry管理器
	globalV2Manager = &v2RegistryManager{
		registries: make(map[string]RegistryV2),
	}
)

// RegisterV2 注册V2 registry实现
func RegisterV2(registry RegistryV2) {
	globalV2Manager.mu.Lock()
	defer globalV2Manager.mu.Unlock()

	name := registry.String()
	if _, exists := globalV2Manager.registries[name]; exists {
		logger.Errorf(context.Background(), "V2 registry %s already registered", name)
		return
	}

	globalV2Manager.registries[name] = registry

	// 如果是第一个registry或者设置了IsDefault，则设为默认
	if globalV2Manager.defaultRegistry == nil || registry.Options().IsDefault {
		globalV2Manager.defaultRegistry = registry
		logger.Infof(context.Background(), "Set %s as default V2 registry", name)
	}
}

// RegisterV2Peer 使用V2接口注册Peer（兼容转换）
func RegisterV2Peer(ctx context.Context, peer *Peer, opts ...RegisterOption) error {
	// 转换Peer到Registration
	registration := &Registration{
		ID:         peer.ID,
		Name:       peer.Name,
		Version:    peer.Version,
		Metadata:   peer.Metadata,
		Signature:  peer.Signature,
		EndStation: peer.EndStation,
	}
	
	// 设置类型（从metadata中获取或默认）
	if peerType, ok := peer.Metadata["type"].(string); ok {
		registration.Type = peerType
	} else {
		registration.Type = "peer"
	}
	
	// 设置地址（从EndStation转换）
	var addresses []string
	for _, station := range peer.EndStation {
		if station.NetAddress != "" {
			addresses = append(addresses, station.NetAddress)
		}
	}
	registration.Addresses = addresses
	
	// 使用V2全局注册
	return RegisterV2Global(ctx, registration, opts...)
}

// 适配器：将V2 RegisterOption转换为RegisterOptionV2
func adaptRegisterOptions(opts []RegisterOption) []RegisterOptionV2 {
	var v2Opts []RegisterOptionV2
	for _, opt := range opts {
		v2Opts = append(v2Opts, func(o *RegisterOptionsV2) {
			// 创建临时RegisterOptions来捕获转换
			tempOpts := &RegisterOptions{}
			opt(tempOpts)
			
			// 转换字段
			if tempOpts.Namespace != "" {
				o.Namespace = tempOpts.Namespace
				o.Namespaces = []string{tempOpts.Namespace} // 支持多namespace
			}
			if tempOpts.TTL > 0 {
				o.TTL = tempOpts.TTL
			}
			if tempOpts.Interval > 0 {
				o.Interval = tempOpts.Interval
			}
		})
	}
	return v2Opts
}

// QueryV2Peer 使用V2接口查询Peer（兼容转换）
func QueryV2Peer(ctx context.Context, opts ...QueryOption) (*Peer, error) {
	registrations, err := QueryV2Global(ctx, opts...)
	if err != nil {
		return nil, err
	}
	
	if len(registrations) == 0 {
		return nil, fmt.Errorf("peer not found")
	}
	
	// 取第一个结果转换回Peer
	reg := registrations[0]
	return &Peer{
		ID:        reg.ID,
		Name:      reg.Name,
		Version:   reg.Version,
		Metadata:  reg.Metadata,
		Signature: reg.Signature,
		EndStation: reg.EndStation,
		Timestamp: time.Now(),
	}, nil
}

// ListV2Peers 使用V2接口列出所有Peers（兼容转换）
func ListV2Peers(ctx context.Context, opts ...QueryOption) ([]*Peer, error) {
	registrations, err := QueryV2Global(ctx, opts...)
	if err != nil {
		return nil, err
	}
	
	peers := make([]*Peer, 0, len(registrations))
	for _, reg := range registrations {
		peer := &Peer{
			ID:        reg.ID,
			Name:      reg.Name,
			Version:   reg.Version,
			Metadata:  reg.Metadata,
			Signature: reg.Signature,
			EndStation: reg.EndStation,
			Timestamp: time.Now(),
		}
		peers = append(peers, peer)
	}
	
	return peers, nil
}

// GetDefaultRegistryV2 获取默认的V2 registry
func GetDefaultRegistryV2() RegistryV2 {
	globalV2Manager.mu.Lock()
	defer globalV2Manager.mu.Unlock()
	return globalV2Manager.defaultRegistry
}

// GetRegistryV2 获取指定名称的V2 registry
func GetRegistryV2(name string) (RegistryV2, error) {
	globalV2Manager.mu.Lock()
	defer globalV2Manager.mu.Unlock()
	
	registry, exists := globalV2Manager.registries[name]
	if !exists {
		return nil, fmt.Errorf("V2 registry not found: %s", name)
	}
	return registry, nil
}

// GetAllRegistriesV2 获取所有V2 registries
func GetAllRegistriesV2() map[string]RegistryV2 {
	globalV2Manager.mu.Lock()
	defer globalV2Manager.mu.Unlock()
	
	// 返回副本避免外部修改
	result := make(map[string]RegistryV2)
	for k, v := range globalV2Manager.registries {
		result[k] = v
	}
	return result
}

// SetDefaultRegistryV2 设置默认V2 registry
func SetDefaultRegistryV2(name string) error {
	globalV2Manager.mu.Lock()
	defer globalV2Manager.mu.Unlock()
	
	registry, exists := globalV2Manager.registries[name]
	if !exists {
		return fmt.Errorf("V2 registry not found: %s", name)
	}
	
	globalV2Manager.defaultRegistry = registry
	logger.Infof(context.Background(), "Set %s as default V2 registry", name)
	return nil
}

// 全局便捷函数 - 使用默认V2 registry

// RegisterV2Global 使用默认V2 registry注册
func RegisterV2Global(ctx context.Context, registration *Registration, opts ...RegisterOption) error {
	registry := GetDefaultRegistryV2()
	if registry == nil {
		return fmt.Errorf("no default V2 registry set")
	}
	return registry.Register(ctx, registration, opts...)
}

// QueryV2Global 使用默认V2 registry查询
func QueryV2Global(ctx context.Context, opts ...QueryOption) ([]*Registration, error) {
	registry := GetDefaultRegistryV2()
	if registry == nil {
		return nil, fmt.Errorf("no default V2 registry set")
	}
	return registry.Query(ctx, opts...)
}

// WatchV2Global 使用默认V2 registry观察
func WatchV2Global(ctx context.Context, callback WatchCallback, opts ...WatchOption) error {
	registry := GetDefaultRegistryV2()
	if registry == nil {
		return fmt.Errorf("no default V2 registry set")
	}
	return registry.Watch(ctx, callback, opts...)
}

// DeregisterV2Global 使用默认V2 registry注销
func DeregisterV2Global(ctx context.Context, id string, opts ...DeregisterOption) error {
	registry := GetDefaultRegistryV2()
	if registry == nil {
		return fmt.Errorf("no default V2 registry set")
	}
	return registry.Deregister(ctx, id, opts...)
}

// Registration 注册信息 - 融合V2设计理念
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
	
	// 兼容现有字段
	Version     string                 // 版本信息
	Signature   []byte                 // 签名信息
}

// WatchEvent 观察事件 - 采用V2设计
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

// 标准命名空间 - 融合V2的平权理念
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
	DefaultPeersNetworkNamespaceV2 = "pst" // 原有的默认namespace
)