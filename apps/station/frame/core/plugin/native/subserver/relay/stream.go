package relay

// 2026-04-07: Major rewrite — introduced frame dispatcher model.
//
// Old model: streamEntry was a passive conn wrapper; handleForward directly
// called ReadFrame on the conn in parallel with handleIncomingFrames → race.
//
// New model: each streamEntry owns a readLoop goroutine (the ONLY reader on
// the conn). Incoming frames are dispatched by type:
//   - Response → routed to pending[reqID] channel (wakes up the Forward caller)
//   - Ping     → immediately replies Pong via writeMu
//   - Pong     → updates lastPong timestamp (used by liveness check)
//   - Others   → logged and dropped
//
// All writes go through writeMu. Forward callers use SendRequest() which
// registers a pending channel, writes the request frame, and selects on the
// channel with context cancellation.

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sync"
	"sync/atomic"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/protocol"
)

// ---- Sentinel errors ----

var (
	ErrStreamClosed       = errors.New("stream closed")
	ErrStreamDisconnected = errors.New("stream disconnected while waiting for response")
	ErrRequestCancelled   = errors.New("request cancelled by target station")
	ErrRequestIDExhausted = errors.New("request ID sequence exhausted")
	ErrTooManyConcurrent  = errors.New("too many concurrent requests")
)

// StatusCallback is invoked when a stream goes online/offline.
type StatusCallback func(ctx context.Context, peerID string, online bool)

// BroadcastCallback is invoked by the readLoop when a station
// publishes a Broadcast frame on its stream. The relay (StreamManager)
// uses this hook to fan the event out to all OTHER connected streams,
// stamped with the authenticated `originPeerID`.
//
// The dispatcher invokes this callback in a fresh goroutine (see
// readLoop's BroadcastFrame case), so the callback MAY perform
// blocking work; it must NOT, however, write to the *publisher's*
// stream (e.peerID) from inside the callback because that would
// require the same writeMu the readLoop's pong path also uses.
// Callbacks must also tolerate being invoked rapidly — there's no
// rate-limiting in the codec layer.
type BroadcastCallback func(ctx context.Context, originPeerID, topic string, body []byte)

type pendingState uint8

const (
	pendingActive pendingState = iota
	pendingDraining
)

type pendingResult struct {
	response *protocol.ResponseFrame
	err      error
}

// pendingRequest is a slot in the response dispatch table. Draining requests
// remain registered and retain semaphore admission until a terminal frame.
type pendingRequest struct {
	ch                   chan pendingResult
	responsePayloadLimit uint32
	privateObjectLog     protocol.RouteLogContext
	state                pendingState
	drainTimer           *time.Timer
}

// streamEntry represents a live TCP connection to a station.
// It owns its readLoop goroutine and serialises all writes via writeMu.
type streamEntry struct {
	peerID    string
	conn      net.Conn
	mountedAt time.Time

	// writeMu serialises ALL writes to conn (request frames, pong, ping).
	writeMu sync.Mutex

	// pending maps reqID → response channel. Protected by pendingMu.
	pendingMu sync.Mutex
	pending   map[uint32]*pendingRequest
	// lastPrivateObjectLog is a bounded stream-lifetime privacy marker. It
	// keeps disconnect and late-terminal logs redacted after the pending slot
	// has been removed.
	lastPrivateObjectLog protocol.RouteLogContext

	// Request IDs are a nonzero monotonic sequence scoped to this TCP stream.
	// retiring stops admission once the sequence reaches its final value.
	nextRequestID uint32
	retiring      bool

	// semaphore limits per-station concurrent forwards (Block 7).
	semaphore chan struct{}

	// lastPong is updated by readLoop when a Pong arrives.
	lastPong atomic.Value // time.Time

	// closed is set once; signals readLoop and prevents double-close.
	closed atomic.Bool

	// done is closed when readLoop exits.
	done chan struct{}

	// ctx/cancel for the entry's lifetime (tied to parent context).
	ctx    context.Context
	cancel context.CancelFunc

	// onBroadcast is the relay-side fan-out hook. Inbound Broadcast
	// frames are dispatched here verbatim so the StreamManager can
	// fan them out to siblings. May be nil during tests.
	onBroadcast BroadcastCallback
}

