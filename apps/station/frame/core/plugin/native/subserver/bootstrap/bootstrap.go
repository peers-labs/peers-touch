// Package bootstrap provides a libp2p-based bootstrap subserver.
package bootstrap

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/ipfs/boxo/ipns"
	libp2p "github.com/libp2p/go-libp2p"
	dht "github.com/libp2p/go-libp2p-kad-dht"
	record "github.com/libp2p/go-libp2p-record"
	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	yamux "github.com/libp2p/go-libp2p/p2p/muxer/yamux"
	multiaddr "github.com/multiformats/go-multiaddr"
	cfg "github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/internal/mdns"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/core/types"
	"github.com/peers-labs/peers-touch/station/frame/touch/federation/invalidation"
	"github.com/peers-labs/peers-touch/station/frame/touch/federation/republisher"
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

	runningLock sync.Mutex
	status      server.Status
	addrs       []string
	mdnsService *mdns.Service

	// seedPeers is the resolved peer.AddrInfo list derived from federation.BootstrapSeeds()
	// (with self filtered out). Populated by createHost() and consumed by Start()'s
	// boot ticker so the DHT routing table actually fills with the configured seeds.
	// libp2p kad-dht's BootstrapPeers option seeds the DHT, but actual transport
	// connections must be initiated explicitly by the host — that is why both
	// dht.BootstrapPeers and host.Connect are required.
	seedPeers []peer.AddrInfo

	// republisher (Phase D) keeps locally-owned locator records alive
	// in the federation DHT despite kad-dht's 24h TTL. Lifecycle is
	// tied to the bootstrap subserver because it owns the only DHT
	// handle in the process and federation policy.
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
	// public health endpoint can read DHT readiness even before the
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

	// Tier C1 — register the federation invalidation subscriber. The
	// relay-client subserver reads federation.GetBroadcastHandler()
	// lazily for every Broadcast frame, so the only ordering rule is
	// "register before the first frame arrives". Bootstrap.Start
	// runs ahead of the relay-client stream coming up in practice,
	// but even on the rare race the lazy lookup makes us correct.
	invalidation.Subscribe()

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

