package relay

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
	nativeFederation "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
)

func TestCloneTargetPreservesControlPlaneConfiguration(t *testing.T) {
	relayPeerID, err := peer.Decode(
		"12D3KooWLpZy2EgZ6SC2pgJFHjM13j1ygz7DXCfm9HiPeNQZ1uaW",
	)
	if err != nil {
		t.Fatal(err)
	}
	original := Target{
		RelayPeerID: relayPeerID,
		Addresses: []string{
			"/ip4/192.0.2.20/tcp/4501/p2p/" + relayPeerID.String(),
		},
		ControlOrigin:  "https://192.0.2.20:18081",
		InviteToken:    "invite",
		CredentialFile: "/app/data/relay.json",
		TLSCAFile:      "/app/relay-ca/relay.crt",
		Label:          "one",
	}

	cloned := cloneTarget(original)

	if cloned.RelayPeerID != original.RelayPeerID ||
		cloned.ControlOrigin != original.ControlOrigin ||
		cloned.InviteToken != original.InviteToken ||
		cloned.CredentialFile != original.CredentialFile ||
		cloned.TLSCAFile != original.TLSCAFile ||
		cloned.Label != original.Label {
		t.Fatalf("cloned target lost control-plane fields: %#v", cloned)
	}
	cloned.Addresses[0] = "/ip4/127.0.0.1/tcp/1"
	if cloned.Addresses[0] == original.Addresses[0] {
		t.Fatal("cloned target shares its address slice")
	}
}

func TestAdmissionDynamicRelayPeerGaterLifecycle(t *testing.T) {
	relayPeerID := testPeerID(t)
	target := Target{
		RelayPeerID: relayPeerID,
		Addresses:   []string{"/ip4/127.0.0.1/tcp/4502"},
	}
	gater := nativeFederation.NewGater(nativeFederation.GaterPolicy{
		DirectOutbound: false,
		DirectInbound:  false,
		AllowedPeers:   map[peer.ID]struct{}{},
	})
	manager, err := NewReservationManager(Pool{Mode: PoolModeOff})
	if err != nil {
		t.Fatalf("create reservation manager: %v", err)
	}
	runtime := &Runtime{
		manager: manager,
		control: &StationControl{
			targets: map[peer.ID]Target{relayPeerID: target},
		},
	}
	runtime.ConfigurePeerAccess(gater)

	if gater.InterceptPeerDial(relayPeerID) {
		t.Fatal("unattached Relay bypassed the closed outbound policy")
	}
	if err := runtime.activatePreparedTarget(target); err != nil {
		t.Fatalf("activate prepared Relay target: %v", err)
	}
	if !gater.InterceptPeerDial(relayPeerID) {
		t.Fatal("active dynamic Relay was rejected by the Host gater")
	}
	if err := runtime.disableTarget(relayPeerID); err != nil {
		t.Fatalf("disable dynamic Relay target: %v", err)
	}
	if gater.InterceptPeerDial(relayPeerID) {
		t.Fatal("detached dynamic Relay retained Host admission")
	}
}

func TestCircuitDialMultiaddrsIncludeRelayTransportAddress(t *testing.T) {
	relayPeerID, err := peer.Decode(
		"12D3KooWLpZy2EgZ6SC2pgJFHjM13j1ygz7DXCfm9HiPeNQZ1uaW",
	)
	if err != nil {
		t.Fatal(err)
	}
	stationPeerID, err := peer.Decode(
		"12D3KooWGo2HxmjfSQZKTheDEbgDBpSuhUxTNsr8DnTkXCDzdaZL",
	)
	if err != nil {
		t.Fatal(err)
	}
	base := multiaddr.StringCast("/ip4/192.0.2.20/tcp/4501")

	addresses, err := circuitDialMultiaddrs(
		peer.AddrInfo{
			ID:    relayPeerID,
			Addrs: []multiaddr.Multiaddr{base},
		},
		stationPeerID,
	)
	if err != nil {
		t.Fatal(err)
	}

	expected := base.String() +
		"/p2p/" + relayPeerID.String() +
		"/p2p-circuit/p2p/" + stationPeerID.String()
	if len(addresses) != 1 || addresses[0].String() != expected {
		t.Fatalf("Circuit dial addresses = %v, want %s", addresses, expected)
	}
}

func TestReservationRenewalFailureRetainsUnexpiredRoute(t *testing.T) {
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	manager, err := NewReservationManager(Pool{Mode: PoolModeOff})
	if err != nil {
		t.Fatalf("create reservation manager: %v", err)
	}
	manager.now = func() time.Time { return now }
	relayPeerID := testPeerID(t)
	if err := manager.AddTarget(Target{
		RelayPeerID: relayPeerID,
		Addresses:   []string{"/ip4/127.0.0.1/tcp/1"},
	}); err != nil {
		t.Fatalf("add Relay target: %v", err)
	}
	worker := manager.workers[relayPeerID]
	route := &CircuitRoute{
		RelayPeerID:     relayPeerID,
		RouteGeneration: 3,
		ExpiresAt:       now.Add(time.Minute),
	}
	manager.record(worker, route, nil)
	manager.record(
		worker,
		nil,
		fmt.Errorf("transient renewal failure"),
	)

	routes := manager.LiveRoutes(now)
	if len(routes) != 1 ||
		routes[0].RelayPeerID != relayPeerID ||
		routes[0].RouteGeneration != route.RouteGeneration {
		t.Fatalf("renewal failure dropped live route: %+v", routes)
	}

	now = now.Add(2 * time.Minute)
	manager.record(worker, nil, fmt.Errorf("route expired"))
	if routes := manager.LiveRoutes(now); len(routes) != 0 {
		t.Fatalf("expired route survived renewal failure: %+v", routes)
	}
}