// newStreamEntry creates and starts a stream entry. The readLoop goroutine
// begins immediately — the entry is "live" after this call.
func newStreamEntry(parentCtx context.Context, peerID string, conn net.Conn, maxConcurrent int, onBroadcast BroadcastCallback) *streamEntry {
	ctx, cancel := context.WithCancel(parentCtx)
	e := &streamEntry{
		peerID:      peerID,
		conn:        conn,
		mountedAt:   time.Now(),
		pending:     make(map[uint32]*pendingRequest),
		semaphore:   make(chan struct{}, maxConcurrent),
		done:        make(chan struct{}),
		ctx:         ctx,
		cancel:      cancel,
		onBroadcast: onBroadcast,
	}
	e.lastPong.Store(time.Now())
	go e.readLoop()
	return e
}

// readLoop is the ONLY goroutine that reads from conn. It dispatches frames
// by type and exits when the conn is closed or context is cancelled.
func (e *streamEntry) readLoop() {
	defer close(e.done)
	defer e.failAllPending()

	for {
		envelope, err := protocol.ReadEnvelope(e.conn)
		if err != nil {
			if !e.closed.Load() {
				e.logPrivacyAware(
					protocol.RouteLogContext{},
					protocol.RouteLogOutcomeInterrupted,
					"[stream] readLoop error for %s: %v",
					e.peerID,
					err,
				)
			}
			return
		}

		if envelope.Type == protocol.TypeResponse {
			pending, ok := e.pendingForResponse(envelope.RequestID)
			if !ok {
				if err := protocol.DiscardPayload(e.conn, envelope.PayloadLen); err != nil {
					logger.Warnf(e.ctx, "[stream] discard orphan response failed")
					return
				}
				logger.Warnf(e.ctx, "[stream] orphan response frame discarded")
				continue
			}
			frame, err := protocol.ReadFramePayload(
				e.conn,
				envelope,
				pending.responsePayloadLimit,
			)
			if err != nil {
				e.logPrivacyAware(
					pending.privateObjectLog,
					protocol.RouteLogOutcomeRejected,
					"[stream] bounded response read error for %s: %v",
					e.peerID,
					err,
				)
				return
			}
			e.dispatchResponse(
				frame.(*protocol.ResponseFrame),
				pending.privateObjectLog,
			)
			continue
		}

		var pendingLog protocol.RouteLogContext
		if envelope.Type == protocol.TypeCancelled {
			pendingLog = e.pendingLogContext(envelope.RequestID)
		}
		frame, err := protocol.ReadFramePayload(e.conn, envelope, protocol.MaxPayloadLen)
		if err != nil {
			if !e.closed.Load() {
				e.logPrivacyAware(
					pendingLog,
					protocol.RouteLogOutcomeRejected,
					"[stream] readLoop payload error for %s: %v",
					e.peerID,
					err,
				)
			}
			return
		}

		switch f := frame.(type) {
		case *protocol.PingFrame:
			e.writeMu.Lock()
			writeErr := protocol.WritePong(e.conn, f.RequestID)
			e.writeMu.Unlock()
			if writeErr != nil {
				e.logPrivacyAware(
					protocol.RouteLogContext{},
					protocol.RouteLogOutcomeInterrupted,
					"[stream] pong write error for %s: %v",
					e.peerID,
					writeErr,
				)
				return
			}

		case *protocol.PongFrame:
			e.lastPong.Store(time.Now())

		case *protocol.CancelledFrame:
			e.dispatchCancelled(f, pendingLog)

		case *protocol.BroadcastFrame:
			// Tier C1: fan-out is delegated to the StreamManager via
			// onBroadcast, dispatched off the read loop so a slow
			// sibling cannot stall this stream's heartbeat or
			// response dispatch. We *deliberately* discard whatever
			// origin_peer_id the publisher sent — the relay is the
			// authority for that field — and pass our authenticated
			// peer id into the callback instead.
			if e.onBroadcast != nil {
				go e.onBroadcast(e.ctx, e.peerID, f.Topic, f.Body)
			} else {
				e.logPrivacyAware(
					protocol.RouteLogContext{},
					protocol.RouteLogOutcomeRejected,
					"[stream] broadcast dropped: no fan-out hook installed",
				)
			}

		default:
			e.logPrivacyAware(
				protocol.RouteLogContext{},
				protocol.RouteLogOutcomeRejected,
				"[stream] unexpected frame type: %T",
				f,
			)
		}
	}
}