// Stop shuts down DHT, mDNS and host, and updates status.
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
		// /relay/forward profile fetch + envelope verification into a
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

		// Ensure Yamux multiplexer is enabled for stream multiplexing
		hostOptions = append(hostOptions, libp2p.Muxer(yamux.ID, yamux.DefaultTransport))
		hostOptions = append(hostOptions, libp2p.Identity(priv))
	}

	// Set listen addresses (strict validation)
	if len(s.opts.ListenMultiAddrs) > 0 {
		// Validate each multiaddr is bindable on current host (allow 0.0.0.0/::)
		for _, m := range s.opts.ListenMultiAddrs {
			if !isBindableLocalAddr(m) {
				return nil, nil, fmt.Errorf("invalid listen address (not local/bindable): %s", m.String())
			}
		}
		hostOptions = append(hostOptions, libp2p.ListenAddrs(s.opts.ListenMultiAddrs...))
	} else if len(s.opts.ListenAddrs) > 0 {
		// Convert string addresses to multiaddr and validate
		var addrs []multiaddr.Multiaddr
		for _, addrStr := range s.opts.ListenAddrs {
			addr, err := multiaddr.NewMultiaddr(addrStr)
			if err != nil {
				return nil, nil, fmt.Errorf("parse listen address %s: %w", addrStr, err)
			}
			if !isBindableLocalAddr(addr) {
				return nil, nil, fmt.Errorf("invalid listen address (not local/bindable): %s", addrStr)
			}
			addrs = append(addrs, addr)
		}
		hostOptions = append(hostOptions, libp2p.ListenAddrs(addrs...))
	}

	// Optional insecure security for testing (set LIBP2P_INSECURE=true)
	if s.opts.Libp2pInsecure || strings.EqualFold(os.Getenv("LIBP2P_INSECURE"), "true") {
		hostOptions = append(hostOptions, libp2p.NoSecurity)
		logger.Warnf(ctx, "[Bootstrap] Using NO-SECURITY transport for testing")
	} else {
		// Use default security (Noise/TLS as provided by go-libp2p)
		hostOptions = append(hostOptions, libp2p.DefaultSecurity)
	}

	// Node-level libp2p policy (announced public-addrs + ConnectionGater).
	// Both are owned by the federation package so the bootstrap host and the
	// transport host share one source of truth — see federation/host_options.go.
	fedPolicy := federation.GetPolicy()
	hostOptions = append(hostOptions, federation.LibP2PHostOptions()...)
	if gp := fedPolicy.GaterPolicy(); gp.Active() {
		if len(gp.AllowedPeers) == 0 {
			logger.Warnf(ctx, "[Bootstrap] federation-direct switches active but federation.bootstrap-nodes is empty; ALL libp2p connectivity will be blocked")
		} else {
			logger.Infof(ctx, "[Bootstrap] federation-direct active: outbound=%v inbound=%v allowed_peers=%d",
				fedPolicy.DirectOutbound, fedPolicy.DirectInbound, len(gp.AllowedPeers))
		}
	}
	if len(fedPolicy.PublicAddrs) > 0 {
		logger.Infof(ctx, "[Bootstrap] announcing %d public multiaddr(s) from federation.public-addrs", len(fedPolicy.PublicAddrs))
	}

	// Create libp2p host
	h, err := libp2p.New(hostOptions...)
	if err != nil {
		return nil, nil, fmt.Errorf("create libp2p host: %w", err)
	}

	// Ensure host actually has listen addresses
	if len(h.Addrs()) == 0 {
		_ = h.Close()
		return nil, nil, fmt.Errorf("bootstrap host has no active listen addresses; check listen-addrs configuration")
	}

	// Resolve federation seeds into peer.AddrInfo, filtering self.
	// Skipping self is essential because operators sometimes copy a node's own
	// dial-address into PEERS_BOOTSTRAP_NODES; without this filter libp2p would
	// log noisy "dial to self" errors on every refresh tick.
	rawSeeds := federation.BootstrapSeeds()
	seeds := make([]peer.AddrInfo, 0, len(rawSeeds))
	for _, info := range rawSeeds {
		if info.ID == h.ID() {
			logger.Infof(ctx, "[Bootstrap] skip self in federation.bootstrap-nodes: %s", info.ID)
			continue
		}
		seeds = append(seeds, info)
	}
	s.seedPeers = seeds

	// Create DHT instance and seed it with the configured bootstrap peers so
	// kad-dht does not fall back to the IPFS public default seeds (which would
	// silently leak our PeerID into the public DHT and never connect to our
	// federation Relay).
	//
	// The ProtocolPrefix MUST match the registry's DHT (registry/native.go
	// uses `dht.ProtocolPrefix(networkID)` too). Without alignment the two
	// DHTs share libp2p connectivity but speak different kad protocols, and
	// neither's routing table ever sees the other — surface symptom is
	// "[HealthCheck] routing table is empty" forever despite ConnectedPeers>0.
	//
	// Validators: the bootstrap DHT is the federation routing fabric for
	// signed user-discovery records. We register the standard kad-dht
	// fallback validators (pk + ipns) plus the locator namespace so
	// PutValue/GetValue under /pst-actor/<handle> are accepted. Without the
	// locator validator any /pst-actor/* PutValue from a peer would be
	// silently dropped — the operator surface symptom is "DHT GetValue
	// returns ErrNotFound forever".
	dhtOpts := []dht.Option{
		dht.Mode(dht.ModeServer),
		dht.ProtocolPrefix(networkID),
		dht.Validator(record.NamespacedValidator{
			"pk":              record.PublicKeyValidator{},
			"ipns":            ipns.Validator{KeyBook: h.Peerstore()},
			locator.Namespace: locator.NewValidator(nil),
		}),
	}
	if len(seeds) > 0 {
		dhtOpts = append(dhtOpts, dht.BootstrapPeers(seeds...))
	}
	dhtInstance, err := dht.New(ctx, h, dhtOpts...)
	if err != nil {
		_ = h.Close()
		return nil, nil, fmt.Errorf("create DHT: %w", err)
	}

	// Publish the local libp2p identity, the configured station domain,
	// and the DHT ValueStore handle into the federation singleton so
	// downstream consumers (locator.Publisher, future federation.Resolver)
	// reach exactly ONE shared instance per process. The order matters:
	// identity before routing, so a consumer that reads federation.Routing()
	// right after RegisterRouting returns is guaranteed to see a populated
	// PeerID too.
	federation.SetLocalStationPeerID(h.ID())
	if domain := stationDomainFromConfig(); domain != "" {
		federation.SetLocalStationDomain(domain)
		logger.Infof(ctx, "[Bootstrap] federation local station domain: %s", domain)
	} else {
		logger.Warnf(ctx, "[Bootstrap] peers.node.server.baseurl missing or invalid; locator publishing will be disabled until the operator sets it")
	}
	federation.RegisterRouting(dhtInstance)

	logger.Infof(ctx, "Created bootstrap host: %s", h.ID())
	logger.Infof(ctx, `Bootstrap listen_raw:
        %s`, joinForPrintLineByLine("----", h.Addrs()))
	p2pAddrs, _ := peer.AddrInfoToP2pAddrs(&peer.AddrInfo{ID: h.ID(), Addrs: h.Addrs()})
	logger.Infof(ctx, `Bootstrap dial_addrs:
        %s`, joinForPrintLineByLine("----", p2pAddrs))

	return h, dhtInstance, nil
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

// isBindableLocalAddr validates a multiaddr IP component is either unspecified (0.0.0.0/::)
// or belongs to one of the local interfaces. Ports are not checked beyond presence.
func isBindableLocalAddr(m multiaddr.Multiaddr) bool {
	// Extract IP protocol
	if v, err := m.ValueForProtocol(multiaddr.P_IP4); err == nil {
		ip := net.ParseIP(v)
		if ip == nil {
			return false
		}
		if v == "0.0.0.0" {
			return true
		}
		return isLocalIP(ip)
	}
	if v, err := m.ValueForProtocol(multiaddr.P_IP6); err == nil {
		ip := net.ParseIP(v)
		if ip == nil {
			return false
		}
		if v == "::" || v == "::1" {
			return true
		}
		return isLocalIP(ip)
	}
	// If no IP component, allow (libp2p may derive defaults)
	return true
}

// stationDomainFromConfig parses peers.node.server.baseurl and returns its
// host portion (preserving port — federation handles round-trip "@user@host"
// or "@user@host:port" so we keep whatever the operator configured). Empty
// return means the baseurl was missing or did not parse; callers MUST treat
// that as "federation publishing disabled" rather than guess a default.
func stationDomainFromConfig() string {
	raw := strings.TrimSpace(cfg.Get("peers", "node", "server", "baseurl").String(""))
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ""
	}
	return u.Host
}

func isLocalIP(ip net.IP) bool {
	ifaces, err := net.InterfaceAddrs()
	if err != nil {
		return false
	}
	for _, a := range ifaces {
		var ia net.IP
		switch v := a.(type) {
		case *net.IPNet:
			ia = v.IP
		case *net.IPAddr:
			ia = v.IP
		}
		if ia != nil && ia.Equal(ip) {
			return true
		}
	}
	return false
}
