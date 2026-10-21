// Package pluginlark is the Lark channel plugin: it owns the platform WebSocket
// connection generations, normalizes private-message events and delivers
// replies through the OpenAPI. Station business code never imports this
// package; it is built as the lark-channel-plugin binary.
//
// The generation client is a port of the reference product's lark_ws_client:
// the official larkws.Client is not used because its retry/ping goroutines
// cannot be cancelled across reconnect generations. Only the SDK's stateless
// pieces are reused (frame codec, ping frame, endpoint contract).
package pluginlark

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	larkws "github.com/larksuite/oapi-sdk-go/v3/ws"
)

// ConnectionState mirrors the channel proto connection states.
type ConnectionState int

const (
	StateStopped ConnectionState = iota
	StateConnecting
	StateConnected
	StateReconnecting
	StateUnauthorized
	StateFailed
)

func (s ConnectionState) protoName() string {
	switch s {
	case StateConnecting:
		return "connecting"
	case StateConnected:
		return "connected"
	case StateReconnecting:
		return "reconnecting"
	case StateUnauthorized:
		return "unauthorized"
	case StateFailed:
		return "failed"
	default:
		return "stopped"
	}
}

// TerminalError marks a non-retryable failure (auth rejected, endpoint
// forbidden). A new client generation is required after the credential or
// configuration is repaired.
type TerminalError struct{ Err error }

func (e *TerminalError) Error() string { return e.Err.Error() }
func (e *TerminalError) Unwrap() error { return e.Err }

type runtimeConfig struct {
	reconnectCount    int
	reconnectInterval time.Duration
	reconnectNonce    time.Duration
	pingInterval      time.Duration
}

// EventHandler processes one platform event payload and returns the frame
// response. A non-nil error makes the client acknowledge with HTTP 500 so
// the platform redelivers; handlers must stay within the platform's 3s budget.
type EventHandler func(ctx context.Context, payload []byte) (any, error)

// StateObserver receives connection generation transitions.
type StateObserver func(state ConnectionState, reason string)

// WSConfig configures one binding's WebSocket client.
type WSConfig struct {
	AppID     string
	AppSecret string
	// BaseURL is the OpenAPI root (overridable for tests); empty uses the
	// official Feishu host.
	BaseURL string

	OnEvent EventHandler
	OnState StateObserver

	HTTPClient *http.Client
}

// wsClient owns one cancellable Run loop with reconnect. Each binding start
// builds a fresh client; Stop waits for every connection goroutine to exit so
// a replaced generation cannot stay attached to the platform and steal
// cluster-sharded events.
type wsClient struct {
	cfg WSConfig

	mu     sync.Mutex
	conn   *websocket.Conn
	cancel context.CancelFunc
	done   chan struct{}

	writeMu sync.Mutex
	partial map[string]partialFrame
	config  runtimeConfig
}

type partialFrame struct {
	parts     [][]byte
	totalSize int
	expiresAt time.Time
}

const (
	partialFrameTTL        = 5 * time.Second
	partialFrameMaxEntries = 1024
	partialFrameMaxParts   = 1024
	partialFrameMaxBytes   = 16 << 20

	defaultReconnectInterval = 5 * time.Second
	defaultReconnectNonce    = 30 * time.Second
	defaultPingInterval      = 2 * time.Minute
)

func newWSClient(cfg WSConfig) *wsClient {
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = http.DefaultClient
	}
	return &wsClient{
		cfg:  cfg,
		done: make(chan struct{}),
		config: runtimeConfig{
			// -1 = retry forever across disconnected periods; a successful
			// connection resets the period budget.
			reconnectCount:    -1,
			reconnectInterval: defaultReconnectInterval,
			reconnectNonce:    defaultReconnectNonce,
			pingInterval:      defaultPingInterval,
		},
	}
}

