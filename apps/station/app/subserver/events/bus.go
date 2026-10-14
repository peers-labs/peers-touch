package events

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

// Defaults from docs/architecture/shared/communication/event-stream.md.
//
// Operators may override per Station via subserver options (future
// work); the defaults below are deliberately the values quoted in
// the contract so behaviour is predictable out of the box.
const (
	// DefaultRingBufferSize is the per-actor in-memory ring buffer
	// length. When a reconnecting client's cursor falls outside this
	// window the bus emits a Resync event (§2.5 case-2).
	DefaultRingBufferSize = 1024

	// DefaultSubscriberQueue is the per-subscriber in-memory channel
	// capacity. A subscriber whose queue stays full at Publish time is
	// considered wedged and gets dropped per §2.6.
	DefaultSubscriberQueue = 64

	// DefaultReconcileBatch bounds one durable-log reconciliation pass. A
	// subscriber farther behind remains eligible for the next wake or periodic
	// pass instead of monopolizing the events worker.
	DefaultReconcileBatch = 512
)

// ErrBusClosed is returned by Publish/Subscribe after Close has run.
var ErrBusClosed = errors.New("events: bus closed")

// EventBus is the single fan-out point for every realtime event in
// a Station process. See contract §3.3.
//
// Implementations are safe for concurrent use. There is one EventBus
// per Station; it is exposed to other subservers via package-level
// GetBus().
type EventBus interface {
	// Start begins cross-node wake consumption and bounded missed-wake
	// reconciliation. It is idempotent.
	Start(context.Context) error

	// Publish clones ev, persists it with the next actor sequence and target,
	// then reconciles the committed row into local subscribers. Returns the
	// opaque durable event_id.
	//
	// Caller fills in ev.Kind (and any payload fields). ev.EventId and
	// ev.TsUnixMs on the caller's struct are NOT mutated — a defensive
	// clone is taken so the caller can re-publish the same logical
	// event to multiple actor streams (e.g. sender + recipient
	// multi-device echo) safely.
	Publish(actorPTID string, ev *realtime.StreamEvent) (string, error)

	// PublishInTransaction persists a durable event in the caller's database
	// transaction, then exposes it to live subscribers only after commit.
	PublishInTransaction(
		context.Context,
		delivery.Transaction,
		string,
		*realtime.StreamEvent,
	) (string, error)

	// PublishToDeviceInTransaction is the device-filtered transactional
	// variant. The target is persisted with the payload before the transaction
	// emits its wake hint.
	PublishToDeviceInTransaction(
		context.Context,
		delivery.Transaction,
		string,
		string,
		*realtime.StreamEvent,
	) (string, error)

	// PublishEphemeral timestamps and fans out an event only to current live
	// subscribers. It has no event_id, does not persist, and cannot advance a
	// durable cursor.
	PublishEphemeral(actorPTID string, ev *realtime.StreamEvent) (string, error)

	// PublishToDevice is the per-device variant of Publish. It stamps and
	// buffers the event on the actor stream, but live fan-out and cursor
	// replay are restricted to subscribers whose DeviceID matches deviceID.
	PublishToDevice(actorPTID, deviceID string, ev *realtime.StreamEvent) (string, error)

	// Subscribe registers a new realtime stream subscriber. cursor is
	// the client's Last-Event-ID; pass empty string for first connect.
	//
	// On return:
	//   - sub.Events delivers live events plus replay (or a single
	//     Resync) before any live event.
	//   - cancel must be called by the caller when the SSE handler exits
	//     so the subscriber is unregistered and its channel is closed.
	Subscribe(ctx context.Context, actorPTID, deviceID, cursor string) (*Subscription, context.CancelFunc, error)

	// Stats returns operator-facing counters.
	Stats() Stats

	// Close tears down all subscribers; subsequent Publish/Subscribe
	// return ErrBusClosed.
	Close()
}

// Subscription is the per-connection handle returned by Subscribe.
type Subscription struct {
	ActorPTID string
	DeviceID  string

	// Events delivers in-order events for the subscriber. Closed when
	// the subscription ends (handler-cancelled or wedged-and-dropped).
	Events <-chan *realtime.StreamEvent

	// internal — set by the bus
	send  chan *realtime.StreamEvent
	bus   *eventBus
	state *actorState
	// durableSequence advances over every scanned durable row, including rows
	// targeted at another device.
	durableSequence uint64
	closed          bool
	mu              sync.Mutex
	floorMu         sync.RWMutex
	floorEventID    string
	pendingFloors   []pendingDurableFloor
}

