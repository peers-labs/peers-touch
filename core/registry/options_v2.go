package registry

import "time"

// 融合V2理念的Option定义

// RegisterOptionV2 注册选项 - 支持多namespace和V2理念
type RegisterOptionV2 func(*RegisterOptionsV2)

type RegisterOptionsV2 struct {
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

// 将V2选项转换为标准RegisterOption
func convertV2RegisterOptions(v2Opts []RegisterOptionV2) []RegisterOption {
	var opts []RegisterOption
	for _, v2Opt := range v2Opts {
		v2Options := &RegisterOptionsV2{}
		v2Opt(v2Options)
		
		// 转换namespace
		if len(v2Options.Namespaces) > 0 {
			opts = append(opts, WithNamespace(v2Options.Namespaces[0])) // 暂时只取第一个
		} else if v2Options.Namespace != "" {
			opts = append(opts, WithNamespace(v2Options.Namespace))
		}
		
		// 转换TTL和Interval
		if v2Options.TTL > 0 {
			opts = append(opts, WithTTL(v2Options.TTL))
		}
		if v2Options.Interval > 0 {
			opts = append(opts, WithInterval(v2Options.Interval))
		}
	}
	return opts
}

// WithNamespacesV2 设置多个namespace（V2理念）
func WithNamespacesV2(namespaces ...string) RegisterOptionV2 {
	return func(o *RegisterOptionsV2) {
		o.Namespaces = namespaces
	}
}

// WithTypeV2 设置类型（V2理念）
func WithTypeV2(typeStr string) RegisterOptionV2 {
	return func(o *RegisterOptionsV2) {
		o.Type = typeStr
	}
}

// WithNameV2 设置名称（V2理念）
func WithNameV2(name string) RegisterOptionV2 {
	return func(o *RegisterOptionsV2) {
		o.Name = name
	}
}

// WithMetadataV2 设置元数据（V2理念）
func WithMetadataV2(metadata map[string]interface{}) RegisterOptionV2 {
	return func(o *RegisterOptionsV2) {
		o.Metadata = metadata
	}
}

// WithTTLV2 向后兼容的Option
func WithTTLV2(ttl time.Duration) RegisterOptionV2 {
	return func(o *RegisterOptionsV2) {
		o.TTL = ttl
	}
}

// WithIntervalV2 向后兼容的Option
func WithIntervalV2(interval time.Duration) RegisterOptionV2 {
	return func(o *RegisterOptionsV2) {
		o.Interval = interval
	}
}

// WithNamespaceV2 向后兼容的Option
func WithNamespaceV2(namespace string) RegisterOptionV2 {
	return func(o *RegisterOptionsV2) {
		o.Namespace = namespace
	}
}