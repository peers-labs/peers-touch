// Package bootstrap provides a libp2p-based bootstrap subserver.
package bootstrap

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	dht "github.com/libp2p/go-libp2p-kad-dht"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/internal/mdns"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/bootstrap/accessendpoint"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/core/types"
	"github.com/peers-labs/peers-touch/station/frame/touch/federation/republisher"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
)

var (
	_ server.Subserver = &SubServer{}
)

// bootstrapRouterURL implements server.RouterURL for bootstrap endpoints
type bootstrapRouterURL struct {
	name string
	url  string
}

// Name returns the route name.
func (b bootstrapRouterURL) Name() string {
	return b.name
}

// SubPath returns the sub path of the route.
func (b bootstrapRouterURL) SubPath() string {
	return b.url
}

// SubServer implements the bootstrap discovery service.
type SubServer struct {
	opts *Options

	host host.Host
	dht  *dht.IpfsDHT

	store store.Store

	nodeAuthorizationLock sync.Mutex
	nodeAuthorization     *peerpb.StationNodeAuthorization

	runningLock sync.Mutex
	status      server.Status
	addrs       []string
	mdnsService *mdns.Service

	// seedPeers is the resolved peer.AddrInfo list derived from
	// federation.BootstrapSeeds(), with self filtered out.
	// libp2p kad-dht's BootstrapPeers option seeds the DHT, but actual transport
	// connections must be initiated explicitly by the host — that is why both
	// dht.BootstrapPeers and host.Connect are required.
	seedPeers []peer.AddrInfo

	// republisher keeps locally-owned locator records alive in the shared DHT.
	// Bootstrap owns the worker; the P2P Kernel owns the DHT lifecycle.
	republisher *republisher.Republisher

	// bootStartedAt is set when Start() begins; consumed by
	// RoutingHealth.Snapshot() so the public /actor/federation/health
	// endpoint can render an "uptime" field. Zero value means "Start
	// has not run yet" — readiness checks treat that as not-ready.
	bootStartedAt time.Time
}

// Snapshot implements federation.RoutingHealth so the resolver and
// public health endpoint can read kad-DHT readiness without importing
// libp2p / dht packages directly. The implementation is lock-free —
// every accessor it touches (RoutingTable, Network, Connectedness)
// is itself goroutine-safe.
func (s *SubServer) Snapshot() federation.RoutingHealthSnapshot {
	policy := federation.GetPolicy()
	minPeers := policy.MinDHTPeers
	if minPeers == 0 {
		minPeers = 1 // package default — see federation.yml.
	}

	rtSize := 0
	if s.dht != nil {
		rtSize = s.dht.RoutingTable().Size()
	}

	connected := 0
	seedsConnected := 0
	if s.host != nil {
		connected = len(s.host.Network().Peers())
		for i := range s.seedPeers {
			if s.host.Network().Connectedness(s.seedPeers[i].ID) == network.Connected {
				seedsConnected++
			}
		}
	}

	// "Ready" requires both: the bootstrap loop has run (BootStartedAt
	// non-zero) AND the routing table has at least the configured
	// number of peers. A negative MinDHTPeers explicitly disables the
	// gate — every snapshot reports Ready=true once Start() begins.
	ready := !s.bootStartedAt.IsZero() && (minPeers < 0 || rtSize >= minPeers)

	return federation.RoutingHealthSnapshot{
		Ready:               ready,
		PeersInRoutingTable: rtSize,
		ConnectedPeers:      connected,
		SeedsConfigured:     len(s.seedPeers),
		SeedsConnected:      seedsConnected,
		BootStartedAt:       s.bootStartedAt,
		MinDHTPeers:         minPeers,
	}
}

