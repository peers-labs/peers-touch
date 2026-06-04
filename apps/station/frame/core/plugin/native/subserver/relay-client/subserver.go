// Package relayclient implements the station-side driver that mounts the local
// Station onto a remote Relay subserver. It is the missing piece between the
// existing relay/client library (which knows how to speak the framed TCP
// protocol) and the Hertz HTTP server we want to expose through the relay's
// /relay/forward/<peer>/<path> endpoint.
//
// Lifecycle (Start spawns a single goroutine running run()):
//
//  1. Wait for the local /sub-bootstrap/info endpoint to expose our peer_id.
//     Subserver Start order is non-deterministic and the local Hertz HTTP
//     server may not yet be listening when Start is invoked.
//  2. Acquire a relay_token. We prefer a cached value at TokenStorePath; on
//     cache miss we POST /api/v1/relay/register with the InviteToken (which
//     the operator pre-distributed via tooling/scripts/pt-relay-issue-invites.sh)
//     and persist the resulting token.
//  3. Hand off to relay/client.Client which keeps the TCP stream alive,
//     reconnects on disconnect, and forwards request frames to a dispatcher
//     we provide. Our dispatcher loops every incoming HTTP request back into
//     the local Hertz server on 127.0.0.1:<LocalHTTPPort>.
//
// Layering note: this subserver lives in frame/core/plugin/native and reuses
// frame-layer components only. It does not touch apps/station/app and does
// not introduce app-layer protocol concerns; it is a thin pump that wires
// two existing native plugins together.
package relayclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/client"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/protocol"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

// federationHandle adapts SubServer into a federation.RelayClientHandle
// so the federation resolver can borrow the relay-access token without
// taking ownership of token lifecycle. Methods read live state from the
// owning subserver — the resolver always sees the freshest credentials.
type federationHandle struct {
	sub *SubServer
}

func (f federationHandle) BaseURL() string {
	if f.sub == nil {
		return ""
	}
	return strings.TrimRight(f.sub.opts.RelayURL, "/")
}

func (f federationHandle) Token() string {
	if f.sub == nil {
		return ""
	}
	return f.sub.getToken()
}

// Publish forwards to the embedded *client.Client. Error semantics:
//
//   - federation.ErrRelayNotConnected when the stream is currently
//     down (relay disabled, transport flap mid-publish, runner not
//     yet built). Callers can errors.Is on the federation-package
//     sentinel without importing this subserver.
//   - any other error means the write failed mid-flight; the read
//     loop will detect a broken conn shortly and re-handshake. The
//     publisher should treat any error as "fall through to slow
//     path" (next periodic republish + receiver TTL).
func (f federationHandle) Publish(ctx context.Context, topic string, body []byte) error {
	if f.sub == nil {
		return federation.ErrRelayNotConnected
	}
	r := f.sub.getRunner()
	if r == nil {
		return federation.ErrRelayNotConnected
	}
	if err := r.Publish(ctx, topic, body); err != nil {
		// The runner's sentinel is package-private to relay/client;
		// re-map onto the federation-package sentinel so callers
		// upstream don't need to know about the layering.
		if errors.Is(err, client.ErrNotConnected) {
			return federation.ErrRelayNotConnected
		}
		return err
	}
	return nil
}

// SubserverTypeRelayClient names this subserver in the framework's registry.
// It deliberately avoids the bare "relay" name to keep semantic distance from
// the existing relay subserver, which serves the OPPOSITE side of the protocol.
const SubserverTypeRelayClient server.SubserverType = "relay-client"

var _ server.Subserver = &SubServer{}

// SubServer mounts the local Station onto a remote Relay.
type SubServer struct {
	opts *Options

	mu     sync.Mutex
	status server.Status
	cancel context.CancelFunc
	runner *client.Client

	// tokenMu guards currentToken. The token is read by both the heartbeat
	// goroutine and the token-refresher callback; we keep them in lockstep
	// instead of re-reading from disk on every tick.
	tokenMu      sync.RWMutex
	currentToken string
}

