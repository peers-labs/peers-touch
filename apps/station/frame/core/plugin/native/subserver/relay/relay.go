package relay

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	relaymodel "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/model"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

const (
	SubserverTypeRelay server.SubserverType = "relay"

	defaultMaxStations       = 100
	defaultHeartbeatTimeout  = 60
	defaultMaxRequestsPerSec = 1000
)

var _ server.Subserver = &SubServer{}

type streamEntry struct {
	peerID    string
	transport io.ReadWriteCloser
	mountedAt time.Time
	mu        sync.Mutex
}

type SubServer struct {
	opts   *Options
	status server.Status
	store  *relayStore

	mu      sync.RWMutex
	streams map[string]*streamEntry

	stopCh chan struct{}
}

func (s *SubServer) Init(ctx context.Context, opts ...option.Option) error {
	for _, opt := range opts {
		s.opts.Apply(opt)
	}

	if s.opts.MaxStations <= 0 {
		s.opts.MaxStations = defaultMaxStations
	}
	if s.opts.HeartbeatTimeout <= 0 {
		s.opts.HeartbeatTimeout = defaultHeartbeatTimeout
	}
	if s.opts.MaxRequestsPerSec <= 0 {
		s.opts.MaxRequestsPerSec = defaultMaxRequestsPerSec
	}

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return fmt.Errorf("[relay] failed to get RDS: %w", err)
	}

	s.store = newRelayStore(rds)
	if err := s.store.AutoMigrate(); err != nil {
		return fmt.Errorf("[relay] failed to auto migrate: %w", err)
	}

	s.streams = make(map[string]*streamEntry)
	s.stopCh = make(chan struct{})

	logger.Infof(ctx, "[relay] initialized, max_stations=%d, heartbeat_timeout=%ds",
		s.opts.MaxStations, s.opts.HeartbeatTimeout)
	return nil
}

func (s *SubServer) Start(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusRunning

	go s.heartbeatChecker(ctx)

	logger.Infof(ctx, "[relay] started")
	return nil
}

func (s *SubServer) Stop(ctx context.Context) error {
	s.status = server.StatusStopping
	defer func() { s.status = server.StatusStopped }()

	close(s.stopCh)

	s.mu.Lock()
	for id, entry := range s.streams {
		_ = entry.transport.Close()
		_ = s.store.UpdateMountStatus(ctx, id, relaymodel.MountStatusOffline)
	}
	s.streams = make(map[string]*streamEntry)
	s.mu.Unlock()

	logger.Infof(ctx, "[relay] stopped")
	return nil
}

func (s *SubServer) Name() string { return "relay" }

func (s *SubServer) Address() server.SubserverAddress {
	return server.SubserverAddress{}
}

func (s *SubServer) Status() server.Status { return s.status }

func (s *SubServer) Type() server.SubserverType { return SubserverTypeRelay }

func (s *SubServer) Handlers() []server.Handler {
	h := newRelayHandler(s)
	return h.handlers()
}

func (s *SubServer) RegisterStream(ctx context.Context, stationPeerID string, stream io.ReadWriteCloser) error {
	count, err := s.store.CountOnlineMounts(ctx)
	if err != nil {
		return fmt.Errorf("[relay] failed to count online mounts: %w", err)
	}
	if int(count) >= s.opts.MaxStations {
		return fmt.Errorf("[relay] capacity exceeded: %d/%d", count, s.opts.MaxStations)
	}

	now := time.Now()
	mount, err := s.store.GetMountByStationPeerID(ctx, stationPeerID)
	if err != nil {
		mount = &relaymodel.RelayMount{
			StationPeerID: stationPeerID,
			Status:        relaymodel.MountStatusOnline,
			LastHeartbeat: now,
			MountedAt:     now,
		}
		if err := s.store.CreateMount(ctx, mount); err != nil {
			return fmt.Errorf("[relay] failed to create mount: %w", err)
		}
	} else {
		if err := s.store.UpdateMountStatus(ctx, stationPeerID, relaymodel.MountStatusOnline); err != nil {
			return fmt.Errorf("[relay] failed to update mount status: %w", err)
		}
		if err := s.store.UpdateHeartbeat(ctx, stationPeerID); err != nil {
			return fmt.Errorf("[relay] failed to update heartbeat: %w", err)
		}
	}

	s.mu.Lock()
	if old, exists := s.streams[stationPeerID]; exists {
		_ = old.transport.Close()
	}
	s.streams[stationPeerID] = &streamEntry{
		peerID:    stationPeerID,
		transport: stream,
		mountedAt: now,
	}
	s.mu.Unlock()

	logger.Infof(ctx, "[relay] station %s registered", stationPeerID)
	return nil
}

func (s *SubServer) UnregisterStream(ctx context.Context, stationPeerID string) {
	s.mu.Lock()
	if entry, exists := s.streams[stationPeerID]; exists {
		_ = entry.transport.Close()
		delete(s.streams, stationPeerID)
	}
	s.mu.Unlock()

	_ = s.store.UpdateMountStatus(ctx, stationPeerID, relaymodel.MountStatusOffline)
	logger.Infof(ctx, "[relay] station %s unregistered", stationPeerID)
}

func (s *SubServer) GetStream(stationPeerID string) (io.ReadWriteCloser, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	entry, ok := s.streams[stationPeerID]
	if !ok {
		return nil, false
	}
	return entry.transport, true
}

func (s *SubServer) streamMu(stationPeerID string) {
	s.mu.RLock()
	entry, ok := s.streams[stationPeerID]
	s.mu.RUnlock()
	if ok {
		entry.mu.Lock()
	}
}

func (s *SubServer) streamUnlock(stationPeerID string) {
	s.mu.RLock()
	entry, ok := s.streams[stationPeerID]
	s.mu.RUnlock()
	if ok {
		entry.mu.Unlock()
	}
}

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
			affected, err := s.store.MarkStaleOffline(ctx, timeout)
			if err != nil {
				logger.Errorf(ctx, "[relay] heartbeat check error: %v", err)
				continue
			}
			if affected > 0 {
				logger.Infof(ctx, "[relay] marked %d stale stations offline", affected)
				s.cleanupStaleStreams(ctx, timeout)
			}
		}
	}
}

func (s *SubServer) cleanupStaleStreams(ctx context.Context, timeout time.Duration) {
	cutoff := time.Now().Add(-timeout)
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, entry := range s.streams {
		if entry.mountedAt.Before(cutoff) {
			_ = entry.transport.Close()
			delete(s.streams, id)
			logger.Infof(ctx, "[relay] cleaned up stale stream for %s", id)
		}
	}
}

func (s *SubServer) writeHTTPError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"error":"%s"}`, msg)))
}

func NewRelaySubServer(opts ...option.Option) server.Subserver {
	return &SubServer{
		opts: option.GetOptions(opts...).Ctx().Value(optionsKey{}).(*Options),
	}
}
