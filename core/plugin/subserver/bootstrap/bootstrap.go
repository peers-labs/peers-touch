package bootstrap

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/registry"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
	"github.com/dirty-bro-tech/peers-touch-go/core/store"
	"github.com/ipfs/boxo/ipns"
	"github.com/libp2p/go-libp2p"
	dht "github.com/libp2p/go-libp2p-kad-dht"
	record "github.com/libp2p/go-libp2p-record"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
)

var (
	_ server.Subserver = &SubServer{}
)

type SubServer struct {
	opts *Options

	host host.Host
	dht  *dht.IpfsDHT

	store store.Store

	runningLock sync.Mutex
	status      server.Status
	addrs       []string
}

func (s *SubServer) Init(ctx context.Context, opts ...option.Option) (err error) {
	defer func() {
		if err != nil {
			logger.Errorf(ctx, "failed to init bootstrap subserver: %v", err)
			return
		}
	}()

	for _, opt := range opts {
		s.opts.Apply(opt)
	}

	var hostOptions []libp2p.Option

	// Load or generate private key
	if s.opts.IdentityKey == nil {
		err = errors.New("identity key for bootstrap server is required")
		return
	}

	hostOptions = append(hostOptions,
		/*		libp2p.Transport(webrtc.New),
				libp2p.Transport(quic.NewTransport),*/
		libp2p.Identity(s.opts.IdentityKey))

	addrs := s.opts.ListenAddrs
	if len(addrs) == 0 {
		addrs = append(addrs, "/ip4/0.0.0.0/tcp/4001")
	}

	s.addrs = addrs
	for _, addr := range s.addrs {
		listenAddr, errIn := multiaddr.NewMultiaddr(addr)
		if errIn != nil {
			err = fmt.Errorf("failed to parse bootstrap server listening address: %v", errIn)
			return
		}
		hostOptions = append(hostOptions, libp2p.ListenAddrs(listenAddr))
	}

	// Initialize libp2p host
	s.host, err = libp2p.New(
		hostOptions...,
	)
	if err != nil {
		err = fmt.Errorf("failed to create libp2p host: %v", err)
		return
	}

	// Create DHT instance in server mode
	s.dht, err = dht.New(ctx, s.host,
		// Isolate network namespace via /peers-touch
		dht.ProtocolPrefix(networkId),
		dht.Validator(
			record.NamespacedValidator{
				// actually, these validators are the defaults in libp2p[see github.com/libp2p/go-libp2p-kad-dht/internal/config/config.go#ApplyFallbacks]
				// but we need to set them here to learn how they work,
				// so we can customize them according to our needs in the future.
				"pk":                                  record.PublicKeyValidator{},
				"ipns":                                ipns.Validator{KeyBook: s.host.Peerstore()},
				registry.DefaultPeersNetworkNamespace: &NamespaceValidator{},
			},
		),
		dht.BootstrapPeersFunc(func() []peer.AddrInfo {
			bootstrapNodes := append(s.opts.BootstrapNodes, dht.DefaultBootstrapPeers...)
			var peerBootstrapNodes []peer.AddrInfo
			for _, addr := range bootstrapNodes {
				pi, errIn := peer.AddrInfoFromP2pAddr(addr)
				if errIn != nil {
					logger.Errorf(ctx, "failed to parse bootstrap node address: %s", errIn)
					continue
				}
				peerBootstrapNodes = append(peerBootstrapNodes, *pi)
			}

			return peerBootstrapNodes
		}),
		dht.BucketSize(20),
		dht.OnRequestHook(dhtRequestHooksWrap),
	)
	if err != nil {
		err = fmt.Errorf("create libp2p host: %w", err)
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

	ticker := time.NewTicker(s.opts.DHTRefreshInterval)
	defer ticker.Stop()

	doNow := make(chan struct{})

	boot := func() {
		logger.Infof(ctx, "bootstrap peer: %s", s.host.ID().String())
		if errIn := s.dht.Bootstrap(ctx); errIn != nil {
			logger.Errorf(ctx, "failed to bootstrap peers: %v", errIn)
		}
	}
	go func() {
		for {
			select {
			case <-doNow:
				boot()
			case <-ticker.C:
				boot()
			case <-ctx.Done():
				logger.Warnf(ctx, "bootstrap stopped %+v", ctx.Err())
				return
			}
		}
	}()

	go func() {
		doNow <- struct{}{}
	}()

	s.status = server.StatusRunning
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
	return nil
}

// NewBootstrapServer creates a new bootstrap subserver with the provided options.
// Call it after root Ctx is initialized, which is initialized in BeforeInit of predominate process.
func NewBootstrapServer(opts ...option.Option) server.Subserver {
	bootS := &SubServer{
		opts: option.GetOptions(opts...).Ctx().Value(optionsKey{}).(*Options),
	}

	return bootS
}
