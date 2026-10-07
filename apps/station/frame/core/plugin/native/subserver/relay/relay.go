package relay

// 2026-04-07: Block 1-8 refactoring (see CHANGELOG per block).
// 2026-04-08: Refactored — route auth wrappers are constructed in Init().
//             Metrics declarations moved to relay_metrics.go.

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/application"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/runtime/role"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

const (
	SubserverTypeRelay server.SubserverType = "relay"
)

var _ server.Subserver = &SubServer{}

type SubServer struct {
	opts    *Options
	status  server.Status
	svc     *application.Service
	streams *StreamManager
	tunnels *tunnelAdmission

	mountJWTWrapper        server.Wrapper
	mountRotateJWTWrapper  server.Wrapper
	routePublishJWTWrapper server.Wrapper
	operatorJWTWrapper     server.Wrapper

	listener       net.Listener
	publicListener net.Listener
	publicServer   *http.Server
	stopCh         chan struct{}
}

func (s *SubServer) Init(ctx context.Context, opts ...option.Option) error {
	for _, opt := range opts {
		s.opts.Apply(opt)
	}

	processRole, err := role.FromContext(ctx)
	if err != nil {
		return fmt.Errorf("[relay] resolve runtime role: %w", err)
	}
	if processRole != role.Relay {
		return fmt.Errorf("[relay] subserver cannot initialize under %q role", processRole)
	}

	securityMaterial, err := validateRelaySecurityOptions(s.opts)
	if err != nil {
		return err
	}
	authority, err := application.NewCredentialAuthority(
		securityMaterial.signingKey,
	)
	if err != nil {
		return fmt.Errorf("[relay] initialize credential authority: %w", err)
	}

	// Infrastructure layer: persistence
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return fmt.Errorf("[relay] failed to get RDS: %w", err)
	}

	repo := infrastructure.NewGormRepo(rds)
	if err := repo.AutoMigrate(); err != nil {
		return fmt.Errorf("[relay] failed to auto migrate: %w", err)
	}

	// Application layer: business logic
	s.svc = application.NewService(repo, authority)
	s.mountJWTWrapper = mountAuthenticationWrapper(
		s.svc,
		domain.ScopeMountConnect,
	)
	s.mountRotateJWTWrapper = mountAuthenticationWrapper(
		s.svc,
		domain.ScopeMountRotate,
	)
	s.routePublishJWTWrapper = mountAuthenticationWrapper(
		s.svc,
		domain.ScopeRoutePublish,
	)
	s.operatorJWTWrapper = operatorAuthenticationWrapper(
		securityMaterial.operatorKey,
		s.opts.OperatorIssuer,
		s.opts.OperatorAudience,
		s.opts.OperatorScope,
	)

	// Stream manager with status callback (Block 7: pass maxConcurrent).
	s.streams = NewStreamManager(func(
		ctx context.Context,
		peerID string,
		generation uint64,
		online bool,
	) {
		if online {
			if err := s.svc.UpdateMountStatus(
				ctx,
				peerID,
				generation,
				domain.MountStatusOnline,
			); err != nil && !errors.Is(err, domain.ErrMountCredentialStale) {
				logger.Errorf(ctx, "[relay] update mount status online for %s: %v", peerID, err)
			}
		} else {
			s.svc.InvalidateStationRoutes(peerID)
			if err := s.svc.UpdateMountStatus(
				ctx,
				peerID,
				generation,
				domain.MountStatusOffline,
			); err != nil && !errors.Is(err, domain.ErrMountCredentialStale) {
				logger.Errorf(ctx, "[relay] update mount status offline for %s: %v", peerID, err)
			}
		}
	}, s.opts.MaxConcurrentPerStation, int64(s.opts.MaxBodySize))
	s.tunnels = newTunnelAdmission(
		s.opts.MaxStations*s.opts.MaxConcurrentPerStation,
		min(8, s.opts.MaxConcurrentPerStation),
		s.opts.MaxConcurrentPerStation,
	)

	// Tier C1 — turn on the federation invalidation pub/sub topic.
	// We list it explicitly here (rather than auto-allowing every
	// topic) so adding new event types is a deliberate change with a
	// review trail. The relay drops anything not in this list.
	s.streams.SetAllowedBroadcastTopics(broadcastTopicFedInvalidate)

	s.stopCh = make(chan struct{})

	logger.Infof(ctx, "[relay] initialized, max_stations=%d, heartbeat_timeout=%ds, max_concurrent=%d",
		s.opts.MaxStations, s.opts.HeartbeatTimeout, s.opts.MaxConcurrentPerStation)
	return nil
}