// Run dials and receives until ctx is cancelled or a terminal error ends the
// generation.
func (c *wsClient) Run(parent context.Context) error {
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	c.mu.Lock()
	c.cancel = cancel
	c.mu.Unlock()
	defer func() {
		c.closeConn()
		cancel()
		close(c.done)
	}()

	attempt := 0
	everConnected := false
	for {
		c.notify(stateForAttempt(everConnected, attempt), "")

		connected, err := c.connectAndReceive(ctx)
		if ctx.Err() != nil {
			return nil
		}
		var terminal *TerminalError
		if errors.As(err, &terminal) {
			c.notify(StateUnauthorized, terminal.Error())
			return terminal
		}
		if connected {
			everConnected = true
			attempt = 0
		} else {
			attempt++
		}

		cfg := c.configSnapshot()
		if cfg.reconnectCount >= 0 && attempt > cfg.reconnectCount {
			c.notify(StateFailed, fmt.Sprintf("reconnect budget exhausted: %v", err))
			return fmt.Errorf("unable to connect to Lark WebSocket after %d retries: %w", cfg.reconnectCount, err)
		}
		delay := cfg.reconnectInterval
		if attempt <= 1 && cfg.reconnectNonce > 0 {
			delay = time.Duration(rand.Int63n(int64(cfg.reconnectNonce)))
		}
		c.notify(StateReconnecting, errString(err))
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
	}
}

func stateForAttempt(everConnected bool, attempt int) ConnectionState {
	if everConnected || attempt > 0 {
		return StateReconnecting
	}
	return StateConnecting
}

// Stop cancels the generation and waits until all goroutines exit.
func (c *wsClient) Stop() {
	c.mu.Lock()
	cancel := c.cancel
	c.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn != nil {
		_ = conn.Close()
	}
	<-c.done
}

func (c *wsClient) notify(state ConnectionState, reason string) {
	if c.cfg.OnState != nil {
		c.cfg.OnState(state, reason)
	}
}

type endpointResponse struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Data *struct {
		URL          string               `json:"URL,omitempty"`
		ClientConfig *larkws.ClientConfig `json:"ClientConfig,omitempty"`
	} `json:"data"`
}