type pendingDurableFloor struct {
	eventID    string
	floorAfter string
}

// DurableFloorEventID returns the latest durable cursor this subscriber has
// either acknowledged on the SSE socket or safely skipped for this device.
func (s *Subscription) DurableFloorEventID() string {
	s.floorMu.RLock()
	defer s.floorMu.RUnlock()
	return s.floorEventID
}

// AcknowledgeDurableEvent advances the reconnect cursor only after the SSE
// handler has written and flushed the corresponding durable event.
func (s *Subscription) AcknowledgeDurableEvent(eventID string) bool {
	if eventID == "" {
		return false
	}
	s.floorMu.Lock()
	defer s.floorMu.Unlock()
	if len(s.pendingFloors) == 0 ||
		s.pendingFloors[0].eventID != eventID {
		return false
	}
	s.floorEventID = s.pendingFloors[0].floorAfter
	s.pendingFloors = s.pendingFloors[1:]
	return true
}

func (s *Subscription) queueDurableEvent(
	eventID string,
	floorAfter string,
) {
	s.floorMu.Lock()
	s.pendingFloors = append(s.pendingFloors, pendingDurableFloor{
		eventID:    eventID,
		floorAfter: floorAfter,
	})
	s.floorMu.Unlock()
}

func (s *Subscription) discardDurableEvent(eventID string) {
	s.floorMu.Lock()
	defer s.floorMu.Unlock()
	for index := len(s.pendingFloors) - 1; index >= 0; index-- {
		if s.pendingFloors[index].eventID == eventID {
			s.pendingFloors = append(
				s.pendingFloors[:index],
				s.pendingFloors[index+1:]...,
			)
			return
		}
	}
}

func (s *Subscription) advanceDurableFloor(eventID string) {
	if eventID == "" {
		return
	}
	s.floorMu.Lock()
	defer s.floorMu.Unlock()
	if len(s.pendingFloors) == 0 {
		s.floorEventID = eventID
		return
	}
	s.pendingFloors[len(s.pendingFloors)-1].floorAfter = eventID
}

// Stats is the snapshot returned by EventBus.Stats.
type Stats struct {
	ActiveActors      int
	ActiveSubscribers int
	BufferedEvents    int
	WedgedDrops       uint64
}

// NewEventBus constructs an in-memory bus with default sizing.
//
// For tests or per-Station tuning, pass options:
//
//	NewEventBus(WithRingBufferSize(2048), WithClock(myClock))
func NewEventBus(opts ...BusOption) EventBus {
	cfg := busConfig{
		ringSize:          DefaultRingBufferSize,
		queueCap:          DefaultSubscriberQueue,
		reconcileBatch:    DefaultReconcileBatch,
		reconcileInterval: defaultReconcileInterval,
		now:               func() time.Time { return time.Now().UTC() },
		idGen:             defaultIDGen(),
	}
	for _, o := range opts {
		o(&cfg)
	}
	return &eventBus{
		cfg:    cfg,
		actors: make(map[string]*actorState),
	}
}

func NewDurableEventBus(database *gorm.DB, opts ...BusOption) (EventBus, error) {
	if database == nil {
		return nil, fmt.Errorf("events: database is required")
	}
	store := newGormEventStore(database)
	if err := store.AutoMigrate(); err != nil {
		return nil, err
	}
	wakeReceiver, err := newPostgresWakeReceiver(database)
	if err != nil {
		return nil, err
	}
	return NewEventBus(
		append(
			opts,
			WithDurableStore(store),
			withWakeReceiver(wakeReceiver),
		)...,
	), nil
}

// BusOption configures an EventBus at construction.
type BusOption func(*busConfig)

type busConfig struct {
	ringSize          int
	queueCap          int
	reconcileBatch    int
	reconcileInterval time.Duration
	now               func() time.Time
	idGen             func() string
	store             durableEventStore
	wakeEmitter       durableWakeEmitter
	wakeReceiver      durableWakeReceiver
}

// WithRingBufferSize overrides DefaultRingBufferSize for this bus.
func WithRingBufferSize(n int) BusOption {
	return func(c *busConfig) {
		if n > 0 {
			c.ringSize = n
		}
	}
}

// WithSubscriberQueue overrides DefaultSubscriberQueue for this bus.
func WithSubscriberQueue(n int) BusOption {
	return func(c *busConfig) {
		if n > 0 {
			c.queueCap = n
		}
	}
}

// WithClock injects a deterministic clock; tests use this to assert
// ts_unix_ms values without flakiness.
func WithClock(now func() time.Time) BusOption {
	return func(c *busConfig) {
		if now != nil {
			c.now = now
		}
	}
}