// broadcastTopicFedInvalidate is the single relay-allowed pub/sub
// topic for Tier C1. Stations publish FederationInvalidation events
// here; the relay fans them out to every other connected station.
const broadcastTopicFedInvalidate = "fed.invalidate.v1"

func (s *SubServer) Start(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusRunning

	if s.opts.StreamListenAddr != "" {
		ln, err := s.listenStream()
		if err != nil {
			return fmt.Errorf("[relay] stream listen on %s: %w", s.opts.StreamListenAddr, err)
		}
		s.listener = ln
		go s.acceptLoop(ctx)
		logger.Infof(ctx, "[relay] stream listener started on %s (tls=%v)",
			s.opts.StreamListenAddr, s.opts.TLSCertFile != "")
	}
	if s.opts.PublicListenAddr != "" {
		if err := s.startPublicProxy(ctx); err != nil {
			if s.listener != nil {
				_ = s.listener.Close()
			}
			return fmt.Errorf(
				"[relay] public TLS listen on %s: %w",
				s.opts.PublicListenAddr,
				err,
			)
		}
	}

	go s.heartbeatChecker(ctx)
	go s.streamPinger(ctx)

	logger.Infof(ctx, "[relay] started")
	return nil
}

// listenStream creates a TLS 1.3 listener unless an explicit loopback-only
// development exception was validated during Init.
func (s *SubServer) listenStream() (net.Listener, error) {
	if s.opts.AllowInsecureLoopback &&
		s.opts.TLSCertFile == "" &&
		s.opts.TLSKeyFile == "" {
		return net.Listen("tcp", s.opts.StreamListenAddr)
	}

	cert, err := tls.LoadX509KeyPair(s.opts.TLSCertFile, s.opts.TLSKeyFile)
	if err != nil {
		return nil, fmt.Errorf("load TLS key pair: %w", err)
	}
	return tls.Listen("tcp", s.opts.StreamListenAddr, relayTLSConfig(cert))
}

func relayTLSConfig(cert tls.Certificate) *tls.Config {
	return &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS13,
	}
}

func (s *SubServer) startPublicProxy(ctx context.Context) error {
	target, err := url.Parse(s.opts.PublicUpstreamURL)
	if err != nil {
		return fmt.Errorf("parse public upstream URL: %w", err)
	}
	cert, err := tls.LoadX509KeyPair(s.opts.TLSCertFile, s.opts.TLSKeyFile)
	if err != nil {
		return fmt.Errorf("load public TLS key pair: %w", err)
	}
	rawListener, err := net.Listen("tcp", s.opts.PublicListenAddr)
	if err != nil {
		return err
	}
	proxy := newRelayPublicProxy(target)
	s.publicListener = tls.NewListener(rawListener, relayTLSConfig(cert))
	s.publicServer = &http.Server{
		Handler:           proxy,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       90 * time.Second,
	}
	go func() {
		if serveErr := s.publicServer.Serve(s.publicListener); serveErr != nil &&
			!errors.Is(serveErr, http.ErrServerClosed) {
			logger.Errorf(ctx, "[relay] public TLS listener failed: %v", serveErr)
		}
	}()
	logger.Infof(
		ctx,
		"[relay] public HTTPS/WSS listener started on %s",
		s.opts.PublicListenAddr,
	)
	return nil
}

func newRelayPublicProxy(target *url.URL) *httputil.ReverseProxy {
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Director = nil
	proxy.Rewrite = func(request *httputil.ProxyRequest) {
		request.SetURL(target)
		request.Out.Host = request.In.Host
		request.SetXForwarded()
		request.Out.Header.Set("X-Forwarded-Proto", "https")
	}
	proxy.ErrorHandler = func(
		response http.ResponseWriter,
		request *http.Request,
		proxyErr error,
	) {
		logger.Warnf(
			request.Context(),
			"[relay] public proxy request failed: %v",
			proxyErr,
		)
		http.Error(
			response,
			http.StatusText(http.StatusBadGateway),
			http.StatusBadGateway,
		)
	}
	return proxy
}

func (s *SubServer) Stop(ctx context.Context) error {
	s.status = server.StatusStopping
	defer func() { s.status = server.StatusStopped }()

	close(s.stopCh)

	if s.listener != nil {
		_ = s.listener.Close()
	}

	drainTimeout := time.Duration(s.opts.GracefulDrainTimeout) * time.Second
	if s.publicServer != nil {
		shutdownCtx, cancel := context.WithTimeout(ctx, drainTimeout)
		if err := s.publicServer.Shutdown(shutdownCtx); err != nil {
			_ = s.publicServer.Close()
		}
		cancel()
	}
	s.streams.DrainAndClose(ctx, drainTimeout)

	logger.Infof(ctx, "[relay] stopped")
	return nil
}