func (c *wsClient) getEndpoint(ctx context.Context) (string, *larkws.ClientConfig, error) {
	base := strings.TrimRight(c.cfg.BaseURL, "/")
	if base == "" {
		base = "https://open.feishu.cn"
	}
	body, _ := json.Marshal(map[string]string{
		"AppID":     c.cfg.AppID,
		"AppSecret": c.cfg.AppSecret,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+larkws.GenEndpointUri, bytes.NewReader(body))
	if err != nil {
		return "", nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.cfg.HTTPClient.Do(req)
	if err != nil {
		return "", nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return "", nil, classifyHandshake(resp)
	}
	var parsed endpointResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", nil, err
	}
	if parsed.Code != 0 {
		err := fmt.Errorf("endpoint code %d: %s", parsed.Code, parsed.Msg)
		if parsed.Code != larkws.SystemBusy && parsed.Code != larkws.InternalError {
			return "", nil, &TerminalError{Err: err}
		}
		return "", nil, err
	}
	if parsed.Data == nil || strings.TrimSpace(parsed.Data.URL) == "" {
		return "", nil, errors.New("lark websocket endpoint is empty")
	}
	return parsed.Data.URL, parsed.Data.ClientConfig, nil
}

func classifyHandshake(resp *http.Response) error {
	code, _ := strconv.Atoi(resp.Header.Get(larkws.HeaderHandshakeStatus))
	msg := strings.TrimSpace(resp.Header.Get(larkws.HeaderHandshakeMsg))
	err := fmt.Errorf("websocket handshake status=%d code=%d message=%s", resp.StatusCode, code, msg)
	authCode, _ := strconv.Atoi(resp.Header.Get(larkws.HeaderHandshakeAuthErrCode))
	if code == larkws.Forbidden || (code == larkws.AuthFailed && authCode == larkws.ExceedConnLimit) {
		return &TerminalError{Err: err}
	}
	return err
}

func (c *wsClient) connectAndReceive(ctx context.Context) (bool, error) {
	endpoint, sdkCfg, err := c.getEndpoint(ctx)
	if err != nil {
		return false, err
	}
	c.applyConfig(sdkCfg)

	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	conn, resp, err := dialer.DialContext(ctx, endpoint, nil)
	if err != nil {
		if resp != nil {
			defer resp.Body.Close()
			return false, classifyHandshake(resp)
		}
		return false, err
	}
	c.mu.Lock()
	if ctx.Err() != nil {
		c.mu.Unlock()
		_ = conn.Close()
		return false, ctx.Err()
	}
	c.conn = conn
	c.mu.Unlock()
	defer c.closeConn()
	c.notify(StateConnected, "")

	connCtx, cancel := context.WithCancel(ctx)
	connDone := make(chan struct{})
	defer cancel()
	defer close(connDone)
	// Cancelling ctx alone does not unblock the blocking read; close the
	// websocket so receiveLoop exits promptly on stop/reconnect teardown.
	go func() {
		select {
		case <-ctx.Done():
			_ = conn.Close()
		case <-connDone:
		}
	}()
	pingDone := make(chan struct{})
	go func() {
		defer close(pingDone)
		c.pingLoop(connCtx, conn, endpoint, connDone)
	}()
	err = c.receiveLoop(ctx, conn)
	cancel()
	<-pingDone
	return true, err
}

func (c *wsClient) receiveLoop(ctx context.Context, conn *websocket.Conn) error {
	conn.SetReadLimit(partialFrameMaxBytes)
	for {
		messageType, body, err := conn.ReadMessage()
		if err != nil {
			return err
		}
		if messageType != websocket.BinaryMessage {
			continue
		}
		var frame larkws.Frame
		if err := frame.Unmarshal(body); err != nil {
			continue
		}
		headers := larkws.Headers(frame.Headers)
		switch larkws.FrameType(frame.Method) {
		case larkws.FrameTypeControl:
			if larkws.MessageType(headers.GetString(larkws.HeaderType)) == larkws.MessageTypePong && len(frame.Payload) > 0 {
				var cfg larkws.ClientConfig
				if err := json.Unmarshal(frame.Payload, &cfg); err == nil {
					c.applyConfig(&cfg)
				}
			}
		case larkws.FrameTypeData:
			if larkws.MessageType(headers.GetString(larkws.HeaderType)) != larkws.MessageTypeEvent {
				continue
			}
			assembled, ok, err := c.assemble(&frame, headers)
			if err != nil || !ok {
				continue
			}
			go c.handleEvent(ctx, conn, assembled, headers)
		}
	}
}

func (c *wsClient) assemble(frame *larkws.Frame, headers larkws.Headers) (*larkws.Frame, bool, error) {
	sum := headers.GetInt(larkws.HeaderSum)
	if sum <= 1 {
		return frame, true, nil
	}
	seq := headers.GetInt(larkws.HeaderSeq)
	messageID := strings.TrimSpace(headers.GetString(larkws.HeaderMessageID))
	if messageID == "" || sum > partialFrameMaxParts || seq < 0 || seq >= sum {
		return nil, false, fmt.Errorf("invalid fragment")
	}
	now := time.Now()
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.partial == nil {
		c.partial = make(map[string]partialFrame)
	}
	for id, p := range c.partial {
		if !now.Before(p.expiresAt) {
			delete(c.partial, id)
		}
	}
	p, ok := c.partial[messageID]
	if !ok {
		if len(c.partial) >= partialFrameMaxEntries {
			return nil, false, fmt.Errorf("fragment capacity reached")
		}
		p = partialFrame{parts: make([][]byte, sum), expiresAt: now.Add(partialFrameTTL)}
	} else if len(p.parts) != sum {
		delete(c.partial, messageID)
		return nil, false, fmt.Errorf("fragment sum changed")
	}
	if p.parts[seq] == nil {
		p.parts[seq] = append([]byte(nil), frame.Payload...)
		p.totalSize += len(frame.Payload)
		if p.totalSize > partialFrameMaxBytes {
			delete(c.partial, messageID)
			return nil, false, fmt.Errorf("fragment payload exceeds limit")
		}
	}
	for _, part := range p.parts {
		if part == nil {
			c.partial[messageID] = p
			return nil, true, nil
		}
	}
	delete(c.partial, messageID)
	frame.Payload = nil
	for _, part := range p.parts {
		frame.Payload = append(frame.Payload, part...)
	}
	return frame, true, nil
}

func (c *wsClient) handleEvent(parent context.Context, conn *websocket.Conn, frame *larkws.Frame, headers larkws.Headers) {
	started := time.Now()
	ctx, cancel := context.WithTimeout(parent, 3*time.Second)
	defer cancel()

	// Admitted work outlives the socket generation: a reconnect must not
	// cancel an in-flight event whose platform frame is still awaiting ack.
	response, handlerErr := c.cfg.OnEvent(context.WithoutCancel(ctx), frame.Payload)

	resp := larkws.NewResponseByCode(http.StatusOK)
	if handlerErr != nil {
		resp = larkws.NewResponseByCode(http.StatusInternalServerError)
	} else if response != nil {
		if data, err := json.Marshal(response); err == nil {
			resp.Data = data
		} else {
			resp = larkws.NewResponseByCode(http.StatusInternalServerError)
		}
	}
	payload, err := json.Marshal(resp)
	if err != nil {
		return
	}
	frame.Payload = payload
	headers.Add(larkws.HeaderBizRt, strconv.FormatInt(time.Since(started).Milliseconds(), 10))
	frame.Headers = headers
	body, err := frame.Marshal()
	if err != nil {
		return
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_ = conn.WriteMessage(websocket.BinaryMessage, body)
}

func (c *wsClient) pingLoop(ctx context.Context, conn *websocket.Conn, endpoint string, connDone <-chan struct{}) {
	serviceID := int32(0)
	if u, err := url.Parse(endpoint); err == nil {
		if id, err := strconv.ParseInt(u.Query().Get(larkws.ServiceID), 10, 32); err == nil {
			serviceID = int32(id)
		}
	}
	for {
		interval := c.configSnapshot().pingInterval
		if interval <= 0 {
			interval = defaultPingInterval
		}
		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-connDone:
			timer.Stop()
			return
		case <-timer.C:
			frame := larkws.NewPingFrame(serviceID)
			body, err := frame.Marshal()
			if err != nil {
				return
			}
			c.writeMu.Lock()
			err = conn.WriteMessage(websocket.BinaryMessage, body)
			c.writeMu.Unlock()
			if err != nil {
				return
			}
		}
	}
}

func (c *wsClient) applyConfig(sdkCfg *larkws.ClientConfig) {
	if sdkCfg == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if sdkCfg.ReconnectCount != 0 {
		c.config.reconnectCount = sdkCfg.ReconnectCount
	}
	if sdkCfg.ReconnectInterval > 0 {
		c.config.reconnectInterval = time.Duration(sdkCfg.ReconnectInterval) * time.Second
	}
	if sdkCfg.ReconnectNonce >= 0 {
		c.config.reconnectNonce = time.Duration(sdkCfg.ReconnectNonce) * time.Second
	}
	if sdkCfg.PingInterval > 0 {
		c.config.pingInterval = time.Duration(sdkCfg.PingInterval) * time.Second
	}
}

func (c *wsClient) configSnapshot() runtimeConfig {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.config
}

func (c *wsClient) closeConn() {
	c.mu.Lock()
	conn := c.conn
	c.conn = nil
	c.mu.Unlock()
	if conn != nil {
		_ = conn.Close()
	}
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
