package registry

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

// registryOptionsKey is the context key for registry options.
type registryOptionsKey struct{}

// OptionWrapper creates typed registry Options from generic option.Options.
var OptionWrapper = option.NewWrapper[Options](registryOptionsKey{}, func(options *option.Options) *Options {
	return &Options{
		Options:       options,
		ExtendOptions: &option.ExtendOptions{},
	}
})

// GetOptions returns registry Options from the option context.
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

// WithInterval sets the registry refresh interval.
func WithInterval(dur time.Duration) option.Option {
	return OptionWrapper.Wrap(func(o *Options) {
		o.Interval = dur
	})
}

// WithConnectTimeout sets the registry connect timeout.
func WithConnectTimeout(dur time.Duration) option.Option {
	return OptionWrapper.Wrap(func(o *Options) {
		o.ConnectTimeout = dur
	})
}

// WithPrivateKey sets the registry private key.
func WithPrivateKey(privateKey string) option.Option {
	return OptionWrapper.Wrap(func(o *Options) {
		o.PrivateKey = privateKey
	})
}

// WithTurnConfig sets TURN auth configuration.
func WithTurnConfig(turnConfig TURNAuthConfig) option.Option {
	return OptionWrapper.Wrap(func(o *Options) {
		o.TurnConfig = &turnConfig
	})
}

// WithStore injects a Store for registry persistence.
func WithStore(store store.Store) option.Option {
	return OptionWrapper.Wrap(func(o *Options) {
		o.Store = store
	})
}

// WithISDefault marks the registry as default.
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
// WithNamespaces sets multiple namespaces for registration.
func WithNamespaces(namespaces ...string) RegisterOption {
	return func(o *RegisterOptions) {
		o.Namespaces = namespaces
	}
}

// WithType set type (V2 philosophy)
// WithType sets the registration type.
func WithType(typeStr string) RegisterOption {
	return func(o *RegisterOptions) {
		o.Type = typeStr
	}
}

// WithName set name (V2 philosophy)
// WithName sets the registration name.
func WithName(name string) RegisterOption {
	return func(o *RegisterOptions) {
		o.Name = name
	}
}

// WithMetadata set metadata (V2 philosophy)
// WithMetadata sets registration metadata.
func WithMetadata(metadata map[string]interface{}) RegisterOption {
	return func(o *RegisterOptions) {
		o.Metadata = metadata
	}
}

// Backward compatible options
// WithTTL sets a TTL for registration.
func WithTTL(ttl time.Duration) RegisterOption {
	return func(o *RegisterOptions) {
		o.TTL = ttl
	}
}

// WithNamespace sets a single namespace for registration.
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
// WithID sets ID filter for query.
func WithID(id string) QueryOption {
	return func(o *QueryOptions) {
		o.ID = id
	}
}

// WithTypes set type filtering (V2 philosophy)
// WithTypes sets type filters for query.
func WithTypes(types ...string) QueryOption {
	return func(o *QueryOptions) {
		o.Types = types
	}
}

// WithRecursive set recursive query (V2 philosophy)
// WithRecursive enables recursive query.
func WithRecursive(recursive bool) QueryOption {
	return func(o *QueryOptions) {
		o.Recursive = recursive
	}
}

// WithActiveOnly query only active components (V2 philosophy)
// WithActiveOnly limits query to active components.
func WithActiveOnly(active bool) QueryOption {
	return func(o *QueryOptions) {
		o.ActiveOnly = active
	}
}

// WithMaxResults set maximum number of results (V2 philosophy)
// WithMaxResults sets the maximum query results.
func WithMaxResults(max int) QueryOption {
	return func(o *QueryOptions) {
		o.MaxResults = max
	}
}

// Backward compatible Query Options
// WithNameIsPeerID treats Name as PeerID for backward compatibility.
func WithNameIsPeerID() QueryOption {
	return func(o *QueryOptions) {
		o.NameIsPeerID = true
	}
}

// WithQueryName sets the query name.
func WithQueryName(name string) QueryOption {
	return func(o *QueryOptions) {
		o.Name = name
	}
}

// GetMe configures the query to retrieve current peer info.
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
// WithWatchTypes sets type filters for watching.
func WithWatchTypes(types ...string) WatchOption {
	return func(o *WatchOptions) {
		o.Types = types
	}
}

// WithWatchActiveOnly watch only active components (V2 philosophy)
// WithWatchActiveOnly watches only active components.
func WithWatchActiveOnly(active bool) WatchOption {
	return func(o *WatchOptions) {
		o.ActiveOnly = active
	}
}

// WithWatchRecursive recursively watch (V2 philosophy)
// WithWatchRecursive enables recursive watching.
func WithWatchRecursive(recursive bool) WatchOption {
	return func(o *WatchOptions) {
		o.Recursive = recursive
	}
}
