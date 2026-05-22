package relay

// 2026-04-07: Block 1-8 refactoring (see CHANGELOG per block).
// 2026-04-08: Refactored — jwtWrapper constructed in Init() and shared with handler layer.
//             Metrics declarations moved to relay_metrics.go.

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net"
	"time"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/application"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

const (
	SubserverTypeRelay server.SubserverType = "relay"

	defaultMaxStations             = 100
	defaultHeartbeatTimeout        = 60
	defaultForwardTimeout          = 30
	defaultMaxBodySize             = 10 * 1024 * 1024 // 10 MB
	defaultMaxConcurrentPerStation = 64
	defaultStreamPingInterval      = 30
	defaultStreamPingTimeout       = 5
	defaultGracefulDrainTimeout    = 10
)

var _ server.Subserver = &SubServer{}

type SubServer struct {
	opts    *Options
	status  server.Status
	svc     *application.Service
	streams *StreamManager

	// jwtWrapper is constructed once in Init() and shared with handler layer.
	// Pattern from friend_chat/subserver.go.
	jwtWrapper server.Wrapper

	listener net.Listener
	stopCh   chan struct{}
}

func (s *SubServer) Init(ctx context.Context, opts ...option.Option) error {
	for _, opt := range opts {
		s.opts.Apply(opt)
	}

	applyDefaults(s.opts)

	// Auth: construct JWT wrapper once, shared with handler layer.
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.jwtWrapper = server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))

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
	s.svc = application.NewService(repo)

	// Stream manager with status callback (Block 7: pass maxConcurrent).
	s.streams = NewStreamManager(func(ctx context.Context, peerID string, online bool) {
		if online {
			if err := s.svc.UpdateMountStatus(ctx, peerID, domain.MountStatusOnline); err != nil {
				logger.Errorf(ctx, "[relay] update mount status online for %s: %v", peerID, err)
			}
		} else {
			if err := s.svc.UpdateMountStatus(ctx, peerID, domain.MountStatusOffline); err != nil {
				logger.Errorf(ctx, "[relay] update mount status offline for %s: %v", peerID, err)
			}
		}
	}, s.opts.MaxConcurrentPerStation)

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

	go s.heartbeatChecker(ctx)
	go s.streamPinger(ctx)

	logger.Infof(ctx, "[relay] started")
	return nil
}

// listenStream creates the TCP or TLS listener (Block 8).
func (s *SubServer) listenStream() (net.Listener, error) {
	if s.opts.TLSCertFile != "" && s.opts.TLSKeyFile != "" {
		cert, err := tls.LoadX509KeyPair(s.opts.TLSCertFile, s.opts.TLSKeyFile)
		if err != nil {
			return nil, fmt.Errorf("load TLS key pair: %w", err)
		}
		tlsCfg := &tls.Config{
			Certificates: []tls.Certificate{cert},
			MinVersion:   tls.VersionTLS12,
		}
		return tls.Listen("tcp", s.opts.StreamListenAddr, tlsCfg)
	}
	return net.Listen("tcp", s.opts.StreamListenAddr)
}

func (s *SubServer) Stop(ctx context.Context) error {
	s.status = server.StatusStopping
	defer func() { s.status = server.StatusStopped }()

	close(s.stopCh)

	if s.listener != nil {
		_ = s.listener.Close()
	}

	drainTimeout := time.Duration(s.opts.GracefulDrainTimeout) * time.Second
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

	// Block 4: Validate relay token via JWT provider.
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	subj, err := provider.Validate(ctx, hs.RelayToken)
	if err != nil {
		logger.Warnf(ctx, "[relay] handshake JWT validation failed for %s: %v", hs.StationPeerID, err)
		s.writeHandshakeACK(conn, false, "invalid relay token")
		_ = conn.Close()
		metConnectionsTotal.Inc("auth_error")
		return
	}

	expectedSubject := domain.SubjectRelayAccess + hs.StationPeerID
	if subj.ID != expectedSubject {
		logger.Warnf(ctx, "[relay] handshake subject mismatch: want %s, got %s", expectedSubject, subj.ID)
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

	// Block 5: DB upsert — errors are NOT silenced.
	now := time.Now()
	if _, getErr := s.svc.GetMountByStationPeerID(ctx, hs.StationPeerID); getErr != nil {
		if err := s.svc.CreateMount(ctx, &domain.Mount{
			StationPeerID: hs.StationPeerID,
			Status:        domain.MountStatusOnline,
			LastHeartbeat: now,
			MountedAt:     now,
		}); err != nil {
			logger.Errorf(ctx, "[relay] create mount for %s: %v", hs.StationPeerID, err)
			s.writeHandshakeACK(conn, false, "internal error")
			_ = conn.Close()
			metConnectionsTotal.Inc("db_error")
			return
		}
	} else {
		if err := s.svc.UpdateMountStatus(ctx, hs.StationPeerID, domain.MountStatusOnline); err != nil {
			logger.Errorf(ctx, "[relay] update mount for %s: %v", hs.StationPeerID, err)
		}
		if err := s.svc.UpdateHeartbeat(ctx, hs.StationPeerID); err != nil {
			logger.Errorf(ctx, "[relay] update heartbeat for %s: %v", hs.StationPeerID, err)
		}
	}

	// Block 4: Send ACK to station — handshake succeeded.
	s.writeHandshakeACK(conn, true, "")

	brc := &bufferedReadConn{Reader: br, Conn: conn}

	// Block 1: Add starts readLoop goroutine internally — no handleIncomingFrames.
	s.streams.Add(ctx, hs.StationPeerID, brc)

	metConnectionsTotal.Inc("success")
	metActiveStreams.Inc()
	logger.Infof(ctx, "[relay] stream connected for %s from %s", hs.StationPeerID, conn.RemoteAddr())

	// Wait for this entry's readLoop to exit (stream disconnect).
	entry, ok := s.streams.GetEntry(hs.StationPeerID)
	if ok {
		entry.Wait()
	}

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

// ---- Defaults ----

func applyDefaults(o *Options) {
	if o.MaxStations <= 0 {
		o.MaxStations = defaultMaxStations
	}
	if o.HeartbeatTimeout <= 0 {
		o.HeartbeatTimeout = defaultHeartbeatTimeout
	}
	if o.ForwardTimeout <= 0 {
		o.ForwardTimeout = defaultForwardTimeout
	}
	if o.MaxBodySize <= 0 {
		o.MaxBodySize = defaultMaxBodySize
	}
	if o.MaxConcurrentPerStation <= 0 {
		o.MaxConcurrentPerStation = defaultMaxConcurrentPerStation
	}
	if o.StreamPingInterval <= 0 {
		o.StreamPingInterval = defaultStreamPingInterval
	}
	if o.StreamPingTimeout <= 0 {
		o.StreamPingTimeout = defaultStreamPingTimeout
	}
	if o.GracefulDrainTimeout <= 0 {
		o.GracefulDrainTimeout = defaultGracefulDrainTimeout
	}
}

// ---- Constructor ----

func NewRelaySubServer(opts ...option.Option) server.Subserver {
	return &SubServer{
		opts: option.GetOptions(opts...).Ctx().Value(optionsKey{}).(*Options),
	}
}
