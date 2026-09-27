package events

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"google.golang.org/protobuf/proto"
)

// Defaults from docs/architecture/realtime/event-stream.md.
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
	// Publish clones ev, stamps the clone with a fresh event_id and
	// current ts_unix_ms, appends it to the actor's ring buffer, and
	// fans out to every live subscriber for actor_ptid. Returns the
	// stamped event_id.
	//
	// Caller fills in ev.Kind (and any payload fields). ev.EventId and
	// ev.TsUnixMs on the caller's struct are NOT mutated — a defensive
	// clone is taken so the caller can re-publish the same logical
	// event to multiple actor streams (e.g. sender + recipient
	// multi-device echo) safely.
	Publish(actorPTID string, ev *realtime.StreamEvent) (string, error)

	// PublishEphemeral stamps and fans out an event only to current live
	// subscribers. It does not persist or enter the replay ring.
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
	send   chan *realtime.StreamEvent
	bus    *eventBus
	state  *actorState
	closed bool
	mu     sync.Mutex
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
		ringSize: DefaultRingBufferSize,
		queueCap: DefaultSubscriberQueue,
		now:      func() time.Time { return time.Now().UTC() },
		idGen:    defaultIDGen(),
	}
	for _, o := range opts {
		o(&cfg)
	}
	return &eventBus{
		cfg:    cfg,
		actors: make(map[string]*actorState),
	}
}

// BusOption configures an EventBus at construction.
type BusOption func(*busConfig)

