// Package turn exposes option helpers for the TURN subserver.
package turn

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/option"
)

type optionsKey struct{}

// Defaults applied when the corresponding config / option is unset.
// They preserve the historical hardcoded behavior so an operator who
// upgrades without touching config sees no change.
const (
	defaultCredentialUsername = "webrtc-user"
	defaultCredentialTTL      = 24 * time.Hour
)

// defaultSTUNURLs is the fallback public STUN list. Operators running
// a private deployment should override this via config to avoid
// leaking client IPs to a third-party STUN service.
var defaultSTUNURLs = []string{"stun:stun.l.google.com:19302"}

var wrapper = option.NewWrapper[Options](optionsKey{}, func(options *option.Options) *Options {
	return &Options{
		Options: options,
	}
})

// Options holds configuration for the TURN subserver.
type Options struct {
	*option.Options

	Enabled    bool
	Port       int
	Realm      string
	PublicIP   string
	AuthSecret string

	// STUNURLs is the list of STUN server URLs advertised to clients
	// via /api/v1/turn/ice-servers. Empty means use defaultSTUNURLs.
	STUNURLs []string
	// CredentialTTL is the lifetime of the ephemeral TURN credentials
	// handed to clients. Zero means defaultCredentialTTL.
	CredentialTTL time.Duration
	// CredentialUsername is the human-readable label embedded in the
	// short-term credential username ("<expiry>:<label>"). Empty means
	// defaultCredentialUsername.
	CredentialUsername string
}

// ResolvedSTUNURLs returns the configured STUN URLs or the default.
func (o *Options) ResolvedSTUNURLs() []string {
	if len(o.STUNURLs) > 0 {
		return o.STUNURLs
	}
	return defaultSTUNURLs
}

// ResolvedCredentialTTL returns the configured credential TTL or the default.
func (o *Options) ResolvedCredentialTTL() time.Duration {
	if o.CredentialTTL > 0 {
		return o.CredentialTTL
	}
	return defaultCredentialTTL
}

// ResolvedCredentialUsername returns the configured credential label or the default.
func (o *Options) ResolvedCredentialUsername() string {
	if o.CredentialUsername != "" {
		return o.CredentialUsername
	}
	return defaultCredentialUsername
}

// WithEnabled toggles the TURN subserver.
func WithEnabled(enabled bool) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.Enabled = enabled
	})
}

// WithPort sets the TURN listening port.
func WithPort(port int) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.Port = port
	})
}

// WithRealm sets the TURN authentication realm.
func WithRealm(realm string) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.Realm = realm
	})
}

// WithPublicIP sets the public IP advertised by the TURN server.
func WithPublicIP(ip string) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.PublicIP = ip
	})
}

// WithAuthSecret sets an auth secret for TURN credentials.
func WithAuthSecret(secret string) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.AuthSecret = secret
	})
}

// WithSTUNURLs sets the STUN URLs advertised to clients.
func WithSTUNURLs(urls []string) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.STUNURLs = urls
	})
}

// WithCredentialTTL sets the lifetime of ephemeral TURN credentials.
func WithCredentialTTL(ttl time.Duration) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.CredentialTTL = ttl
	})
}

// WithCredentialUsername sets the label embedded in TURN credential usernames.
func WithCredentialUsername(username string) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.CredentialUsername = username
	})
}
