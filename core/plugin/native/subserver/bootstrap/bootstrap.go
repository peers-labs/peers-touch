package bootstrap

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	dht "github.com/libp2p/go-libp2p-kad-dht"
	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	libp2p "github.com/libp2p/go-libp2p"
	"github.com/multiformats/go-multiaddr"
	"github.com/peers-touch/peers-touch-go/core/logger"
	"github.com/peers-touch/peers-touch-go/core/option"
	"github.com/peers-touch/peers-touch-go/core/plugin/native/internal/mdns"
	"github.com/peers-touch/peers-touch-go/core/server"
	"github.com/peers-touch/peers-touch-go/core/store"
	"github.com/peers-touch/peers-touch-go/core/types"
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

	// Create libp2p host and DHT
	s.host, s.dht, err = s.createHost(ctx)
	if err != nil {
		err = fmt.Errorf("[Init] failed to create libp2p host: %w", err)
		return
	}
	notifee := &libp2pHostNotifee{
		SubServer: s,
	}
	s.host.Network().Notify(notifee)

	// Init MDNS with new internal mDNS service
	if s.opts.EnableMDNS {
		var err error
		s.mdnsService, err = mdns.NewMDNSService(ctx,
			mdns.WithNamespace("bootstrap"),
			mdns.WithService("_peers-touch._tcp"),
		)
		if err != nil {
			return fmt.Errorf("failed to create mDNS service: %w", err)
		}

		// Set up discovery callback - bootstrap just logs discoveries
		s.mdnsService.Watch(func(peer *types.Peer) {
			// Bootstrap subserver should not connect to mDNS-discovered nodes
			// Just log the discovery for informational purposes
			ctx := context.Background()
			logger.Infof(ctx, "Discovered peer via mDNS: %s (type: %s)", peer.Name, peer.ID)
		})

		err = s.mdnsService.Start()
		if err != nil {
			return fmt.Errorf("failed to start mDNS service: %w", err)
		}
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

	// Stop mDNS service if enabled
	if s.mdnsService != nil {
		if err := s.mdnsService.Stop(); err != nil {
			logger.Errorf(ctx, "[Bootstrap] Error stopping mDNS service: %v", err)
		}
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

// createHost creates libp2p host and DHT for bootstrap server
func (s *SubServer) createHost(ctx context.Context) (host.Host, *dht.IpfsDHT, error) {
	// Prepare libp2p options
	var hostOptions []libp2p.Option

	// Use configured private key or generate new one
	if s.opts.PrivateKey != nil {
		hostOptions = append(hostOptions, libp2p.Identity(s.opts.PrivateKey))
	} else {
		// Generate new private key
		priv, _, err := crypto.GenerateKeyPair(crypto.Ed25519, 0)
		if err != nil {
			return nil, nil, fmt.Errorf("generate key pair: %w", err)
		}
		hostOptions = append(hostOptions, libp2p.Identity(priv))
	}

	// Set listen addresses
	if len(s.opts.ListenMultiAddrs) > 0 {
		hostOptions = append(hostOptions, libp2p.ListenAddrs(s.opts.ListenMultiAddrs...))
	} else if len(s.opts.ListenAddrs) > 0 {
		// Convert string addresses to multiaddr
		var addrs []multiaddr.Multiaddr
		for _, addrStr := range s.opts.ListenAddrs {
			addr, err := multiaddr.NewMultiaddr(addrStr)
			if err != nil {
				return nil, nil, fmt.Errorf("parse listen address %s: %w", addrStr, err)
			}
			addrs = append(addrs, addr)
		}
		hostOptions = append(hostOptions, libp2p.ListenAddrs(addrs...))
	}

	// Create libp2p host
	h, err := libp2p.New(hostOptions...)
	if err != nil {
		return nil, nil, fmt.Errorf("create libp2p host: %w", err)
	}

	// Create DHT instance
	dhtInstance, err := dht.New(ctx, h, dht.Mode(dht.ModeServer))
	if err != nil {
		h.Close()
		return nil, nil, fmt.Errorf("create DHT: %w", err)
	}

	logger.Infof(ctx, "Created bootstrap host: %s", h.ID())
	logger.Infof(ctx, "Bootstrap listening on addresses: %v", h.Addrs())

	return h, dhtInstance, nil
}
