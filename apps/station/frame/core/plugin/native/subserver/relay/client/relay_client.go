package client

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"time"

	federationmodel "github.com/peers-labs/peers-touch/station/frame/core/federation/model"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/protocol"
)

var (
	ErrHandshakeRejected = errors.New("handshake rejected by relay")
	ErrDialFailed        = errors.New("failed to dial relay")
	ErrNotConnected      = errors.New("relay-client: not connected")
	ErrTunnelClosed      = errors.New("relay-client: tunnel closed")
	ErrTunnelProtocol    = errors.New("relay-client: tunnel protocol violation")
	ErrTunnelOversize    = errors.New("relay-client: tunnel byte limit exceeded")
)

const inboundTunnelQueueDepth = 16

type TokenRefresher func(
	ctx context.Context,
	currentToken string,
) (newToken string, err error)

type CredentialRejectedHandler func(
	ctx context.Context,
	currentToken string,
) (newToken string, err error)

type ConnectionStateChanged func(connected bool)

type BroadcastHandler func(
	ctx context.Context,
	originPeerID string,
	topic string,
	body []byte,
)

type TunnelHandler func(ctx context.Context, tunnel *InboundTunnel)

type Config struct {
	RelayAddr     string
	RelayToken    string
	StationPeerID string

	TunnelHandler          TunnelHandler
	TokenRefresher         TokenRefresher
	CredentialRejected     CredentialRejectedHandler
	ConnectionStateChanged ConnectionStateChanged
	BroadcastHandler       BroadcastHandler

	InitialBackoff time.Duration
	MaxBackoff     time.Duration
	PingInterval   time.Duration
	PingTimeout    time.Duration

	TokenRefreshInterval time.Duration
	MaxTunnelBytes       int64

	UseTLS                bool
	TLSInsecureSkipVerify bool
}

type Client struct {
	mu      sync.Mutex
	conn    net.Conn
	writeMu sync.Mutex
	token   string

	tunnelsMu sync.RWMutex
	tunnels   map[uint32]*InboundTunnel

	cfg      Config
	done     chan struct{}
	stopOnce sync.Once
}

func New(cfg Config) *Client {
	if cfg.InitialBackoff == 0 {
		cfg.InitialBackoff = time.Second
	}
	if cfg.MaxBackoff == 0 {
		cfg.MaxBackoff = time.Minute
	}
	if cfg.PingInterval == 0 {
		cfg.PingInterval = 25 * time.Second
	}
	if cfg.PingTimeout == 0 {
		cfg.PingTimeout = 5 * time.Second
	}
	if cfg.TokenRefreshInterval == 0 {
		cfg.TokenRefreshInterval = 30 * time.Minute
	}
	if cfg.MaxTunnelBytes <= 0 {
		cfg.MaxTunnelBytes = 32 << 20
	}
	return &Client{
		cfg:     cfg,
		token:   cfg.RelayToken,
		tunnels: make(map[uint32]*InboundTunnel),
		done:    make(chan struct{}),
	}
}

func (c *Client) Run(ctx context.Context) {
	go c.connectLoop(ctx)
	if c.cfg.TokenRefresher != nil {
		go c.tokenRefreshLoop(ctx)
	}
}

func (c *Client) Stop() {
	c.stopOnce.Do(func() { close(c.done) })
	c.mu.Lock()
	if c.conn != nil {
		_ = c.conn.Close()
	}
	c.mu.Unlock()
	c.finishAllTunnels()
}

