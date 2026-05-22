package client

// 2026-04-07: Block 2 — writeMu protects all conn writes.
// 2026-04-07: Block 4 — reads handshake ACK from server; fails fast on NACK.
// 2026-04-07: Block 8 — optional TLS dialer.
// 2026-04-08: Sentinel errors for external error matching.

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/protocol"
)

// ---- Sentinel errors ----

var (
	ErrHandshakeRejected = errors.New("handshake rejected by relay")
	ErrDialFailed        = errors.New("failed to dial relay")
	// ErrNotConnected is returned by Publish when there is no active
	// stream to the relay. Callers (e.g. the locator hook) should treat
	// this as a soft failure: the next periodic republish will re-emit
	// the visibility change and downstream caches still age out via
	// TTL.
	//
	// The federation package re-exports this as
	// federation.ErrRelayNotConnected so consumers can errors.Is
	// without importing the subserver. The two values must remain
	// equal — see the adapter in relay-client/subserver.go.
	ErrNotConnected = errors.New("relay-client: not connected")
)

// Dispatcher is called for each incoming request frame from the relay.
type Dispatcher func(ctx context.Context, req *protocol.RequestFrame) (statusCode uint32, headers map[string]string, body []byte, err error)

// TokenRefresher returns a fresh relay token when the current one is near expiry.
type TokenRefresher func(ctx context.Context, currentToken string) (newToken string, err error)

// BroadcastHandler is invoked when the relay forwards a Broadcast
// frame to this station. `originPeerID` is the publisher's
// authenticated peer id (relay-stamped). Implementations should
// dispatch by topic and return promptly — the read loop is blocked
// until this returns. Long-running work belongs in a separate
// goroutine launched from the handler.
type BroadcastHandler func(ctx context.Context, originPeerID, topic string, body []byte)

type Config struct {
	RelayAddr     string
	RelayToken    string
	StationPeerID string

	Dispatcher     Dispatcher
	TokenRefresher TokenRefresher

	// BroadcastHandler receives pub/sub events forwarded by the relay
	// (Tier C1: federation invalidation). Optional — when nil, all
	// inbound Broadcast frames are dropped with a warn log.
	BroadcastHandler BroadcastHandler

	InitialBackoff time.Duration
	MaxBackoff     time.Duration

	PingInterval time.Duration
	PingTimeout  time.Duration

	TokenRefreshInterval time.Duration

	// TLS (Block 8): if true, dial with TLS; InsecureSkipVerify is for dev only.
	UseTLS                bool
	TLSInsecureSkipVerify bool
}

type Client struct {
	mu      sync.Mutex // protects conn and token
	conn    net.Conn
	writeMu sync.Mutex // protects all writes to conn (Block 2)
	token   string     // current relay token, guarded by mu

	cfg  Config
	done chan struct{}
}

