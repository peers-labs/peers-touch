package relay

import (
	"github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

var relayOptions struct {
	Peers struct {
		Node struct {
			Server struct {
				Subserver struct {
					Relay struct {
						Enabled                 bool   `pconf:"enabled"`
						MaxStations             int    `pconf:"max-stations"`
						HeartbeatTimeout        int    `pconf:"heartbeat-timeout"`
						ForwardTimeout          int    `pconf:"forward-timeout"`
						MaxBodySize             int    `pconf:"max-body-size"`
						MaxConcurrentPerStation int    `pconf:"max-concurrent-per-station"`
						StreamPingInterval      int    `pconf:"stream-ping-interval"`
						StreamPingTimeout       int    `pconf:"stream-ping-timeout"`
						StreamListenAddr        string `pconf:"stream-listen-addr"`
						GracefulDrainTimeout    int    `pconf:"graceful-drain-timeout"`
						TLSCertFile             string `pconf:"tls-cert-file"`
						TLSKeyFile              string `pconf:"tls-key-file"`
						AllowInsecureLoopback   bool   `pconf:"allow-insecure-loopback"`
						SigningKeyFile          string `pconf:"signing-key-file"`
						OperatorKeyFile         string `pconf:"operator-key-file"`
						OperatorIssuer          string `pconf:"operator-issuer"`
						OperatorAudience        string `pconf:"operator-audience"`
						OperatorScope           string `pconf:"operator-scope"`
					} `pconf:"relay"`
					Turn struct {
						Enabled    bool   `pconf:"enabled"`
						Port       int    `pconf:"port"`
						PublicIP   string `pconf:"public-ip"`
						AuthSecret string `pconf:"auth-secret"`
					} `pconf:"turn"`
				} `pconf:"subserver"`
			} `pconf:"server"`
		} `pconf:"node"`
	} `pconf:"peers"`
}

type relayPlugin struct{}

func (p *relayPlugin) Name() string {
	return "relay"
}

func (p *relayPlugin) Options() []option.Option {
	var opts []option.Option
	r := relayOptions.Peers.Node.Server.Subserver.Relay

	opts = append(opts, WithEnabled(r.Enabled))
	if baseURL := config.Get("peers.node.server.baseurl").String(""); baseURL != "" {
		opts = append(opts, WithPublicBaseURL(baseURL))
	}

	if r.MaxStations > 0 {
		opts = append(opts, WithMaxStations(r.MaxStations))
	}
	if r.HeartbeatTimeout > 0 {
		opts = append(opts, WithHeartbeatTimeout(r.HeartbeatTimeout))
	}
	if r.ForwardTimeout > 0 {
		opts = append(opts, WithForwardTimeout(r.ForwardTimeout))
	}
	if r.MaxBodySize > 0 {
		opts = append(opts, WithMaxBodySize(r.MaxBodySize))
	}
	if r.MaxConcurrentPerStation > 0 {
		opts = append(opts, WithMaxConcurrentPerStation(r.MaxConcurrentPerStation))
	}
	if r.StreamPingInterval > 0 {
		opts = append(opts, WithStreamPingInterval(r.StreamPingInterval))
	}
	if r.StreamPingTimeout > 0 {
		opts = append(opts, WithStreamPingTimeout(r.StreamPingTimeout))
	}
	if r.StreamListenAddr != "" {
		opts = append(opts, WithStreamListenAddr(r.StreamListenAddr))
	}
	if r.GracefulDrainTimeout > 0 {
		opts = append(opts, WithGracefulDrainTimeout(r.GracefulDrainTimeout))
	}
	if r.TLSCertFile != "" {
		opts = append(opts, WithTLSCertFile(r.TLSCertFile))
	}
	if r.TLSKeyFile != "" {
		opts = append(opts, WithTLSKeyFile(r.TLSKeyFile))
	}
	opts = append(opts, WithAllowInsecureLoopback(r.AllowInsecureLoopback))
	if r.SigningKeyFile != "" {
		opts = append(opts, WithSigningKeyFile(r.SigningKeyFile))
	}
	if r.OperatorKeyFile != "" {
		opts = append(opts, WithOperatorKeyFile(r.OperatorKeyFile))
	}
	if r.OperatorIssuer != "" {
		opts = append(opts, WithOperatorIssuer(r.OperatorIssuer))
	}
	if r.OperatorAudience != "" {
		opts = append(opts, WithOperatorAudience(r.OperatorAudience))
	}
	if r.OperatorScope != "" {
		opts = append(opts, WithOperatorScope(r.OperatorScope))
	}

	turn := relayOptions.Peers.Node.Server.Subserver.Turn
	opts = append(opts, WithTurnEnabled(turn.Enabled))
	if turn.PublicIP != "" {
		opts = append(opts, WithTurnPublicIP(turn.PublicIP))
	}
	if turn.Port > 0 {
		opts = append(opts, WithTurnPort(turn.Port))
	}
	if turn.AuthSecret != "" {
		opts = append(opts, WithTurnAuthSecret(turn.AuthSecret))
	}

	return opts
}

func (p *relayPlugin) Enabled() bool {
	return relayOptions.Peers.Node.Server.Subserver.Relay.Enabled
}

func (p *relayPlugin) New(opts ...option.Option) server.Subserver {
	opts = append(opts, p.Options()...)
	return NewRelaySubServer(opts...)
}

func init() {
	config.RegisterOptions(&relayOptions)
	plugin.SubserverPlugins["relay"] = &relayPlugin{}
}