// setToken stores the latest relay_token. Callers are: initial register,
// token refresher, and any future revoke-and-replace path.
func (s *SubServer) setToken(t string) {
	s.tokenMu.Lock()
	s.currentToken = t
	s.tokenMu.Unlock()
}

// getToken returns the latest relay_token, or empty string if none acquired.
func (s *SubServer) getToken() string {
	s.tokenMu.RLock()
	defer s.tokenMu.RUnlock()
	return s.currentToken
}

// getRunner returns the live *client.Client under the subserver lock,
// or nil while we are between connect cycles. Read-only; callers MUST
// NOT mutate its state.
func (s *SubServer) getRunner() *client.Client {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.runner
}

// NewRelayClientSubServer constructs the subserver from accumulated options.
func NewRelayClientSubServer(opts ...option.Option) server.Subserver {
	o := option.GetOptions(opts...).Ctx().Value(optionsKey{}).(*Options)
	return &SubServer{opts: o}
}

// Name returns the subserver identifier shown in framework logs.
func (s *SubServer) Name() string { return "relay-client" }

// Status returns the current lifecycle status.
func (s *SubServer) Status() server.Status { return s.status }

// Type returns the registry-level subserver type.
func (s *SubServer) Type() server.SubserverType { return SubserverTypeRelayClient }

// Address returns nothing — relay-client only opens an outbound connection.
func (s *SubServer) Address() server.SubserverAddress { return server.SubserverAddress{} }

// Handlers returns no HTTP handlers — relay-client is a one-way driver.
func (s *SubServer) Handlers() []server.Handler { return nil }

// Init applies any extra options. Validation happens in Start so that the
// framework can still init even when configuration is incomplete (for example
// when an operator forgot to pass an invite-token but expects a cached token
// to exist on disk).
func (s *SubServer) Init(ctx context.Context, opts ...option.Option) error {
	for _, opt := range opts {
		s.opts.Apply(opt)
	}
	logger.Infof(ctx, "[relay-client] init enabled=%v relay=%s stream=%s",
		s.opts.Enabled, s.opts.RelayURL, s.opts.RelayStreamAddr)
	return nil
}

// Start kicks off the resolve → register → mount pipeline in a single
// background goroutine. Returns immediately so it does not block sibling
// subservers' Start.
func (s *SubServer) Start(ctx context.Context, opts ...option.Option) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.status.IsRunning() {
		return errors.New("relay-client is already running")
	}
	if !s.opts.Enabled {
		logger.Infof(ctx, "[relay-client] disabled, skipping mount")
		s.status = server.StatusStopped
		return nil
	}
	if s.opts.RelayURL == "" {
		return fmt.Errorf("[relay-client] relay-url is required when enabled=true")
	}
	if s.opts.RelayStreamAddr == "" {
		return fmt.Errorf("[relay-client] relay-stream-addr is required when enabled=true")
	}

	runCtx, cancel := context.WithCancel(ctx)
	s.cancel = cancel
	s.status = server.StatusRunning

	go s.run(runCtx)

	logger.Infof(ctx, "[relay-client] started; relay=%s stream=%s label=%q",
		s.opts.RelayURL, s.opts.RelayStreamAddr, s.opts.Label)
	return nil
}

// Stop cancels the run goroutine and tears down the underlying client.
func (s *SubServer) Stop(ctx context.Context) error {
	s.mu.Lock()
	cancel := s.cancel
	runner := s.runner
	s.cancel = nil
	s.runner = nil
	s.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if runner != nil {
		runner.Stop()
	}

	federation.ClearRelayClient()

	s.mu.Lock()
	s.status = server.StatusStopped
	s.mu.Unlock()
	logger.Infof(ctx, "[relay-client] stopped")
	return nil
}

