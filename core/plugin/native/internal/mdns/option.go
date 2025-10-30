package mdns

import (
	"net"
	"time"

	"github.com/peers-touch/peers-touch-go/core/types"
)

// Option configures a mDNS service
type Option func(*Options)

// Options holds the configuration for mDNS service
type Options struct {
	Namespace string
	Service   string
	Domain    string
	HostName  string
	Port      int
	IPs       []net.IP
	TXT       []string

	// Discovery settings
	DiscoveryInterval time.Duration
	TTL               time.Duration

	node types.Node
}

// DefaultServiceConfig returns a default configuration
func DefaultServiceConfig() Options {
	return Options{
		Service:           "_peers-touch._tcp",
		Domain:            "local.",
		DiscoveryInterval: 30 * time.Second,
		TTL:               120 * time.Second,
	}
}

// WithNamespace sets the Namespace name
func WithNamespace(Namespace string) Option {
	return func(c *Options) {
		c.Namespace = Namespace
	}
}

// WithService sets the service type
func WithService(service string) Option {
	return func(c *Options) {
		c.Service = service
	}
}

// WithDomain sets the domain
func WithDomain(domain string) Option {
	return func(c *Options) {
		c.Domain = domain
	}
}

// WithHostName sets the hostname
func WithHostName(hostName string) Option {
	return func(c *Options) {
		c.HostName = hostName
	}
}

// WithPort sets the service port
func WithPort(port int) Option {
	return func(c *Options) {
		c.Port = port
	}
}

// WithIPs sets the IP addresses
func WithIPs(ips []net.IP) Option {
	return func(c *Options) {
		c.IPs = ips
	}
}

// WithTXT sets the TXT records
func WithTXT(txt []string) Option {
	return func(c *Options) {
		c.TXT = txt
	}
}

// WithDiscoveryInterval sets the discovery interval
func WithDiscoveryInterval(interval time.Duration) Option {
	return func(c *Options) {
		c.DiscoveryInterval = interval
	}
}

// WithTTL sets the TTL for mDNS records
func WithTTL(ttl time.Duration) Option {
	return func(c *Options) {
		c.TTL = ttl
	}
}

// ApplyOptions applies a list of options to a Options
func ApplyOptions(config Options, opts ...Option) Options {
	for _, opt := range opts {
		opt(&config)
	}
	return config
}

// WithNode sets the node
// the node is only used for conveniently parsing metadata info for mDNS service
// eg. the ip of this node will not be set to mDNS service
func WithNode(node types.Node) Option {
	return func(c *Options) {
		c.node = node
	}
}
