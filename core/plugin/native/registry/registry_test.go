package native

import (
	"context"
	"errors"
	"testing"

	"github.com/peers-touch/peers-touch-go/core/option"
	"github.com/peers-touch/peers-touch-go/core/registry"
	"github.com/peers-touch/peers-touch-go/core/store"
	"github.com/stretchr/testify/assert"
	"gorm.io/gorm"
)

// mockStore implements store.Store interface for testing
type mockStore struct{}

func (m *mockStore) Init(ctx context.Context, opts ...option.Option) error { return nil }
func (m *mockStore) RDS(ctx context.Context, opts ...store.RDSDMLOption) (*gorm.DB, error) {
	// Return a mock GORM DB that won't cause panics
	// In a real test, you might use an in-memory SQLite database
	// For now, we'll return an error to avoid the migration step
	return nil, errors.New("mock store - migration not supported")
}
func (m *mockStore) Name() string { return "mock" }

func TestNativeRegistry_NewRegistry(t *testing.T) {
	ctx := context.Background()
	// Create registry with proper options initialization
	opts := []option.Option{
		option.WithRootCtx(ctx),
		registry.WithStore(&mockStore{}),
		registry.WithPrivateKey("test-private-key"),
	}
	reg := NewRegistry(opts...)
	assert.NotNil(t, reg)
	assert.IsType(t, &nativeRegistry{}, reg)
}

func TestNativeRegistry_Init_WithMDNS(t *testing.T) {
	ctx := context.Background()
	reg := NewRegistry(option.WithRootCtx(ctx)).(*nativeRegistry)

	// Create test options with mDNS enabled
	opts := []option.Option{
		option.WithRootCtx(ctx),
		registry.WithStore(&mockStore{}),
		registry.WithPrivateKey("test-private-key"),
		WithMDNSEnable(true),
		WithBootstrapEnable(false), // Disable bootstrap for this test
		WithLibp2pIdentityKeyFile("test.key"),
	}

	err := reg.Init(ctx, opts...)
	// We expect this to fail due to missing key file, but we can verify the options are set
	assert.Error(t, err) // Expected due to missing key file
	assert.True(t, reg.extOpts.mdnsEnable)
	assert.False(t, reg.extOpts.bootstrapEnable)
}

func TestNativeRegistry_Init_WithBootstrap(t *testing.T) {
	ctx := context.Background()
	reg := NewRegistry(option.WithRootCtx(ctx)).(*nativeRegistry)

	// Create test options with bootstrap enabled
	opts := []option.Option{
		option.WithRootCtx(ctx),
		registry.WithStore(&mockStore{}),
		registry.WithPrivateKey("test-private-key"),
		WithMDNSEnable(false),
		WithBootstrapEnable(true),
		WithLibp2pIdentityKeyFile("test.key"),
		WithBootstrapListenAddrs("/ip4/0.0.0.0/tcp/4001"),
	}

	err := reg.Init(ctx, opts...)
	// We expect this to fail due to missing key file, but we can verify the options are set
	assert.Error(t, err) // Expected due to missing key file
	assert.False(t, reg.extOpts.mdnsEnable)
	assert.True(t, reg.extOpts.bootstrapEnable)
	assert.Contains(t, reg.extOpts.bootstrapListenAddrs, "/ip4/0.0.0.0/tcp/4001")
}

func TestNativeRegistry_Init_WithTURN(t *testing.T) {
	ctx := context.Background()
	reg := NewRegistry(option.WithRootCtx(ctx)).(*nativeRegistry)

	// Create test options with TURN enabled
	turnConfig := registry.TURNAuthConfig{
		Enabled:         true,
		ServerAddresses: []string{"stun.l.google.com:19302"},
		Method:          "short-term",
		ShortTerm: registry.ShortTermAuth{
			Username: "test",
			Password: "test",
		},
	}

	opts := []option.Option{
		option.WithRootCtx(ctx),
		registry.WithStore(&mockStore{}),
		registry.WithPrivateKey("test-private-key"),
		registry.WithTurnConfig(turnConfig),
		WithMDNSEnable(false),
		WithBootstrapEnable(false),
		WithLibp2pIdentityKeyFile("test.key"),
	}

	err := reg.Init(ctx, opts...)
	// We expect this to fail due to missing key file, but we can verify the options are set
	assert.Error(t, err) // Expected due to missing key file
	assert.True(t, reg.options.TurnConfig.Enabled)
	assert.Equal(t, "stun.l.google.com:19302", reg.options.TurnConfig.ServerAddresses[0])
}

