package registry

// 融合V2理念的Watch选项 - fire-and-forget
type WatchOptionV2 func(*WatchOptionsV2)

type WatchOptionsV2 struct {
	// V2理念：fire-and-forget，支持多namespace
	Namespaces []string // 观察的namespaces（支持多namespace）
	Types      []string // 观察的类型
	ActiveOnly bool     // 只观察活跃的
	Recursive  bool     // 是否递归观察
}

// WithWatchNamespacesV2 设置观察的namespaces（V2理念）
func WithWatchNamespacesV2(namespaces ...string) WatchOptionV2 {
	return func(o *WatchOptionsV2) {
		o.Namespaces = namespaces
	}
}

// WithWatchTypesV2 设置观察的类型（V2理念）
func WithWatchTypesV2(types ...string) WatchOptionV2 {
	return func(o *WatchOptionsV2) {
		o.Types = types
	}
}

// WithWatchActiveOnlyV2 只观察活跃的（V2理念）
func WithWatchActiveOnlyV2(active bool) WatchOptionV2 {
	return func(o *WatchOptionsV2) {
		o.ActiveOnly = active
	}
}

// WithWatchRecursiveV2 递归观察（V2理念）
func WithWatchRecursiveV2(recursive bool) WatchOptionV2 {
	return func(o *WatchOptionsV2) {
		o.Recursive = recursive
	}
}