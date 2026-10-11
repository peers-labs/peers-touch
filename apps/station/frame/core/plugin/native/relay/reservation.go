package relay

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	relayclient "github.com/libp2p/go-libp2p/p2p/protocol/circuitv2/client"
	"github.com/multiformats/go-multiaddr"
)

type CircuitRoute struct {
	RelayPeerID     peer.ID
	DialMultiaddr   multiaddr.Multiaddr
	RouteGeneration uint64
	ExpiresAt       time.Time
	LimitDuration   time.Duration
	LimitData       uint64
}

type reservationState struct {
	route     *CircuitRoute
	lastError error
}

type ReservationManager struct {
	config Pool

	lock       sync.RWMutex
	host       host.Host
	authorizer func(context.Context, Target) (uint64, error)
	publisher  func(context.Context, Target, CircuitRoute) error
	states     map[peer.ID]reservationState
	cancel     context.CancelFunc
	started    bool
	group      sync.WaitGroup
}

func (m *ReservationManager) SetControl(
	authorizer func(context.Context, Target) (uint64, error),
	publisher func(context.Context, Target, CircuitRoute) error,
) error {
	if m == nil || authorizer == nil || publisher == nil {
		return fmt.Errorf("Relay reservation control is incomplete")
	}
	m.lock.Lock()
	defer m.lock.Unlock()
	if m.started {
		return fmt.Errorf("Relay reservation control cannot change after start")
	}
	m.authorizer = authorizer
	m.publisher = publisher
	return nil
}

func NewReservationManager(config Pool) (*ReservationManager, error) {
	if config.Mode == "" {
		config.Mode = PoolModeOff
	}
	if config.RenewBefore <= 0 {
		config.RenewBefore = 20 * time.Minute
	}
	if config.RetryMin <= 0 {
		config.RetryMin = time.Second
	}
	if config.RetryMax < config.RetryMin {
		config.RetryMax = config.RetryMin
	}
	for index, target := range config.Targets {
		if _, err := targetAddrInfo(target); err != nil {
			return nil, fmt.Errorf("Relay pool target %d: %w", index, err)
		}
	}
	return &ReservationManager{
		config: config,
		states: make(map[peer.ID]reservationState, len(config.Targets)),
	}, nil
}

func (m *ReservationManager) AttachHost(value host.Host) error {
	if m == nil || value == nil {
		return fmt.Errorf("Relay reservation manager requires a P2P Kernel Host")
	}
	m.lock.Lock()
	defer m.lock.Unlock()
	if m.host != nil {
		return fmt.Errorf("Relay reservation manager already has a Host")
	}
	m.host = value
	return nil
}

func (m *ReservationManager) Start(ctx context.Context) error {
	if m == nil || m.config.Mode == PoolModeOff {
		return nil
	}
	m.lock.Lock()
	if m.started {
		m.lock.Unlock()
		return fmt.Errorf("Relay reservation manager already started")
	}
	if m.host == nil {
		m.lock.Unlock()
		return fmt.Errorf("Relay reservation manager has no P2P Kernel Host")
	}
	runContext, cancel := context.WithCancel(ctx)
	m.cancel = cancel
	m.started = true
	m.lock.Unlock()
	for _, configured := range m.config.Targets {
		target := Target{
			RelayPeerID: configured.RelayPeerID,
			Addresses:   append([]string(nil), configured.Addresses...),
		}
		m.group.Add(1)
		go func() {
			defer m.group.Done()
			m.maintain(runContext, target)
		}()
	}
	return nil
}

func (m *ReservationManager) Close() error {
	if m == nil {
		return nil
	}
	m.lock.Lock()
	cancel := m.cancel
	m.cancel = nil
	m.started = false
	m.lock.Unlock()
	if cancel != nil {
		cancel()
	}
	m.group.Wait()
	m.lock.Lock()
	m.states = make(map[peer.ID]reservationState, len(m.config.Targets))
	m.lock.Unlock()
	return nil
}

func (m *ReservationManager) LiveRoutes(now time.Time) []CircuitRoute {
	if m == nil {
		return nil
	}
	m.lock.RLock()
	defer m.lock.RUnlock()
	routes := make([]CircuitRoute, 0, len(m.states))
	for _, state := range m.states {
		if state.route == nil || !state.route.ExpiresAt.After(now) {
			continue
		}
		routes = append(routes, *state.route)
	}
	sort.Slice(routes, func(left, right int) bool {
		return routes[left].RelayPeerID.String() <
			routes[right].RelayPeerID.String()
	})
	return routes
}

