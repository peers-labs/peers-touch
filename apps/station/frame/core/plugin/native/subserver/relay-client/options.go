// Package relayclient configures the station-side driver that mounts the
// local Station onto a remote Relay subserver. The driver itself lives in
// subserver.go; this file owns option resolution.
package relayclient

import (
	"github.com/peers-labs/peers-touch/station/frame/core/option"
)

type optionsKey struct{}

var wrapper = option.NewWrapper[Options](optionsKey{}, func(options *option.Options) *Options {
	return &Options{Options: options}
})

// Options captures every knob the relay-client subserver consumes at
// runtime. Defaults are applied in plugin.Options() so this struct mirrors
// the YAML / env surface 1:1 and stays free of conditional logic.
type Options struct {
	*option.Options

	// Enabled gates Start. When false Init still runs (so options are bound)
	// but Start short-circuits after logging "disabled".
	Enabled bool

	// RelayURL is the relay node's HTTP base URL, e.g. http://10.37.118.48:18081.
	// Used for /api/v1/relay/register and /api/v1/relay/token/refresh.
	RelayURL string

	// RelayStreamAddr is the relay node's TCP stream listen address, e.g.
	// 10.37.118.48:4501. The relay client opens a long-lived TCP connection
	// here after acquiring a relay_token via RelayURL.
	RelayStreamAddr string

	// InviteToken is the single-use opaque secret used the first time a
	// Station registers with this Relay. After registration the structured
	// mount credential at TokenStorePath becomes the source of truth.
	InviteToken string

	// Label is an opaque, human-readable identifier sent on /register and
	// echoed back in /api/v1/relay/mounts. Useful to disambiguate stations
	// that share the same operator account.
	Label string

	// LocalHTTPPort is the port the local Hertz HTTP server listens on. The
	// loopback dispatcher rewrites every incoming forwarded request as
	// "http://127.0.0.1:<port>/<path>".
	LocalHTTPPort int

	// LocalHTTPTimeoutSec is the per-request timeout the loopback dispatcher
	// uses when relaying a forwarded request to the local Hertz server.
	LocalHTTPTimeoutSec int

	// BootstrapInfoURL is the local URL we poll until it responds with a
	// peer_id. We need our own peer_id before we can call /register because
	// the relay binds the resulting relay_token to that exact peer_id.
	BootstrapInfoURL string

	// BootstrapIdentityURL signs Relay enrollment and rotation challenges with
	// the Station's libp2p host key.
	BootstrapIdentityURL string

	// TokenStorePath persists the structured, expiring mount credential.
	TokenStorePath string

	// UseTLS enables the mandatory TLS transport for the Relay stream.
	UseTLS                bool
	TLSInsecureSkipVerify bool

	// HeartbeatIntervalSec governs how often the relay-client posts to
	// /api/v1/relay/heartbeat. Must be smaller than the relay subserver's
	// HeartbeatTimeout (default 60s). Defaults to 30s when <=0.
	HeartbeatIntervalSec int

	// CredentialRefreshIntervalSec controls proactive host-key-proven
	// credential rotation.
	CredentialRefreshIntervalSec int
}

// WithEnabled toggles the relay-client subserver.
func WithEnabled(v bool) option.Option {
	return wrapper.Wrap(func(o *Options) { o.Enabled = v })
}

// WithRelayURL sets the relay HTTP base URL.
func WithRelayURL(v string) option.Option {
	return wrapper.Wrap(func(o *Options) { o.RelayURL = v })
}

// WithRelayStreamAddr sets the relay TCP stream addr (host:port).
func WithRelayStreamAddr(v string) option.Option {
	return wrapper.Wrap(func(o *Options) { o.RelayStreamAddr = v })
}

// WithInviteToken sets the single-use admin invite token.
func WithInviteToken(v string) option.Option {
	return wrapper.Wrap(func(o *Options) { o.InviteToken = v })
}

// WithLabel sets the human-readable label for the registered mount.
func WithLabel(v string) option.Option {
	return wrapper.Wrap(func(o *Options) { o.Label = v })
}

// WithLocalHTTPPort sets the local Hertz port the loopback dispatcher targets.
func WithLocalHTTPPort(v int) option.Option {
	return wrapper.Wrap(func(o *Options) { o.LocalHTTPPort = v })
}

// WithLocalHTTPTimeoutSec sets the per-request loopback dispatch timeout.
func WithLocalHTTPTimeoutSec(v int) option.Option {
	return wrapper.Wrap(func(o *Options) { o.LocalHTTPTimeoutSec = v })
}

// WithBootstrapInfoURL sets the URL we poll to discover our own peer_id.
func WithBootstrapInfoURL(v string) option.Option {
	return wrapper.Wrap(func(o *Options) { o.BootstrapInfoURL = v })
}

func WithBootstrapIdentityURL(v string) option.Option {
	return wrapper.Wrap(func(o *Options) { o.BootstrapIdentityURL = v })
}

// WithTokenStorePath sets where we persist the relay_token across restarts.
func WithTokenStorePath(v string) option.Option {
	return wrapper.Wrap(func(o *Options) { o.TokenStorePath = v })
}

// WithUseTLS toggles TLS on the TCP stream connection.
func WithUseTLS(v bool) option.Option {
	return wrapper.Wrap(func(o *Options) { o.UseTLS = v })
}

// WithTLSInsecureSkipVerify disables TLS cert verification (dev/test only).
func WithTLSInsecureSkipVerify(v bool) option.Option {
	return wrapper.Wrap(func(o *Options) { o.TLSInsecureSkipVerify = v })
}

// WithHeartbeatIntervalSec sets how often we POST /api/v1/relay/heartbeat.
func WithHeartbeatIntervalSec(v int) option.Option {
	return wrapper.Wrap(func(o *Options) { o.HeartbeatIntervalSec = v })
}

func WithCredentialRefreshIntervalSec(v int) option.Option {
	return wrapper.Wrap(func(o *Options) { o.CredentialRefreshIntervalSec = v })
}