func (e *streamEntry) pendingForResponse(reqID uint32) (*pendingRequest, bool) {
	e.pendingMu.Lock()
	defer e.pendingMu.Unlock()
	pr, ok := e.pending[reqID]
	return pr, ok
}

func (e *streamEntry) pendingLogContext(reqID uint32) protocol.RouteLogContext {
	e.pendingMu.Lock()
	defer e.pendingMu.Unlock()
	pr, ok := e.pending[reqID]
	if !ok {
		return protocol.RouteLogContext{}
	}
	return pr.privateObjectLog
}

func (e *streamEntry) privateObjectLogContext() (
	protocol.RouteLogContext,
	bool,
) {
	e.pendingMu.Lock()
	defer e.pendingMu.Unlock()
	for _, pending := range e.pending {
		if pending.privateObjectLog.Category != "" {
			return pending.privateObjectLog, true
		}
	}
	if e.lastPrivateObjectLog.Category != "" {
		return e.lastPrivateObjectLog, true
	}

	return protocol.RouteLogContext{}, false
}

// dispatchResponse routes an active response or discards a raced response for
// a draining slot. In both cases the response is terminal and releases admission.
func (e *streamEntry) dispatchResponse(
	f *protocol.ResponseFrame,
	pendingLog protocol.RouteLogContext,
) {
	pr, state, retire, ok := e.takePending(f.RequestID)
	if !ok {
		if pendingLog.Category != "" {
			logPrivateObjectStream(
				e.ctx,
				pendingLog,
				protocol.RouteLogOutcomeRejected,
			)
		} else {
			logger.Warnf(e.ctx, "[stream] orphan response frame discarded")
		}
		return
	}
	if state == pendingActive {
		select {
		case pr.ch <- pendingResult{response: f}:
		default:
		}
	}
	if retire {
		go e.Close()
	}
}

func (e *streamEntry) dispatchCancelled(
	f *protocol.CancelledFrame,
	pendingLog protocol.RouteLogContext,
) {
	pr, state, retire, ok := e.takePending(f.RequestID)
	if !ok {
		if pendingLog.Category != "" {
			logPrivateObjectStream(
				e.ctx,
				pendingLog,
				protocol.RouteLogOutcomeRejected,
			)
		} else {
			logger.Warnf(e.ctx, "[stream] orphan cancelled frame discarded")
		}
		return
	}
	if state == pendingActive {
		select {
		case pr.ch <- pendingResult{err: ErrRequestCancelled}:
		default:
		}
	}
	if retire {
		go e.Close()
	}
}

func (e *streamEntry) takePending(reqID uint32) (*pendingRequest, pendingState, bool, bool) {
	e.pendingMu.Lock()
	pr, ok := e.pending[reqID]
	if !ok {
		e.pendingMu.Unlock()
		return nil, pendingActive, false, false
	}
	delete(e.pending, reqID)
	if pr.drainTimer != nil {
		pr.drainTimer.Stop()
	}
	retire := e.retiring && len(e.pending) == 0
	state := pr.state
	e.pendingMu.Unlock()

	e.ReleaseSemaphore()
	return pr, state, retire, true
}