func (c *Client) Publish(
	ctx context.Context,
	topic string,
	body []byte,
) error {
	conn := c.activeConn()
	if conn == nil {
		return ErrNotConnected
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	err := protocol.WriteBroadcastFrame(conn, topic, "", body)
	_ = conn.SetWriteDeadline(time.Time{})
	if err != nil {
		return fmt.Errorf("relay-client: publish topic=%s: %w", topic, err)
	}
	return nil
}

func (c *Client) activeConn() net.Conn {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn
}

func (c *Client) connectLoop(ctx context.Context) {
	backoff := c.cfg.InitialBackoff
	for {
		select {
		case <-c.done:
			return
		case <-ctx.Done():
			return
		default:
		}

		conn, reader, err := c.dialAndHandshake(ctx)
		if err != nil {
			if c.cfg.ConnectionStateChanged != nil {
				c.cfg.ConnectionStateChanged(false)
			}
			if errors.Is(err, ErrHandshakeRejected) &&
				c.cfg.CredentialRejected != nil {
				c.mu.Lock()
				currentToken := c.token
				c.mu.Unlock()
				replacement, replaceErr := c.cfg.CredentialRejected(
					ctx,
					currentToken,
				)
				if replaceErr == nil && replacement != "" {
					c.mu.Lock()
					c.token = replacement
					c.mu.Unlock()
					backoff = c.cfg.InitialBackoff
					continue
				}
			}
			select {
			case <-time.After(backoff):
			case <-c.done:
				return
			case <-ctx.Done():
				return
			}
			backoff = min(backoff*2, c.cfg.MaxBackoff)
			continue
		}

		backoff = c.cfg.InitialBackoff
		c.mu.Lock()
		c.conn = conn
		c.mu.Unlock()
		if c.cfg.ConnectionStateChanged != nil {
			c.cfg.ConnectionStateChanged(true)
		}

		pingDone := make(chan struct{})
		go c.pingLoop(ctx, conn, pingDone)
		c.readLoop(ctx, reader, conn)
		close(pingDone)
		_ = conn.Close()
		c.finishAllTunnels()

		c.mu.Lock()
		if c.conn == conn {
			c.conn = nil
		}
		c.mu.Unlock()
		if c.cfg.ConnectionStateChanged != nil {
			c.cfg.ConnectionStateChanged(false)
		}
	}
}

type handshakePayload struct {
	RelayToken    string `json:"relay_token"`
	StationPeerID string `json:"station_peer_id"`
}

type handshakeACK struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

func (c *Client) dialAndHandshake(
	ctx context.Context,
) (net.Conn, *bufio.Reader, error) {
	var conn net.Conn
	var err error
	if c.cfg.UseTLS {
		dialer := tls.Dialer{
			NetDialer: &net.Dialer{Timeout: 10 * time.Second},
			Config: &tls.Config{
				MinVersion:         tls.VersionTLS13,
				InsecureSkipVerify: c.cfg.TLSInsecureSkipVerify,
			},
		}
		conn, err = dialer.DialContext(ctx, "tcp", c.cfg.RelayAddr)
	} else {
		conn, err = (&net.Dialer{Timeout: 10 * time.Second}).
			DialContext(ctx, "tcp", c.cfg.RelayAddr)
	}
	if err != nil {
		return nil, nil, fmt.Errorf("%w: %v", ErrDialFailed, err)
	}

	c.mu.Lock()
	currentToken := c.token
	c.mu.Unlock()
	data, _ := json.Marshal(handshakePayload{
		RelayToken:    currentToken,
		StationPeerID: c.cfg.StationPeerID,
	})
	data = append(data, '\n')
	_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	if _, err := conn.Write(data); err != nil {
		_ = conn.Close()
		return nil, nil, fmt.Errorf("handshake write: %w", err)
	}
	_ = conn.SetWriteDeadline(time.Time{})

	reader := bufio.NewReader(conn)
	_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	ackLine, err := reader.ReadBytes('\n')
	_ = conn.SetReadDeadline(time.Time{})
	if err != nil {
		_ = conn.Close()
		return nil, nil, fmt.Errorf("handshake ack read: %w", err)
	}
	var ack handshakeACK
	if err := json.Unmarshal(ackLine, &ack); err != nil {
		_ = conn.Close()
		return nil, nil, fmt.Errorf("handshake ack decode: %w", err)
	}
	if !ack.OK {
		_ = conn.Close()
		return nil, nil, fmt.Errorf("%w: %s", ErrHandshakeRejected, ack.Error)
	}
	return conn, reader, nil
}

func (c *Client) readLoop(
	ctx context.Context,
	reader *bufio.Reader,
	conn net.Conn,
) {
	for {
		frame, err := protocol.ReadFrame(reader)
		if err != nil {
			if ctx.Err() == nil {
				logger.Warnf(ctx, "[relay-client] read error: %v", err)
			}
			return
		}
		switch typed := frame.(type) {
		case *protocol.TunnelOpenFrame:
			c.handleTunnelOpen(ctx, typed)
		case *protocol.TunnelDataFrame:
			tunnel := c.tunnel(typed.TunnelID)
			if tunnel == nil {
				go c.writeTunnelCancel(
					conn,
					typed.TunnelID,
					federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_PROTOCOL_ERROR,
				)
				continue
			}
			if err := tunnel.acceptData(typed); err != nil {
				reason := federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_PROTOCOL_ERROR
				if errors.Is(err, ErrTunnelOversize) {
					reason = federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_OVERSIZE
				}
				go c.finishTunnel(typed.TunnelID, reason, true)
			}
		case *protocol.TunnelCancelFrame:
			c.finishTunnel(typed.TunnelID, typed.Reason, false)
		case *protocol.TunnelCloseFrame:
			c.finishTunnel(typed.TunnelID, typed.Reason, false)
		case *protocol.PingFrame:
			c.writeMu.Lock()
			writeErr := protocol.WritePong(conn, typed.RequestID)
			c.writeMu.Unlock()
			if writeErr != nil {
				return
			}
		case *protocol.PongFrame:
		case *protocol.BroadcastFrame:
			if c.cfg.BroadcastHandler != nil {
				go c.cfg.BroadcastHandler(
					ctx,
					typed.OriginPeerID,
					typed.Topic,
					typed.Body,
				)
			}
		default:
			logger.Warnf(ctx, "[relay-client] unexpected frame: %T", typed)
		}
	}
}

func (c *Client) handleTunnelOpen(
	parent context.Context,
	frame *protocol.TunnelOpenFrame,
) {
	if frame == nil || frame.TunnelID == 0 {
		return
	}
	tunnel := newInboundTunnel(
		parent,
		c,
		frame,
		c.cfg.MaxTunnelBytes,
	)
	c.tunnelsMu.Lock()
	if _, exists := c.tunnels[frame.TunnelID]; exists {
		c.tunnelsMu.Unlock()
		go c.writeTunnelCancel(
			c.activeConn(),
			frame.TunnelID,
			federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_PROTOCOL_ERROR,
		)
		return
	}
	c.tunnels[frame.TunnelID] = tunnel
	c.tunnelsMu.Unlock()

	go func() {
		if c.cfg.TunnelHandler == nil {
			c.finishTunnel(
				frame.TunnelID,
				federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_UNAVAILABLE,
				true,
			)
			return
		}
		c.cfg.TunnelHandler(tunnel.ctx, tunnel)
		tunnel.Close()
	}()
}

func (c *Client) tunnel(tunnelID uint32) *InboundTunnel {
	c.tunnelsMu.RLock()
	tunnel := c.tunnels[tunnelID]
	c.tunnelsMu.RUnlock()
	return tunnel
}

func (c *Client) finishTunnel(
	tunnelID uint32,
	reason federationmodel.RelayTunnelCloseReason,
	notifyRelay bool,
) {
	c.tunnelsMu.Lock()
	tunnel := c.tunnels[tunnelID]
	delete(c.tunnels, tunnelID)
	c.tunnelsMu.Unlock()
	if tunnel == nil {
		return
	}
	tunnel.finish()
	if notifyRelay && reason != 0 {
		c.writeMu.Lock()
		conn := c.activeConn()
		if conn != nil {
			_ = protocol.WriteTunnelClose(conn, tunnelID, reason)
		}
		c.writeMu.Unlock()
	}
}

func (c *Client) writeTunnelCancel(
	conn net.Conn,
	tunnelID uint32,
	reason federationmodel.RelayTunnelCloseReason,
) {
	if conn == nil {
		return
	}
	c.writeMu.Lock()
	_ = protocol.WriteTunnelCancel(conn, tunnelID, reason)
	c.writeMu.Unlock()
}

func (c *Client) finishAllTunnels() {
	c.tunnelsMu.Lock()
	tunnels := make([]*InboundTunnel, 0, len(c.tunnels))
	for id, tunnel := range c.tunnels {
		tunnels = append(tunnels, tunnel)
		delete(c.tunnels, id)
	}
	c.tunnelsMu.Unlock()
	for _, tunnel := range tunnels {
		tunnel.finish()
	}
}

func (c *Client) pingLoop(
	ctx context.Context,
	conn net.Conn,
	done <-chan struct{},
) {
	ticker := time.NewTicker(c.cfg.PingInterval)
	defer ticker.Stop()
	for {
		select {
		case <-done:
			return
		case <-c.done:
			return
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.writeMu.Lock()
			_ = conn.SetWriteDeadline(time.Now().Add(c.cfg.PingTimeout))
			err := protocol.WritePing(conn, 0)
			_ = conn.SetWriteDeadline(time.Time{})
			c.writeMu.Unlock()
			if err != nil {
				_ = conn.Close()
				return
			}
		}
	}
}

func (c *Client) tokenRefreshLoop(ctx context.Context) {
	ticker := time.NewTicker(c.cfg.TokenRefreshInterval)
	defer ticker.Stop()
	for {
		select {
		case <-c.done:
			return
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.mu.Lock()
			currentToken := c.token
			c.mu.Unlock()
			newToken, err := c.cfg.TokenRefresher(ctx, currentToken)
			if err != nil {
				continue
			}
			c.mu.Lock()
			c.token = newToken
			c.mu.Unlock()
		}
	}
}

type InboundTunnel struct {
	owner  *Client
	open   protocol.TunnelOpenFrame
	ctx    context.Context
	cancel context.CancelFunc

	incoming chan []byte
	done     chan struct{}
	finished atomic.Bool
	accepted atomic.Bool

	readMu     sync.Mutex
	readBuffer []byte
	stateMu    sync.Mutex
	readUntil  time.Time
	writeUntil time.Time
	nextRead   uint64
	nextWrite  uint64
	readBytes  int64
	writeBytes int64
	maxBytes   int64
}

func newInboundTunnel(
	parent context.Context,
	owner *Client,
	open *protocol.TunnelOpenFrame,
	maxBytes int64,
) *InboundTunnel {
	ctx, cancel := context.WithCancel(parent)
	return &InboundTunnel{
		owner:     owner,
		open:      *open,
		ctx:       ctx,
		cancel:    cancel,
		incoming:  make(chan []byte, inboundTunnelQueueDepth),
		done:      make(chan struct{}),
		nextRead:  1,
		nextWrite: 1,
		maxBytes:  maxBytes,
	}
}

func (t *InboundTunnel) RouteID() string {
	return t.open.RouteID
}

func (t *InboundTunnel) RouteGeneration() uint64 {
	return t.open.RouteGeneration
}

func (t *InboundTunnel) CallerStationPeerID() string {
	return t.open.CallerStationPeerID
}

func (t *InboundTunnel) Purpose() federationmodel.RelayTunnelPurpose {
	return t.open.Purpose
}

func (t *InboundTunnel) Accept() error {
	if t.finished.Load() {
		return ErrTunnelClosed
	}
	if t.accepted.Swap(true) {
		return ErrTunnelProtocol
	}
	conn := t.owner.activeConn()
	if conn == nil {
		return ErrNotConnected
	}
	t.owner.writeMu.Lock()
	err := protocol.WriteTunnelOpened(conn, t.open.TunnelID)
	t.owner.writeMu.Unlock()
	return err
}

func (t *InboundTunnel) acceptData(frame *protocol.TunnelDataFrame) error {
	t.stateMu.Lock()
	if t.finished.Load() ||
		!t.accepted.Load() ||
		frame.Sequence != t.nextRead {
		t.stateMu.Unlock()
		return ErrTunnelProtocol
	}
	nextBytes := t.readBytes + int64(len(frame.Data))
	if nextBytes > t.maxBytes ||
		nextBytes+t.writeBytes > t.maxBytes*2 {
		t.stateMu.Unlock()
		return ErrTunnelOversize
	}
	t.nextRead++
	t.readBytes = nextBytes
	t.stateMu.Unlock()
	select {
	case t.incoming <- append([]byte(nil), frame.Data...):
		return nil
	default:
		return ErrTunnelProtocol
	}
}

func (t *InboundTunnel) Read(buffer []byte) (int, error) {
	t.readMu.Lock()
	defer t.readMu.Unlock()
	for len(t.readBuffer) == 0 {
		select {
		case chunk := <-t.incoming:
			t.readBuffer = chunk
			continue
		default:
		}
		timer, timerC := deadlineTimer(t.readDeadline())
		select {
		case chunk := <-t.incoming:
			t.readBuffer = chunk
		case <-t.done:
			stopTimer(timer)
			return 0, io.EOF
		case <-timerC:
			return 0, timeoutError{}
		}
		stopTimer(timer)
	}
	n := copy(buffer, t.readBuffer)
	t.readBuffer = t.readBuffer[n:]
	return n, nil
}

func (t *InboundTunnel) Write(data []byte) (int, error) {
	if len(data) == 0 {
		return 0, nil
	}
	if t.finished.Load() {
		return 0, ErrTunnelClosed
	}
	written := 0
	for len(data) > 0 {
		size := min(len(data), protocol.MaxTunnelDataLen)
		chunk := data[:size]
		t.stateMu.Lock()
		if t.finished.Load() {
			t.stateMu.Unlock()
			return written, ErrTunnelClosed
		}
		if deadlineExpired(t.writeUntil) {
			t.stateMu.Unlock()
			return written, timeoutError{}
		}
		nextBytes := t.writeBytes + int64(len(chunk))
		if nextBytes > t.maxBytes ||
			t.readBytes+nextBytes > t.maxBytes*2 {
			t.stateMu.Unlock()
			return written, ErrTunnelOversize
		}
		sequence := t.nextWrite
		t.nextWrite++
		t.writeBytes = nextBytes
		t.stateMu.Unlock()

		conn := t.owner.activeConn()
		if conn == nil {
			return written, ErrNotConnected
		}
		t.owner.writeMu.Lock()
		err := protocol.WriteTunnelData(
			conn,
			t.open.TunnelID,
			sequence,
			chunk,
		)
		t.owner.writeMu.Unlock()
		if err != nil {
			return written, err
		}
		written += len(chunk)
		data = data[size:]
	}
	return written, nil
}

func (t *InboundTunnel) Close() error {
	if !t.finished.Load() {
		t.owner.finishTunnel(
			t.open.TunnelID,
			federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_NORMAL,
			true,
		)
	}
	return nil
}

func (t *InboundTunnel) finish() {
	if t.finished.Swap(true) {
		return
	}
	t.cancel()
	close(t.done)
}

func (t *InboundTunnel) LocalAddr() net.Addr {
	return tunnelAddr("station-inner-tls")
}

func (t *InboundTunnel) RemoteAddr() net.Addr {
	return tunnelAddr("relay-opaque-tunnel")
}

func (t *InboundTunnel) SetDeadline(deadline time.Time) error {
	t.stateMu.Lock()
	t.readUntil = deadline
	t.writeUntil = deadline
	t.stateMu.Unlock()
	return nil
}

func (t *InboundTunnel) SetReadDeadline(deadline time.Time) error {
	t.stateMu.Lock()
	t.readUntil = deadline
	t.stateMu.Unlock()
	return nil
}

func (t *InboundTunnel) SetWriteDeadline(deadline time.Time) error {
	t.stateMu.Lock()
	t.writeUntil = deadline
	t.stateMu.Unlock()
	return nil
}

func (t *InboundTunnel) readDeadline() time.Time {
	t.stateMu.Lock()
	defer t.stateMu.Unlock()
	return t.readUntil
}

type tunnelAddr string

func (a tunnelAddr) Network() string { return "relay-tunnel" }
func (a tunnelAddr) String() string  { return string(a) }

type timeoutError struct{}

func (timeoutError) Error() string   { return "relay tunnel deadline exceeded" }
func (timeoutError) Timeout() bool   { return true }
func (timeoutError) Temporary() bool { return true }

func deadlineTimer(deadline time.Time) (*time.Timer, <-chan time.Time) {
	if deadline.IsZero() {
		return nil, nil
	}
	duration := time.Until(deadline)
	if duration <= 0 {
		channel := make(chan time.Time)
		close(channel)
		return nil, channel
	}
	timer := time.NewTimer(duration)
	return timer, timer.C
}

func stopTimer(timer *time.Timer) {
	if timer != nil {
		timer.Stop()
	}
}

func deadlineExpired(deadline time.Time) bool {
	return !deadline.IsZero() && !deadline.After(time.Now())
}