// WithIDGenerator injects a deterministic id generator; tests use
// this to keep event_id strings stable.
func WithIDGenerator(gen func() string) BusOption {
	return func(c *busConfig) {
		if gen != nil {
			c.idGen = gen
		}
	}
}

// WithDurableStore makes the bus persist every stamped event before fan-out and
// replay reconnects from that durable log. Without it, the bus stays memory-only
// and is suitable only for unit tests.
func WithDurableStore(store durableEventStore) BusOption {
	return func(c *busConfig) {
		c.store = store
	}
}

func withWakeEmitter(emitter durableWakeEmitter) BusOption {
	return func(c *busConfig) {
		c.wakeEmitter = emitter
	}
}

func withWakeReceiver(receiver durableWakeReceiver) BusOption {
	return func(c *busConfig) {
		c.wakeReceiver = receiver
	}
}

func withReconcileInterval(interval time.Duration) BusOption {
	return func(c *busConfig) {
		if interval > 0 {
			c.reconcileInterval = interval
		}
	}
}

func defaultIDGen() func() string {
	var mu sync.Mutex
	entropy := ulid.Monotonic(rand.Reader, 0)
	return func() string {
		mu.Lock()
		defer mu.Unlock()
		ts := ulid.Timestamp(time.Now())
		id, err := ulid.New(ts, entropy)
		if err != nil {
			// In the catastrophic case of monotonic entropy overflow
			// within the same millisecond we fall back to a brand-new
			// entropy source. This still keeps event_id unique per
			// process; clients treat it as opaque so monotonicity gaps
			// only matter for the pathological burst window itself.
			entropy = ulid.Monotonic(rand.Reader, 0)
			id = ulid.MustNew(ts, entropy)
		}
		return id.String()
	}
}

func (b *eventBus) Start(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		return ErrBusClosed
	}
	if b.started {
		b.mu.Unlock()
		return nil
	}
	runContext, cancel := context.WithCancel(context.Background())
	b.started = true
	b.cancel = cancel
	b.mu.Unlock()

	if b.cfg.store != nil {
		b.done.Add(1)
		go func() {
			defer b.done.Done()
			b.runReconciler(runContext)
		}()
	}
	if b.cfg.wakeReceiver != nil {
		b.done.Add(1)
		go func() {
			defer b.done.Done()
			b.runWakeReceiver(runContext)
		}()
	}
	if ready, ok := b.cfg.wakeReceiver.(readyDurableWakeReceiver); ok {
		readyContext, cancelReady := context.WithTimeout(
			ctx,
			wakeStartTimeout,
		)
		err := ready.WaitReady(readyContext)
		cancelReady()
		if err != nil {
			cancel()
			b.done.Wait()
			b.mu.Lock()
			b.started = false
			b.cancel = nil
			b.mu.Unlock()
			return fmt.Errorf(
				"events: durable wake listener did not become ready: %w",
				err,
			)
		}
	}
	return nil
}

func (b *eventBus) runReconciler(ctx context.Context) {
	ticker := time.NewTicker(b.cfg.reconcileInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			for _, actorPTID := range b.subscribedActors() {
				if err := b.reconcileActor(actorPTID, 0); err != nil &&
					!errors.Is(err, ErrBusClosed) {
					logger.DefaultHelper.Warnf(
						"events: durable reconciliation failed actor_ptid=%s: %v",
						actorPTID,
						err,
					)
				}
			}
		}
	}
}

func (b *eventBus) runWakeReceiver(ctx context.Context) {
	for {
		err := b.cfg.wakeReceiver.Run(
			ctx,
			func(hint durableWakeHint) {
				_ = b.reconcileActor(hint.ActorPTID, hint.Sequence)
			},
		)
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			logger.DefaultHelper.Warnf(
				"events: durable wake listener restarting: %v",
				err,
			)
		}
		timer := time.NewTimer(wakeReconnectDelay)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return
		case <-timer.C:
		}
	}
}

func (b *eventBus) subscribedActors() []string {
	b.mu.RLock()
	states := make(map[string]*actorState, len(b.actors))
	for actorPTID, state := range b.actors {
		states[actorPTID] = state
	}
	b.mu.RUnlock()

	actors := make([]string, 0, len(states))
	for actorPTID, state := range states {
		state.mu.Lock()
		hasSubscribers := len(state.subs) > 0
		state.mu.Unlock()
		if hasSubscribers {
			actors = append(actors, actorPTID)
		}
	}
	return actors
}