type busConfig struct {
	ringSize int
	queueCap int
	now      func() time.Time
	idGen    func() string
	store    durableEventStore
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

// ---------------------------------------------------------------------
// concrete eventBus
// ---------------------------------------------------------------------

type eventBus struct {
	cfg busConfig

	mu     sync.RWMutex
	actors map[string]*actorState
	closed bool

	wedgedDrops uint64 // accessed under mu
}

// actorState is the per-actor state tree. All fields are guarded by
// the actor's own mutex; the bus-level mu only guards the actors map
// itself.
type actorState struct {
	mu     sync.Mutex
	buffer []bufferedEvent // oldest first; len <= ringSize
	subs   map[*Subscription]struct{}
}

type bufferedEvent struct {
	ev             *realtime.StreamEvent
	targetDeviceID string
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
	cloned.EventId = b.cfg.idGen()
	cloned.TsUnixMs = b.cfg.now().UnixMilli()

	a := b.getOrCreateActor(actorPTID)
	a.mu.Lock()
	defer a.mu.Unlock()
	subscriberCount := len(a.subs)
	deliveredCount := 0
	for sub := range a.subs {
		select {
		case sub.send <- cloned:
			deliveredCount++
		default:
			b.dropLocked(a, sub)
		}
	}
	// #region debug-point J:typing-ephemeral-subscribers
	if typing := cloned.GetTyping(); typing != nil {
		if payload, err := json.Marshal(map[string]any{"sessionId": "mobile-social-activation", "runId": "typing-pre-fix", "hypothesisId": "J", "location": "apps/station/app/subserver/events/bus.go:PublishEphemeral", "msg": "[DEBUG] Typing event published to live subscribers", "data": map[string]any{"actorPtid": actorPTID, "conversationId": typing.GetSessionUlid(), "fromActorPtid": typing.GetFromActorPtid(), "typing": typing.GetTyping(), "subscriberCount": subscriberCount, "deliveredCount": deliveredCount}, "ts": time.Now().UnixMilli()}); err == nil {
			go func() {
				response, _ := http.Post("http://192.0.2.12:7784/event", "application/json", bytes.NewReader(payload))
				if response != nil {
					_ = response.Body.Close()
				}
			}()
		}
	}
	// #endregion
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

	// Defensive clone: the caller may publish the same logical event
	// to multiple actor buses (e.g. sender + recipient for multi-device
	// echo). Mutating the caller's pointer would corrupt the copy
	// already sitting in another actor's ring buffer / subscriber
	// channels. The clone is cheap (single-message protobuf) compared
	// to the cost of a hard-to-reproduce data race.
	cloned := proto.Clone(ev).(*realtime.StreamEvent)
	cloned.EventId = b.cfg.idGen()
	cloned.TsUnixMs = b.cfg.now().UnixMilli()
	ev = cloned

	a := b.getOrCreateActor(actorPTID)
	a.mu.Lock()
	defer a.mu.Unlock()

	if b.cfg.store != nil {
		if err := b.cfg.store.Persist(actorPTID, ev); err != nil {
			return "", err
		}
	}

	// Append to ring buffer.
	a.buffer = append(a.buffer, bufferedEvent{ev: ev, targetDeviceID: targetDeviceID})
	if len(a.buffer) > b.cfg.ringSize {
		// Drop oldest in-place to bound allocation churn under hot fan-out.
		copy(a.buffer, a.buffer[1:])
		a.buffer = a.buffer[:b.cfg.ringSize]
	}

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
	replay, err := b.replayLocked(a, actorPTID, deviceID, cursor)
	if err != nil {
		a.mu.Unlock()
		return nil, nil, err
	}

	queueCap := b.cfg.queueCap
	if len(replay) > queueCap {
		queueCap = len(replay)
	}

	sub := &Subscription{
		ActorPTID: actorPTID,
		DeviceID:  deviceID,
		send:      make(chan *realtime.StreamEvent, queueCap),
		bus:       b,
		state:     a,
	}
	sub.Events = sub.send

	for _, ev := range replay {
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
func (b *eventBus) replayLocked(a *actorState, actorPTID, deviceID, cursor string) ([]*realtime.StreamEvent, error) {
	if cursor == "" {
		return nil, nil
	}
	if b.cfg.store != nil {
		newest, ok, err := b.cfg.store.NewestEventID(actorPTID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return []*realtime.StreamEvent{newResync("", "durable log empty", b)}, nil
		}
		if cursor == newest {
			return nil, nil
		}
		if cursor > newest {
			return []*realtime.StreamEvent{newResync(newest, "cursor newer than durable log", b)}, nil
		}
		events, err := b.cfg.store.ReplayAfter(actorPTID, cursor, 0)
		if err != nil {
			return nil, err
		}
		if len(events) == 0 {
			return []*realtime.StreamEvent{newResync(newest, "cursor not found in durable log", b)}, nil
		}
		return events, nil
	}
	if len(a.buffer) == 0 {
		return []*realtime.StreamEvent{newResync("", "buffer empty (process restart?)", b)}, nil
	}
	newest := a.buffer[len(a.buffer)-1].ev.EventId
	oldest := a.buffer[0].ev.EventId

	if cursor == newest {
		return nil, nil
	}
	if cursor > newest {
		// Client claims to have seen events newer than anything we hold —
		// this happens after process restart wiped the buffer. Force a
		// cold catch-up.
		return []*realtime.StreamEvent{newResync(newest, "cursor newer than buffer (process restart?)", b)}, nil
	}
	if cursor < oldest {
		return []*realtime.StreamEvent{newResync(newest, "cursor evicted from ring buffer", b)}, nil
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
		return nil, nil
	}
	out := make([]*realtime.StreamEvent, 0, len(a.buffer)-idx)
	for _, item := range a.buffer[idx:] {
		if item.targetDeviceID != "" && item.targetDeviceID != deviceID {
			continue
		}
		out = append(out, item.ev)
	}
	return out, nil
}

func newResync(newestEventID, reason string, b *eventBus) *realtime.StreamEvent {
	return &realtime.StreamEvent{
		EventId:  b.cfg.idGen(),
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
	defer b.mu.RUnlock()

	out := Stats{
		ActiveActors: len(b.actors),
		WedgedDrops:  b.wedgedDrops,
	}
	for _, a := range b.actors {
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