// failAllPending wakes all waiting SendRequest callers with nil (they'll
// see an error because the channel is closed without a value, or ctx is done).
func (e *streamEntry) failAllPending() {
	e.pendingMu.Lock()
	pending := make([]*pendingRequest, 0, len(e.pending))
	for id, pr := range e.pending {
		if pr.drainTimer != nil {
			pr.drainTimer.Stop()
		}
		pending = append(pending, pr)
		delete(e.pending, id)
	}
	e.pendingMu.Unlock()

	for _, pr := range pending {
		e.ReleaseSemaphore()
		close(pr.ch)
	}
}

// SendRequest sends a request frame and waits for its terminal response. On
// caller cancellation the slot transitions to draining, sends Cancel, and
// retains both its response cap and semaphore admission until Response,
// Cancelled, stream failure, or the additional drain timeout.
func (e *streamEntry) SendRequest(
	ctx context.Context,
	method, path string,
	headers map[string]string,
	body []byte,
	responsePayloadLimit uint32,
	drainTimeout time.Duration,
) (*protocol.ResponseFrame, uint32, error) {
	if e.closed.Load() {
		return nil, 0, ErrStreamClosed
	}
	if !e.AcquireSemaphore() {
		return nil, 0, ErrTooManyConcurrent
	}
	if responsePayloadLimit == 0 || responsePayloadLimit > protocol.MaxPayloadLen {
		responsePayloadLimit = protocol.MaxPayloadLen
	}
	if drainTimeout <= 0 {
		drainTimeout = time.Second
	}

	privateObjectLog, _ := protocol.PrivateObjectRouteLogContext(
		method,
		path,
		headers,
	)
	pr := &pendingRequest{
		ch:                   make(chan pendingResult, 1),
		responsePayloadLimit: responsePayloadLimit,
		privateObjectLog:     privateObjectLog,
		state:                pendingActive,
	}
	e.pendingMu.Lock()
	if e.closed.Load() {
		e.pendingMu.Unlock()
		e.ReleaseSemaphore()
		return nil, 0, ErrStreamClosed
	}
	if e.retiring {
		e.pendingMu.Unlock()
		e.ReleaseSemaphore()
		return nil, 0, ErrRequestIDExhausted
	}
	reqID := e.nextRequestID + 1
	if reqID == 0 {
		e.retiring = true
		e.pendingMu.Unlock()
		e.ReleaseSemaphore()
		return nil, 0, ErrRequestIDExhausted
	}
	e.nextRequestID = reqID
	if reqID == ^uint32(0) {
		e.retiring = true
	}
	if privateObjectLog.Category != "" {
		e.lastPrivateObjectLog = privateObjectLog
	}
	e.pending[reqID] = pr
	e.pendingMu.Unlock()

	e.writeMu.Lock()
	writeErr := protocol.WriteRequestFrame(e.conn, reqID, method, path, headers, body)
	e.writeMu.Unlock()
	if writeErr != nil {
		_, _, retire, _ := e.takePending(reqID)
		if retire {
			go e.Close()
		}
		return nil, reqID, fmt.Errorf("write request: %w", writeErr)
	}

	select {
	case result, ok := <-pr.ch:
		if !ok {
			return nil, reqID, ErrStreamDisconnected
		}
		if result.err != nil {
			return nil, reqID, result.err
		}
		return result.response, reqID, nil
	case <-ctx.Done():
		e.beginDrain(reqID, pr, drainTimeout)
		return nil, reqID, ctx.Err()
	}
}