func (s *SubServer) Name() string                     { return "relay" }
func (s *SubServer) Status() server.Status            { return s.status }
func (s *SubServer) Type() server.SubserverType       { return SubserverTypeRelay }
func (s *SubServer) Address() server.SubserverAddress { return server.SubserverAddress{} }

func (s *SubServer) Handlers() []server.Handler {
	h := newRelayHandler(s)
	return h.handlers()
}

// ---- TCP stream accept loop ----

func (s *SubServer) acceptLoop(ctx context.Context) {
	for {
		conn, err := s.listener.Accept()
		if err != nil {
			select {
			case <-s.stopCh:
				return
			default:
				logger.Errorf(ctx, "[relay] accept error: %v", err)
				continue
			}
		}
		go s.handleStreamConnection(ctx, conn)
	}
}

// streamHandshake is the JSON payload the station sends on TCP connect.
type streamHandshake struct {
	RelayToken    string `json:"relay_token"`
	StationPeerID string `json:"station_peer_id"`
}

// handshakeACK is the JSON response sent back to the station (Block 4).
type handshakeACK struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

func (s *SubServer) writeHandshakeACK(conn net.Conn, ok bool, errMsg string) {
	ack := handshakeACK{OK: ok, Error: errMsg}
	data, _ := json.Marshal(ack)
	data = append(data, '\n')
	_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	_, _ = conn.Write(data)
	_ = conn.SetWriteDeadline(time.Time{})
}

func (s *SubServer) handleStreamConnection(ctx context.Context, conn net.Conn) {
	br := bufio.NewReader(conn)

	// 10s total handshake deadline.
	_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	line, err := br.ReadBytes('\n')
	_ = conn.SetReadDeadline(time.Time{})
	if err != nil {
		logger.Warnf(ctx, "[relay] handshake read error from %s: %v", conn.RemoteAddr(), err)
		_ = conn.Close()
		metConnectionsTotal.Inc("handshake_error")
		return
	}

	var hs streamHandshake
	if err := json.Unmarshal(line, &hs); err != nil {
		logger.Warnf(ctx, "[relay] handshake decode error from %s: %v", conn.RemoteAddr(), err)
		s.writeHandshakeACK(conn, false, "invalid handshake JSON")
		_ = conn.Close()
		metConnectionsTotal.Inc("handshake_error")
		return
	}

	if hs.StationPeerID == "" || hs.RelayToken == "" {
		logger.Warnf(ctx, "[relay] handshake missing fields from %s", conn.RemoteAddr())
		s.writeHandshakeACK(conn, false, "relay_token and station_peer_id are required")
		_ = conn.Close()
		metConnectionsTotal.Inc("handshake_error")
		return
	}

	identity, err := s.svc.AuthenticateMountCredential(
		ctx,
		hs.RelayToken,
		domain.ScopeMountConnect,
	)
	if err != nil {
		logger.Warnf(ctx, "[relay] handshake credential validation failed for %s: %v", hs.StationPeerID, err)
		s.writeHandshakeACK(conn, false, "invalid relay token")
		_ = conn.Close()
		metConnectionsTotal.Inc("auth_error")
		return
	}

	if identity.StationPeerID != hs.StationPeerID {
		logger.Warnf(ctx, "[relay] handshake subject mismatch for %s", hs.StationPeerID)
		s.writeHandshakeACK(conn, false, "token subject does not match station_peer_id")
		_ = conn.Close()
		metConnectionsTotal.Inc("auth_error")
		return
	}

	// Block 5: Capacity check using in-memory stream count (accurate).
	if s.streams.Count() >= s.opts.MaxStations {
		logger.Warnf(ctx, "[relay] capacity exceeded (%d/%d), rejecting %s",
			s.streams.Count(), s.opts.MaxStations, hs.StationPeerID)
		s.writeHandshakeACK(conn, false, "relay capacity exceeded")
		_ = conn.Close()
		metConnectionsTotal.Inc("capacity_exceeded")
		return
	}

	if err := s.svc.ActivateMount(ctx, identity); err != nil {
		logger.Warnf(ctx, "[relay] handshake mount activation failed for %s: %v", hs.StationPeerID, err)
		s.writeHandshakeACK(conn, false, "mount is revoked or stale")
		_ = conn.Close()
		metConnectionsTotal.Inc("auth_error")
		return
	}
	mount, err := s.svc.GetMountByStationPeerID(ctx, hs.StationPeerID)
	if err != nil {
		logger.Warnf(ctx, "[relay] load mount limits for %s: %v", hs.StationPeerID, err)
		s.writeHandshakeACK(conn, false, "mount limits are unavailable")
		_ = conn.Close()
		metConnectionsTotal.Inc("auth_error")
		return
	}
	limits := streamLimits{
		maxConcurrent:      s.opts.MaxConcurrentPerStation,
		maxDirectionBytes:  int64(s.opts.MaxBodySize),
		rateBytesPerSecond: tunnelRateBytesPerSecond,
	}
	if mount.MaxClients > 0 &&
		int(mount.MaxClients) < limits.maxConcurrent {
		limits.maxConcurrent = int(mount.MaxClients)
	}
	if mount.BandwidthLimit > 0 &&
		mount.BandwidthLimit < limits.rateBytesPerSecond {
		limits.rateBytesPerSecond = mount.BandwidthLimit
	}

	brc := &bufferedReadConn{Reader: br, Conn: conn}
	entry, err := s.streams.AddValidated(
		ctx,
		hs.StationPeerID,
		identity.Generation,
		identity.ExpiresAt,
		brc,
		limits,
		func() error {
			_, err := s.svc.AuthenticateMountCredential(
				ctx,
				hs.RelayToken,
				domain.ScopeMountConnect,
			)
			return err
		},
	)
	if err != nil {
		logger.Warnf(
			ctx,
			"[relay] handshake credential became stale for %s: %v",
			hs.StationPeerID,
			err,
		)
		s.writeHandshakeACK(conn, false, "mount is revoked or stale")
		_ = conn.Close()
		metConnectionsTotal.Inc("auth_error")
		return
	}

	// ACK only after the stream is registered. Rotation or revocation updates
	// persistent state first, then removes this exact live entry.
	s.writeHandshakeACK(conn, true, "")

	metConnectionsTotal.Inc("success")
	metActiveStreams.Inc()
	logger.Infof(ctx, "[relay] stream connected for %s from %s", hs.StationPeerID, conn.RemoteAddr())

	// Wait for this entry's readLoop to exit (stream disconnect).
	entry.Wait()

	metActiveStreams.Dec()

	// Only remove if our entry is still the current one. A reconnecting station
	// may have already replaced it via Add(), in which case Remove would kill
	// the new entry — a critical race condition.
	s.streams.RemoveIfSame(ctx, hs.StationPeerID, entry)
	logger.Infof(ctx, "[relay] stream disconnected for %s", hs.StationPeerID)
}