func TestNativeRegistry_AllDiscoveryMechanisms(t *testing.T) {
	ctx := context.Background()
	reg := NewRegistry(option.WithRootCtx(ctx)).(*nativeRegistry)

	// Create test options with all discovery mechanisms enabled
	turnConfig := registry.TURNAuthConfig{
		Enabled:         true,
		ServerAddresses: []string{"stun.l.google.com:19302"},
		Method:          "short-term",
		ShortTerm: registry.ShortTermAuth{
			Username: "test",
			Password: "test",
		},
	}

	opts := []option.Option{
		option.WithRootCtx(ctx),
		registry.WithStore(&mockStore{}),
		registry.WithPrivateKey("test-private-key"),
		registry.WithTurnConfig(turnConfig),
		WithMDNSEnable(true),
		WithBootstrapEnable(true),
		WithLibp2pIdentityKeyFile("test.key"),
		WithBootstrapListenAddrs("/ip4/0.0.0.0/tcp/4001"),
		WithBootstrapNodes([]string{"/ip4/127.0.0.1/tcp/5001/p2p/12D3KooWR1QjveRKiKMQYQHHbzykFmLRrqHrcrWpBwro8t7mSKwg"}),
	}

	err := reg.Init(ctx, opts...)
	// We expect this to fail due to missing key file, but we can verify all options are set correctly
	assert.Error(t, err) // Expected due to missing key file

	// Verify all discovery mechanisms are configured
	assert.True(t, reg.extOpts.mdnsEnable, "mDNS should be enabled")
	assert.True(t, reg.extOpts.bootstrapEnable, "Bootstrap should be enabled")
	assert.True(t, reg.options.TurnConfig.Enabled, "TURN should be enabled")

	// Verify configuration details
	assert.Contains(t, reg.extOpts.bootstrapListenAddrs, "/ip4/0.0.0.0/tcp/4001")
	assert.Len(t, reg.extOpts.bootstrapNodes, 1)
	assert.Equal(t, "stun.l.google.com:19302", reg.options.TurnConfig.ServerAddresses[0])
}

func TestNativeRegistry_BootstrapStatusTracking(t *testing.T) {
	reg := NewRegistry().(*nativeRegistry)

	// Test that registry can be created without errors
	assert.NotNil(t, reg)

	// Test mDNS stats initialization
	stats := reg.getMDNSStats()
	assert.Equal(t, 0, stats.TotalDiscovered)
	assert.Equal(t, 0, stats.BootstrapDiscovered)
	assert.Equal(t, 0, stats.ConnectedBootstrap)

	// Test mDNS stats update
	reg.updateMDNSStats(5, 2, 1, []string{"peer1", "peer2"})
	stats = reg.getMDNSStats()
	assert.Equal(t, 5, stats.TotalDiscovered)
	assert.Equal(t, 2, stats.BootstrapDiscovered)
	assert.Equal(t, 1, stats.ConnectedBootstrap)
	assert.Equal(t, 2, len(stats.ActivePeers))
}

func TestNativeRegistry_DiscoveryMechanismOptions(t *testing.T) {
	tests := []struct {
		name              string
		mdnsEnable        bool
		bootstrapEnable   bool
		turnEnabled       bool
		expectedMDNS      bool
		expectedBootstrap bool
		expectedTURN      bool
	}{
		{
			name:              "All disabled",
			mdnsEnable:        false,
			bootstrapEnable:   false,
			turnEnabled:       false,
			expectedMDNS:      false,
			expectedBootstrap: false,
			expectedTURN:      false,
		},
		{
			name:              "Only mDNS enabled",
			mdnsEnable:        true,
			bootstrapEnable:   false,
			turnEnabled:       false,
			expectedMDNS:      true,
			expectedBootstrap: false,
			expectedTURN:      false,
		},
		{
			name:              "Only bootstrap enabled",
			mdnsEnable:        false,
			bootstrapEnable:   true,
			turnEnabled:       false,
			expectedMDNS:      false,
			expectedBootstrap: true,
			expectedTURN:      false,
		},
		{
			name:              "Only TURN enabled",
			mdnsEnable:        false,
			bootstrapEnable:   false,
			turnEnabled:       true,
			expectedMDNS:      false,
			expectedBootstrap: false,
			expectedTURN:      true,
		},
		{
			name:              "All enabled",
			mdnsEnable:        true,
			bootstrapEnable:   true,
			turnEnabled:       true,
			expectedMDNS:      true,
			expectedBootstrap: true,
			expectedTURN:      true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := context.Background()
			reg := NewRegistry(option.WithRootCtx(ctx)).(*nativeRegistry)

			turnConfig := registry.TURNAuthConfig{
				Enabled:         tt.turnEnabled,
				ServerAddresses: []string{"stun.l.google.com:19302"},
				Method:          "short-term",
				ShortTerm: registry.ShortTermAuth{
					Username: "test",
					Password: "test",
				},
			}

			opts := []option.Option{
				option.WithRootCtx(ctx),
				registry.WithStore(&mockStore{}),
				registry.WithPrivateKey("test-private-key"),
				registry.WithTurnConfig(turnConfig),
				WithMDNSEnable(tt.mdnsEnable),
				WithBootstrapEnable(tt.bootstrapEnable),
				WithLibp2pIdentityKeyFile("test.key"),
			}

			// Apply options to verify they are set correctly
			reg.options = registry.GetPluginRegions(opts...)
			reg.extOpts = reg.options.ExtOptions.(*options)

			assert.Equal(t, tt.expectedMDNS, reg.extOpts.mdnsEnable)
			assert.Equal(t, tt.expectedBootstrap, reg.extOpts.bootstrapEnable)
			assert.Equal(t, tt.expectedTURN, reg.options.TurnConfig.Enabled)
		})
	}
}