// ---------------------------------------------------------------------
// concrete eventBus
// ---------------------------------------------------------------------

type eventBus struct {
	cfg busConfig

	mu      sync.RWMutex
	actors  map[string]*actorState
	closed  bool
	started bool
	cancel  context.CancelFunc
	done    sync.WaitGroup

	wedgedDrops uint64 // accessed under mu
}

// actorState is the per-actor state tree. All fields are guarded by
// the actor's own mutex; the bus-level mu only guards the actors map
// itself.
type actorState struct {
	mu              sync.Mutex
	buffer          []bufferedEvent // oldest first; len <= ringSize
	scannedSequence uint64
	subs            map[*Subscription]struct{}
}

type bufferedEvent struct {
	ev             *realtime.StreamEvent
	targetDeviceID string
	sequence       uint64
}

func (b *eventBus) getOrCreateActor(actorPTID string) *actorState {
	b.mu.RLock()
	if a, ok := b.actors[actorPTID]; ok {
		b.mu.RUnlock()
		return a
	}
	b.mu.RUnlock()

	b.mu.Lock()
	defer b.mu.Unlock()
	if a, ok := b.actors[actorPTID]; ok {
		return a
	}
	a := &actorState{
		subs: make(map[*Subscription]struct{}),
	}
	b.actors[actorPTID] = a
	return a
}

// Publish — see EventBus.
func (b *eventBus) Publish(actorPTID string, ev *realtime.StreamEvent) (string, error) {
	return b.publish(actorPTID, "", ev)
}

func (b *eventBus) PublishInTransaction(
	ctx context.Context,
	transaction delivery.Transaction,
	actorPTID string,
	ev *realtime.StreamEvent,
) (string, error) {
	return b.publishInTransaction(ctx, transaction, actorPTID, "", ev)
}

func (b *eventBus) PublishToDeviceInTransaction(
	ctx context.Context,
	transaction delivery.Transaction,
	actorPTID string,
	deviceID string,
	ev *realtime.StreamEvent,
) (string, error) {
	if deviceID == "" {
		return "", fmt.Errorf("events: empty deviceID")
	}
	return b.publishInTransaction(
		ctx,
		transaction,
		actorPTID,
		deviceID,
		ev,
	)
}

func (b *eventBus) publishInTransaction(
	ctx context.Context,
	transaction delivery.Transaction,
	actorPTID string,
	targetDeviceID string,
	ev *realtime.StreamEvent,
) (string, error) {
	if transaction == nil || transaction.DB() == nil {
		return "", fmt.Errorf("events: transaction is required")
	}
	registrar, ok := transaction.(delivery.AfterCommitRegistrar)
	if !ok {
		return "", fmt.Errorf("events: transaction cannot register post-commit fan-out")
	}
	if actorPTID == "" {
		return "", fmt.Errorf("events: empty actorPTID")
	}
	if ev == nil {
		return "", fmt.Errorf("events: nil event")
	}

	b.mu.RLock()
	closed := b.closed
	b.mu.RUnlock()
	if closed {
		return "", ErrBusClosed
	}

	stamped := b.stampDurable(ev)
	store, ok := b.cfg.store.(transactionalDurableEventStore)
	if !ok {
		return "", fmt.Errorf(
			"events: durable transactional store is unavailable",
		)
	}
	stored, err := store.PersistInTransaction(
		ctx,
		transaction.DB(),
		actorPTID,
		targetDeviceID,
		stamped,
	)
	if err != nil {
		return "", err
	}
	if err := registrar.AfterCommit(func(context.Context) error {
		b.emitWake(actorPTID, stored.Sequence)
		if err := b.reconcileActor(
			actorPTID,
			stored.Sequence,
		); err != nil && !errors.Is(err, ErrBusClosed) {
			logger.DefaultHelper.Warnf(
				"events: transactional event awaits reconciliation actor_ptid=%s sequence=%d: %v",
				actorPTID,
				stored.Sequence,
				err,
			)
		}
		return nil
	}); err != nil {
		return "", err
	}
	return stored.Event.GetEventId(), nil
}