func TestReservationManagerAddsAndRemovesTargetsAtRuntime(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()

	stationHost := newCircuitTestHost(t)
	defer stationHost.Close()
	relayA := newCircuitTestRelay(t, stationHost.ID())
	defer relayA.close()
	relayB := newCircuitTestRelay(t, stationHost.ID())
	defer relayB.close()

	manager, err := NewReservationManager(Pool{
		Mode:        PoolModeOff,
		RenewBefore: 2 * time.Second,
		RetryMin:    50 * time.Millisecond,
		RetryMax:    200 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("create reservation manager: %v", err)
	}
	if err := manager.SetControl(
		func(context.Context, Target) (uint64, error) {
			return 1, nil
		},
		func(context.Context, Target, CircuitRoute) error {
			return nil
		},
	); err != nil {
		t.Fatalf("set reservation control: %v", err)
	}
	if err := manager.AttachHost(stationHost); err != nil {
		t.Fatalf("attach Station Host: %v", err)
	}
	if err := manager.Start(ctx); err != nil {
		t.Fatalf("start reservation manager: %v", err)
	}
	defer manager.Close()

	targetA := Target{
		RelayPeerID: relayA.host.ID(),
		Addresses:   []string{circuitTestRelayAddress(t, relayA.host)},
	}
	targetB := Target{
		RelayPeerID: relayB.host.ID(),
		Addresses:   []string{circuitTestRelayAddress(t, relayB.host)},
	}
	if err := manager.AddTarget(targetA); err != nil {
		t.Fatalf("add first Relay at runtime: %v", err)
	}
	if err := manager.AddTarget(targetB); err != nil {
		t.Fatalf("add second Relay at runtime: %v", err)
	}
	waitForCircuitRoutes(t, ctx, manager, 2)

	if err := manager.RemoveTarget(relayA.host.ID()); err != nil {
		t.Fatalf("remove first Relay at runtime: %v", err)
	}
	remaining := waitForCircuitRoutes(t, ctx, manager, 1)
	if remaining[0].RelayPeerID != relayB.host.ID() {
		t.Fatalf("runtime removal mutated surviving route: %+v", remaining)
	}
	targets := manager.Targets()
	snapshots := manager.Snapshots()
	if len(targets) != 1 ||
		targets[0].RelayPeerID != relayB.host.ID() ||
		len(snapshots) != 1 ||
		snapshots[0].Target.RelayPeerID != relayB.host.ID() {
		t.Fatalf(
			"runtime target projection is stale: targets=%+v snapshots=%+v",
			targets,
			snapshots,
		)
	}
	if err := manager.RetryTarget(relayB.host.ID()); err != nil {
		t.Fatalf("retry surviving Relay: %v", err)
	}
}

func TestReservationManagerKeepsIndependentRelayRoutes(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()

	stationHost := newCircuitTestHost(t)
	defer stationHost.Close()
	relayA := newCircuitTestRelay(t, stationHost.ID())
	defer relayA.close()
	relayB := newCircuitTestRelay(t, stationHost.ID())
	defer relayB.close()

	manager, err := NewReservationManager(Pool{
		Mode:        PoolModeCustom,
		RenewBefore: 2 * time.Second,
		RetryMin:    50 * time.Millisecond,
		RetryMax:    200 * time.Millisecond,
		Targets: []Target{
			{
				RelayPeerID: relayA.host.ID(),
				Addresses:   []string{circuitTestRelayAddress(t, relayA.host)},
			},
			{
				RelayPeerID: relayB.host.ID(),
				Addresses:   []string{circuitTestRelayAddress(t, relayB.host)},
			},
		},
	})
	if err != nil {
		t.Fatalf("create reservation manager: %v", err)
	}
	if err := manager.SetControl(
		func(context.Context, Target) (uint64, error) {
			return 1, nil
		},
		func(context.Context, Target, CircuitRoute) error {
			return nil
		},
	); err != nil {
		t.Fatalf("set reservation control: %v", err)
	}
	if err := manager.AttachHost(stationHost); err != nil {
		t.Fatalf("attach Station Host: %v", err)
	}
	if err := manager.Start(ctx); err != nil {
		t.Fatalf("start reservation manager: %v", err)
	}
	defer manager.Close()

	routes := waitForCircuitRoutes(t, ctx, manager, 2)
	if routes[0].RelayPeerID == routes[1].RelayPeerID {
		t.Fatal("independent Relay targets collapsed into one reservation")
	}

	routeB := circuitRouteForRelay(t, routes, relayB.host.ID())
	sourceHost := newCircuitTestHost(t)
	defer sourceHost.Close()
	if err := connectThroughCircuit(ctx, sourceHost, routeB.DialMultiaddrs[0]); err != nil {
		t.Fatalf("ordinary source could not reach public destination: %v", err)
	}

	if err := relayA.host.Close(); err != nil {
		t.Fatalf("close first Relay: %v", err)
	}
	remaining := waitForCircuitRoutes(t, ctx, manager, 1)
	if remaining[0].RelayPeerID != relayB.host.ID() {
		t.Fatalf(
			"first Relay failure mutated the surviving route: %+v",
			remaining,
		)
	}
}

type circuitTestRelay struct {
	host    host.Host
	runtime *Runtime
}

func newCircuitTestRelay(
	t *testing.T,
	destinationPeerID peer.ID,
) *circuitTestRelay {
	t.Helper()
	runtime, err := NewRuntime(RuntimeConfig{
		Resources: Resources{
			ReservationTTL:        3 * time.Second,
			MaxReservations:       16,
			MaxCircuitsPerPeer:    4,
			MaxBytesPerDirection:  1 << 20,
			MaxCircuitDuration:    10 * time.Second,
			MaxReservationsPerIP:  16,
			MaxReservationsPerASN: 16,
			BufferSize:            2048,
		},
		Pool: Pool{Mode: PoolModeOff},
	}, false)
	if err != nil {
		t.Fatalf("create Relay runtime: %v", err)
	}
	if err := runtime.Admission().AdmitNode(NodeAdmission{
		StationPeerID: "station-a",
		NodePeerID:    destinationPeerID,
		Generation:    1,
		ExpiresAt:     time.Now().UTC().Add(time.Minute),
	}); err != nil {
		t.Fatalf("admit Station node: %v", err)
	}
	if err := runtime.Admission().PublishRoute(RouteAdmission{
		NodePeerID: destinationPeerID,
		Generation: 1,
		Public:     true,
		ExpiresAt:  time.Now().UTC().Add(time.Minute),
	}); err != nil {
		t.Fatalf("publish public Station route: %v", err)
	}
	options := []libp2p.Option{
		libp2p.ListenAddrStrings("/ip4/127.0.0.1/tcp/0"),
	}
	options = append(options, runtime.LibP2POptions(true)...)
	relayHost, err := libp2p.New(options...)
	if err != nil {
		t.Fatalf("create Relay Host: %v", err)
	}
	if err := runtime.AttachHost(relayHost); err != nil {
		_ = relayHost.Close()
		t.Fatalf("attach Relay Host: %v", err)
	}
	return &circuitTestRelay{host: relayHost, runtime: runtime}
}

func (r *circuitTestRelay) close() {
	_ = r.runtime.Close()
	_ = r.host.Close()
}

func newCircuitTestHost(t *testing.T) host.Host {
	t.Helper()
	value, err := libp2p.New(
		libp2p.ListenAddrStrings("/ip4/127.0.0.1/tcp/0"),
		libp2p.EnableRelay(),
	)
	if err != nil {
		t.Fatalf("create Circuit test Host: %v", err)
	}
	return value
}

func circuitTestRelayAddress(t *testing.T, relayHost host.Host) string {
	t.Helper()
	if len(relayHost.Addrs()) == 0 {
		t.Fatal("Relay Host has no dial address")
	}
	peerComponent, err := multiaddr.NewMultiaddr(
		"/p2p/" + relayHost.ID().String(),
	)
	if err != nil {
		t.Fatalf("build Relay PeerID component: %v", err)
	}
	return relayHost.Addrs()[0].Encapsulate(peerComponent).String()
}

func connectThroughCircuit(
	ctx context.Context,
	source host.Host,
	address multiaddr.Multiaddr,
) error {
	info, err := peer.AddrInfoFromP2pAddr(address)
	if err != nil {
		return err
	}
	if err := source.Connect(ctx, *info); err != nil {
		return err
	}
	for _, connection := range source.Network().ConnsToPeer(info.ID) {
		if connection.Stat().Limited {
			return nil
		}
	}
	return fmt.Errorf(
		"connection to %s was not a Circuit Relay connection",
		info.ID,
	)
}

func waitForCircuitRoutes(
	t *testing.T,
	ctx context.Context,
	manager *ReservationManager,
	count int,
) []CircuitRoute {
	t.Helper()
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		routes := manager.LiveRoutes(time.Now().UTC())
		if len(routes) == count {
			return routes
		}
		select {
		case <-ctx.Done():
			t.Fatalf(
				"timed out waiting for %d Circuit routes, last=%+v",
				count,
				routes,
			)
		case <-ticker.C:
		}
	}
}

func circuitRouteForRelay(
	t *testing.T,
	routes []CircuitRoute,
	relayPeerID peer.ID,
) CircuitRoute {
	t.Helper()
	for _, route := range routes {
		if route.RelayPeerID == relayPeerID {
			return route
		}
	}
	t.Fatalf("route for Relay %s was not found", relayPeerID)
	return CircuitRoute{}
}
