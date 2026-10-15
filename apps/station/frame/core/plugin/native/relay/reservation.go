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
	DialMultiaddrs  []multiaddr.Multiaddr
	RouteGeneration uint64
	ExpiresAt       time.Time
	LimitDuration   time.Duration
	LimitData       uint64
}

type reservationState struct {
	route     *CircuitRoute
	lastError error
}

type reservationWorker struct {
	target Target
	cancel context.CancelFunc
	done   chan struct{}
	retry  chan struct{}
}

type ReservationSnapshot struct {
	Target    Target
	Route     *CircuitRoute
	LastError error
}

type ReservationManager struct {
	config Pool

	lock       sync.RWMutex
	host       host.Host
	authorizer func(context.Context, Target) (uint64, error)
	publisher  func(context.Context, Target, CircuitRoute) error
	states     map[peer.ID]reservationState
	workers    map[peer.ID]*reservationWorker
	runContext context.Context
	cancel     context.CancelFunc
	started    bool
	now        func() time.Time
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
	if config.Mode != PoolModeOff && config.Mode != PoolModeCustom {
		return nil, fmt.Errorf("unsupported Relay pool mode %q", config.Mode)
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
	bootstrapTargets := config.Targets
	config.Targets = nil
	manager := &ReservationManager{
		config:  config,
		states:  make(map[peer.ID]reservationState, len(bootstrapTargets)),
		workers: make(map[peer.ID]*reservationWorker, len(bootstrapTargets)),
		now:     func() time.Time { return time.Now().UTC() },
	}
	if config.Mode == PoolModeCustom {
		for index, target := range bootstrapTargets {
			if err := manager.addTargetLocked(target); err != nil {
				return nil, fmt.Errorf("Relay pool target %d: %w", index, err)
			}
		}
	}
	return manager, nil
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
	if m == nil {
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
	if m.authorizer == nil || m.publisher == nil {
		m.lock.Unlock()
		return fmt.Errorf("Relay reservation control is unavailable")
	}
	runContext, cancel := context.WithCancel(ctx)
	m.runContext = runContext
	m.cancel = cancel
	m.started = true
	for _, worker := range m.workers {
		m.startWorkerLocked(worker)
	}
	m.lock.Unlock()
	return nil
}

func cloneTarget(target Target) Target {
	target.Addresses = append([]string(nil), target.Addresses...)
	return target
}

func (m *ReservationManager) Close() error {
	if m == nil {
		return nil
	}
	m.lock.Lock()
	cancel := m.cancel
	done := make([]chan struct{}, 0, len(m.workers))
	for _, worker := range m.workers {
		if worker.done != nil {
			done = append(done, worker.done)
		}
		worker.cancel = nil
		worker.done = nil
	}
	m.runContext = nil
	m.cancel = nil
	m.started = false
	m.lock.Unlock()
	if cancel != nil {
		cancel()
	}
	for _, completed := range done {
		<-completed
	}
	m.lock.Lock()
	m.states = make(map[peer.ID]reservationState, len(m.workers))
	for relayPeerID := range m.workers {
		m.states[relayPeerID] = reservationState{}
	}
	m.lock.Unlock()
	return nil
}

func (m *ReservationManager) AddTarget(target Target) error {
	if m == nil {
		return fmt.Errorf("Relay reservation manager is unavailable")
	}
	m.lock.Lock()
	defer m.lock.Unlock()
	return m.addTargetLocked(target)
}

func (m *ReservationManager) addTargetLocked(target Target) error {
	if _, err := targetAddrInfo(target); err != nil {
		return err
	}
	if _, exists := m.workers[target.RelayPeerID]; exists {
		return fmt.Errorf("Relay target %s already exists", target.RelayPeerID)
	}
	worker := &reservationWorker{
		target: cloneTarget(target),
		retry:  make(chan struct{}, 1),
	}
	m.workers[target.RelayPeerID] = worker
	m.states[target.RelayPeerID] = reservationState{}
	if m.started {
		m.startWorkerLocked(worker)
	}
	return nil
}

func (m *ReservationManager) RemoveTarget(relayPeerID peer.ID) error {
	if m == nil {
		return fmt.Errorf("Relay reservation manager is unavailable")
	}
	m.lock.Lock()
	worker, exists := m.workers[relayPeerID]
	if !exists {
		m.lock.Unlock()
		return fmt.Errorf("Relay target %s does not exist", relayPeerID)
	}
	delete(m.workers, relayPeerID)
	delete(m.states, relayPeerID)
	cancel := worker.cancel
	done := worker.done
	worker.cancel = nil
	worker.done = nil
	m.lock.Unlock()
	if cancel != nil {
		cancel()
	}
	if done != nil {
		<-done
	}
	return nil
}

func (m *ReservationManager) RetryTarget(relayPeerID peer.ID) error {
	if m == nil {
		return fmt.Errorf("Relay reservation manager is unavailable")
	}
	m.lock.RLock()
	worker, exists := m.workers[relayPeerID]
	m.lock.RUnlock()
	if !exists {
		return fmt.Errorf("Relay target %s does not exist", relayPeerID)
	}
	select {
	case worker.retry <- struct{}{}:
	default:
	}
	return nil
}

func (m *ReservationManager) Targets() []Target {
	if m == nil {
		return nil
	}
	m.lock.RLock()
	defer m.lock.RUnlock()
	targets := make([]Target, 0, len(m.workers))
	for _, worker := range m.workers {
		targets = append(targets, cloneTarget(worker.target))
	}
	sort.Slice(targets, func(left, right int) bool {
		return targets[left].RelayPeerID.String() <
			targets[right].RelayPeerID.String()
	})
	return targets
}

func (m *ReservationManager) Snapshots() []ReservationSnapshot {
	if m == nil {
		return nil
	}
	m.lock.RLock()
	defer m.lock.RUnlock()
	snapshots := make([]ReservationSnapshot, 0, len(m.workers))
	for relayPeerID, worker := range m.workers {
		state := m.states[relayPeerID]
		snapshots = append(snapshots, ReservationSnapshot{
			Target:    cloneTarget(worker.target),
			Route:     cloneCircuitRoute(state.route),
			LastError: state.lastError,
		})
	}
	sort.Slice(snapshots, func(left, right int) bool {
		return snapshots[left].Target.RelayPeerID.String() <
			snapshots[right].Target.RelayPeerID.String()
	})
	return snapshots
}

func (m *ReservationManager) startWorkerLocked(worker *reservationWorker) {
	runContext, cancel := context.WithCancel(m.runContext)
	done := make(chan struct{})
	worker.cancel = cancel
	worker.done = done
	go func() {
		defer close(done)
		m.maintain(runContext, worker)
	}()
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
		routes = append(routes, *cloneCircuitRoute(state.route))
	}
	sort.Slice(routes, func(left, right int) bool {
		return routes[left].RelayPeerID.String() <
			routes[right].RelayPeerID.String()
	})
	return routes
}

func (m *ReservationManager) maintain(
	ctx context.Context,
	worker *reservationWorker,
) {
	target := cloneTarget(worker.target)
	backoff := m.config.RetryMin
	for {
		route, err := m.reserve(ctx, target)
		if err == nil {
			m.record(worker, route, nil)
			backoff = m.config.RetryMin
			wait := time.Until(route.ExpiresAt) - m.config.RenewBefore
			if wait > 2*time.Minute {
				wait = 2 * time.Minute
			}
			if wait < time.Second {
				wait = time.Second
			}
			if !waitForContextOrRetry(ctx, worker.retry, wait) {
				return
			}
			continue
		}
		if errors.Is(err, context.Canceled) {
			return
		}
		m.record(worker, nil, err)
		if !waitForContextOrRetry(ctx, worker.retry, backoff) {
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
	circuitAddresses, err := circuitDialMultiaddrs(
		addressInfo,
		valueHost.ID(),
	)
	if err != nil {
		return nil, fmt.Errorf("build Circuit route: %w", err)
	}
	route := &CircuitRoute{
		RelayPeerID:     target.RelayPeerID,
		DialMultiaddrs:  circuitAddresses,
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
	worker *reservationWorker,
	route *CircuitRoute,
	err error,
) {
	m.lock.Lock()
	relayPeerID := worker.target.RelayPeerID
	if m.workers[relayPeerID] != worker {
		m.lock.Unlock()
		return
	}
	state := m.states[relayPeerID]
	if route != nil {
		state.route = cloneCircuitRoute(route)
	} else if state.route != nil && !state.route.ExpiresAt.After(m.now()) {
		state.route = nil
	}
	state.lastError = err
	m.states[relayPeerID] = state
	m.lock.Unlock()
}

func cloneCircuitRoute(route *CircuitRoute) *CircuitRoute {
	if route == nil {
		return nil
	}
	cloned := *route
	cloned.DialMultiaddrs = append(
		[]multiaddr.Multiaddr(nil),
		route.DialMultiaddrs...,
	)
	return &cloned
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

func circuitDialMultiaddrs(
	relay peer.AddrInfo,
	stationPeerID peer.ID,
) ([]multiaddr.Multiaddr, error) {
	if relay.ID == "" || stationPeerID == "" || len(relay.Addrs) == 0 {
		return nil, fmt.Errorf("Relay route identity is incomplete")
	}
	suffix := multiaddr.StringCast(
		fmt.Sprintf(
			"/p2p/%s/p2p-circuit/p2p/%s",
			relay.ID,
			stationPeerID,
		),
	)
	unique := make(map[string]multiaddr.Multiaddr, len(relay.Addrs))
	for _, base := range relay.Addrs {
		if len(base) == 0 {
			return nil, fmt.Errorf("Relay route has an empty dial address")
		}
		address := base.Encapsulate(suffix)
		unique[address.String()] = address
	}
	keys := make([]string, 0, len(unique))
	for key := range unique {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	addresses := make([]multiaddr.Multiaddr, 0, len(keys))
	for _, key := range keys {
		addresses = append(addresses, unique[key])
	}
	return addresses, nil
}

func waitForContextOrRetry(
	ctx context.Context,
	retry <-chan struct{},
	duration time.Duration,
) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-retry:
		return true
	case <-timer.C:
		return true
	}
}