func (b *eventBus) PublishEphemeral(
	actorPTID string,
	ev *realtime.StreamEvent,
) (string, error) {
	if actorPTID == "" {
		return "", fmt.Errorf("events: empty actorPTID")
	}
	if ev == nil {
		return "", fmt.Errorf("events: nil event")
	}
	b.mu.RLock()
	if b.closed {
		b.mu.RUnlock()
		return "", ErrBusClosed
	}
	b.mu.RUnlock()

	cloned := proto.Clone(ev).(*realtime.StreamEvent)
	// Ephemeral events deliberately have no SSE id. They can never become a
	// Last-Event-ID cursor or move the durable heartbeat floor.
	cloned.EventId = ""
	cloned.TsUnixMs = b.cfg.now().UnixMilli()

	a := b.getOrCreateActor(actorPTID)
	a.mu.Lock()
	defer a.mu.Unlock()
	for sub := range a.subs {
		select {
		case sub.send <- cloned:
		default:
			b.dropLocked(a, sub)
		}
	}
	return cloned.EventId, nil
}

// PublishToDevice — see EventBus.
func (b *eventBus) PublishToDevice(actorPTID, deviceID string, ev *realtime.StreamEvent) (string, error) {
	if deviceID == "" {
		return "", fmt.Errorf("events: empty deviceID")
	}
	return b.publish(actorPTID, deviceID, ev)
}

func (b *eventBus) publish(actorPTID, targetDeviceID string, ev *realtime.StreamEvent) (string, error) {
	if actorPTID == "" {
		return "", fmt.Errorf("events: empty actorPTID")
	}
	if ev == nil {
		return "", fmt.Errorf("events: nil event")
	}

	b.mu.RLock()
	if b.closed {
		b.mu.RUnlock()
		return "", ErrBusClosed
	}
	b.mu.RUnlock()

	if b.cfg.store == nil {
		return b.publishMemory(
			actorPTID,
			targetDeviceID,
			b.stampMemory(ev),
		)
	}
	stored, err := b.cfg.store.Persist(
		actorPTID,
		targetDeviceID,
		b.stampDurable(ev),
	)
	if err != nil {
		return "", err
	}
	b.getOrCreateActor(actorPTID)
	b.emitWake(actorPTID, stored.Sequence)
	if err := b.reconcileActor(actorPTID, stored.Sequence); err != nil &&
		!errors.Is(err, ErrBusClosed) {
		logger.DefaultHelper.Warnf(
			"events: committed event awaits reconciliation actor_ptid=%s sequence=%d: %v",
			actorPTID,
			stored.Sequence,
			err,
		)
	}
	return stored.Event.GetEventId(), nil
}

func (b *eventBus) stampMemory(ev *realtime.StreamEvent) *realtime.StreamEvent {
	cloned := proto.Clone(ev).(*realtime.StreamEvent)
	cloned.EventId = b.cfg.idGen()
	cloned.TsUnixMs = b.cfg.now().UnixMilli()
	return cloned
}

func (b *eventBus) stampDurable(
	ev *realtime.StreamEvent,
) *realtime.StreamEvent {
	cloned := proto.Clone(ev).(*realtime.StreamEvent)
	cloned.EventId = ""
	cloned.TsUnixMs = b.cfg.now().UnixMilli()
	return cloned
}

func (b *eventBus) emitWake(actorPTID string, sequence uint64) {
	if b.cfg.wakeEmitter == nil || actorPTID == "" || sequence == 0 {
		return
	}
	b.cfg.wakeEmitter.Emit(durableWakeHint{
		ActorPTID: actorPTID,
		Sequence:  sequence,
	})
}

func (b *eventBus) publishMemory(
	actorPTID string,
	targetDeviceID string,
	ev *realtime.StreamEvent,
) (string, error) {
	b.mu.RLock()
	if b.closed {
		b.mu.RUnlock()
		return "", ErrBusClosed
	}
	b.mu.RUnlock()

	a := b.getOrCreateActor(actorPTID)
	a.mu.Lock()
	defer a.mu.Unlock()

	b.appendBufferedLocked(a, durableEventRecord{
		TargetDeviceID: targetDeviceID,
		Event:          ev,
	})

	// Fan out non-blocking. A wedged subscriber gets dropped per §2.6.
	for sub := range a.subs {
		if targetDeviceID != "" && sub.DeviceID != targetDeviceID {
			continue
		}
		select {
		case sub.send <- ev:
		default:
			// Channel full — subscriber is wedged. Close it so the SSE
			// handler exits its loop and the client reconnects (and, on
			// reconnect, will likely receive a Resync since its cursor
			// fell behind).
			b.dropLocked(a, sub)
		}
	}

	return ev.EventId, nil
}

func (b *eventBus) appendBufferedLocked(
	state *actorState,
	record durableEventRecord,
) {
	state.buffer = append(state.buffer, bufferedEvent{
		ev:             record.Event,
		targetDeviceID: record.TargetDeviceID,
		sequence:       record.Sequence,
	})
	if len(state.buffer) > b.cfg.ringSize {
		copy(state.buffer, state.buffer[1:])
		state.buffer = state.buffer[:b.cfg.ringSize]
	}
	if record.Sequence > state.scannedSequence {
		state.scannedSequence = record.Sequence
	}
}