// run drives the resolve → register → mount pipeline for the lifetime of ctx.
// All errors at this level are terminal for the current attempt: relay-client
// stops trying. Token-level errors inside client.Client are recoverable via
// its own reconnect loop. This split keeps the subserver-level concern
// ("can we even mount?") distinct from the connection-level concern ("did we
// briefly drop?").
func (s *SubServer) run(ctx context.Context) {
	peerID, err := s.waitForStationPeerID(ctx)
	if err != nil {
		logger.Errorf(ctx, "[relay-client] could not resolve station peer id: %v", err)
		return
	}
	logger.Infof(ctx, "[relay-client] resolved station_peer_id=%s", peerID)

	relayToken, err := s.acquireRelayToken(ctx, peerID)
	if err != nil {
		logger.Errorf(ctx, "[relay-client] could not acquire relay token: %v", err)
		return
	}
	s.setToken(relayToken)
	federation.RegisterRelayClient(federationHandle{sub: s})
	logger.Infof(ctx, "[relay-client] relay token acquired, opening stream")

	cli := client.New(client.Config{
		RelayAddr:             s.opts.RelayStreamAddr,
		RelayToken:            relayToken,
		StationPeerID:         peerID,
		Dispatcher:            s.makeDispatcher(),
		TokenRefresher:        s.makeTokenRefresher(),
		BroadcastHandler:      s.makeBroadcastHandler(),
		UseTLS:                s.opts.UseTLS,
		TLSInsecureSkipVerify: s.opts.TLSInsecureSkipVerify,
	})

	s.mu.Lock()
	s.runner = cli
	s.mu.Unlock()

	// Heartbeat keeps the relay's mount table marked Online and resets
	// last_heartbeat in the relay's DB. Stream-level pings handle dead
	// connections; this HTTP heartbeat is an application-level liveness
	// signal that survives across reconnects.
	go s.runHeartbeat(ctx)

	cli.Run(ctx)

	<-ctx.Done()
	logger.Infof(ctx, "[relay-client] run loop exiting: %v", ctx.Err())
}

// runHeartbeat posts /api/v1/relay/heartbeat every HeartbeatInterval until
// ctx is cancelled. It uses the latest token surfaced by setToken, so it
// transparently follows token refreshes. A failed heartbeat is logged and
// retried on the next tick — we never want to crash the subserver because
// of a transient network blip.
func (s *SubServer) runHeartbeat(ctx context.Context) {
	interval := time.Duration(s.opts.HeartbeatIntervalSec) * time.Second
	if interval <= 0 {
		interval = 30 * time.Second
	}
	url := strings.TrimRight(s.opts.RelayURL, "/") + "/api/v1/relay/heartbeat"
	cl := &http.Client{Timeout: 10 * time.Second}

	tick := time.NewTicker(interval)
	defer tick.Stop()

	send := func() {
		token := s.getToken()
		if token == "" {
			return
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader([]byte("{}")))
		if err != nil {
			logger.Warnf(ctx, "[relay-client] heartbeat build request: %v", err)
			return
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		resp, err := cl.Do(req)
		if err != nil {
			logger.Warnf(ctx, "[relay-client] heartbeat send: %v", err)
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 300 {
			body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
			logger.Warnf(ctx, "[relay-client] heartbeat status=%d body=%s",
				resp.StatusCode, strings.TrimSpace(string(body)))
		}
	}

	send()

	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			send()
		}
	}
}

// waitForStationPeerID polls the local /sub-bootstrap/info endpoint until it
// returns a non-empty peer_id. We do not assume a startup ordering between
// the relay-client subserver and the bootstrap subserver / Hertz HTTP listener;
// if everything is wired correctly the first probe succeeds, otherwise we
// retry with bounded exponential backoff until ctx is cancelled.
func (s *SubServer) waitForStationPeerID(ctx context.Context) (string, error) {
	const maxBackoff = 30 * time.Second
	bo := time.Second

	for {
		peerID, err := s.fetchBootstrapPeerID(ctx)
		if err == nil && peerID != "" {
			return peerID, nil
		}
		if err != nil {
			logger.Debugf(ctx, "[relay-client] bootstrap info not ready: %v", err)
		}

		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(bo):
		}

		if bo < maxBackoff {
			bo *= 2
			if bo > maxBackoff {
				bo = maxBackoff
			}
		}
	}
}