// ---- Background goroutines ----

func (s *SubServer) heartbeatChecker(ctx context.Context) {
	interval := time.Duration(s.opts.HeartbeatTimeout/2) * time.Second
	if interval < 10*time.Second {
		interval = 10 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-s.stopCh:
			return
		case <-ticker.C:
			timeout := time.Duration(s.opts.HeartbeatTimeout) * time.Second

			affected, err := s.svc.MarkStaleOffline(ctx, timeout)
			if err != nil {
				logger.Errorf(ctx, "[relay] heartbeat check error: %v", err)
				continue
			}
			if affected > 0 {
				logger.Infof(ctx, "[relay] marked %d stale stations offline", affected)
				cutoff := time.Now().Add(-timeout)
				s.streams.CleanupStale(ctx, cutoff)
			}

			expired, err := s.svc.ExpireStaleInvites(ctx)
			if err != nil {
				logger.Errorf(ctx, "[relay] invite expiry error: %v", err)
			} else if expired > 0 {
				logger.Infof(ctx, "[relay] expired %d stale invites", expired)
			}
		}
	}
}

func (s *SubServer) streamPinger(ctx context.Context) {
	interval := time.Duration(s.opts.StreamPingInterval) * time.Second
	if interval <= 0 {
		return
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	timeout := time.Duration(s.opts.StreamPingTimeout) * time.Second
	if timeout <= 0 {
		timeout = 5 * time.Second
	}

	for {
		select {
		case <-s.stopCh:
			return
		case <-ticker.C:
			cleaned := s.streams.PingAll(ctx, interval, timeout)
			if cleaned > 0 {
				logger.Infof(ctx, "[relay] ping cleaned %d dead streams", cleaned)
			}
		}
	}
}

// ---- bufferedReadConn ----

type bufferedReadConn struct {
	*bufio.Reader
	net.Conn
}

func (c *bufferedReadConn) Read(p []byte) (int, error)  { return c.Reader.Read(p) }
func (c *bufferedReadConn) Write(p []byte) (int, error) { return c.Conn.Write(p) }
func (c *bufferedReadConn) Close() error                { return c.Conn.Close() }

// ---- Constructor ----

func NewRelaySubServer(opts ...option.Option) server.Subserver {
	return &SubServer{
		opts: option.GetOptions(opts...).Ctx().Value(optionsKey{}).(*Options),
	}
}