// dropLocked closes a subscriber's channel and removes it from the
// actor state. Caller must hold a.mu.
func (b *eventBus) dropLocked(a *actorState, sub *Subscription) {
	if _, ok := a.subs[sub]; !ok {
		return
	}
	delete(a.subs, sub)

	sub.mu.Lock()
	if !sub.closed {
		sub.closed = true
		close(sub.send)
	}
	sub.mu.Unlock()

	b.mu.Lock()
	b.wedgedDrops++
	b.mu.Unlock()
}

// Subscribe — see EventBus.
func (b *eventBus) Subscribe(ctx context.Context, actorPTID, deviceID, cursor string) (*Subscription, context.CancelFunc, error) {
	if actorPTID == "" {
		return nil, nil, fmt.Errorf("events: empty actorPTID")
	}

	b.mu.RLock()
	if b.closed {
		b.mu.RUnlock()
		return nil, nil, ErrBusClosed
	}
	b.mu.RUnlock()

	a := b.getOrCreateActor(actorPTID)

	a.mu.Lock()
	// Replay (or Resync sentinel) BEFORE registering for live fan-out.
	// This preserves ordering: every event the subscriber sees came
	// either from replay (with eventId <= newest at subscribe time) or
	// from live publish (with eventId strictly after).
	replay, throughSequence, floorEventID, err := b.replayLocked(
		a,
		actorPTID,
		deviceID,
		cursor,
	)
	if err != nil {
		a.mu.Unlock()
		return nil, nil, err
	}

	queueCap := b.cfg.queueCap
	if len(replay) > queueCap {
		queueCap = len(replay)
	}
	initialFloorEventID := floorEventID
	if b.cfg.store != nil && len(replay) > 0 {
		initialFloorEventID = cursor
		if replay[0].GetResync() != nil {
			initialFloorEventID = ""
		}
	}

	sub := &Subscription{
		ActorPTID:       actorPTID,
		DeviceID:        deviceID,
		send:            make(chan *realtime.StreamEvent, queueCap),
		bus:             b,
		state:           a,
		durableSequence: throughSequence,
		floorEventID:    initialFloorEventID,
	}
	sub.Events = sub.send

	for index, ev := range replay {
		if b.cfg.store != nil {
			floorAfter := ev.GetEventId()
			if index == len(replay)-1 {
				floorAfter = floorEventID
			}
			sub.queueDurableEvent(ev.GetEventId(), floorAfter)
		}
		sub.send <- ev
	}
	a.subs[sub] = struct{}{}
	a.mu.Unlock()

	cancel := func() {
		a.mu.Lock()
		b.dropLocked(a, sub)
		a.mu.Unlock()
	}

	// Honour the caller's context: if it cancels, drop the subscription.
	go func() {
		<-ctx.Done()
		cancel()
	}()

	return sub, cancel, nil
}