func (s *SubServer) fetchBootstrapPeerID(ctx context.Context) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.opts.BootstrapInfoURL, nil)
	if err != nil {
		return "", err
	}
	cl := &http.Client{Timeout: 5 * time.Second}
	resp, err := cl.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("status=%d", resp.StatusCode)
	}
	var out struct {
		PeerID string `json:"peer_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	return out.PeerID, nil
}

// acquireRelayToken returns a usable relay_token. Cache-first: if a previously
// issued token exists at TokenStorePath we trust it as long as the file is
// non-empty. The relay subserver is the source of truth for token expiry and
// will reject expired tokens at handshake time, which surfaces in client logs.
//
// On cache miss we exchange the invite_token for a relay_token via /register
// and persist the new value so future restarts do not consume a fresh invite.
func (s *SubServer) acquireRelayToken(ctx context.Context, peerID string) (string, error) {
	if s.opts.TokenStorePath != "" {
		if data, err := os.ReadFile(s.opts.TokenStorePath); err == nil {
			t := strings.TrimSpace(string(data))
			if t != "" {
				logger.Infof(ctx, "[relay-client] reusing cached relay token from %s", s.opts.TokenStorePath)
				return t, nil
			}
		}
	}

	if s.opts.InviteToken == "" {
		return "", fmt.Errorf("no cached relay token at %q and invite-token is empty", s.opts.TokenStorePath)
	}

	relayToken, err := s.callRegister(ctx, peerID)
	if err != nil {
		return "", err
	}
	if s.opts.TokenStorePath != "" {
		if err := os.MkdirAll(filepath.Dir(s.opts.TokenStorePath), 0o700); err == nil {
			if werr := os.WriteFile(s.opts.TokenStorePath, []byte(relayToken), 0o600); werr != nil {
				logger.Warnf(ctx, "[relay-client] could not persist relay token to %s: %v", s.opts.TokenStorePath, werr)
			}
		}
	}
	return relayToken, nil
}

func (s *SubServer) callRegister(ctx context.Context, peerID string) (string, error) {
	body, _ := json.Marshal(map[string]string{
		"invite_token": s.opts.InviteToken,
		"label":        s.opts.Label,
	})
	url := strings.TrimRight(s.opts.RelayURL, "/") + "/api/v1/relay/register"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Station-Peer-ID", peerID)

	cl := &http.Client{Timeout: 30 * time.Second}
	resp, err := cl.Do(req)
	if err != nil {
		return "", fmt.Errorf("dial relay: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("relay register status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	var out struct {
		RelayToken string `json:"relay_token"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("relay register decode: %w (body=%s)", err, strings.TrimSpace(string(raw)))
	}
	if out.RelayToken == "" {
		return "", fmt.Errorf("relay register response missing relay_token: %s", strings.TrimSpace(string(raw)))
	}
	return out.RelayToken, nil
}

