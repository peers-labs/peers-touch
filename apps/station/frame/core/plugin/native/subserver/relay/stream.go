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

// pendingRequest is a slot in the response dispatch table.
type pendingRequest struct {
	ch chan *protocol.ResponseFrame
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
		frame, err := protocol.ReadFrame(e.conn)
		if err != nil {
			if !e.closed.Load() {
				logger.Warnf(e.ctx, "[stream] readLoop error for %s: %v", e.peerID, err)
			}
			return
		}

		switch f := frame.(type) {
		case *protocol.ResponseFrame:
			e.dispatchResponse(f)

		case *protocol.PingFrame:
			e.writeMu.Lock()
			writeErr := protocol.WritePong(e.conn, f.RequestID)
			e.writeMu.Unlock()
			if writeErr != nil {
				logger.Warnf(e.ctx, "[stream] pong write error for %s: %v", e.peerID, writeErr)
				return
			}

		case *protocol.PongFrame:
			e.lastPong.Store(time.Now())

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
				logger.Warnf(e.ctx, "[stream] broadcast from %s topic=%s but no fan-out hook installed", e.peerID, f.Topic)
			}

		default:
			logger.Warnf(e.ctx, "[stream] unexpected frame type for %s: %T", e.peerID, f)
		}
	}
}

// dispatchResponse routes a ResponseFrame to the corresponding pending
// request channel. If no waiter exists (timeout/cancelled), the frame is dropped.
func (e *streamEntry) dispatchResponse(f *protocol.ResponseFrame) {
	e.pendingMu.Lock()
	pr, ok := e.pending[f.RequestID]
	if ok {
		delete(e.pending, f.RequestID)
	}
	e.pendingMu.Unlock()

	if ok {
		// Non-blocking send — if the waiter already left (ctx cancelled),
		// the channel has a buffer of 1 so this won't block.
		select {
		case pr.ch <- f:
		default:
		}
	} else {
		logger.Warnf(e.ctx, "[stream] orphan response frame req_id=%d for %s", f.RequestID, e.peerID)
	}
}

// failAllPending wakes all waiting SendRequest callers with nil (they'll
// see an error because the channel is closed without a value, or ctx is done).
func (e *streamEntry) failAllPending() {
	e.pendingMu.Lock()
	for id, pr := range e.pending {
		close(pr.ch)
		delete(e.pending, id)
	}
	e.pendingMu.Unlock()
}

// SendRequest sends a request frame and waits for the corresponding response.
// This is the ONLY way Forward should interact with the stream.
//
// The method:
//  1. Registers a pending slot for reqID
//  2. Writes the request frame under writeMu
//  3. Waits on the response channel with ctx cancellation
//
// Thread-safe: multiple goroutines can call SendRequest concurrently —
// each gets its own reqID and response channel.
func (e *streamEntry) SendRequest(
	ctx context.Context,
	reqID uint32,
	method, path string,
	headers map[string]string,
	body []byte,
) (*protocol.ResponseFrame, error) {
	if e.closed.Load() {
		return nil, ErrStreamClosed
	}

	// 1. Register pending slot (buffered channel so readLoop never blocks).
	pr := &pendingRequest{ch: make(chan *protocol.ResponseFrame, 1)}
	e.pendingMu.Lock()
	e.pending[reqID] = pr
	e.pendingMu.Unlock()

	// Ensure cleanup on all exit paths.
	defer func() {
		e.pendingMu.Lock()
		delete(e.pending, reqID)
		e.pendingMu.Unlock()
	}()

	// 2. Write request frame.
	e.writeMu.Lock()
	writeErr := protocol.WriteRequestFrame(e.conn, reqID, method, path, headers, body)
	e.writeMu.Unlock()
	if writeErr != nil {
		return nil, fmt.Errorf("write request: %w", writeErr)
	}

	// 3. Wait for response or cancellation.
	select {
	case resp, ok := <-pr.ch:
		if !ok || resp == nil {
			return nil, ErrStreamDisconnected
		}
		return resp, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-e.done:
		return nil, ErrStreamClosed
	}
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
	reqID    atomic.Uint32

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
	logger.Infof(ctx, "[stream] added stream for %s", peerID)
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
		logger.Warnf(ctx, "[stream] dropping broadcast from %s on disallowed topic %q", originPeerID, topic)
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
				logger.Warnf(ctx, "[stream] broadcast write to %s failed (topic=%s origin=%s): %v",
					target.peerID, topic, originPeerID, err)
				return
			}
			metBroadcastForwarded.Inc(topic, broadcastResultOK)
		}(e)
	}

	logger.Debugf(ctx, "[stream] broadcast topic=%s origin=%s fanout_count=%d body_len=%d",
		topic, originPeerID, len(peers), len(body))
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

// NextRequestID returns a monotonically increasing ID for framing.
func (sm *StreamManager) NextRequestID() uint32 {
	return sm.reqID.Add(1)
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
			logger.Warnf(ctx, "[stream] no pong from %s within %v, removing", e.peerID, interval+timeout)
			failed = append(failed, e.peerID)
			continue
		}

		// Send a new ping for the next round's liveness check.
		pingID := sm.reqID.Add(1)
		if err := e.WritePing(pingID); err != nil {
			logger.Warnf(ctx, "[stream] ping write failed for %s: %v", e.peerID, err)
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
		logger.Infof(ctx, "[stream] cleaned stale stream for %s", e.peerID)
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