// replayLocked builds the replay slice for `cursor` against the
// actor's current ring buffer. Caller must hold a.mu.
//
// Behaviour matches contract §2.5:
//   - cursor == "": no replay (first connect path).
//   - cursor strictly older than newest: replay (cursor, newest].
//   - cursor outside buffer (older than buffer[0] or unrecognized):
//     emit a single Resync sentinel; client must cold catch up.
//   - cursor matches the newest event: no replay.
//   - cursor at-or-after newest (e.g. process restart):
//     emit a single Resync sentinel.
func (b *eventBus) replayLocked(
	a *actorState,
	actorPTID string,
	deviceID string,
	cursor string,
) ([]*realtime.StreamEvent, uint64, string, error) {
	if b.cfg.store != nil {
		head, ok, err := b.cfg.store.Head(actorPTID)
		if err != nil {
			return nil, 0, "", err
		}
		if !ok {
			if cursor == "" {
				return nil, 0, "", nil
			}
			return []*realtime.StreamEvent{
				newResync("", "durable log empty", b),
			}, 0, "", nil
		}
		if cursor == "" {
			a.scannedSequence = max(
				a.scannedSequence,
				head.Sequence,
			)
			return nil, head.Sequence, head.EventID, nil
		}
		cursorSequence, found, err := b.cfg.store.CursorSequence(
			actorPTID,
			cursor,
		)
		if err != nil {
			return nil, 0, "", err
		}
		if !found || cursorSequence > head.Sequence {
			return []*realtime.StreamEvent{
				newResync(
					head.EventID,
					"cursor not retained in durable log",
					b,
				),
			}, head.Sequence, head.EventID, nil
		}
		if cursorSequence == head.Sequence {
			return nil, head.Sequence, head.EventID, nil
		}
		records, err := b.cfg.store.ReplayRange(
			actorPTID,
			cursorSequence,
			head.Sequence,
			0,
		)
		if err != nil {
			return nil, 0, "", err
		}
		if !contiguousDurableRange(
			records,
			cursorSequence+1,
			head.Sequence,
		) {
			return []*realtime.StreamEvent{
				newResync(
					head.EventID,
					"durable log retention gap",
					b,
				),
			}, head.Sequence, head.EventID, nil
		}
		replay := make([]*realtime.StreamEvent, 0, len(records))
		for _, record := range records {
			if record.Sequence > a.scannedSequence {
				b.appendBufferedLocked(a, record)
			}
			if record.TargetDeviceID != "" &&
				record.TargetDeviceID != deviceID {
				continue
			}
			replay = append(replay, record.Event)
		}
		a.scannedSequence = max(a.scannedSequence, head.Sequence)
		return replay, head.Sequence, head.EventID, nil
	}
	if cursor == "" {
		return nil, 0, "", nil
	}
	if len(a.buffer) == 0 {
		return []*realtime.StreamEvent{
			newResync("", "buffer empty (process restart?)", b),
		}, 0, "", nil
	}
	newest := a.buffer[len(a.buffer)-1].ev.EventId
	oldest := a.buffer[0].ev.EventId

	if cursor == newest {
		return nil, 0, "", nil
	}
	if cursor > newest {
		// Client claims to have seen events newer than anything we hold —
		// this happens after process restart wiped the buffer. Force a
		// cold catch-up.
		return []*realtime.StreamEvent{
			newResync(
				newest,
				"cursor newer than buffer (process restart?)",
				b,
			),
		}, 0, "", nil
	}
	if cursor < oldest {
		return []*realtime.StreamEvent{
			newResync(newest, "cursor evicted from ring buffer", b),
		}, 0, "", nil
	}

	// Binary-search for the cursor inside the buffer; replay strictly
	// after it. If the cursor isn't an exact match (cursor was a real
	// event but the buffer evicted it while still holding newer ones),
	// the search returns the insertion index which is exactly what we
	// want for "replay everything after this".
	idx := sort.Search(len(a.buffer), func(i int) bool {
		return a.buffer[i].ev.EventId > cursor
	})
	if idx >= len(a.buffer) {
		return nil, 0, "", nil
	}
	out := make([]*realtime.StreamEvent, 0, len(a.buffer)-idx)
	for _, item := range a.buffer[idx:] {
		if item.targetDeviceID != "" && item.targetDeviceID != deviceID {
			continue
		}
		out = append(out, item.ev)
	}
	return out, 0, "", nil
}

func contiguousDurableRange(
	records []durableEventRecord,
	first uint64,
	last uint64,
) bool {
	if first > last {
		return len(records) == 0
	}
	if uint64(len(records)) != last-first+1 {
		return false
	}
	for index, record := range records {
		if record.Sequence != first+uint64(index) {
			return false
		}
	}
	return true
}

