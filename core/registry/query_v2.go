package registry

// 融合V2理念的查询选项 - 统一Query和Get
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

// WithNamespacesV2 设置查询的namespaces（V2理念）
func WithNamespacesV2(namespaces ...string) QueryOption {
	return func(o *QueryOptions) {
		o.Namespaces = namespaces
	}
}

// WithTypesV2 设置类型过滤（V2理念）
func WithTypesV2(types ...string) QueryOption {
	return func(o *QueryOptions) {
		o.Types = types
	}
}

// WithRecursiveV2 设置递归查询（V2理念）
func WithRecursiveV2(recursive bool) QueryOption {
	return func(o *QueryOptions) {
		o.Recursive = recursive
	}
}

// WithActiveOnlyV2 只查询活跃的（V2理念）
func WithActiveOnlyV2(active bool) QueryOption {
	return func(o *QueryOptions) {
		o.ActiveOnly = active
	}
}

// WithMaxResultsV2 设置最大结果数（V2理念）
func WithMaxResultsV2(max int) QueryOption {
	return func(o *QueryOptions) {
		o.MaxResults = max
	}
}

// WithTypesV2 设置类型过滤（V2理念）
func WithTypesV2(types ...string) QueryOption {
	return func(o *QueryOptions) {
		o.Types = types
	}
}

// WithRecursiveV2 设置递归查询（V2理念）
func WithRecursiveV2(recursive bool) QueryOption {
	return func(o *QueryOptions) {
		o.Recursive = recursive
	}
}

// WithActiveOnlyV2 只查询活跃的（V2理念）
func WithActiveOnlyV2(active bool) QueryOption {
	return func(o *QueryOptions) {
		o.ActiveOnly = active
	}
}

// WithMaxResultsV2 设置最大结果数（V2理念）
func WithMaxResultsV2(max int) QueryOption {
	return func(o *QueryOptions) {
		o.MaxResults = max
	}
}