func (e *streamEntry) beginDrain(reqID uint32, expected *pendingRequest, drainTimeout time.Duration) {
	e.pendingMu.Lock()
	pr, ok := e.pending[reqID]
	if !ok || pr != expected || pr.state != pendingActive {
		e.pendingMu.Unlock()
		return
	}
	pr.state = pendingDraining
	pr.drainTimer = time.AfterFunc(drainTimeout, func() {
		e.pendingMu.Lock()
		current, stillDraining := e.pending[reqID]
		stillDraining = stillDraining &&
			current == expected &&
			current.state == pendingDraining
		e.pendingMu.Unlock()
		if stillDraining {
			e.logPrivacyAware(
				expected.privateObjectLog,
				protocol.RouteLogOutcomeInterrupted,
				"[stream] cancellation drain timeout req_id=%d for %s",
				reqID,
				e.peerID,
			)
			e.Close()
		}
	})
	e.pendingMu.Unlock()

	go func() {
		e.writeMu.Lock()
		err := protocol.WriteCancel(e.conn, reqID)
		e.writeMu.Unlock()
		if err != nil {
			e.logPrivacyAware(
				expected.privateObjectLog,
				protocol.RouteLogOutcomeInterrupted,
				"[stream] cancel write error req_id=%d for %s: %v",
				reqID,
				e.peerID,
				err,
			)
			e.Close()
		}
	}()
}

func logPrivateObjectStream(
	ctx context.Context,
	logContext protocol.RouteLogContext,
	outcome string,
) {
	logger.Warnf(
		ctx,
		"[stream] route=%s method=%s outcome=%s request_id=%s",
		logContext.Category,
		logContext.Method,
		outcome,
		logContext.RequestID,
	)
}

func (e *streamEntry) logPrivacyAware(
	preferred protocol.RouteLogContext,
	outcome string,
	legacyFormat string,
	legacyArgs ...interface{},
) {
	if preferred.Category == "" {
		preferred, _ = e.privateObjectLogContext()
	}
	if preferred.Category != "" {
		logPrivateObjectStream(e.ctx, preferred, outcome)

		return
	}
	logger.Warnf(e.ctx, legacyFormat, legacyArgs...)
}

// WritePing sends a Ping frame through the write lock.
func (e *streamEntry) WritePing(reqID uint32) error {
	e.writeMu.Lock()
	defer e.writeMu.Unlock()
	return protocol.WritePing(e.conn, reqID)
}

// WriteBroadcast sends a Broadcast frame to this station, stamping
// `originPeerID` (the authenticated publisher) before write. The caller
// is responsible for filtering out the publisher's own stream so we
// don't echo events back to the source.
func (e *streamEntry) WriteBroadcast(topic, originPeerID string, body []byte) error {
	if e.closed.Load() {
		return ErrStreamClosed
	}
	e.writeMu.Lock()
	defer e.writeMu.Unlock()
	return protocol.WriteBroadcastFrame(e.conn, topic, originPeerID, body)
}

// Close marks the entry as closed, cancels context, and closes the conn.
// readLoop will exit on its own when the conn is closed.
func (e *streamEntry) Close() {
	if e.closed.Swap(true) {
		return // already closed
	}
	e.cancel()
	_ = e.conn.Close()
}

// Wait blocks until the readLoop goroutine exits.
func (e *streamEntry) Wait() {
	<-e.done
}

// LastPong returns the timestamp of the last received Pong.
func (e *streamEntry) LastPong() time.Time {
	return e.lastPong.Load().(time.Time)
}

// AcquireSemaphore tries to acquire a slot for this station. Returns false
// if the station already has too many concurrent forwards (Block 7).
func (e *streamEntry) AcquireSemaphore() bool {
	select {
	case e.semaphore <- struct{}{}:
		return true
	default:
		return false
	}
}

// ReleaseSemaphore releases a previously acquired slot.
func (e *streamEntry) ReleaseSemaphore() {
	<-e.semaphore
}

// ---- StreamManager ----

