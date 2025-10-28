package bootstrap

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/libp2p/go-libp2p"
	dht "github.com/libp2p/go-libp2p-kad-dht"
	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
	"github.com/peers-touch/peers-touch-go/core/logger"
	"github.com/peers-touch/peers-touch-go/core/option"
	"github.com/peers-touch/peers-touch-go/core/plugin/native/pkg/mdns"
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

	// Create a new dedicated libp2p host for bootstrap subserver using injected options
	err = s.createBootstrapHost(ctx)
	if err != nil {
		err = fmt.Errorf("[Init] failed to create bootstrap host: %w", err)
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

	// Create DHT instance for the bootstrap subserver
	err = s.createBootstrapDHT(ctx)
	if err != nil {
		err = fmt.Errorf("[Init] failed to create bootstrap DHT: %w", err)
		return
	}

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

	// Close DHT first
	if s.dht != nil {
		err = s.dht.Close()
		if err != nil {
			err = fmt.Errorf("failed to close bootstrap dht: %w", err)
			return err
		}
	}

	// Unregister mDNS callbacks if enabled
	if s.mdnsService != nil {
		s.mdnsService.UnregisterCallback("bootstrap")
		// Note: Don't close the singleton node as other components may be using it
	}

	// Close the dedicated host
	if s.host != nil {
		err = s.host.Close()
		if err != nil {
			err = fmt.Errorf("failed to close bootstrap host: %w", err)
			s.status = server.StatusError
			return err
		}
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

// createBootstrapHost creates a dedicated libp2p host for the bootstrap subserver using injected options
func (s *SubServer) createBootstrapHost(ctx context.Context) error {
	var hostOptions []libp2p.Option

	// Use injected identity key if available, otherwise generate a new one
	if s.opts.IdentityKey != nil {
		hostOptions = append(hostOptions, libp2p.Identity(s.opts.IdentityKey))
		logger.Infof(ctx, "Bootstrap subserver using injected identity key")
	} else {
		// Generate a new identity key for this bootstrap instance
		privKey, _, err := crypto.GenerateEd25519Key(nil)
		if err != nil {
			return fmt.Errorf("failed to generate identity key: %w", err)
		}
		hostOptions = append(hostOptions, libp2p.Identity(privKey))
		logger.Infof(ctx, "Bootstrap subserver generated new identity key")
	}

	// Use injected listen addresses if available
	if len(s.opts.ListenAddrs) > 0 {
		for _, addr := range s.opts.ListenAddrs {
			listenAddr, err := multiaddr.NewMultiaddr(addr)
			if err != nil {
				return fmt.Errorf("invalid listen address %s: %w", addr, err)
			}
			hostOptions = append(hostOptions, libp2p.ListenAddrs(listenAddr))
		}
		logger.Infof(ctx, "Bootstrap subserver using %d injected listen addresses", len(s.opts.ListenAddrs))
	} else {
		// Default listen address if none provided
		defaultAddr, err := multiaddr.NewMultiaddr("/ip4/0.0.0.0/tcp/0")
		if err != nil {
			return fmt.Errorf("failed to create default listen address: %w", err)
		}
		hostOptions = append(hostOptions, libp2p.ListenAddrs(defaultAddr))
		logger.Infof(ctx, "Bootstrap subserver using default listen address")
	}

	// Add standard libp2p options for bootstrap functionality
	hostOptions = append(hostOptions,
		libp2p.EnableNATService(),
		libp2p.EnableHolePunching(),
		libp2p.EnableRelay(),
	)

	// Create the libp2p host
	host, err := libp2p.New(hostOptions...)
	if err != nil {
		return fmt.Errorf("failed to create libp2p host: %w", err)
	}

	s.host = host
	s.addrs = make([]string, len(host.Addrs()))
	for i, addr := range host.Addrs() {
		s.addrs[i] = addr.String()
	}

	logger.Infof(ctx, "Bootstrap subserver created host with ID: %s", host.ID().String())
	logger.Infof(ctx, "Bootstrap subserver listening on addresses: %v", s.addrs)

	return nil
}

// createBootstrapDHT creates a dedicated DHT instance for the bootstrap subserver
func (s *SubServer) createBootstrapDHT(ctx context.Context) error {
	var dhtOptions []dht.Option

	// Set DHT mode to server for bootstrap functionality
	dhtOptions = append(dhtOptions, dht.Mode(dht.ModeServer))

	// Set protocol prefix for network isolation
	dhtOptions = append(dhtOptions, dht.ProtocolPrefix("/peers-touch"))

	// Use injected bootstrap nodes if available
	for _, bn := range s.opts.BootstrapNodes {
		info, err := peer.AddrInfoFromP2pAddr(bn)
		if err != nil {
			logger.Errorf(ctx, "failed to convert bootstrapper address to peer addr info", "address",
				bn.String(), err, "err")
			continue
		}

		dhtOptions = append(dhtOptions, dht.BootstrapPeers(*info))
		logger.Infof(ctx, "Bootstrap subserver using %d configured bootstrap nodes", len(s.opts.BootstrapNodes))
	}

	// Create DHT instance
	dhtInstance, err := dht.New(ctx, s.host, dhtOptions...)
	if err != nil {
		return fmt.Errorf("failed to create DHT: %w", err)
	}

	s.dht = dhtInstance
	return nil
}
