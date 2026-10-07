package relay

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sync"
	"sync/atomic"
	"time"

	federationmodel "github.com/peers-labs/peers-touch/station/frame/core/federation/model"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/protocol"
)

var (
	ErrStreamClosed       = errors.New("stream closed")
	ErrStreamDisconnected = errors.New("stream disconnected")
	ErrTunnelProtocol     = errors.New("tunnel protocol violation")
	ErrTunnelOverloaded   = errors.New("tunnel queue overloaded")
	ErrTunnelOversize     = errors.New("tunnel byte limit exceeded")
)

const tunnelQueueDepth = 16

type StatusCallback func(
	ctx context.Context,
	peerID string,
	generation uint64,
	online bool,
)

type BroadcastCallback func(
	ctx context.Context,
	originPeerID string,
	topic string,
	body []byte,
)

type streamTunnel struct {
	id                   uint32
	entry                *streamEntry
	opened               chan struct{}
	incoming             chan []byte
	done                 chan struct{}
	finishOnce           sync.Once
	mu                   sync.Mutex
	finished             bool
	openedOK             bool
	nextIncomingSequence uint64
	nextOutgoingSequence uint64
	incomingBytes        int64
	outgoingBytes        int64
	maxDirectionBytes    int64
}

func newStreamTunnel(
	entry *streamEntry,
	id uint32,
	maxDirectionBytes int64,
) *streamTunnel {
	return &streamTunnel{
		id:                   id,
		entry:                entry,
		opened:               make(chan struct{}),
		incoming:             make(chan []byte, tunnelQueueDepth),
		done:                 make(chan struct{}),
		nextIncomingSequence: 1,
		nextOutgoingSequence: 1,
		maxDirectionBytes:    maxDirectionBytes,
	}
}

func (t *streamTunnel) markOpened() {
	t.mu.Lock()
	if !t.finished && !t.openedOK {
		t.openedOK = true
		close(t.opened)
	}
	t.mu.Unlock()
}

func (t *streamTunnel) acceptData(frame *protocol.TunnelDataFrame) error {
	t.mu.Lock()
	if t.finished || frame.Sequence != t.nextIncomingSequence {
		t.mu.Unlock()
		return ErrTunnelProtocol
	}
	nextBytes := t.incomingBytes + int64(len(frame.Data))
	if nextBytes > t.maxDirectionBytes ||
		nextBytes+t.outgoingBytes > t.maxDirectionBytes*2 {
		t.mu.Unlock()
		return ErrTunnelOversize
	}
	t.nextIncomingSequence++
	t.incomingBytes = nextBytes
	t.mu.Unlock()

	data := append([]byte(nil), frame.Data...)
	select {
	case t.incoming <- data:
		return nil
	default:
		return ErrTunnelOverloaded
	}
}

func (t *streamTunnel) Send(data []byte) error {
	if len(data) == 0 {
		return nil
	}
	if len(data) > protocol.MaxTunnelDataLen {
		return ErrTunnelOversize
	}
	t.mu.Lock()
	if t.finished {
		t.mu.Unlock()
		return ErrStreamClosed
	}
	nextBytes := t.outgoingBytes + int64(len(data))
	if nextBytes > t.maxDirectionBytes ||
		t.incomingBytes+nextBytes > t.maxDirectionBytes*2 {
		t.mu.Unlock()
		return ErrTunnelOversize
	}
	sequence := t.nextOutgoingSequence
	t.nextOutgoingSequence++
	t.outgoingBytes = nextBytes
	t.mu.Unlock()

	t.entry.writeMu.Lock()
	err := protocol.WriteTunnelData(t.entry.conn, t.id, sequence, data)
	t.entry.writeMu.Unlock()
	if err != nil {
		return fmt.Errorf("write tunnel data: %w", err)
	}
	return nil
}