// Init initializes the bootstrap server state and services.
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

	if s.opts.Host == nil || s.opts.DHT == nil {
		err = fmt.Errorf("[Init] P2P Kernel Host and DHT must be injected")
		return
	}
	s.host = s.opts.Host
	s.dht = s.opts.DHT
	rawSeeds := federation.BootstrapSeeds()
	s.seedPeers = make([]peer.AddrInfo, 0, len(rawSeeds))
	for _, info := range rawSeeds {
		if info.ID == s.host.ID() {
			logger.Infof(
				ctx,
				"[Bootstrap] skip self in federation.bootstrap-nodes: %s",
				info.ID,
			)
			continue
		}
		s.seedPeers = append(s.seedPeers, info)
	}
	stationPeerID, identityErr := peer.IDFromPrivateKey(s.opts.StationRootKey)
	if identityErr != nil {
		err = fmt.Errorf("[Init] derive logical Station PeerID: %w", identityErr)
		return
	}
	if stationPeerID == s.host.ID() {
		err = fmt.Errorf(
			"[Init] logical Station root and Node Host identities must be independent",
		)
		return
	}
	federation.SetLocalStationPeerID(stationPeerID)
	if s.opts.StationDomain != "" {
		federation.SetLocalStationDomain(s.opts.StationDomain)
	}
	federation.RegisterRouting(s.dht)
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
			logger.Warnf(ctx, "[Bootstrap] mDNS service creation failed, peer discovery degraded: %v", err)
		} else {
			s.mdnsService.Watch(func(peer *types.Peer) {
				ctx := context.Background()
				logger.Infof(ctx, "Discovered peer via mDNS: %s (type: %s)", peer.Name, peer.ID)
			})

			err = s.mdnsService.Start()
			if err != nil {
				logger.Warnf(ctx, "[Bootstrap] mDNS service start failed, peer discovery degraded: %v", err)
				s.mdnsService = nil
			}
		}
	}

	// Note: DHT is also obtained from the registry along with the host
	// No need to create a separate DHT instance

	return
}

