// Package dashboard — SubServer lifecycle implementation.
// Wires together domain, infrastructure, and application layers following DDD.
//
// Change History:
// - 2026-04-10: Initial implementation — SubServer with auth, overview,
//   actor management services.
// - 2026-04-10: Refactored to DDD architecture. Replaced hardcoded fallback
//   JWT secret with random generation + warning.
// - 2026-04-10: Fixed getSubservers() returning nil — now loads sibling
//   subserver instances from server.GetOptions().SubserverInstances at Start.
package dashboard

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"sync"
	"time"

	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/infrastructure"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/registry"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

// Compile-time interface check.
var _ server.Subserver = (*subServer)(nil)

// ---------------------------------------------------------------------------
// subServer is the dashboard SubServer implementation.
// ---------------------------------------------------------------------------

type subServer struct {
	mu     sync.RWMutex
	status server.Status

	// Database handle
	db *gorm.DB

	// Application services (DDD application layer)
	authSvc     *application.AuthService
	overviewSvc *application.OverviewService
	actorsSvc   *application.ActorService
	chatDebugSvc *application.ChatDebugService

	// Infrastructure repositories (DDD infrastructure layer)
	auditRepo infrastructure.AuditRepository

	// External references
	registry   registry.Registry
	listenAddr string
	startedAt  time.Time

	// Sibling subserver instances, populated at Start from
	// server.GetOptions().SubserverInstances for overview & status display.
	subservers []server.Subserver

	// Disabled flag: when true, Init returns early and Handlers returns nil.
	disabled bool
}

// NewDashboardSubServer constructs the dashboard SubServer.
// It follows the same constructor signature as other SubServers:
//
//	server.WithSubServer("dashboard", dashboard.NewDashboardSubServer)
func NewDashboardSubServer(opts ...option.Option) server.Subserver {
	return &subServer{status: server.StatusStopped}
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

// Init initialises database tables, repositories, services, and bootstraps
// the super user. This is where the DDD layers are wired together.
func (s *subServer) Init(ctx context.Context, opts ...option.Option) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status = server.StatusStarting

	cfg := GetConfig()
	if !cfg.Peers.Dashboard.Enable {
		log.Infof(ctx, "[dashboard] dashboard is disabled by configuration")
		s.status = server.StatusStopped
		s.disabled = true
		return nil
	}

	// Obtain shared database handle
	rds, err := store.GetRDS(ctx)
	if err != nil {
		s.status = server.StatusError
		return fmt.Errorf("[dashboard] failed to get database: %w", err)
	}
	s.db = rds

	// Auto-migrate dashboard-specific tables
	if err := rds.AutoMigrate(&domain.DashboardAdmin{}, &domain.DashboardSession{}, &domain.DashboardAuditLog{}); err != nil {
		s.status = server.StatusError
		return fmt.Errorf("[dashboard] auto-migrate failed: %w", err)
	}

	// Resolve JWT secret — prefer config, fall back to env var, then random
	jwtSecret := cfg.Peers.Dashboard.JWTSecret
	if jwtSecret == "" {
		jwtSecret = deriveFallbackSecret(ctx)
	}

	// Parse session TTL
	sessionTTL := 24 * time.Hour
	if cfg.Peers.Dashboard.SessionTTL != "" {
		if d, err := time.ParseDuration(cfg.Peers.Dashboard.SessionTTL); err == nil {
			sessionTTL = d
		}
	}

	// ---------------------------------------------------------------------------
	// DDD wiring: infrastructure → application
	// ---------------------------------------------------------------------------

	adminRepo := infrastructure.NewAdminRepository(rds)
	sessionRepo := infrastructure.NewSessionRepository(rds)
	auditRepo := infrastructure.NewAuditRepository(rds)
	actorQueryRepo := infrastructure.NewActorQueryRepository(rds)

	s.auditRepo = auditRepo

	s.authSvc = application.NewAuthService(adminRepo, sessionRepo, auditRepo, jwtSecret, sessionTTL)
	s.overviewSvc = application.NewOverviewService(actorQueryRepo, auditRepo, nil)
	s.actorsSvc = application.NewActorService(actorQueryRepo)
	s.chatDebugSvc = application.NewChatDebugService(rds)

	// Try to resolve registry from the global default
	s.registry = registry.GetDefaultRegistry()
	if s.registry != nil {
		s.overviewSvc.SetRegistry(s.registry)
	}

	// Bootstrap the super user if configured
	superUser := cfg.Peers.Dashboard.SuperUser
	if superUser.Username != "" && superUser.Password != "" {
		if err := s.authSvc.EnsureSuperUser(ctx, superUser.Username, superUser.Password); err != nil {
			log.Errorf(ctx, "[dashboard] failed to ensure super user: %v", err)
		}
	}

	log.Infof(ctx, "[dashboard] subserver initialised (DDD architecture)")
	return nil
}

// Start transitions the SubServer to running state.
func (s *subServer) Start(ctx context.Context, opts ...option.Option) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.disabled {
		return nil
	}

	s.status = server.StatusRunning
	s.startedAt = time.Now()

	// Resolve listen address from server options (best-effort)
	serverOpts := server.GetOptions()
	if serverOpts != nil {
		s.listenAddr = serverOpts.Address

		// Snapshot sibling subserver instances for overview & status display.
		// SubserverInstances is populated by BaseServer.init() before Start.
		for _, sub := range serverOpts.SubserverInstances {
			s.subservers = append(s.subservers, sub)
		}
	}

	log.Infof(ctx, "[dashboard] subserver started, discovered %d sibling subservers", len(s.subservers))
	return nil
}

// Stop gracefully shuts down the SubServer.
func (s *subServer) Stop(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status = server.StatusStopped
	log.Infof(ctx, "[dashboard] subserver stopped")
	return nil
}

// ---------------------------------------------------------------------------
// Subserver interface methods
// ---------------------------------------------------------------------------

func (s *subServer) Name() string              { return "dashboard" }
func (s *subServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *subServer) Status() server.Status      { return s.status }

func (s *subServer) Address() server.SubserverAddress {
	return server.SubserverAddress{}
}

// Handlers returns the HTTP handlers registered by this SubServer.
// Returns nil when the dashboard is disabled.
// API handlers are registered first, followed by embedded static file handlers
// for serving the frontend SPA from the Go binary.
func (s *subServer) Handlers() []server.Handler {
	if s.disabled || s.authSvc == nil {
		return nil
	}

	h := &dashboardHandler{sub: s}
	handlers := h.handlers()

	// Append embedded static file serving handlers (SPA, assets, favicon).
	handlers = append(handlers, staticFileHandlers()...)

	return handlers
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// getSubservers returns a snapshot of all sibling SubServer instances.
// The slice is populated during Start() from server.GetOptions().SubserverInstances.
func (s *subServer) getSubservers() []server.Subserver {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.subservers
}

// deriveFallbackSecret returns a fallback JWT secret derived from environment.
// If no environment variable is set, a random secret is generated per process
// lifetime and a warning is logged.
func deriveFallbackSecret(ctx context.Context) string {
	if secret := os.Getenv("PEERS_AUTH_SECRET"); secret != "" {
		return "dashboard-" + secret
	}

	b := make([]byte, 32)
	_, _ = rand.Read(b)
	log.Warnf(ctx, "[dashboard] no jwt_secret configured, using random secret (sessions will NOT survive restart)")
	return hex.EncodeToString(b)
}
