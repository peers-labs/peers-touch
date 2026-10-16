package relay

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	frameconfig "github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/pkg/config/source/memory"
	"github.com/stretchr/testify/require"
)

func TestCheckedInConfigsKeepRelayPoolModeAsString(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	require.True(t, ok)
	configDir := filepath.Join(
		filepath.Dir(currentFile),
		"..",
		"..",
		"..",
		"..",
		"..",
		"app",
		"conf",
	)

	for _, name := range []string{"peers.yml", "peers-sqlite.yml"} {
		t.Run(name, func(t *testing.T) {
			content, err := os.ReadFile(filepath.Join(configDir, name))
			require.NoError(t, err)

			contextOption := option.WithRootCtx(context.Background())
			loaded := frameconfig.NewConfig(
				contextOption,
				frameconfig.WithSources(
					memory.NewSource(
						contextOption,
						memory.WithYAML(content),
					),
				),
			)
			require.NoError(t, loaded.Init())

			resolved, err := ConfigFromRegistered()
			require.NoError(t, err)
			require.Equal(t, PoolModeOff, resolved.Pool.Mode)
		})
	}
}

func TestConfigFromRegisteredAcceptsRelayPeerID(t *testing.T) {
	contextOption := option.WithRootCtx(context.Background())
	loaded := frameconfig.NewConfig(
		contextOption,
		frameconfig.WithSources(
			memory.NewSource(
				contextOption,
				memory.WithYAML([]byte(`
peers:
  node:
    relay-pool:
      mode: "custom"
      relays:
        - peer-id: "12D3KooWLpZy2EgZ6SC2pgJFHjM13j1ygz7DXCfm9HiPeNQZ1uaW"
          addresses:
            - "/ip4/192.0.2.20/tcp/4001/p2p/12D3KooWLpZy2EgZ6SC2pgJFHjM13j1ygz7DXCfm9HiPeNQZ1uaW"
          control-origin: "https://192.0.2.20:18081"
          credential-file: "/tmp/relay.json"
`)),
			),
		),
	)
	require.NoError(t, loaded.Init())

	resolved, err := ConfigFromRegistered()
	require.NoError(t, err)
	require.Len(t, resolved.Pool.Targets, 1)
	require.Equal(
		t,
		"12D3KooWLpZy2EgZ6SC2pgJFHjM13j1ygz7DXCfm9HiPeNQZ1uaW",
		resolved.Pool.Targets[0].RelayPeerID.String(),
	)
}