func New(cfg Config) *Client {
	if cfg.InitialBackoff == 0 {
		cfg.InitialBackoff = 1 * time.Second
	}
	if cfg.MaxBackoff == 0 {
		cfg.MaxBackoff = 60 * time.Second
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
	return &Client{
		cfg:   cfg,
		token: cfg.RelayToken,
		done:  make(chan struct{}),
	}
}

func (c *Client) Run(ctx context.Context) {
	go c.connectLoop(ctx)
	if c.cfg.TokenRefresher != nil {
		go c.tokenRefreshLoop(ctx)
	}
}

func (c *Client) Stop() {
	close(c.done)
	c.mu.Lock()
	if c.conn != nil {
		_ = c.conn.Close()
	}
	c.mu.Unlock()
}

// Publish writes a Broadcast frame on the active relay stream. The
// `originPeerID` field is left blank — the relay will stamp it from
// the authenticated handshake before fan-out.
//
// Returns ErrNotConnected if the relay stream is currently down. The
// publish path is best-effort by design: if the relay is unreachable
// we accept the cache-staleness window (capped by republish + TTL).
//
// Thread-safe — multiple goroutines can Publish concurrently. The
// underlying writeMu serialises all writes to the conn.
func (c *Client) Publish(ctx context.Context, topic string, body []byte) error {
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn == nil {
		return ErrNotConnected
	}

	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	// Brief deadline so a misbehaving relay can't stall the caller
	// (visibility flips run on the user-visible PUT path).
	_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	err := protocol.WriteBroadcastFrame(conn, topic, "", body)
	_ = conn.SetWriteDeadline(time.Time{})
	if err != nil {
		// A write failure here means the conn is broken; the read
		// loop will detect it on the next ReadFrame and the
		// connectLoop will re-handshake. We just propagate the error
		// up — the publisher decides whether to retry or fall through
		// to the slow path.
		return fmt.Errorf("relay-client: publish topic=%s: %w", topic, err)
	}
	return nil
}

func (c *Client) connectLoop(ctx context.Context) {
	backoff := c.cfg.InitialBackoff

	for {
		select {
		case <-c.done:
			return
		default:
		}

		conn, br, err := c.dialAndHandshake(ctx)
		if err != nil {
			logger.Warnf(ctx, "[relay-client] connect failed: %v, retry in %v", err, backoff)
			select {
			case <-time.After(backoff):
			case <-c.done:
				return
			}
			backoff = min(backoff*2, c.cfg.MaxBackoff)
			continue
		}

		backoff = c.cfg.InitialBackoff
		c.mu.Lock()
		c.conn = conn
		c.mu.Unlock()

		logger.Infof(ctx, "[relay-client] connected to %s", c.cfg.RelayAddr)

		pingDone := make(chan struct{})
		go c.pingLoop(ctx, conn, pingDone)

		c.readLoop(ctx, br, conn)

		close(pingDone)
		_ = conn.Close()

		c.mu.Lock()
		c.conn = nil
		c.mu.Unlock()

		logger.Infof(ctx, "[relay-client] disconnected, will reconnect")
	}
}

type handshakePayload struct {
	RelayToken    string `json:"relay_token"`
	StationPeerID string `json:"station_peer_id"`
}

// handshakeACK mirrors the server's response (Block 4).
type handshakeACK struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

func (c *Client) dialAndHandshake(ctx context.Context) (net.Conn, *bufio.Reader, error) {
	var conn net.Conn
	var err error

	// Block 8: TLS support.
	if c.cfg.UseTLS {
		tlsCfg := &tls.Config{
			InsecureSkipVerify: c.cfg.TLSInsecureSkipVerify,
		}
		dialer := tls.Dialer{
			NetDialer: &net.Dialer{Timeout: 10 * time.Second},
			Config:    tlsCfg,
		}
		conn, err = dialer.DialContext(ctx, "tcp", c.cfg.RelayAddr)
	} else {
		dialer := net.Dialer{Timeout: 10 * time.Second}
		conn, err = dialer.DialContext(ctx, "tcp", c.cfg.RelayAddr)
	}
	if err != nil {
		return nil, nil, fmt.Errorf("%w: %v", ErrDialFailed, err)
	}

	// Read current token under lock (race fix).
	c.mu.Lock()
	currentToken := c.token
	c.mu.Unlock()

	hs := handshakePayload{
		RelayToken:    currentToken,
		StationPeerID: c.cfg.StationPeerID,
	}
	data, _ := json.Marshal(hs)
	data = append(data, '\n')

	_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	if _, err := conn.Write(data); err != nil {
		_ = conn.Close()
		return nil, nil, fmt.Errorf("handshake write: %w", err)
	}
	_ = conn.SetWriteDeadline(time.Time{})

	br := bufio.NewReader(conn)

	// Block 4: Read handshake ACK from server.
	_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	ackLine, err := br.ReadBytes('\n')
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

	return conn, br, nil
}

func (c *Client) readLoop(ctx context.Context, br *bufio.Reader, conn net.Conn) {
	for {
		select {
		case <-c.done:
			return
		default:
		}

		frame, err := protocol.ReadFrame(br)
		if err != nil {
			logger.Warnf(ctx, "[relay-client] read error: %v", err)
			return
		}

		switch f := frame.(type) {
		case *protocol.RequestFrame:
			go c.handleRequest(ctx, conn, f)

		case *protocol.PingFrame:
			// Block 2: write pong through writeMu.
			c.writeMu.Lock()
			writeErr := protocol.WritePong(conn, f.RequestID)
			c.writeMu.Unlock()
			if writeErr != nil {
				logger.Warnf(ctx, "[relay-client] pong write error: %v", writeErr)
				return
			}

		case *protocol.PongFrame:
			// Handled internally — ignore.

		case *protocol.BroadcastFrame:
			// Tier C1 — pub/sub. The handler is invoked off the read
			// loop so blocking work (DB lookups, fedcache eviction)
			// cannot stall heartbeat / response dispatch on this
			// connection. We deliberately mirror the RequestFrame
			// pattern above (`go c.handleRequest(...)`).
			if c.cfg.BroadcastHandler != nil {
				go c.cfg.BroadcastHandler(ctx, f.OriginPeerID, f.Topic, f.Body)
			} else {
				logger.Warnf(ctx, "[relay-client] dropped broadcast topic=%s origin=%s body_len=%d (no handler)",
					f.Topic, f.OriginPeerID, len(f.Body))
			}

		default:
			logger.Warnf(ctx, "[relay-client] unexpected frame type: %T", f)
		}
	}
}

func (c *Client) handleRequest(ctx context.Context, conn net.Conn, req *protocol.RequestFrame) {
	var statusCode uint32
	var headers map[string]string
	var body []byte

	if c.cfg.Dispatcher == nil {
		statusCode = 501
		headers = map[string]string{"Content-Type": "text/plain"}
		body = []byte("no dispatcher")
	} else {
		var err error
		statusCode, headers, body, err = c.cfg.Dispatcher(ctx, req)
		if err != nil {
			logger.Errorf(ctx, "[relay-client] dispatch error (req_id=%d): %v", req.RequestID, err)
			statusCode = 502
			headers = map[string]string{"Content-Type": "text/plain"}
			body = []byte(fmt.Sprintf("dispatch error: %v", err))
		}
	}

	// Block 2: all writes through writeMu.
	c.writeMu.Lock()
	writeErr := protocol.WriteResponseFrame(conn, req.RequestID, statusCode, headers, body)
	c.writeMu.Unlock()
	if writeErr != nil {
		logger.Errorf(ctx, "[relay-client] response write error (req_id=%d): %v", req.RequestID, writeErr)
	}
}

func (c *Client) pingLoop(ctx context.Context, conn net.Conn, done <-chan struct{}) {
	ticker := time.NewTicker(c.cfg.PingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-done:
			return
		case <-c.done:
			return
		case <-ticker.C:
			// Block 2: ping through writeMu.
			c.writeMu.Lock()
			_ = conn.SetWriteDeadline(time.Now().Add(c.cfg.PingTimeout))
			err := protocol.WritePing(conn, 0)
			_ = conn.SetWriteDeadline(time.Time{})
			c.writeMu.Unlock()
			if err != nil {
				logger.Warnf(ctx, "[relay-client] ping failed: %v", err)
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
		case <-ticker.C:
			c.mu.Lock()
			currentToken := c.token
			c.mu.Unlock()

			newToken, err := c.cfg.TokenRefresher(ctx, currentToken)
			if err != nil {
				logger.Warnf(ctx, "[relay-client] token refresh failed: %v", err)
				continue
			}

			c.mu.Lock()
			c.token = newToken
			c.mu.Unlock()
			logger.Infof(ctx, "[relay-client] token refreshed")
		}
	}
}
