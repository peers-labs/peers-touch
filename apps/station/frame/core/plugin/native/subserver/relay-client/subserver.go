// Package relayclient mounts a Station onto a Relay and terminates opaque
// client-to-Station TLS inside the Station process.
//
// Lifecycle (Start spawns a single goroutine running run()):
//
//  1. Wait for the local /sub-bootstrap/info endpoint to expose our peer_id.
//     Subserver Start order is non-deterministic and the local Hertz HTTP
//     server may not yet be listening when Start is invoked.
//  2. Acquire a relay_token. We prefer a cached value at TokenStorePath; on
//     cache miss we complete challenge-bound enrollment with the operator's
//     one-time InviteToken and persist the resulting structured credential.
//  3. Hand off to relay/client.Client, which multiplexes opaque tunnels over
//     the authenticated mount stream.
//  4. Terminate inner TLS 1.3 and bridge decrypted HTTP to the canonical local
//     Station router. The Relay never receives method, path, headers, or body.
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
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/client"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

// federationHandle adapts SubServer into a federation.RelayClientHandle
// so the federation resolver can borrow the relay-access token without
// taking ownership of token lifecycle. Methods read live state from the
// owning subserver — the resolver always sees the freshest credentials.
type federationHandle struct {
	sub *SubServer
}

func (f federationHandle) Available() bool {
	return f.sub != nil &&
		f.sub.Status() == server.StatusRunning &&
		f.sub.getToken() != ""
}

func (f federationHandle) RelayOrigin() string {
	if f.sub == nil || f.sub.opts == nil {
		return ""
	}
	return strings.TrimRight(strings.TrimSpace(f.sub.opts.RelayURL), "/")
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

	mu              sync.Mutex
	status          server.Status
	enrollmentState string
	cancel          context.CancelFunc
	runner          *client.Client
	stationSigner   stationConnectionSigner
	innerTLS        *innerTLSIngress

	relayHTTPTransportOnce sync.Once
	relayHTTPTransport     *http.Transport

	routeMu         sync.RWMutex
	publishedRoutes map[string]uint64

	// tokenMu guards the complete current mount credential. Route and grant
	// issuance must bind the same Relay, Station, and generation as the token
	// used for registration.
	tokenMu           sync.RWMutex
	currentCredential *cachedMountCredential
}

// getToken returns the latest relay_token, or empty string if none acquired.
func (s *SubServer) getToken() string {
	s.tokenMu.RLock()
	defer s.tokenMu.RUnlock()
	if s.currentCredential == nil {
		return ""
	}
	return s.currentCredential.Token
}

func (s *SubServer) setCredential(credential *cachedMountCredential) {
	s.tokenMu.Lock()
	defer s.tokenMu.Unlock()
	if credential == nil {
		s.currentCredential = nil
		return
	}
	copy := *credential
	s.currentCredential = &copy
}

func (s *SubServer) getCredential() (*cachedMountCredential, bool) {
	s.tokenMu.RLock()
	defer s.tokenMu.RUnlock()
	if s.currentCredential == nil {
		return nil, false
	}
	copy := *s.currentCredential
	return &copy, true
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
	return &SubServer{
		opts:            o,
		publishedRoutes: make(map[string]uint64),
	}
}

// Name returns the subserver identifier shown in framework logs.
func (s *SubServer) Name() string { return "relay-client" }