// makeDispatcher returns a relay/client.Dispatcher that loops every incoming
// forwarded request back into the local Hertz server. We strip hop-by-hop
// headers so they are not blindly proxied — they describe the relay→station
// hop, not the station→loopback hop.
func (s *SubServer) makeDispatcher() client.Dispatcher {
	base := fmt.Sprintf("http://127.0.0.1:%d", s.opts.LocalHTTPPort)
	timeout := time.Duration(s.opts.LocalHTTPTimeoutSec) * time.Second
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	cl := &http.Client{Timeout: timeout}
	return func(ctx context.Context, req *protocol.RequestFrame) (uint32, map[string]string, []byte, error) {
		url := base + req.Path
		httpReq, err := http.NewRequestWithContext(ctx, req.Method, url, bytes.NewReader(req.Body))
		if err != nil {
			return http.StatusBadGateway, map[string]string{"Content-Type": "text/plain"}, []byte(err.Error()), nil
		}
		for k, v := range req.Headers {
			if isHopByHop(k) {
				continue
			}
			httpReq.Header.Set(k, v)
		}
		resp, err := cl.Do(httpReq)
		if err != nil {
			return http.StatusBadGateway,
				map[string]string{"Content-Type": "text/plain"},
				[]byte(err.Error()),
				nil
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		hdrs := make(map[string]string, len(resp.Header))
		for k, v := range resp.Header {
			if len(v) == 0 || isHopByHop(k) {
				continue
			}
			hdrs[k] = v[0]
		}
		return uint32(resp.StatusCode), hdrs, body, nil
	}
}

// makeBroadcastHandler bridges relay-client read-loop frames to the
// federation-registered subscriber. The handler is resolved lazily on
// every call so that a station which mounts federation AFTER the relay
// stream is up still receives events — there's no chicken-egg with
// startup ordering.
//
// We deliberately do NOT capture the handler at config-build time: at
// boot the touch-layer subscribers may not have registered yet, and a
// stale-nil capture would cause silent drops for the first few hundred
// milliseconds of the connection.
func (s *SubServer) makeBroadcastHandler() client.BroadcastHandler {
	return func(ctx context.Context, originPeerID, topic string, body []byte) {
		h := federation.GetBroadcastHandler()
		if h == nil {
			logger.Debugf(ctx, "[relay-client] dropped broadcast topic=%s origin=%s (no federation subscriber)",
				topic, originPeerID)
			return
		}
		h(ctx, originPeerID, topic, body)
	}
}

// makeTokenRefresher swaps the current relay_token for a freshly-signed one
// via /api/v1/relay/token/refresh. The refreshed token is persisted to disk
// so a subsequent station restart does not invalidate the live mount.
func (s *SubServer) makeTokenRefresher() client.TokenRefresher {
	return func(ctx context.Context, currentToken string) (string, error) {
		url := strings.TrimRight(s.opts.RelayURL, "/") + "/api/v1/relay/token/refresh"
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, nil)
		if err != nil {
			return "", err
		}
		req.Header.Set("Authorization", "Bearer "+currentToken)
		cl := &http.Client{Timeout: 15 * time.Second}
		resp, err := cl.Do(req)
		if err != nil {
			return "", err
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return "", fmt.Errorf("status=%d", resp.StatusCode)
		}
		var out struct {
			RelayToken string `json:"relay_token"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
			return "", err
		}
		if out.RelayToken == "" {
			return "", fmt.Errorf("missing relay_token in refresh response")
		}
		if s.opts.TokenStorePath != "" {
			if werr := os.WriteFile(s.opts.TokenStorePath, []byte(out.RelayToken), 0o600); werr != nil {
				logger.Warnf(ctx, "[relay-client] could not persist refreshed token: %v", werr)
			}
		}
		s.setToken(out.RelayToken)
		return out.RelayToken, nil
	}
}

// hopByHopHeaders enumerates the standard RFC 7230 §6.1 hop-by-hop headers
// plus Host, which we never want to copy from one hop to another because it
// would break loopback addressing.
var hopByHopHeaders = map[string]struct{}{
	"Connection":          {},
	"Keep-Alive":          {},
	"Proxy-Authenticate":  {},
	"Proxy-Authorization": {},
	"Te":                  {},
	"Trailer":             {},
	"Transfer-Encoding":   {},
	"Upgrade":             {},
	"Host":                {},
}

func isHopByHop(h string) bool {
	_, ok := hopByHopHeaders[http.CanonicalHeaderKey(h)]
	return ok
}