func (m *ReservationManager) maintain(ctx context.Context, target Target) {
	backoff := m.config.RetryMin
	for {
		route, err := m.reserve(ctx, target)
		if err == nil {
			m.record(target.RelayPeerID, route, nil)
			backoff = m.config.RetryMin
			wait := time.Until(route.ExpiresAt) - m.config.RenewBefore
			if wait > 2*time.Minute {
				wait = 2 * time.Minute
			}
			if wait < time.Second {
				wait = time.Second
			}
			if !waitForContext(ctx, wait) {
				return
			}
			continue
		}
		if errors.Is(err, context.Canceled) {
			return
		}
		m.record(target.RelayPeerID, nil, err)
		if !waitForContext(ctx, backoff) {
			return
		}
		backoff *= 2
		if backoff > m.config.RetryMax {
			backoff = m.config.RetryMax
		}
	}
}

func (m *ReservationManager) reserve(
	ctx context.Context,
	target Target,
) (*CircuitRoute, error) {
	m.lock.RLock()
	valueHost := m.host
	m.lock.RUnlock()
	if valueHost == nil {
		return nil, fmt.Errorf("P2P Kernel Host is unavailable")
	}
	m.lock.RLock()
	authorizer := m.authorizer
	publisher := m.publisher
	m.lock.RUnlock()
	if authorizer == nil || publisher == nil {
		return nil, fmt.Errorf("Relay reservation control is unavailable")
	}
	generation, err := authorizer(ctx, target)
	if err != nil {
		return nil, err
	}
	addressInfo, err := targetAddrInfo(target)
	if err != nil {
		return nil, err
	}
	reserveContext, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if err := valueHost.Connect(reserveContext, addressInfo); err != nil {
		return nil, fmt.Errorf("connect Relay %s: %w", target.RelayPeerID, err)
	}
	reservation, err := relayclient.Reserve(
		reserveContext,
		valueHost,
		addressInfo,
	)
	if err != nil {
		return nil, fmt.Errorf(
			"reserve Relay %s: %w",
			target.RelayPeerID,
			err,
		)
	}
	circuitAddress, err := multiaddr.NewMultiaddr(
		fmt.Sprintf(
			"/p2p/%s/p2p-circuit/p2p/%s",
			target.RelayPeerID,
			valueHost.ID(),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("build Circuit route: %w", err)
	}
	route := &CircuitRoute{
		RelayPeerID:     target.RelayPeerID,
		DialMultiaddr:   circuitAddress,
		RouteGeneration: generation,
		ExpiresAt:       reservation.Expiration.UTC(),
		LimitDuration:   reservation.LimitDuration,
		LimitData:       reservation.LimitData,
	}
	if err := publisher(ctx, target, *route); err != nil {
		return nil, err
	}
	return route, nil
}

func (m *ReservationManager) record(
	relayPeerID peer.ID,
	route *CircuitRoute,
	err error,
) {
	m.lock.Lock()
	m.states[relayPeerID] = reservationState{
		route:     route,
		lastError: err,
	}
	m.lock.Unlock()
}

func targetAddrInfo(target Target) (peer.AddrInfo, error) {
	addresses := make([]multiaddr.Multiaddr, 0, len(target.Addresses))
	for _, raw := range target.Addresses {
		address, err := multiaddr.NewMultiaddr(raw)
		if err != nil {
			return peer.AddrInfo{}, fmt.Errorf(
				"invalid Relay address %q: %w",
				raw,
				err,
			)
		}
		if peerID, err := address.ValueForProtocol(multiaddr.P_P2P); err == nil {
			if peerID != target.RelayPeerID.String() {
				return peer.AddrInfo{}, fmt.Errorf(
					"Relay address PeerID does not match %s",
					target.RelayPeerID,
				)
			}
			address, err = address.Decapsulate(
				multiaddr.StringCast("/p2p/"+peerID),
			), nil
		}
		addresses = append(addresses, address)
	}
	return peer.AddrInfo{ID: target.RelayPeerID, Addrs: addresses}, nil
}

func waitForContext(ctx context.Context, duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
