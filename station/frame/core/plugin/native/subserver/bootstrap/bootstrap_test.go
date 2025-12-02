package bootstrap

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/stretchr/testify/assert"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// MockStore implements store.Store for testing
type MockStore struct {
	db *gorm.DB
}

func (m *MockStore) Init(ctx context.Context, opts ...option.Option) error {
	return nil
}

func (m *MockStore) RDS(ctx context.Context, opts ...store.RDSDMLOption) (*gorm.DB, error) {
	return m.db, nil
}

func (m *MockStore) Name() string {
	return "mock-store"
}

func setupMockStore() error {
	// Use in-memory SQLite
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		return err
	}

	mockStore := &MockStore{db: db}
	// Ignore error if already injected (for multiple tests)
	_ = store.InjectStore(context.Background(), mockStore)
	return nil
}

func TestBootstrapServer_StartAndConnect(t *testing.T) {
	// 1. Setup Mock Store
	err := setupMockStore()
	assert.NoError(t, err)

	// 2. Initialize SubServer
	// Random port
	port := 0 // Let OS choose
	listenAddr := fmt.Sprintf("/ip4/127.0.0.1/tcp/%d", port)

	// Init options
	initOpts := []option.Option{
		option.WithRootCtx(context.Background()),
		WithEnabled(true),
		WithListenAddrs([]string{listenAddr}),
		WithMDNS(false), // Disable mDNS for unit test to avoid network noise
		WithLibp2pInsecure(true),
		WithDHTRefreshInterval(10 * time.Second),
	}

	subServer := NewBootstrapServer(initOpts...)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	err = subServer.Init(ctx, initOpts...)
	assert.NoError(t, err)

	// 3. Start SubServer
	err = subServer.Start(ctx)
	assert.NoError(t, err)
	defer subServer.Stop(ctx)

	// Give it a moment to start
	time.Sleep(1 * time.Second)

	// Get server address
	serverAddrs := subServer.Address().Address
	assert.NotEmpty(t, serverAddrs)
	t.Logf("Server Addresses: %v", serverAddrs)

	// 4. Create Client Host
	clientHost, err := libp2p.New(libp2p.NoSecurity)
	assert.NoError(t, err)
	defer clientHost.Close()

	// 5. Connect Client to Server
	// Pick an IPv4 address
	var targetMultiAddr string
	for _, addr := range serverAddrs {
		if strings.Contains(addr, "127.0.0.1") {
			targetMultiAddr = addr
			break
		}
	}
	if targetMultiAddr == "" {
		targetMultiAddr = serverAddrs[0]
	}

	t.Logf("Connecting to: %s", targetMultiAddr)

	ma, err := multiaddr.NewMultiaddr(targetMultiAddr)
	assert.NoError(t, err)

	targetPeerInfo, err := peer.AddrInfoFromP2pAddr(ma)
	assert.NoError(t, err)

	err = clientHost.Connect(ctx, *targetPeerInfo)
	assert.NoError(t, err, "Failed to connect to bootstrap server")

	t.Log("Successfully connected to bootstrap server")
}
