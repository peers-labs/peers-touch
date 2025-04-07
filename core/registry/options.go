package registry

import (
	"github.com/libp2p/go-libp2p/core/peer"
	"time"
)

// region Options

// Option is a function that can be used to configure a Registry
type Option func(*Options)

type Options struct {
}

type RegisterOption func(*RegisterOptions)

type RegisterOptions struct {
	TTL time.Duration
}

type DeregisterOption func(*DeregisterOptions)

type DeregisterOptions struct {
}

type GetOption func(*GetOptions)

type GetOptions struct {
}

type WatchOption func(*WatchOptions)

type WatchOptions struct{}

// endregion

// RegistryConfig 注册表的配置结构体
type RegistryConfig struct {
	DNSAddresses            []string
	DHTNodes                []string
	BootstrapNodes          []peer.AddrInfo
	ContentDiscoveryEnabled bool
	BroadcastEnabled        bool
}

// Option 是一个函数类型，用于修改 RegistryConfig
type Option func(*RegistryConfig)

// WithDNSAddresses 设置 DNS 服务器地址
func WithDNSAddresses(addresses []string) Option {
	return func(c *RegistryConfig) {
		c.DNSAddresses = addresses
	}
}

// WithDHTNodes 设置 DHT 节点信息
func WithDHTNodes(nodes []string) Option {
	return func(c *RegistryConfig) {
		c.DHTNodes = nodes
	}
}

// WithBootstrapNodes 设置引导节点列表
func WithBootstrapNodes(nodes []peer.AddrInfo) Option {
	return func(c *RegistryConfig) {
		c.BootstrapNodes = nodes
	}
}

// EnableContentDiscovery 启用基于内容的发现
func EnableContentDiscovery() Option {
	return func(c *RegistryConfig) {
		c.ContentDiscoveryEnabled = true
	}
}

// EnableBroadcast 启用节点广播与组播
func EnableBroadcast() Option {
	return func(c *RegistryConfig) {
		c.BroadcastEnabled = true
	}
}