func (t *streamTunnel) Receive(ctx context.Context) ([]byte, error) {
	select {
	case data := <-t.incoming:
		return data, nil
	default:
	}
	select {
	case data := <-t.incoming:
		return data, nil
	case <-t.done:
		return nil, ErrStreamDisconnected
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (t *streamTunnel) Cancel(
	reason federationmodel.RelayTunnelCloseReason,
) {
	t.entry.finishTunnel(t.id, reason, true)
}

func (t *streamTunnel) finish() {
	t.finishOnce.Do(func() {
		t.mu.Lock()
		t.finished = true
		t.mu.Unlock()
		close(t.done)
	})
}

type streamEntry struct {
	peerID              string
	generation          uint64
	conn                net.Conn
	credentialExpiresAt time.Time
	maxDirectionBytes   int64
	rateBytesPerSecond  int64
	rateLimiter         *tunnelRateLimiter

	writeMu sync.Mutex

	tunnelsMu sync.RWMutex
	tunnels   map[uint32]*streamTunnel

	semaphore chan struct{}
	lastPong  atomic.Value
	closed    atomic.Bool
	done      chan struct{}
	ctx       context.Context
	cancel    context.CancelFunc

	onBroadcast BroadcastCallback
}

func newStreamEntry(
	parentCtx context.Context,
	peerID string,
	generation uint64,
	credentialExpiresAt time.Time,
	conn net.Conn,
	maxConcurrent int,
	maxDirectionBytes int64,
	rateBytesPerSecond int64,
	onBroadcast BroadcastCallback,
) *streamEntry {
	ctx, cancel := context.WithCancel(parentCtx)
	entry := &streamEntry{
		peerID:              peerID,
		generation:          generation,
		conn:                conn,
		credentialExpiresAt: credentialExpiresAt,
		maxDirectionBytes:   maxDirectionBytes,
		rateBytesPerSecond:  rateBytesPerSecond,
		rateLimiter:         newTunnelRateLimiter(rateBytesPerSecond),
		tunnels:             make(map[uint32]*streamTunnel),
		semaphore:           make(chan struct{}, maxConcurrent),
		done:                make(chan struct{}),
		ctx:                 ctx,
		cancel:              cancel,
		onBroadcast:         onBroadcast,
	}
	entry.lastPong.Store(time.Now())
	return entry
}

func (e *streamEntry) start() {
	go e.readLoop()
}

// readLoop is the only reader for a mount stream. Blocking tunnel and
// broadcast work is handed off so Ping/Pong liveness cannot be starved.
func (e *streamEntry) readLoop() {
	defer close(e.done)
	defer e.failAllTunnels()

	for {
		frame, err := protocol.ReadFrame(e.conn)
		if err != nil {
			if !e.closed.Load() {
				logger.Warnf(
					e.ctx,
					"[stream] read error for %s: %v",
					e.peerID,
					err,
				)
			}
			return
		}
		switch typed := frame.(type) {
		case *protocol.TunnelOpenedFrame:
			if tunnel := e.tunnel(typed.TunnelID); tunnel != nil {
				tunnel.markOpened()
			}
		case *protocol.TunnelDataFrame:
			tunnel := e.tunnel(typed.TunnelID)
			if tunnel == nil {
				go e.writeTunnelCancel(
					typed.TunnelID,
					federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_PROTOCOL_ERROR,
				)
				continue
			}
			if err := tunnel.acceptData(typed); err != nil {
				reason := federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_PROTOCOL_ERROR
				if errors.Is(err, ErrTunnelOverloaded) {
					reason = federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_OVERLOADED
				} else if errors.Is(err, ErrTunnelOversize) {
					reason = federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_OVERSIZE
				}
				go e.finishTunnel(typed.TunnelID, reason, true)
			}
		case *protocol.TunnelCancelFrame:
			e.finishTunnel(typed.TunnelID, typed.Reason, false)
		case *protocol.TunnelCloseFrame:
			e.finishTunnel(typed.TunnelID, typed.Reason, false)
		case *protocol.PingFrame:
			e.writeMu.Lock()
			writeErr := protocol.WritePong(e.conn, typed.RequestID)
			e.writeMu.Unlock()
			if writeErr != nil {
				return
			}
		case *protocol.PongFrame:
			e.lastPong.Store(time.Now())
		case *protocol.BroadcastFrame:
			if e.onBroadcast != nil {
				go e.onBroadcast(e.ctx, e.peerID, typed.Topic, typed.Body)
			}
		default:
			logger.Warnf(
				e.ctx,
				"[stream] unexpected frame for %s: %T",
				e.peerID,
				typed,
			)
		}
	}
}

func (e *streamEntry) OpenTunnel(
	ctx context.Context,
	tunnelID uint32,
	routeID string,
	routeGeneration uint64,
	callerStationPeerID string,
	purpose federationmodel.RelayTunnelPurpose,
	handshakeTimeout time.Duration,
) (*streamTunnel, error) {
	if e.closed.Load() {
		return nil, ErrStreamClosed
	}
	tunnel := newStreamTunnel(e, tunnelID, e.maxDirectionBytes)
	e.tunnelsMu.Lock()
	if _, exists := e.tunnels[tunnelID]; exists {
		e.tunnelsMu.Unlock()
		return nil, ErrTunnelProtocol
	}
	e.tunnels[tunnelID] = tunnel
	e.tunnelsMu.Unlock()

	e.writeMu.Lock()
	err := protocol.WriteTunnelOpen(e.conn, &protocol.TunnelOpenFrame{
		TunnelID:            tunnelID,
		RouteID:             routeID,
		RouteGeneration:     routeGeneration,
		CallerStationPeerID: callerStationPeerID,
		Purpose:             purpose,
	})
	e.writeMu.Unlock()
	if err != nil {
		e.finishTunnel(tunnelID, 0, false)
		return nil, fmt.Errorf("write tunnel open: %w", err)
	}

	timer := time.NewTimer(handshakeTimeout)
	defer timer.Stop()
	select {
	case <-tunnel.opened:
		return tunnel, nil
	case <-tunnel.done:
		return nil, ErrStreamDisconnected
	case <-timer.C:
		e.finishTunnel(
			tunnelID,
			federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_TIMEOUT,
			true,
		)
		return nil, context.DeadlineExceeded
	case <-ctx.Done():
		e.finishTunnel(
			tunnelID,
			federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_CANCELLED,
			true,
		)
		return nil, ctx.Err()
	}
}

func (e *streamEntry) tunnel(tunnelID uint32) *streamTunnel {
	e.tunnelsMu.RLock()
	tunnel := e.tunnels[tunnelID]
	e.tunnelsMu.RUnlock()
	return tunnel
}

func (e *streamEntry) finishTunnel(
	tunnelID uint32,
	reason federationmodel.RelayTunnelCloseReason,
	notifyStation bool,
) {
	e.tunnelsMu.Lock()
	tunnel := e.tunnels[tunnelID]
	delete(e.tunnels, tunnelID)
	e.tunnelsMu.Unlock()
	if tunnel == nil {
		return
	}
	tunnel.finish()
	if notifyStation && reason != 0 {
		e.writeTunnelCancel(tunnelID, reason)
	}
}

func (e *streamEntry) writeTunnelCancel(
	tunnelID uint32,
	reason federationmodel.RelayTunnelCloseReason,
) {
	e.writeMu.Lock()
	_ = protocol.WriteTunnelCancel(e.conn, tunnelID, reason)
	e.writeMu.Unlock()
}

func (e *streamEntry) failAllTunnels() {
	e.tunnelsMu.Lock()
	tunnels := make([]*streamTunnel, 0, len(e.tunnels))
	for id, tunnel := range e.tunnels {
		tunnels = append(tunnels, tunnel)
		delete(e.tunnels, id)
	}
	e.tunnelsMu.Unlock()
	for _, tunnel := range tunnels {
		tunnel.finish()
	}
}

func (e *streamEntry) WritePing(requestID uint32) error {
	e.writeMu.Lock()
	defer e.writeMu.Unlock()
	return protocol.WritePing(e.conn, requestID)
}

func (e *streamEntry) WriteBroadcast(
	topic string,
	originPeerID string,
	body []byte,
) error {
	if e.closed.Load() {
		return ErrStreamClosed
	}
	e.writeMu.Lock()
	defer e.writeMu.Unlock()
	return protocol.WriteBroadcastFrame(e.conn, topic, originPeerID, body)
}

func (e *streamEntry) Close() {
	if e.closed.Swap(true) {
		return
	}
	e.cancel()
	_ = e.conn.Close()
}

func (e *streamEntry) Wait() {
	<-e.done
}

func (e *streamEntry) LastPong() time.Time {
	return e.lastPong.Load().(time.Time)
}

func (e *streamEntry) AcquireSemaphore() bool {
	select {
	case e.semaphore <- struct{}{}:
		return true
	default:
		return false
	}
}

func (e *streamEntry) ReleaseSemaphore() {
	<-e.semaphore
}

type StreamManager struct {
	mu       sync.RWMutex
	streams  map[string]*streamEntry
	inflight atomic.Int64
	streamID atomic.Uint32

	maxConcurrentPerStation int
	maxDirectionBytes       int64
	callback                StatusCallback
	allowedBroadcastTopics  map[string]struct{}
}

type streamLimits struct {
	maxConcurrent      int
	maxDirectionBytes  int64
	rateBytesPerSecond int64
}

func NewStreamManager(
	callback StatusCallback,
	maxConcurrentPerStation int,
	maxDirectionBytes ...int64,
) *StreamManager {
	if maxConcurrentPerStation <= 0 {
		maxConcurrentPerStation = 64
	}
	directionLimit := int64(32 << 20)
	if len(maxDirectionBytes) > 0 && maxDirectionBytes[0] > 0 {
		directionLimit = maxDirectionBytes[0]
	}
	return &StreamManager{
		streams:                 make(map[string]*streamEntry),
		maxConcurrentPerStation: maxConcurrentPerStation,
		maxDirectionBytes:       directionLimit,
		callback:                callback,
		allowedBroadcastTopics:  make(map[string]struct{}),
	}
}

func (sm *StreamManager) SetAllowedBroadcastTopics(topics ...string) {
	next := make(map[string]struct{}, len(topics))
	for _, topic := range topics {
		if topic != "" {
			next[topic] = struct{}{}
		}
	}
	sm.mu.Lock()
	sm.allowedBroadcastTopics = next
	sm.mu.Unlock()
}

func (sm *StreamManager) IsBroadcastTopicAllowed(topic string) bool {
	sm.mu.RLock()
	_, ok := sm.allowedBroadcastTopics[topic]
	sm.mu.RUnlock()
	return ok
}

func (sm *StreamManager) Add(
	ctx context.Context,
	peerID string,
	generation uint64,
	credentialExpiresAt time.Time,
	conn net.Conn,
) {
	_, _ = sm.AddValidated(
		ctx,
		peerID,
		generation,
		credentialExpiresAt,
		conn,
		streamLimits{},
		nil,
	)
}

func (sm *StreamManager) AddValidated(
	ctx context.Context,
	peerID string,
	generation uint64,
	credentialExpiresAt time.Time,
	conn net.Conn,
	limits streamLimits,
	validate func() error,
) (*streamEntry, error) {
	sm.mu.Lock()
	if validate != nil {
		if err := validate(); err != nil {
			sm.mu.Unlock()
			return nil, err
		}
	}
	if limits.maxConcurrent <= 0 ||
		limits.maxConcurrent > sm.maxConcurrentPerStation {
		limits.maxConcurrent = sm.maxConcurrentPerStation
	}
	if limits.maxDirectionBytes <= 0 ||
		limits.maxDirectionBytes > sm.maxDirectionBytes {
		limits.maxDirectionBytes = sm.maxDirectionBytes
	}
	if limits.rateBytesPerSecond <= 0 ||
		limits.rateBytesPerSecond > tunnelRateBytesPerSecond {
		limits.rateBytesPerSecond = tunnelRateBytesPerSecond
	}
	entry := newStreamEntry(
		ctx,
		peerID,
		generation,
		credentialExpiresAt,
		conn,
		limits.maxConcurrent,
		limits.maxDirectionBytes,
		limits.rateBytesPerSecond,
		sm.handleInboundBroadcast,
	)
	if old := sm.streams[peerID]; old != nil {
		old.Close()
	}
	sm.streams[peerID] = entry
	entry.start()
	sm.mu.Unlock()

	if sm.callback != nil {
		sm.callback(ctx, peerID, generation, true)
	}
	return entry, nil
}

func (sm *StreamManager) handleInboundBroadcast(
	ctx context.Context,
	originPeerID string,
	topic string,
	body []byte,
) {
	if !sm.IsBroadcastTopicAllowed(topic) {
		metBroadcastReceived.Inc(topic, broadcastResultDroppedDisallowed)
		return
	}
	metBroadcastReceived.Inc(topic, broadcastResultAllowed)

	sm.mu.RLock()
	targets := make([]*streamEntry, 0, len(sm.streams))
	for peerID, entry := range sm.streams {
		if peerID != originPeerID && !entry.closed.Load() {
			targets = append(targets, entry)
		}
	}
	sm.mu.RUnlock()
	metBroadcastFanoutSize.Observe(float64(len(targets)), topic)

	for _, entry := range targets {
		go func(target *streamEntry) {
			if err := target.WriteBroadcast(topic, originPeerID, body); err != nil {
				metBroadcastForwarded.Inc(topic, broadcastResultError)
				return
			}
			metBroadcastForwarded.Inc(topic, broadcastResultOK)
		}(entry)
	}
}

func (sm *StreamManager) Remove(ctx context.Context, peerID string) {
	sm.mu.Lock()
	entry := sm.streams[peerID]
	if entry != nil {
		entry.Close()
		delete(sm.streams, peerID)
	}
	sm.mu.Unlock()
	if entry != nil && sm.callback != nil {
		sm.callback(ctx, peerID, entry.generation, false)
	}
}

func (sm *StreamManager) RemoveIfSame(
	ctx context.Context,
	peerID string,
	expected *streamEntry,
) {
	if expected == nil {
		return
	}
	sm.mu.Lock()
	current := sm.streams[peerID]
	if current == expected {
		current.Close()
		delete(sm.streams, peerID)
	} else {
		current = nil
	}
	sm.mu.Unlock()
	if current != nil && sm.callback != nil {
		sm.callback(ctx, peerID, expected.generation, false)
	}
}

func (sm *StreamManager) GetEntry(peerID string) (*streamEntry, bool) {
	sm.mu.RLock()
	entry := sm.streams[peerID]
	sm.mu.RUnlock()
	return entry, entry != nil && !entry.closed.Load()
}

func (sm *StreamManager) NextTunnelID() uint32 {
	for {
		id := sm.streamID.Add(1)
		if id != 0 {
			return id
		}
	}
}

func (sm *StreamManager) TrackInflight() {
	sm.inflight.Add(1)
}

func (sm *StreamManager) UntrackInflight() {
	sm.inflight.Add(-1)
}

func (sm *StreamManager) Inflight() int64 {
	return sm.inflight.Load()
}

func (sm *StreamManager) Count() int {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return len(sm.streams)
}

func (sm *StreamManager) PingAll(
	ctx context.Context,
	interval time.Duration,
	timeout time.Duration,
) int {
	sm.mu.RLock()
	snapshot := make([]*streamEntry, 0, len(sm.streams))
	for _, entry := range sm.streams {
		snapshot = append(snapshot, entry)
	}
	sm.mu.RUnlock()

	cutoff := time.Now().Add(-(interval + timeout))
	failed := make([]string, 0)
	for _, entry := range snapshot {
		if entry.closed.Load() ||
			!entry.credentialExpiresAt.After(time.Now()) ||
			entry.LastPong().Before(cutoff) {
			failed = append(failed, entry.peerID)
			continue
		}
		if err := entry.WritePing(sm.NextTunnelID()); err != nil {
			failed = append(failed, entry.peerID)
		}
	}
	for _, peerID := range failed {
		sm.Remove(ctx, peerID)
	}
	return len(failed)
}

// CleanupStale uses observed liveness, never mount age. A healthy long-lived
// stream must survive indefinitely.
func (sm *StreamManager) CleanupStale(
	ctx context.Context,
	cutoff time.Time,
) int {
	sm.mu.RLock()
	staleIDs := make([]string, 0)
	for peerID, entry := range sm.streams {
		if entry.LastPong().Before(cutoff) {
			staleIDs = append(staleIDs, peerID)
		}
	}
	sm.mu.RUnlock()
	for _, peerID := range staleIDs {
		sm.Remove(ctx, peerID)
	}
	return len(staleIDs)
}

func (sm *StreamManager) DrainAndClose(
	ctx context.Context,
	timeout time.Duration,
) {
	timer := time.NewTimer(timeout)
	ticker := time.NewTicker(50 * time.Millisecond)
	defer timer.Stop()
	defer ticker.Stop()
	for sm.inflight.Load() > 0 {
		select {
		case <-timer.C:
			goto closeStreams
		case <-ticker.C:
		case <-ctx.Done():
			goto closeStreams
		}
	}

closeStreams:
	sm.mu.Lock()
	entries := make([]*streamEntry, 0, len(sm.streams))
	for peerID, entry := range sm.streams {
		entries = append(entries, entry)
		entry.Close()
		delete(sm.streams, peerID)
	}
	sm.mu.Unlock()
	for _, entry := range entries {
		entry.Wait()
	}
}
