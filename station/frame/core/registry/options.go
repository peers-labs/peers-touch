package registry

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

type registryOptionsKey struct{}

var OptionWrapper = option.NewWrapper[Options](registryOptionsKey{}, func(options *option.Options) *Options {
	return &Options{
		Options:       options,
		ExtendOptions: &option.ExtendOptions{},
	}
})

func GetOptions(opts ...option.Option) *Options {
	return option.GetOptions(opts...).Ctx().Value(registryOptionsKey{}).(*Options)
}

// Options is the options for the registry plugin.
type Options struct {
	*option.Options
	*option.ExtendOptions

	IsDefault      bool
	PrivateKey     string
	Interval       time.Duration
	ConnectTimeout time.Duration
	TurnConfig     *TURNAuthConfig
	Store          store.Store
}

func WithInterval(dur time.Duration) option.Option {
	return OptionWrapper.Wrap(func(o *Options) {
		o.Interval = dur
	})
}

func WithConnectTimeout(dur time.Duration) option.Option {
	return OptionWrapper.Wrap(func(o *Options) {
		o.ConnectTimeout = dur
	})
}

func WithPrivateKey(privateKey string) option.Option {
	return OptionWrapper.Wrap(func(o *Options) {
		o.PrivateKey = privateKey
	})
}

func WithTurnConfig(turnConfig TURNAuthConfig) option.Option {
	return OptionWrapper.Wrap(func(o *Options) {
		o.TurnConfig = &turnConfig
	})
}

func WithStore(store store.Store) option.Option {
	return OptionWrapper.Wrap(func(o *Options) {
		o.Store = store
	})
}

func WithISDefault() option.Option {
	return OptionWrapper.Wrap(func(o *Options) {
		o.IsDefault = true
	})
}

// RegisterOption registration options - supports multi-namespace and V2 philosophy
type RegisterOption func(*RegisterOptions)

type RegisterOptions struct {
	// V2 philosophy: support multi-namespace
	Namespaces []string

	// V2 philosophy: basic fields
	Type     string
	Name     string
	Metadata map[string]interface{}

	// Compatible with existing fields
	Namespace string // Single namespace for backward compatibility
	TTL       time.Duration
}

// WithNamespaces set multiple namespaces (V2 philosophy)
func WithNamespaces(namespaces ...string) RegisterOption {
	return func(o *RegisterOptions) {
		o.Namespaces = namespaces
	}
}

// WithType set type (V2 philosophy)
func WithType(typeStr string) RegisterOption {
	return func(o *RegisterOptions) {
		o.Type = typeStr
	}
}

// WithName set name (V2 philosophy)
func WithName(name string) RegisterOption {
	return func(o *RegisterOptions) {
		o.Name = name
	}
}

// WithMetadata set metadata (V2 philosophy)
func WithMetadata(metadata map[string]interface{}) RegisterOption {
	return func(o *RegisterOptions) {
		o.Metadata = metadata
	}
}

// Backward compatible options
func WithTTL(ttl time.Duration) RegisterOption {
	return func(o *RegisterOptions) {
		o.TTL = ttl
	}
}

func WithNamespace(namespace string) RegisterOption {
	return func(o *RegisterOptions) {
		o.Namespace = namespace
	}
}

// DeregisterOption deregistration options
type DeregisterOption func(*DeregisterOptions)

type DeregisterOptions struct{}

// QueryOption query options - unified Query and Get
type QueryOption func(*QueryOptions)

type QueryOptions struct {
	// V2 philosophy: unified Query and Get
	ID         string   // Query by ID (replaces the original Get)
	Namespaces []string // Query namespaces (support multi-namespace)
	Recursive  bool     // Whether to recursively query sub-namespaces
	Types      []string // Type filtering (V2 philosophy)
	ActiveOnly bool     // Query only active components
	MaxResults int      // Maximum number of results

	// Backward compatibility
	Me           bool
	NameIsPeerID bool
	Name         string
}

// WithID query by ID (V2 philosophy, replaces Get)
func WithID(id string) QueryOption {
	return func(o *QueryOptions) {
		o.ID = id
	}
}

// WithTypes set type filtering (V2 philosophy)
func WithTypes(types ...string) QueryOption {
	return func(o *QueryOptions) {
		o.Types = types
	}
}

// WithRecursive set recursive query (V2 philosophy)
func WithRecursive(recursive bool) QueryOption {
	return func(o *QueryOptions) {
		o.Recursive = recursive
	}
}

// WithActiveOnly query only active components (V2 philosophy)
func WithActiveOnly(active bool) QueryOption {
	return func(o *QueryOptions) {
		o.ActiveOnly = active
	}
}

// WithMaxResults set maximum number of results (V2 philosophy)
func WithMaxResults(max int) QueryOption {
	return func(o *QueryOptions) {
		o.MaxResults = max
	}
}

// Backward compatible Query Options
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

// WatchOption watch options - fire-and-forget
type WatchOption func(*WatchOptions)

type WatchOptions struct {
	// V2 philosophy: fire-and-forget, support multi-namespace
	Namespaces []string // Watch namespaces (support multi-namespace)
	Types      []string // Watch types
	ActiveOnly bool     // Watch only active components
	Recursive  bool     // Whether to recursively watch
}

// WithWatchTypes set watch types (V2 philosophy)
func WithWatchTypes(types ...string) WatchOption {
	return func(o *WatchOptions) {
		o.Types = types
	}
}

// WithWatchActiveOnly watch only active components (V2 philosophy)
func WithWatchActiveOnly(active bool) WatchOption {
	return func(o *WatchOptions) {
		o.ActiveOnly = active
	}
}

// WithWatchRecursive recursively watch (V2 philosophy)
func WithWatchRecursive(recursive bool) WatchOption {
	return func(o *WatchOptions) {
		o.Recursive = recursive
	}
}