// StreamManager owns the peer-id → streamEntry mapping, provides
// request dispatching, periodic liveness checks, and graceful drain.
type StreamManager struct {
	mu       sync.RWMutex
	streams  map[string]*streamEntry
	inflight atomic.Int64

	maxConcurrentPerStation int
	callback                StatusCallback

	// allowedBroadcastTopics gates which Broadcast topics the relay is
	// willing to fan out. Empty map = deny-by-default (no broadcast).
	// Tier C1 ships only one topic; future event types must be added
	// here to be relayed.
	allowedBroadcastTopics map[string]struct{}
}

// NewStreamManager builds a manager with the supplied status callback
// and concurrency budget. Broadcast topics are off by default —
// callers wanting pub/sub must set them via SetAllowedBroadcastTopics.
func NewStreamManager(cb StatusCallback, maxConcurrentPerStation int) *StreamManager {
	if maxConcurrentPerStation <= 0 {
		maxConcurrentPerStation = 64
	}
	return &StreamManager{
		streams:                 make(map[string]*streamEntry),
		maxConcurrentPerStation: maxConcurrentPerStation,
		callback:                cb,
		allowedBroadcastTopics:  make(map[string]struct{}),
	}
}

// SetAllowedBroadcastTopics replaces the topic allow-list. Calling
// this with an empty list re-enables deny-by-default.
//
// The allow-list is the relay's only pub/sub policy gate today; we
// keep it deliberately simple because Tier C1 has exactly one topic.
// Per-station rate-limits / per-topic ACLs land in a later tier.
func (sm *StreamManager) SetAllowedBroadcastTopics(topics ...string) {
	next := make(map[string]struct{}, len(topics))
	for _, t := range topics {
		if t == "" {
			continue
		}
		next[t] = struct{}{}
	}
	sm.mu.Lock()
	sm.allowedBroadcastTopics = next
	sm.mu.Unlock()
}

// IsBroadcastTopicAllowed reports whether the relay is configured to
// fan out the given topic. Used by the broadcast callback to drop
// off-policy publishes early.
func (sm *StreamManager) IsBroadcastTopicAllowed(topic string) bool {
	sm.mu.RLock()
	_, ok := sm.allowedBroadcastTopics[topic]
	sm.mu.RUnlock()
	return ok
}

// Add registers (or replaces) a stream for the given peerID.
// If an old stream exists it is closed first.
// The new entry starts its readLoop immediately.
func (sm *StreamManager) Add(ctx context.Context, peerID string, conn net.Conn) {
	// We bind the broadcast hook here (not in NewStreamManager) so
	// each entry's readLoop dispatches into the same fan-out path,
	// without the entry having to know about its peers.
	entry := newStreamEntry(ctx, peerID, conn, sm.maxConcurrentPerStation, sm.handleInboundBroadcast)

	sm.mu.Lock()
	if old, exists := sm.streams[peerID]; exists {
		old.Close()
	}
	sm.streams[peerID] = entry
	sm.mu.Unlock()

	if sm.callback != nil {
		sm.callback(ctx, peerID, true)
	}
	logger.Infof(ctx, "[stream] added stream")
}

