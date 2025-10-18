package bootstrap

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	dht "github.com/libp2p/go-libp2p-kad-dht"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/peers-touch/peers-touch-go/core/logger"
	"github.com/peers-touch/peers-touch-go/core/option"
	"github.com/peers-touch/peers-touch-go/core/plugin/native/pkg/mdns"
	native "github.com/peers-touch/peers-touch-go/core/plugin/native/registry"
	"github.com/peers-touch/peers-touch-go/core/server"
	"github.com/peers-touch/peers-touch-go/core/store"
)

var (
	_ server.Subserver = &SubServer{}
)

// bootstrapRouterURL implements server.RouterURL for bootstrap endpoints
type bootstrapRouterURL struct {
	name string
	url  string
}

func (b bootstrapRouterURL) Name() string {
	return b.name
}

func (b bootstrapRouterURL) SubPath() string {
	return b.url
}

type SubServer struct {
	opts *Options

	host host.Host
	dht  *dht.IpfsDHT

	store store.Store

	runningLock sync.Mutex
	status      server.Status
	addrs       []string
	mdnsService *mdns.Service
}

func (s *SubServer) Init(ctx context.Context, opts ...option.Option) (err error) {
	defer func() {
		if err != nil {
			logger.Errorf(ctx, "[Init] failed to init bootstrap subserver: %v", err)
			return
		}
	}()

	for _, opt := range opts {
		s.opts.Apply(opt)
	}

	s.store, err = store.GetStore(ctx)
	if err != nil {
		err = fmt.Errorf("[Init] bootstrap server get store error: %w", err)
		return
	}
	err = s.autoMigrate(ctx)
	if err != nil {
		err = fmt.Errorf("[Init] bootstrap server create table error: %w", err)
		return
	}

	// Use the shared libp2p host from registry instead of creating a new one
	s.host, s.dht = native.GetLibp2pHost()
	if s.host == nil {
		err = errors.New("[Init] failed to get libp2p host from registry - registry may not be initialized")
		return
	}
	notifee := &libp2pHostNotifee{
		SubServer: s,
	}
	s.host.Network().Notify(notifee)

	// Init MDNS with singleton pattern
	if s.opts.EnableMDNS {
		s.mdnsService = mdns.NewMDNSServiceWithComponent(s.host, "bootstrap")

		// Register bootstrap-specific callbacks
		callbackReg := &mdns.CallbackRegistration{
			ComponentID: "bootstrap",
			PeerDiscovery: func(ctx context.Context, pi peer.AddrInfo, isBootstrap bool) error {
				// Bootstrap subserver should not connect to mDNS-discovered nodes
				// Just log the discovery for informational purposes
				logger.Infof(ctx, "Discovered peer via mDNS (bootstrap=%t): %s", isBootstrap, pi.ID.String())
				return nil
			},
		}
		s.mdnsService.RegisterCallback(callbackReg)

		err = s.mdnsService.Start()
		if err != nil {
			return fmt.Errorf("start mdns node: %w", err)
		}
		s.mdnsService.StartPeriodicRefresh()
	}

	// Note: DHT is also obtained from the registry along with the host
	// No need to create a separate DHT instance

	return
}

func (s *SubServer) Start(ctx context.Context, opts ...option.Option) (err error) {
	s.runningLock.Lock()
	defer s.runningLock.Unlock()

	if s.status.IsRunning() {
		return errors.New("bootstrap server is already running")
	}

	logger.Info(ctx, "peers-touch bootstrap server starting")

	doNow := make(chan struct{})
	boot := func() {
		logger.Infof(ctx, "peers-touch bootstrap server's id: %s", s.host.ID().String())
		logger.Infof(ctx, `peers-touch bootstrap server is listening on : 
			%s`, joinForPrintLineByLine("----", s.host.Addrs()))
		if errIn := s.dht.Bootstrap(ctx); errIn != nil {
			logger.Errorf(ctx, "failed to bootstrap peers: %v", errIn)
		}
	}

	go func() {
		ticker := time.NewTicker(s.opts.DHTRefreshInterval)
		defer ticker.Stop()

		for {
			select {
			case <-doNow:
				boot()
			case <-ticker.C:
				boot()
			case <-ctx.Done():
				logger.Warnf(ctx, "peers-touch bootstrap server stopped %+v", ctx.Err())
				return
			}
		}
	}()

	go func() {
		doNow <- struct{}{}
	}()

	s.status = server.StatusRunning

	logger.Infof(ctx, "peers-touch bootstrap starts to serve at %s", s.host.ID().String())
	return nil
}

func (s *SubServer) Stop(ctx context.Context) (err error) {
	s.runningLock.Lock()
	defer s.runningLock.Unlock()

	defer func() {
		if err != nil {
			s.status = server.StatusError
		}
	}()

	err = s.dht.Close()
	if err != nil {
		err = fmt.Errorf("failed to close bootstrap dht: %w", err)
		return err
	}

	// Unregister mDNS callbacks if enabled
	if s.mdnsService != nil {
		s.mdnsService.UnregisterCallback("bootstrap")
		// Note: Don't close the singleton node as other components may be using it
	}

	err = s.host.Close()
	if err != nil {
		err = fmt.Errorf("failed to close bootstrap host: %w", err)
		s.status = server.StatusError
		return err
	}

	s.status = server.StatusStopped

	return nil
}

func (s *SubServer) Name() string {
	return "libp2p-bootstrap"
}

func (s *SubServer) Address() server.SubserverAddress {
	return server.SubserverAddress{
		Address: s.addrs,
	}
}

func (s *SubServer) Status() server.Status {
	return s.status
}

func (s *SubServer) Handlers() []server.Handler {
	return []server.Handler{
		server.NewHandler(
			bootstrapRouterURL{name: "list-peers", url: "/sub-bootstrap/list-peers"},
			s.listPeerInfos,
		),
		server.NewHandler(
			bootstrapRouterURL{name: "query-dht-peer", url: "/sub-bootstrap/query-dht-peer"},
			s.queryDHTPeer,
		),
	}
}

func (s *SubServer) Type() server.SubserverType {
	return server.SubserverTypeBootstrap
}

// AddBootstrapNode implements mdns.Registry interface
func (s *SubServer) AddBootstrapNode(pi peer.AddrInfo) {
	// Add the peer to our bootstrap nodes for DHT
	logger.Infof(context.Background(), "Adding bootstrap node from mDNS: %s", pi.ID.String())
}

// Register implements mdns.Registry interface
func (s *SubServer) Register(ctx context.Context, pi peer.AddrInfo) error {
	// Connect to the discovered peer
	return s.host.Connect(ctx, pi)
}

// NewBootstrapServer creates a new bootstrap subserver with the provided options.
// Call it after root Ctx is initialized, which is initialized in BeforeInit of predominate process.
func NewBootstrapServer(opts ...option.Option) server.Subserver {
	bootS := &SubServer{
		opts: option.GetOptions(opts...).Ctx().Value(optionsKey{}).(*Options),
	}

	return bootS
}
