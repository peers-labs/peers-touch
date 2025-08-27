package registry

import (
	"time"

	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/store"
)

type registryOptionsKey struct{}

var OptionWrapper = option.NewWrapper[Options](registryOptionsKey{}, func(options *option.Options) *Options {
	return &Options{
		Options: options,
	}
})

// TURNAuthMethod defines the type of TURN authentication
type TURNAuthMethod string

const (
	TURNAuthLongTerm  TURNAuthMethod = "long-term"  // Long-term credential
	TURNAuthShortTerm TURNAuthMethod = "short-term" // Short-term credential
	TURNAuthOAuth     TURNAuthMethod = "oauth"      // OAuth 2.0 token
	TURNAuthAnonymous TURNAuthMethod = "anonymous"  // No authentication
)

// TURNAuthConfig is an abstract struct to hold authentication configurations
type TURNAuthConfig struct {
	Enabled         bool           `json:"enabled" pconf:"enabled"`
	ServerAddresses []string       `json:"server_addresses" pconf:"server-addresses"`
	Method          TURNAuthMethod `json:"method" pconf:"method"`         // Determines which nested config to use
	LongTerm        LongTermAuth   `json:"long_term" pconf:"long-term"`   // For TURNAuthLongTerm
	ShortTerm       ShortTermAuth  `json:"short_term" pconf:"short-term"` // For TURNAuthShortTerm
	OAuth           OAuthAuth      `json:"oauth" pconf:"oauth"`           // For TURNAuthOAuth, todo implement
}

// LongTermAuth holds config for long-term credential auth
type LongTermAuth struct {
	Username string `json:"username,omitempty" pconf:"username"` // Client username
	Password string `json:"password,omitempty" pconf:"password"` // Pre-shared secret (hashed with realm)
	Realm    string `json:"realm,omitempty" pconf:"realm"`       // TURN server realm (e.g., "turn.example.com")
}

// ShortTermAuth holds config for short-term credential auth
type ShortTermAuth struct {
	Username string `json:"username,omitempty" pconf:"username"`
	Password string `json:"password,omitempty" pconf:"password"`
}

// OAuthAuth holds config for OAuth 2.0 token auth
type OAuthAuth struct {
	Token         string `json:"token,omitempty" pconf:"token"`                   // Access token (e.g., Bearer token)
	TokenEndpoint string `json:"token_endpoint,omitempty" pconf:"token-endpoint"` // Optional: Endpoint to refresh the token
	ClientID      string `json:"client_id,omitempty" pconf:"client-id"`           // Optional: OAuth client ID (for token refresh)
	ClientSecret  string `json:"client_secret,omitempty" pconf:"client-secret"`   // Optional: OAuth client secret (for token refresh)
}

// region Options

// Options is the options for the registry plugin.
type Options struct {
	*option.Options

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

type RegisterOption func(*RegisterOptions)

type RegisterOptions struct {
	Namespace string
	Interval  time.Duration
	TTL       time.Duration
}

type DeregisterOption func(*DeregisterOptions)

type DeregisterOptions struct {
}

type GetOption func(*GetOptions)

type GetOptions struct {
	Me           bool
	NameIsPeerID bool
	Name         string
}

func WithNameIsPeerID() GetOption {
	return func(o *GetOptions) {
		o.NameIsPeerID = true
	}
}

func WithId(id string) GetOption {
	return func(o *GetOptions) {
		o.Name = id
		WithNameIsPeerID()
	}
}

func WithName(name string) GetOption {
	return func(o *GetOptions) {
		o.Name = name
	}
}

func GetMe() GetOption {
	return func(o *GetOptions) {
		o.Me = true
	}
}

type WatchOption func(*WatchOptions)

type WatchOptions struct{}

// endregion

func GetPluginRegions(opts ...option.Option) *Options {
	return option.GetOptions(opts...).Ctx().Value(registryOptionsKey{}).(*Options)
}