// handleInboundBroadcast is the readLoop callback for Broadcast
// frames. It applies the topic allow-list, then fans the event out to
// every registered stream EXCEPT the publisher (we don't echo).
//
// `originPeerID` is the authenticated publisher (set by Add via the
// entry callback closure) — never trust whatever the publisher might
// have placed in the inbound frame.
func (sm *StreamManager) handleInboundBroadcast(ctx context.Context, originPeerID, topic string, body []byte) {
	if !sm.IsBroadcastTopicAllowed(topic) {
		// We still record the topic the publisher used — cardinality
		// is bounded by the publisher's frame parser (max 128 bytes,
		// see protocol.MaxBroadcastTopicLen) AND by the fact that
		// any unknown topic is a config bug we want to surface rather
		// than aggregate away.
		metBroadcastReceived.Inc(topic, broadcastResultDroppedDisallowed)
		logger.Warnf(ctx, "[stream] dropping disallowed broadcast")
		return
	}

	metBroadcastReceived.Inc(topic, broadcastResultAllowed)

	// Snapshot the peer list under the read lock. We don't hold the
	// lock during writes because per-entry writeMu is what serialises
	// them, and a long broadcast must not block Add/Remove.
	sm.mu.RLock()
	peers := make([]*streamEntry, 0, len(sm.streams))
	for pid, e := range sm.streams {
		if pid == originPeerID || e.closed.Load() {
			continue
		}
		peers = append(peers, e)
	}
	sm.mu.RUnlock()

	// Fan-out cardinality at dispatch time. Recorded BEFORE the
	// goroutines run so a per-write failure doesn't bias the
	// histogram; the per-write outcome counter below tells you how
	// many of those siblings actually got the frame.
	metBroadcastFanoutSize.Observe(float64(len(peers)), topic)

	// Each per-peer WriteBroadcast acquires that peer's writeMu, which
	// can be held for several seconds by an in-flight HTTP forward.
	// Issuing the writes in parallel goroutines means one stuck sibling
	// cannot head-of-line-block its neighbours; logging happens
	// per-goroutine. We bound concurrency only by the live peer count —
	// fan-out volume is intrinsically capped by topic allow-list +
	// 64KB body limit + publisher rate.
	for _, e := range peers {
		go func(target *streamEntry) {
			if err := target.WriteBroadcast(topic, originPeerID, body); err != nil {
				metBroadcastForwarded.Inc(topic, broadcastResultError)
				logger.Warnf(ctx, "[stream] broadcast write failed")
				return
			}
			metBroadcastForwarded.Inc(topic, broadcastResultOK)
		}(e)
	}

	logger.Debugf(ctx, "[stream] broadcast fanout_count=%d body_len=%d",
		len(peers), len(body))
}

// Remove closes and deletes the stream for peerID.
func (sm *StreamManager) Remove(ctx context.Context, peerID string) {
	sm.mu.Lock()
	entry, exists := sm.streams[peerID]
	if exists {
		entry.Close()
		delete(sm.streams, peerID)
	}
	sm.mu.Unlock()

	if exists && sm.callback != nil {
		sm.callback(ctx, peerID, false)
	}
}

// RemoveIfSame only removes the entry if it is still the same pointer as `expected`.
// This prevents a reconnecting station's new entry from being killed by the old
// goroutine's cleanup path.
func (sm *StreamManager) RemoveIfSame(ctx context.Context, peerID string, expected *streamEntry) {
	if expected == nil {
		return
	}

	sm.mu.Lock()
	current, exists := sm.streams[peerID]
	if exists && current == expected {
		current.Close()
		delete(sm.streams, peerID)
	} else {
		exists = false
	}
	sm.mu.Unlock()

	if exists && sm.callback != nil {
		sm.callback(ctx, peerID, false)
	}
}

// GetEntry returns the stream entry for peerID (if it exists and is not closed).
// The caller may call entry.SendRequest() concurrently — no external locking needed.
func (sm *StreamManager) GetEntry(peerID string) (*streamEntry, bool) {
	sm.mu.RLock()
	entry, ok := sm.streams[peerID]
	sm.mu.RUnlock()
	if !ok || entry.closed.Load() {
		return nil, false
	}
	return entry, true
}

// TrackInflight increments inflight counter. Caller MUST call UntrackInflight after.
func (sm *StreamManager) TrackInflight() {
	sm.inflight.Add(1)
}

// UntrackInflight decrements inflight counter.
func (sm *StreamManager) UntrackInflight() {
	sm.inflight.Add(-1)
}

// Inflight returns the current number of in-flight forwards.
func (sm *StreamManager) Inflight() int64 {
	return sm.inflight.Load()
}

// Count returns the total number of registered streams.
func (sm *StreamManager) Count() int {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return len(sm.streams)
}

