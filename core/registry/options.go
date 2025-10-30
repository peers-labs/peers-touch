package registry

import "time"

// RegisterOption 注册选项 - 支持多namespace和V2理念
type RegisterOption func(*RegisterOptions)

type RegisterOptions struct {
	// V2理念：支持多namespace
	Namespaces []string
	
	// V2理念：基础字段
	Type     string
	Name     string
	Metadata map[string]interface{}
	
	// 兼容现有字段
	Namespace string // 单namespace的向后兼容
	Interval  time.Duration
	TTL       time.Duration
}

// WithNamespaces 设置多个namespace（V2理念）
func WithNamespaces(namespaces ...string) RegisterOption {
	return func(o *RegisterOptions) {
		o.Namespaces = namespaces
	}
}

// WithType 设置类型（V2理念）
func WithType(typeStr string) RegisterOption {
	return func(o *RegisterOptions) {
		o.Type = typeStr
	}
}

// WithName 设置名称（V2理念）
func WithName(name string) RegisterOption {
	return func(o *RegisterOptions) {
		o.Name = name
	}
}

// WithMetadata 设置元数据（V2理念）
func WithMetadata(metadata map[string]interface{}) RegisterOption {
	return func(o *RegisterOptions) {
		o.Metadata = metadata
	}
}

// 向后兼容的Option
func WithTTL(ttl time.Duration) RegisterOption {
	return func(o *RegisterOptions) {
		o.TTL = ttl
	}
}

func WithInterval(interval time.Duration) RegisterOption {
	return func(o *RegisterOptions) {
		o.Interval = interval
	}
}

func WithNamespace(namespace string) RegisterOption {
	return func(o *RegisterOptions) {
		o.Namespace = namespace
	}
}

// DeregisterOption 注销选项
type DeregisterOption func(*DeregisterOptions)

type DeregisterOptions struct{}

// QueryOption 查询选项 - 统一Query和Get
type QueryOption func(*QueryOptions)

type QueryOptions struct {
	// V2理念：统一Query和Get
	ID         string   // 通过ID查询（替代原来的Get）
	Namespaces []string // 查询的namespaces（支持多namespace）
	Recursive  bool     // 是否递归子namespace
	Types      []string // 类型过滤（V2理念）
	ActiveOnly bool     // 只查询活跃的
	MaxResults int      // 最大结果数
	
	// 向后兼容
	Me           bool
	NameIsPeerID bool
	Name         string
}

// WithID 通过ID查询（V2理念，替代Get）
func WithID(id string) QueryOption {
	return func(o *QueryOptions) {
		o.ID = id
	}
}

// WithNamespaces 设置查询的namespaces（V2理念）
func WithNamespaces(namespaces ...string) QueryOption {
	return func(o *QueryOptions) {
		o.Namespaces = namespaces
	}
}

// WithTypes 设置类型过滤（V2理念）
func WithTypes(types ...string) QueryOption {
	return func(o *QueryOptions) {
		o.Types = types
	}
}

// WithRecursive 设置递归查询（V2理念）
func WithRecursive(recursive bool) QueryOption {
	return func(o *QueryOptions) {
		o.Recursive = recursive
	}
}

// WithActiveOnly 只查询活跃的（V2理念）
func WithActiveOnly(active bool) QueryOption {
	return func(o *QueryOptions) {
		o.ActiveOnly = active
	}
}

// WithMaxResults 设置最大结果数（V2理念）
func WithMaxResults(max int) QueryOption {
	return func(o *QueryOptions) {
		o.MaxResults = max
	}
}

// 向后兼容的Query Option
func WithNameIsPeerID() QueryOption {
	return func(o *QueryOptions) {
		o.NameIsPeerID = true
	}
}

func WithQueryName(name string) QueryOption {
	return func(o *QueryOptions) {
		o.Name = name
	}
}

func GetMe() QueryOption {
	return func(o *QueryOptions) {
		o.Me = true
	}
}

// WatchOption Watch选项 - fire-and-forget
type WatchOption func(*WatchOptions)

type WatchOptions struct {
	// V2理念：fire-and-forget，支持多namespace
	Namespaces []string // 观察的namespaces（支持多namespace）
	Types      []string // 观察的类型
	ActiveOnly bool     // 只观察活跃的
	Recursive  bool     // 是否递归观察
}

// WithWatchNamespaces 设置观察的namespaces（V2理念）
func WithWatchNamespaces(namespaces ...string) WatchOption {
	return func(o *WatchOptions) {
		o.Namespaces = namespaces
	}
}

// WithWatchTypes 设置观察的类型（V2理念）
func WithWatchTypes(types ...string) WatchOption {
	return func(o *WatchOptions) {
		o.Types = types
	}
}

// WithWatchActiveOnly 只观察活跃的（V2理念）
func WithWatchActiveOnly(active bool) WatchOption {
	return func(o *WatchOptions) {
		o.ActiveOnly = active
	}
}

// WithWatchRecursive 递归观察（V2理念）
func WithWatchRecursive(recursive bool) WatchOption {
	return func(o *WatchOptions) {
		o.Recursive = recursive
	}
}