// Status reports ready only after the Relay accepted the current mount
// credential and the stream handshake completed.
func (s *SubServer) Status() server.Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status
}

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

	if s.status != "" && s.status != server.StatusStopped {
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
	if err := validateRelayClientOptions(s.opts); err != nil {
		return fmt.Errorf("[relay-client] %w", err)
	}

	runCtx, cancel := context.WithCancel(ctx)
	s.cancel = cancel
	s.status = server.StatusStarting
	s.enrollmentState = "connecting"

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
	s.innerTLS = nil
	s.status = server.StatusStopping
	s.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if runner != nil {
		runner.Stop()
	}

	s.setCredential(nil)
	s.clearPublishedRoutes()
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
		s.setEnrollmentFailure(err)
		return
	}
	logger.Infof(ctx, "[relay-client] resolved station_peer_id=%s", peerID)

	ingress, err := newInnerTLSIngress(
		s.opts.LocalHTTPPort,
		time.Duration(s.opts.LocalHTTPTimeoutSec)*time.Second,
	)
	if err != nil {
		logger.Errorf(ctx, "[relay-client] initialize inner TLS ingress: %v", err)
		s.setEnrollmentFailure(err)
		return
	}
	s.mu.Lock()
	s.innerTLS = ingress
	s.mu.Unlock()

	credential, err := s.acquireRelayCredential(ctx, peerID)
	if err != nil {
		logger.Errorf(ctx, "[relay-client] could not acquire relay token: %v", err)
		s.setEnrollmentFailure(err)
		return
	}
	s.setCredential(credential)
	logger.Infof(ctx, "[relay-client] relay token acquired, opening stream")

	cli := client.New(client.Config{
		RelayAddr:              s.opts.RelayStreamAddr,
		RelayToken:             credential.Token,
		StationPeerID:          peerID,
		TunnelHandler:          s.handleInboundTunnel,
		TokenRefresher:         s.makeTokenRefresher(),
		CredentialRejected:     s.makeCredentialRejected(peerID),
		ConnectionStateChanged: s.setMountReady,
		BroadcastHandler:       s.makeBroadcastHandler(),
		UseTLS:                 s.opts.UseTLS,
		TLSInsecureSkipVerify:  s.opts.TLSInsecureSkipVerify,
		TokenRefreshInterval: time.Duration(
			s.opts.CredentialRefreshIntervalSec,
		) * time.Second,
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
	go s.runRoutePublisher(ctx)

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
	cl := s.relayHTTPClient(10 * time.Second)

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

func (s *SubServer) handleInboundTunnel(
	ctx context.Context,
	tunnel *client.InboundTunnel,
) {
	if tunnel == nil || !s.routeIsPublished(
		tunnel.RouteID(),
		tunnel.RouteGeneration(),
	) {
		return
	}
	s.mu.Lock()
	ingress := s.innerTLS
	s.mu.Unlock()
	if ingress != nil {
		ingress.Serve(ctx, tunnel)
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

// makeTokenRefresher rotates the current credential only after a fresh
// Station host-key proof.
func (s *SubServer) makeTokenRefresher() client.TokenRefresher {
	return func(ctx context.Context, currentToken string) (string, error) {
		credential, err := s.rotateRelayCredential(ctx, currentToken)
		if err != nil {
			return "", err
		}
		s.setCredential(credential)
		if err := s.persistRelayCredential(credential); err != nil {
			logger.Warnf(
				ctx,
				"[relay-client] could not persist rotated credential: %v",
				err,
			)
		}
		return credential.Token, nil
	}
}

func (s *SubServer) makeCredentialRejected(
	stationPeerID string,
) client.CredentialRejectedHandler {
	return func(ctx context.Context, _ string) (string, error) {
		if err := s.clearRelayCredential(); err != nil {
			logger.Warnf(ctx, "[relay-client] clear rejected credential: %v", err)
		}
		s.setEnrollmentRequired()
		credential, err := s.acquireRelayCredential(ctx, stationPeerID)
		if err != nil {
			s.setEnrollmentFailure(err)
			return "", err
		}
		s.setCredential(credential)
		return credential.Token, nil
	}
}

func (s *SubServer) setMountReady(connected bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if connected {
		s.status = server.StatusRunning
		s.enrollmentState = "mounted"
		federation.RegisterRelayClient(federationHandle{sub: s})
		go s.publishDefaultRoute(context.Background())
		return
	}
	if s.status != server.StatusStopping && s.status != server.StatusStopped {
		s.status = server.StatusStarting
		s.enrollmentState = "reconnecting"
	}
	s.clearPublishedRoutes()
	federation.ClearRelayClient()
}

func (s *SubServer) setEnrollmentRequired() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.status == server.StatusStopping || s.status == server.StatusStopped {
		return
	}
	s.status = server.StatusStarting
	s.enrollmentState = "enrollment_required"
}

func (s *SubServer) setEnrollmentFailure(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.status == server.StatusStopping || s.status == server.StatusStopped {
		return
	}
	s.status = server.StatusError
	if errors.Is(err, ErrEnrollmentRequired) {
		s.enrollmentState = "enrollment_required"
		return
	}
	s.enrollmentState = "error"
}