// PingAll sends a Ping to every stream and checks liveness based on the last
// Pong timestamp. Streams that haven't responded within `interval + timeout`
// are removed.
//
// The cutoff is `interval + timeout`, NOT `timeout` alone, because a healthy
// pong cycle looks like: at t=N we send a ping and (within timeout) record
// lastPong; at t=N+interval we run PingAll again and lastPong is `interval`
// old by construction. If we used `now - timeout` as the cutoff we would
// kill every healthy stream on the very next cycle. Initial lastPong is
// stored at stream creation, so the same `interval + timeout` budget gives
// brand-new streams their first full cycle to handshake.
//
// Unlike the old implementation, this does NOT lock each entry.mu — it simply
// writes a Ping (via writeMu inside WritePing) and checks lastPong on the
// next round. This means PingAll does not block ongoing Forward calls.
func (sm *StreamManager) PingAll(ctx context.Context, interval, timeout time.Duration) int {
	sm.mu.RLock()
	snapshot := make([]*streamEntry, 0, len(sm.streams))
	for _, e := range sm.streams {
		snapshot = append(snapshot, e)
	}
	sm.mu.RUnlock()

	var failed []string
	cutoff := time.Now().Add(-(interval + timeout))

	for _, e := range snapshot {
		if e.closed.Load() {
			continue
		}

		// Check if last pong is too old (station not responding).
		if e.LastPong().Before(cutoff) {
			e.logPrivacyAware(
				protocol.RouteLogContext{},
				protocol.RouteLogOutcomeInterrupted,
				"[stream] no pong from %s within %v, removing",
				e.peerID,
				interval+timeout,
			)
			failed = append(failed, e.peerID)
			continue
		}

		// Send a new ping for the next round's liveness check.
		if err := e.WritePing(0); err != nil {
			e.logPrivacyAware(
				protocol.RouteLogContext{},
				protocol.RouteLogOutcomeInterrupted,
				"[stream] ping write failed for %s: %v",
				e.peerID,
				err,
			)
			failed = append(failed, e.peerID)
		}
	}

	for _, pid := range failed {
		sm.Remove(ctx, pid)
	}
	return len(failed)
}

// CleanupStale removes streams whose mountedAt is older than cutoff.
func (sm *StreamManager) CleanupStale(ctx context.Context, cutoff time.Time) int {
	sm.mu.Lock()
	var stale []*streamEntry
	for _, e := range sm.streams {
		if e.mountedAt.Before(cutoff) {
			stale = append(stale, e)
		}
	}
	for _, e := range stale {
		e.Close()
		delete(sm.streams, e.peerID)
	}
	sm.mu.Unlock()

	for _, e := range stale {
		if sm.callback != nil {
			sm.callback(ctx, e.peerID, false)
		}
		e.logPrivacyAware(
			protocol.RouteLogContext{},
			protocol.RouteLogOutcomeInterrupted,
			"[stream] cleaned stale stream for %s",
			e.peerID,
		)
	}
	return len(stale)
}

// DrainAndClose waits for inflight to reach 0 (up to timeout),
// then closes all remaining streams and waits for their readLoops to exit.
func (sm *StreamManager) DrainAndClose(ctx context.Context, timeout time.Duration) {
	deadline := time.After(timeout)
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()

drain:
	for {
		if sm.inflight.Load() <= 0 {
			break
		}
		select {
		case <-deadline:
			logger.Warnf(ctx, "[stream] drain timeout, %d requests still inflight", sm.inflight.Load())
			break drain
		case <-ticker.C:
		}
	}

	// Close all streams.
	sm.mu.Lock()
	entries := make([]*streamEntry, 0, len(sm.streams))
	for id, e := range sm.streams {
		entries = append(entries, e)
		e.Close()
		delete(sm.streams, id)
	}
	sm.mu.Unlock()

	// Wait for all readLoops to finish (bounded by conn close).
	for _, e := range entries {
		e.Wait()
	}

	logger.Infof(ctx, "[stream] all streams closed")
}