// Start launches the bootstrap server.
func (s *SubServer) Start(ctx context.Context, opts ...option.Option) (err error) {
	s.runningLock.Lock()
	defer s.runningLock.Unlock()

	if s.status.IsRunning() {
		return errors.New("bootstrap server is already running")
	}

	logger.Info(ctx, "peers-touch bootstrap server starting")

	// Capture the boot start time so RoutingHealth.Snapshot() can
	// report uptime, and register the health source so resolver /
	// first DHT bootstrap tick lands. Both must happen before we kick
	// the boot ticker — otherwise a request that arrives in the brief
	// gap would see a "not registered" snapshot.
	s.bootStartedAt = time.Now()
	federation.RegisterRoutingHealth(s)

	doNow := make(chan struct{})
	boot := func() {
		p2pAddrs, _ := peer.AddrInfoToP2pAddrs(&peer.AddrInfo{ID: s.host.ID(), Addrs: s.host.Addrs()})
		var dialList []string
		for _, a := range p2pAddrs {
			dialList = append(dialList, a.String())
		}
		s.addrs = dialList
		logger.Infof(ctx, "bootstrap id=%s dht.refresh=%s mdns.enabled=%v seeds=%d", s.host.ID().String(), s.opts.DHTRefreshInterval, s.opts.EnableMDNS, len(s.seedPeers))
		logger.Infof(ctx, `bootstrap listen_raw:
            %s`, joinForPrintLineByLine("----", s.host.Addrs()))
		logger.Infof(ctx, `bootstrap dial_addrs:
            %s`, joinForPrintLineByLine("----", p2pAddrs))

		// Explicitly dial each configured seed before asking the DHT to refresh.
		// libp2p kad-dht's Bootstrap() walks the DHT starting from peers already
		// present in the routing table; it does NOT initiate transport-level
		// connections to seeds itself. Without this loop the routing table stays
		// empty and "discover each other" never converges.
		s.connectSeeds(ctx)

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

	s.startRepublisher(ctx)

	s.status = server.StatusRunning

	logger.Infof(ctx, "peers-touch bootstrap starts to serve at %s", s.host.ID().String())
	return nil
}

// startRepublisher constructs and launches the locator republisher.
// Lifecycle is tied to Start/Stop so a subserver hot-restart does not
// leak the goroutine. Failures during construction degrade gracefully:
// the subserver continues to serve DHT traffic, only the freshness
// keeper is missing.
func (s *SubServer) startRepublisher(ctx context.Context) {
	policy := federation.GetPolicy()
	if policy.RepublishDisabled {
		logger.Infof(ctx, "[Bootstrap] locator republisher disabled by federation.republish-disabled")
		return
	}
	cfg := republisher.Config{}
	if policy.RepublishIntervalSec > 0 {
		cfg.Interval = time.Duration(policy.RepublishIntervalSec) * time.Second
	}
	rp := republisher.New(cfg)
	if err := rp.Start(ctx); err != nil {
		logger.Warnf(ctx, "[Bootstrap] failed to start locator republisher: %v", err)
		return
	}
	s.republisher = rp
}

// Stop shuts down bootstrap-owned workers. The P2P Kernel owns Host and DHT.
func (s *SubServer) Stop(ctx context.Context) (err error) {
	s.runningLock.Lock()
	defer s.runningLock.Unlock()

	defer func() {
		if err != nil {
			s.status = server.StatusError
		}
	}()

	// Stop the republisher BEFORE the DHT closes so its in-flight
	// PutValue calls do not race the closing routing layer.
	if s.republisher != nil {
		s.republisher.Stop()
		s.republisher = nil
	}

	// Stop mDNS service if enabled
	if s.mdnsService != nil {
		if err := s.mdnsService.Stop(); err != nil {
			logger.Errorf(ctx, "[Bootstrap] Error stopping mDNS service: %v", err)
		}
	}

	s.status = server.StatusStopped

	return nil
}

// Name returns the subserver identifier.
func (s *SubServer) Name() string {
	return "libp2p-bootstrap"
}

// Address returns dial addresses.
func (s *SubServer) Address() server.SubserverAddress {
	return server.SubserverAddress{
		Address: s.addrs,
	}
}

// Status returns the current running status.
func (s *SubServer) Status() server.Status {
	return s.status
}

// Handlers returns HTTP handlers for listing peers, DHT query and info.
func (s *SubServer) Handlers() []server.Handler {
	return []server.Handler{
		server.NewHandlerWithURL(
			bootstrapRouterURL{name: "bootstrap-info", url: "/sub-bootstrap/list"},
			s.listPeerInfos,
			server.WithMethod(server.GET),
		),
		server.NewHandlerWithURL(
			bootstrapRouterURL{name: "bootstrap-info", url: "/sub-bootstrap/dht"},
			s.queryDHTPeer,
			server.WithMethod(server.GET),
		),
		server.NewHandlerWithURL(
			bootstrapRouterURL{name: "bootstrap-info", url: "/sub-bootstrap/connect"},
			s.connectPeer,
			server.WithMethod(server.GET),
		),
		server.NewHandlerWithURL(
			bootstrapRouterURL{name: "bootstrap-info", url: "/sub-bootstrap/info"},
			s.info,
			server.WithMethod(server.GET),
		),
		server.NewTypedHandler(
			"bootstrap-station-identity",
			"/sub-bootstrap/station-identity",
			server.POST,
			s.stationIdentity,
		),
		accessendpoint.Handler(s),
		// Phase B: federation locator diagnostic endpoints. These are
		// intentionally on the bootstrap subserver (not /touch/...)
		// because they manipulate the federation DHT directly and have
		// the same operator-only audience as /sub-bootstrap/connect.
		server.NewHandlerWithURL(
			bootstrapRouterURL{name: "bootstrap-locator-lookup", url: "/sub-bootstrap/locator/lookup"},
			s.locatorLookup,
			server.WithMethod(server.GET),
		),
		server.NewHandlerWithURL(
			bootstrapRouterURL{name: "bootstrap-locator-publish", url: "/sub-bootstrap/locator/publish"},
			s.locatorPublish,
			server.WithMethod(server.POST),
		),
		// Phase C: federated user resolver — wraps locator lookup +
		// verified Station route fetch + envelope verification into a
		// single diagnostic endpoint so operators can validate the
		// full read-side loop end-to-end.
		server.NewHandlerWithURL(
			bootstrapRouterURL{name: "bootstrap-federation-resolve", url: "/sub-bootstrap/federation/resolve"},
			s.federationResolve,
			server.WithMethod(server.GET),
		),
	}
}

// Type returns the bootstrap subserver type.
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

// connectSeeds dials every configured bootstrap seed in parallel with a short,
// per-peer timeout. Already-connected seeds are skipped silently. Failures are
// only logged at warn level — they are recoverable on the next refresh tick
// and must never crash the subserver.
func (s *SubServer) connectSeeds(ctx context.Context) {
	if len(s.seedPeers) == 0 {
		return
	}
	var wg sync.WaitGroup
	for i := range s.seedPeers {
		info := s.seedPeers[i]
		// Skip seeds already in the peerstore with a live connection.
		if s.host.Network().Connectedness(info.ID) == network.Connected {
			continue
		}
		wg.Add(1)
		go func(pi peer.AddrInfo) {
			defer wg.Done()
			cctx, cancel := context.WithTimeout(ctx, 15*time.Second)
			defer cancel()
			if err := s.host.Connect(cctx, pi); err != nil {
				logger.Warnf(ctx, "[Bootstrap] seed connect failed peer=%s addrs=%v err=%v", pi.ID, pi.Addrs, err)
				return
			}
			logger.Infof(ctx, "[Bootstrap] seed connected peer=%s", pi.ID)
		}(info)
	}
	wg.Wait()
}
