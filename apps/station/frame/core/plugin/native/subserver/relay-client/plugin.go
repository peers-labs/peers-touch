package relayclient

import (
	"github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

// relayClientOptions binds the YAML hierarchy to a plain Go struct so the
// pconf engine can populate it before plugin construction. The struct path
// mirrors peers.node.server.subserver.relay-client.* exactly.
//
// Notable: every string field defaults to its zero value here. Sensible
// defaults (BootstrapInfoURL, TokenStorePath, LocalHTTPPort, etc.) are
// applied in plugin.Options() so YAML / env overrides remain authoritative
// and YAML-only deployments still work without ceremony.
var relayClientOptions struct {
	Peers struct {
		Node struct {
			Server struct {
				Subserver struct {
					RelayClient struct {
						Enabled                      bool   `pconf:"enabled"`
						RelayURL                     string `pconf:"relay-url"`
						RelayStreamAddr              string `pconf:"relay-stream-addr"`
						InviteToken                  string `pconf:"invite-token"`
						InviteTokenFile              string `pconf:"invite-token-file"`
						Label                        string `pconf:"label"`
						LocalHTTPPort                int    `pconf:"local-http-port"`
						LocalHTTPTimeoutSec          int    `pconf:"local-http-timeout-sec"`
						BootstrapInfoURL             string `pconf:"bootstrap-info-url"`
						BootstrapIdentityURL         string `pconf:"bootstrap-identity-url"`
						TokenStorePath               string `pconf:"token-store-path"`
						UseTLS                       bool   `pconf:"use-tls"`
						TLSInsecureSkipVerify        bool   `pconf:"tls-insecure-skip-verify"`
						HeartbeatIntervalSec         int    `pconf:"heartbeat-interval-sec"`
						CredentialRefreshIntervalSec int    `pconf:"credential-refresh-interval-sec"`
					} `pconf:"relay-client"`
				} `pconf:"subserver"`
			} `pconf:"server"`
		} `pconf:"node"`
	} `pconf:"peers"`
}

type relayClientPlugin struct{}

func (p *relayClientPlugin) Name() string { return "relay-client" }

// Options resolves the YAML config into option.Option, applying defaults
// for fields the operator did not set explicitly. We default the fields that
// are stable across deployments (loopback HTTP target, bootstrap info URL,
// token store path) so a minimal YAML override only needs to provide the
// network-specific values: relay-url, relay-stream-addr, invite-token.
func (p *relayClientPlugin) Options() []option.Option {
	c := relayClientOptions.Peers.Node.Server.Subserver.RelayClient

	opts := []option.Option{
		WithEnabled(c.Enabled),
		WithRelayURL(c.RelayURL),
		WithRelayStreamAddr(c.RelayStreamAddr),
		WithInviteToken(c.InviteToken),
		WithInviteTokenFile(c.InviteTokenFile),
		WithLabel(c.Label),
		WithUseTLS(c.UseTLS),
		WithTLSInsecureSkipVerify(c.TLSInsecureSkipVerify),
	}

	port := c.LocalHTTPPort
	if port <= 0 {
		port = 18080
	}
	opts = append(opts, WithLocalHTTPPort(port))

	timeout := c.LocalHTTPTimeoutSec
	if timeout <= 0 {
		timeout = 30
	}
	opts = append(opts, WithLocalHTTPTimeoutSec(timeout))

	bootstrapInfoURL := c.BootstrapInfoURL
	if bootstrapInfoURL == "" {
		bootstrapInfoURL = "http://127.0.0.1:18080/sub-bootstrap/info"
	}
	opts = append(opts, WithBootstrapInfoURL(bootstrapInfoURL))

	bootstrapIdentityURL := c.BootstrapIdentityURL
	if bootstrapIdentityURL == "" {
		bootstrapIdentityURL = "http://127.0.0.1:18080/sub-bootstrap/station-identity"
	}
	opts = append(opts, WithBootstrapIdentityURL(bootstrapIdentityURL))

	tokenStore := c.TokenStorePath
	if tokenStore == "" {
		tokenStore = "data/relay_token"
	}
	opts = append(opts, WithTokenStorePath(tokenStore))

	hbInterval := c.HeartbeatIntervalSec
	if hbInterval <= 0 {
		hbInterval = 30
	}
	opts = append(opts, WithHeartbeatIntervalSec(hbInterval))

	refreshInterval := c.CredentialRefreshIntervalSec
	if refreshInterval <= 0 {
		refreshInterval = 300
	}
	opts = append(opts, WithCredentialRefreshIntervalSec(refreshInterval))

	return opts
}

// Enabled gates the framework's "include this subserver" decision. We must
// return true here even when the runtime YAML says enabled=false — otherwise
// the framework drops the subserver entirely and our Stop telemetry / state
// is unobservable. The Start method itself short-circuits when disabled.
//
// Update 2026-05-15: Reverted to the more idiomatic gate-here pattern. If
// someone really wants the subserver to never construct, they should drop
// the include from peers.yml. Disabling at runtime via the YAML flag now
// truly skips construction, in line with how `relay`, `bootstrap`, `turn`
// gate themselves.
func (p *relayClientPlugin) Enabled() bool {
	return relayClientOptions.Peers.Node.Server.Subserver.RelayClient.Enabled
}

func (p *relayClientPlugin) New(opts ...option.Option) server.Subserver {
	opts = append(opts, p.Options()...)
	return NewRelayClientSubServer(opts...)
}

func init() {
	config.RegisterOptions(&relayClientOptions)
	plugin.SubserverPlugins["relay-client"] = &relayClientPlugin{}
}