func (b *eventBus) reconcileActor(
	actorPTID string,
	hintedSequence uint64,
) error {
	if b.cfg.store == nil || actorPTID == "" {
		return nil
	}
	b.mu.RLock()
	if b.closed {
		b.mu.RUnlock()
		return ErrBusClosed
	}
	state := b.actors[actorPTID]
	b.mu.RUnlock()
	if state == nil {
		return nil
	}

	state.mu.Lock()
	defer state.mu.Unlock()

	head, ok, err := b.cfg.store.Head(actorPTID)
	if err != nil {
		return err
	}
	if !ok {
		return nil
	}
	if hintedSequence > head.Sequence {
		return fmt.Errorf(
			"events: wake sequence %d exceeds actor %s head %d",
			hintedSequence,
			actorPTID,
			head.Sequence,
		)
	}

	start := state.scannedSequence
	for sub := range state.subs {
		if sub.durableSequence < start {
			start = sub.durableSequence
		}
	}
	if start >= head.Sequence {
		return nil
	}

	oldest, hasOldest, err := b.cfg.store.OldestSequence(actorPTID)
	if err != nil {
		return err
	}
	if !hasOldest {
		return nil
	}
	for sub := range state.subs {
		if sub.durableSequence+1 >= oldest {
			continue
		}
		resync := newResync(
			head.EventID,
			"durable log retention gap",
			b,
		)
		if !b.sendDurableLocked(
			state,
			sub,
			resync,
			head.EventID,
		) {
			continue
		}
		sub.durableSequence = head.Sequence
	}

	start = state.scannedSequence
	for sub := range state.subs {
		if sub.durableSequence < start {
			start = sub.durableSequence
		}
	}
	if start >= head.Sequence {
		return nil
	}
	through := head.Sequence
	if remaining := through - start; remaining > uint64(b.cfg.reconcileBatch) {
		through = start + uint64(b.cfg.reconcileBatch)
	}
	records, err := b.cfg.store.ReplayRange(
		actorPTID,
		start,
		through,
		b.cfg.reconcileBatch,
	)
	if err != nil {
		return err
	}
	if !contiguousDurableRange(records, start+1, through) {
		for sub := range state.subs {
			if sub.durableSequence >= through {
				continue
			}
			resync := newResync(
				head.EventID,
				"durable log sequence gap",
				b,
			)
			if b.sendDurableLocked(
				state,
				sub,
				resync,
				head.EventID,
			) {
				sub.durableSequence = head.Sequence
			}
		}
		state.scannedSequence = max(
			state.scannedSequence,
			head.Sequence,
		)
		return nil
	}

	for _, record := range records {
		if record.Sequence > state.scannedSequence {
			b.appendBufferedLocked(state, record)
		}
		for sub := range state.subs {
			if sub.durableSequence >= record.Sequence {
				continue
			}
			if record.TargetDeviceID == "" ||
				record.TargetDeviceID == sub.DeviceID {
				if !b.sendDurableLocked(
					state,
					sub,
					record.Event,
					record.Event.GetEventId(),
				) {
					continue
				}
			}
			sub.durableSequence = record.Sequence
			sub.advanceDurableFloor(record.Event.GetEventId())
		}
	}
	state.scannedSequence = max(state.scannedSequence, through)
	return nil
}

func (b *eventBus) sendDurableLocked(
	state *actorState,
	sub *Subscription,
	event *realtime.StreamEvent,
	floorAfter string,
) bool {
	eventID := event.GetEventId()
	sub.queueDurableEvent(eventID, floorAfter)
	if b.sendLocked(state, sub, event) {
		return true
	}
	sub.discardDurableEvent(eventID)
	return false
}

func (b *eventBus) sendLocked(
	state *actorState,
	sub *Subscription,
	event *realtime.StreamEvent,
) bool {
	if _, exists := state.subs[sub]; !exists {
		return false
	}
	select {
	case sub.send <- event:
		return true
	default:
		b.dropLocked(state, sub)
		return false
	}
}

func newResync(newestEventID, reason string, b *eventBus) *realtime.StreamEvent {
	return &realtime.StreamEvent{
		// Resync advances the SSE cursor directly to the durable head. Creating
		// a process-local id here would strand the next reconnect outside the
		// authoritative log.
		EventId:  newestEventID,
		TsUnixMs: b.cfg.now().UnixMilli(),
		Kind: &realtime.StreamEvent_Resync{
			Resync: &realtime.Resync{
				NewestEventId: newestEventID,
				Reason:        reason,
			},
		},
	}
}

// Stats — see EventBus.
func (b *eventBus) Stats() Stats {
	b.mu.RLock()
	out := Stats{
		ActiveActors: len(b.actors),
		WedgedDrops:  b.wedgedDrops,
	}
	actors := make([]*actorState, 0, len(b.actors))
	for _, state := range b.actors {
		actors = append(actors, state)
	}
	b.mu.RUnlock()

	for _, a := range actors {
		a.mu.Lock()
		out.ActiveSubscribers += len(a.subs)
		out.BufferedEvents += len(a.buffer)
		a.mu.Unlock()
	}
	return out
}

// Close — see EventBus.
func (b *eventBus) Close() {
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		return
	}
	b.closed = true
	cancel := b.cancel
	b.cancel = nil
	b.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	b.done.Wait()

	b.mu.Lock()
	actors := b.actors
	b.actors = make(map[string]*actorState)
	b.mu.Unlock()

	for _, a := range actors {
		a.mu.Lock()
		for sub := range a.subs {
			delete(a.subs, sub)
			sub.mu.Lock()
			if !sub.closed {
				sub.closed = true
				close(sub.send)
			}
			sub.mu.Unlock()
		}
		a.buffer = nil
		a.mu.Unlock()
	}
}
