// Package dashboard — HTTP handler layer. Translates HTTP requests into
// application service calls and serialises responses via TypedHandler.
//
// Change History:
//   - 2026-04-10: Initial implementation — 28 endpoints covering auth,
//     overview, actors, admins, audit, system, sessions, chat debug,
//     storage, nodes. Used raw NewHTTPHandler + HertzHandlerFunc.
//   - 2026-04-10: Refactored to depend on DDD application/domain layers
//     instead of flat package types.
//   - 2026-04-22: Migrated ALL 28 endpoints from NewHTTPHandler +
//     HertzHandlerFunc to NewTypedHandler. Auth, path params, and query
//     params now extracted via server.Wrapper (handler_middleware.go).
//     Removed all Hertz imports from this file.
package dashboard

import (
	"context"
	"strconv"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

// ---------------------------------------------------------------------------
// Route constants
// ---------------------------------------------------------------------------

const (
	// Auth
	routeLogin          = "/dashboard/api/auth/login"
	routeLogout         = "/dashboard/api/auth/logout"
	routeMe             = "/dashboard/api/auth/me"
	routeChangePassword = "/dashboard/api/auth/change-password"

	// Overview
	routeOverviewStats        = "/dashboard/api/overview/stats"
	routeOverviewRecentActors = "/dashboard/api/overview/recent-actors"
	routeOverviewRecentAudit  = "/dashboard/api/overview/recent-audit-logs"

	// Actors
	routeActors             = "/dashboard/api/actors"
	routeActorDetail        = "/dashboard/api/actors/:id"
	routeActorSessions      = "/dashboard/api/actors/:id/sessions"
	routeActorResetPassword = "/dashboard/api/actors/:id/reset-password"
	routeActorRevokeSession = "/dashboard/api/actors/:id/sessions/:sid/revoke"

	// Admins
	routeAdmins       = "/dashboard/api/admins"
	routeAdminDisable = "/dashboard/api/admins/:id/disable"
	routeAdminEnable  = "/dashboard/api/admins/:id/enable"
	routeAdminDelete  = "/dashboard/api/admins/:id"

	// Audit logs
	routeAuditLogs = "/dashboard/api/audit-logs"

	// System
	routeSystemInfo       = "/dashboard/api/system/info"
	routeSystemRoutes     = "/dashboard/api/system/routes"
	routeSystemSubservers = "/dashboard/api/system/subservers"

	// Peers actor sessions
	routePeersSessions      = "/dashboard/api/sessions/active"
	routePeersRevokeSession = "/dashboard/api/sessions/:sid/revoke"

	// Dashboard admin sessions
	routeDashboardSessions      = "/dashboard/api/dashboard-sessions"
	routeDashboardRevokeSession = "/dashboard/api/dashboard-sessions/:sid/revoke"

	// Chat debug (admin-only)
	routeFriendChatStats = "/dashboard/api/chat/friend/stats"

	// Storage / Nodes
	routeStorageInfo = "/dashboard/api/storage/info"
	routeNodes       = "/dashboard/api/nodes"
)

// ---------------------------------------------------------------------------
// dashboardHandler holds references to the SubServer and generates handlers.
// ---------------------------------------------------------------------------

type dashboardHandler struct {
	sub *subServer
}

// handlers returns the full list of HTTP handlers for the dashboard SubServer.
// All API endpoints use NewTypedHandler with the dashboard auth/meta wrapper;
// static file serving (embed.go) is registered separately and is NOT included.
func (h *dashboardHandler) handlers() []server.Handler {
	auth := h.authWrapper()
	meta := h.metaWrapper() // no JWT required — used for login

	return []server.Handler{
		// -- Auth (login uses metaWrapper because it has no JWT yet) --
		server.NewTypedHandler("dashboard-login", routeLogin, server.POST,
			h.handleLogin, meta),
		server.NewTypedHandler("dashboard-logout", routeLogout, server.POST,
			h.handleLogout, auth),
		server.NewTypedHandler("dashboard-me", routeMe, server.GET,
			h.handleMe, auth),
		server.NewTypedHandler("dashboard-change-password", routeChangePassword, server.POST,
			h.handleChangePassword, auth),

		// -- Overview --
		server.NewTypedHandler("dashboard-overview-stats", routeOverviewStats, server.GET,
			h.handleOverviewStats, auth),
		server.NewTypedHandler("dashboard-overview-recent-actors", routeOverviewRecentActors, server.GET,
			h.handleRecentActors, auth),
		server.NewTypedHandler("dashboard-overview-recent-audit", routeOverviewRecentAudit, server.GET,
			h.handleRecentAuditLogs, auth),

		// -- Actors --
		server.NewTypedHandler("dashboard-list-actors", routeActors, server.GET,
			h.handleListActors, auth),
		server.NewTypedHandler("dashboard-get-actor", routeActorDetail, server.GET,
			h.handleGetActor, auth),
		server.NewTypedHandler("dashboard-actor-sessions", routeActorSessions, server.GET,
			h.handleGetActorSessions, auth),
		server.NewTypedHandler("dashboard-actor-reset-password", routeActorResetPassword, server.POST,
			h.handleResetActorPassword, auth),
		server.NewTypedHandler("dashboard-actor-revoke-session", routeActorRevokeSession, server.POST,
			h.handleRevokeActorSession, auth),

		// -- Admins --
		server.NewTypedHandler("dashboard-create-admin", routeAdmins, server.POST,
			h.handleCreateAdmin, auth),
		server.NewTypedHandler("dashboard-list-admins", routeAdmins, server.GET,
			h.handleListAdmins, auth),
		server.NewTypedHandler("dashboard-disable-admin", routeAdminDisable, server.POST,
			h.handleDisableAdmin, auth),
		server.NewTypedHandler("dashboard-enable-admin", routeAdminEnable, server.POST,
			h.handleEnableAdmin, auth),
		server.NewTypedHandler("dashboard-delete-admin", routeAdminDelete, server.DELETE,
			h.handleDeleteAdmin, auth),

		// -- Audit logs --
		server.NewTypedHandler("dashboard-audit-logs", routeAuditLogs, server.GET,
			h.handleAuditLogs, auth),

		// -- System --
		server.NewTypedHandler("dashboard-system-info", routeSystemInfo, server.GET,
			h.handleSystemInfo, auth),
		server.NewTypedHandler("dashboard-system-routes", routeSystemRoutes, server.GET,
			h.handleSystemRoutes, auth),
		server.NewTypedHandler("dashboard-system-subservers", routeSystemSubservers, server.GET,
			h.handleSystemSubservers, auth),

		// -- Peers actor sessions --
		server.NewTypedHandler("dashboard-peers-sessions", routePeersSessions, server.GET,
			h.handleGetActivePeersSessions, auth),
		server.NewTypedHandler("dashboard-peers-revoke-session", routePeersRevokeSession, server.POST,
			h.handleRevokePeersSession, auth),

		// -- Dashboard admin sessions --
		server.NewTypedHandler("dashboard-admin-sessions", routeDashboardSessions, server.GET,
			h.handleDashboardSessions, auth),
		server.NewTypedHandler("dashboard-admin-revoke-session", routeDashboardRevokeSession, server.POST,
			h.handleRevokeDashboardSession, auth),

		// -- Chat debug --
		server.NewTypedHandler("dashboard-friend-chat-stats", routeFriendChatStats, server.GET,
			h.handleFriendChatStats, auth),

		// -- Storage --
		server.NewTypedHandler("dashboard-storage-info", routeStorageInfo, server.GET,
			h.handleStorageInfo, auth),

		// -- Nodes --
		server.NewTypedHandler("dashboard-nodes", routeNodes, server.GET,
			h.handleNodes, auth),
	}
}

// ===========================================================================
// Auth handlers
// ===========================================================================

// handleLogin — POST /dashboard/api/auth/login
// Uses metaWrapper (no auth) because login is the endpoint that issues tokens.
func (h *dashboardHandler) handleLogin(ctx context.Context, req *domain.LoginRequest) (*domain.LoginResult, error) {
	// Enforce local-only access if configured
	cfg := GetConfig()
	if cfg.Peers.Dashboard.LocalOnly && !domain.IsLocalRequest(getClientIP(ctx)) {
		return nil, server.Forbidden("dashboard access is restricted to local network")
	}

	if req.Username == "" || req.Password == "" {
		return nil, server.BadRequest("username and password are required")
	}

	result, err := h.sub.authSvc.Login(ctx, req.Username, req.Password, getClientIP(ctx), getUserAgent(ctx))
	if err != nil {
		switch err {
		case domain.ErrInvalidCredentials:
			return nil, server.Unauthorized(err.Error())
		case domain.ErrAdminDisabled:
			return nil, server.Forbidden(err.Error())
		case domain.ErrSuperUserExpired:
			return nil, server.Forbidden(err.Error())
		default:
			log.Errorf(ctx, "[dashboard] login error: %v", err)
			return nil, server.InternalError("internal error")
		}
	}

	return result, nil
}

// handleLogout — POST /dashboard/api/auth/logout
func (h *dashboardHandler) handleLogout(ctx context.Context, _ *domain.EmptyRequest) (*domain.MessageResponse, error) {
	claims := getClaims(ctx)

	if err := h.sub.authSvc.Logout(ctx, claims.SessionID, claims.AdminID, getClientIP(ctx), getUserAgent(ctx)); err != nil {
		log.Errorf(ctx, "[dashboard] logout error: %v", err)
		return nil, server.InternalError("logout failed")
	}

	return &domain.MessageResponse{Message: "logged out"}, nil
}

// handleMe — GET /dashboard/api/auth/me
func (h *dashboardHandler) handleMe(ctx context.Context, _ *domain.EmptyRequest) (*domain.AdminInfo, error) {
	claims := getClaims(ctx)

	return &domain.AdminInfo{
		ID:          claims.AdminID,
		Username:    claims.Username,
		Role:        domain.AdminRole(claims.Role),
		IsSuperUser: claims.Role == string(domain.AdminRoleSuper),
	}, nil
}

// handleChangePassword — POST /dashboard/api/auth/change-password
func (h *dashboardHandler) handleChangePassword(ctx context.Context, req *domain.ChangePasswordRequest) (*domain.MessageResponse, error) {
	claims := getClaims(ctx)

	if req.OldPassword == "" || req.NewPassword == "" {
		return nil, server.BadRequest("old_password and new_password are required")
	}

	if len(req.NewPassword) < 8 {
		return nil, server.BadRequest("new password must be at least 8 characters")
	}

	if err := h.sub.authSvc.ChangePassword(ctx, claims.AdminID, req.OldPassword, req.NewPassword, getClientIP(ctx), getUserAgent(ctx)); err != nil {
		if err == domain.ErrInvalidCredentials {
			return nil, server.Forbidden("old password is incorrect")
		}
		log.Errorf(ctx, "[dashboard] change password error: %v", err)
		return nil, server.InternalError("failed to change password")
	}

	return &domain.MessageResponse{Message: "password changed, please re-login"}, nil
}

// ===========================================================================
// Overview handlers
// ===========================================================================

// handleOverviewStats — GET /dashboard/api/overview/stats
func (h *dashboardHandler) handleOverviewStats(ctx context.Context, _ *domain.EmptyRequest) (*domain.OverviewStats, error) {
	stats, err := h.sub.overviewSvc.GetOverview(ctx,
		h.sub.getSubservers(),
		h.sub.startedAt,
		h.sub.listenAddr,
	)
	if err != nil {
		log.Errorf(ctx, "[dashboard] overview stats error: %v", err)
		return nil, server.InternalError("failed to get overview stats")
	}

	return stats, nil
}

// handleRecentActors — GET /dashboard/api/overview/recent-actors?limit=10
func (h *dashboardHandler) handleRecentActors(ctx context.Context, _ *domain.EmptyRequest) (*domain.RecentActorsResponse, error) {
	limit := queryParamInt(ctx, "limit", 10)

	actors, err := h.sub.overviewSvc.GetRecentActors(ctx, limit)
	if err != nil {
		log.Errorf(ctx, "[dashboard] recent actors error: %v", err)
		return nil, server.InternalError("failed to get recent actors")
	}

	return &domain.RecentActorsResponse{Items: actors}, nil
}

// handleRecentAuditLogs — GET /dashboard/api/overview/recent-audit-logs?limit=10
func (h *dashboardHandler) handleRecentAuditLogs(ctx context.Context, _ *domain.EmptyRequest) (*domain.RecentAuditLogsResponse, error) {
	limit := queryParamInt(ctx, "limit", 10)

	logs, err := h.sub.overviewSvc.GetRecentAuditLogs(ctx, limit)
	if err != nil {
		log.Errorf(ctx, "[dashboard] recent audit logs error: %v", err)
		return nil, server.InternalError("failed to get recent audit logs")
	}

	return &domain.RecentAuditLogsResponse{Items: logs}, nil
}

// ===========================================================================
// Actor handlers
// ===========================================================================

// handleListActors — GET /dashboard/api/actors?page=1&page_size=20&search=&status=
func (h *dashboardHandler) handleListActors(ctx context.Context, _ *domain.EmptyRequest) (*domain.ActorListResult, error) {
	query := domain.ActorListQuery{
		Page:     queryParamInt(ctx, "page", 1),
		PageSize: queryParamInt(ctx, "page_size", 20),
		Search:   queryParam(ctx, "search"),
		Status:   queryParam(ctx, "status"),
	}

	result, err := h.sub.actorsSvc.ListActors(ctx, query)
	if err != nil {
		log.Errorf(ctx, "[dashboard] list actors error: %v", err)
		return nil, server.InternalError("failed to list actors")
	}

	return result, nil
}

// handleGetActor — GET /dashboard/api/actors/:id
func (h *dashboardHandler) handleGetActor(ctx context.Context, _ *domain.EmptyRequest) (*domain.ActorDetail, error) {
	actorID, err := parsePathParamUint64(ctx, "id")
	if err != nil {
		return nil, server.BadRequest("invalid actor id")
	}

	detail, err := h.sub.actorsSvc.GetActorDetail(ctx, actorID)
	if err != nil {
		return nil, server.NotFound("actor not found")
	}

	return detail, nil
}

// handleGetActorSessions — GET /dashboard/api/actors/:id/sessions
func (h *dashboardHandler) handleGetActorSessions(ctx context.Context, _ *domain.EmptyRequest) (*domain.ActorSessionsResponse, error) {
	actorID, err := parsePathParamUint64(ctx, "id")
	if err != nil {
		return nil, server.BadRequest("invalid actor id")
	}

	sessions, err := h.sub.actorsSvc.GetActorSessions(ctx, actorID)
	if err != nil {
		log.Errorf(ctx, "[dashboard] actor sessions error: %v", err)
		return nil, server.InternalError("failed to get actor sessions")
	}

	return &domain.ActorSessionsResponse{Items: sessions}, nil
}

// handleResetActorPassword — POST /dashboard/api/actors/:id/reset-password
func (h *dashboardHandler) handleResetActorPassword(ctx context.Context, req *domain.ResetPasswordRequest) (*domain.MessageResponse, error) {
	claims := getClaims(ctx)

	actorID, err := parsePathParamUint64(ctx, "id")
	if err != nil {
		return nil, server.BadRequest("invalid actor id")
	}

	if len(req.NewPassword) < 8 {
		return nil, server.BadRequest("password must be at least 8 characters")
	}

	if err := h.sub.actorsSvc.ResetActorPassword(ctx, actorID, req.NewPassword); err != nil {
		log.Errorf(ctx, "[dashboard] reset actor password error: %v", err)
		return nil, server.InternalError("failed to reset password")
	}

	h.sub.authSvc.RecordAudit(ctx, claims.AdminID, claims.Username, "reset_actor_password", "actor",
		"actor_id="+strconv.FormatUint(actorID, 10), getClientIP(ctx), getUserAgent(ctx))

	return &domain.MessageResponse{Message: "password reset successfully"}, nil
}

// handleRevokeActorSession — POST /dashboard/api/actors/:id/sessions/:sid/revoke
func (h *dashboardHandler) handleRevokeActorSession(ctx context.Context, _ *domain.EmptyRequest) (*domain.MessageResponse, error) {
	claims := getClaims(ctx)

	sid := pathParam(ctx, "sid")
	if sid == "" {
		return nil, server.BadRequest("session id is required")
	}

	if err := h.sub.actorsSvc.RevokeActorSession(ctx, sid); err != nil {
		log.Errorf(ctx, "[dashboard] revoke actor session error: %v", err)
		return nil, server.InternalError("failed to revoke session")
	}

	h.sub.authSvc.RecordAudit(ctx, claims.AdminID, claims.Username, "revoke_actor_session", "session",
		"session_id="+sid, getClientIP(ctx), getUserAgent(ctx))

	return &domain.MessageResponse{Message: "session revoked"}, nil
}

// ===========================================================================
// Admin handlers
// ===========================================================================

// handleCreateAdmin — POST /dashboard/api/admins
// NOTE: The old handler returned HTTP 201 (Created). TypedHandler always
// returns HTTP 200 on success. The frontend uses axios which treats all 2xx
// as success, so this semantic change does not break the frontend.
func (h *dashboardHandler) handleCreateAdmin(ctx context.Context, req *domain.CreateAdminRequest) (*domain.AdminInfo, error) {
	claims := getClaims(ctx)

	if req.Username == "" || req.Password == "" {
		return nil, server.BadRequest("username and password are required")
	}

	if len(req.Password) < 8 {
		return nil, server.BadRequest("password must be at least 8 characters")
	}

	admin, err := h.sub.authSvc.CreateAdmin(ctx, *req, claims.AdminID, getClientIP(ctx), getUserAgent(ctx))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") || strings.Contains(err.Error(), "duplicate") {
			return nil, conflict("username already exists")
		}
		log.Errorf(ctx, "[dashboard] create admin error: %v", err)
		return nil, server.InternalError("failed to create admin")
	}

	return &domain.AdminInfo{
		ID:          admin.ID,
		Username:    admin.Username,
		DisplayName: admin.DisplayName,
		Role:        admin.Role,
		IsSuperUser: admin.IsSuperUser,
	}, nil
}

// handleListAdmins — GET /dashboard/api/admins
func (h *dashboardHandler) handleListAdmins(ctx context.Context, _ *domain.EmptyRequest) (*domain.AdminListResponse, error) {
	admins, err := h.sub.authSvc.ListAdmins(ctx)
	if err != nil {
		log.Errorf(ctx, "[dashboard] list admins error: %v", err)
		return nil, server.InternalError("failed to list admins")
	}

	return &domain.AdminListResponse{Items: admins}, nil
}

// handleDisableAdmin — POST /dashboard/api/admins/:id/disable
func (h *dashboardHandler) handleDisableAdmin(ctx context.Context, _ *domain.EmptyRequest) (*domain.MessageResponse, error) {
	claims := getClaims(ctx)

	adminID, err := parsePathParamUint64(ctx, "id")
	if err != nil {
		return nil, server.BadRequest("invalid admin id")
	}

	if err := h.sub.authSvc.DisableAdmin(ctx, adminID, claims.AdminID, getClientIP(ctx), getUserAgent(ctx)); err != nil {
		return nil, server.BadRequest(err.Error())
	}

	return &domain.MessageResponse{Message: "admin disabled"}, nil
}

// handleEnableAdmin — POST /dashboard/api/admins/:id/enable
func (h *dashboardHandler) handleEnableAdmin(ctx context.Context, _ *domain.EmptyRequest) (*domain.MessageResponse, error) {
	claims := getClaims(ctx)

	adminID, err := parsePathParamUint64(ctx, "id")
	if err != nil {
		return nil, server.BadRequest("invalid admin id")
	}

	if err := h.sub.authSvc.EnableAdmin(ctx, adminID, claims.AdminID, getClientIP(ctx), getUserAgent(ctx)); err != nil {
		return nil, server.BadRequest(err.Error())
	}

	return &domain.MessageResponse{Message: "admin enabled"}, nil
}

// handleDeleteAdmin — DELETE /dashboard/api/admins/:id
func (h *dashboardHandler) handleDeleteAdmin(ctx context.Context, _ *domain.EmptyRequest) (*domain.MessageResponse, error) {
	claims := getClaims(ctx)

	adminID, err := parsePathParamUint64(ctx, "id")
	if err != nil {
		return nil, server.BadRequest("invalid admin id")
	}

	if err := h.sub.authSvc.DeleteAdmin(ctx, adminID, claims.AdminID, getClientIP(ctx), getUserAgent(ctx)); err != nil {
		return nil, server.BadRequest(err.Error())
	}

	return &domain.MessageResponse{Message: "admin deleted"}, nil
}

// ===========================================================================
// Audit log handlers
// ===========================================================================

// handleAuditLogs — GET /dashboard/api/audit-logs?page=1&page_size=20
func (h *dashboardHandler) handleAuditLogs(ctx context.Context, _ *domain.EmptyRequest) (*domain.AuditLogsResponse, error) {
	page := queryParamInt(ctx, "page", 1)
	pageSize := queryParamInt(ctx, "page_size", 20)
	if pageSize > 100 {
		pageSize = 100
	}

	logs, total, err := h.sub.authSvc.GetAuditLogs(ctx, page, pageSize)
	if err != nil {
		log.Errorf(ctx, "[dashboard] audit logs error: %v", err)
		return nil, server.InternalError("failed to get audit logs")
	}

	return &domain.AuditLogsResponse{
		Items: logs,
		Total: total,
		Page:  page,
	}, nil
}

// ===========================================================================
// System handlers
// ===========================================================================

// handleSystemInfo — GET /dashboard/api/system/info
func (h *dashboardHandler) handleSystemInfo(ctx context.Context, _ *domain.EmptyRequest) (*domain.SystemInfo, error) {
	stats, err := h.sub.overviewSvc.GetOverview(ctx,
		h.sub.getSubservers(),
		h.sub.startedAt,
		h.sub.listenAddr,
	)
	if err != nil {
		log.Errorf(ctx, "[dashboard] system info error: %v", err)
		return nil, server.InternalError("failed to get system info")
	}

	return &stats.System, nil
}

// handleSystemRoutes — GET /dashboard/api/system/routes
func (h *dashboardHandler) handleSystemRoutes(ctx context.Context, _ *domain.EmptyRequest) (*domain.RoutesResponse, error) {
	handlers := server.GetOptions().Handlers

	routes := make([]domain.RouteInfo, 0, len(handlers))
	for _, handler := range handlers {
		routes = append(routes, domain.RouteInfo{
			Name:   handler.Name(),
			Path:   handler.Path(),
			Method: string(handler.Method()),
		})
	}

	return &domain.RoutesResponse{
		Count:  len(routes),
		Routes: routes,
	}, nil
}

// handleSystemSubservers — GET /dashboard/api/system/subservers
func (h *dashboardHandler) handleSystemSubservers(ctx context.Context, _ *domain.EmptyRequest) (*domain.SubserversResponse, error) {
	subservers := h.sub.getSubservers()

	items := make([]domain.SubServerInfo, 0, len(subservers))
	for _, sub := range subservers {
		items = append(items, domain.SubServerInfo{
			Name:   sub.Name(),
			Type:   string(sub.Type()),
			Status: string(sub.Status()),
		})
	}

	return &domain.SubserversResponse{
		Count: len(items),
		Items: items,
	}, nil
}

// ===========================================================================
// Peers session handlers (actor sessions, not dashboard admin sessions)
// ===========================================================================

// handleGetActivePeersSessions — GET /dashboard/api/sessions/active?limit=100
//
// Returns ALL currently-active actor sessions across the station, joined
// with the owning actor's preferred_username/email for display.
func (h *dashboardHandler) handleGetActivePeersSessions(ctx context.Context, _ *domain.EmptyRequest) (*domain.PeersSessionsResponse, error) {
	limit := queryParamInt(ctx, "limit", 100)
	if limit > 500 {
		limit = 500
	}

	sessions, err := h.sub.actorsSvc.ListActivePeersSessions(ctx, limit)
	if err != nil {
		log.Errorf(ctx, "[dashboard] get active peers sessions error: %v", err)
		return nil, server.InternalError("failed to get active sessions")
	}

	return &domain.PeersSessionsResponse{
		Count: len(sessions),
		Items: sessions,
	}, nil
}

// handleRevokePeersSession — POST /dashboard/api/sessions/:sid/revoke
func (h *dashboardHandler) handleRevokePeersSession(ctx context.Context, _ *domain.EmptyRequest) (*domain.MessageResponse, error) {
	claims := getClaims(ctx)

	sid := pathParam(ctx, "sid")
	if sid == "" {
		return nil, server.BadRequest("session id is required")
	}

	if err := h.sub.actorsSvc.RevokeActorSession(ctx, sid); err != nil {
		log.Errorf(ctx, "[dashboard] revoke peers session error: %v", err)
		return nil, server.InternalError("failed to revoke session")
	}

	h.sub.authSvc.RecordAudit(ctx, claims.AdminID, claims.Username, "revoke_peers_session", "session",
		"session_id="+sid, getClientIP(ctx), getUserAgent(ctx))

	return &domain.MessageResponse{Message: "session revoked"}, nil
}

// ===========================================================================
// Dashboard admin session handlers
// ===========================================================================

// handleDashboardSessions — GET /dashboard/api/dashboard-sessions
func (h *dashboardHandler) handleDashboardSessions(ctx context.Context, _ *domain.EmptyRequest) (*domain.DashboardSessionsResponse, error) {
	sessions, err := h.sub.authSvc.GetActiveSessions(ctx)
	if err != nil {
		log.Errorf(ctx, "[dashboard] get dashboard sessions error: %v", err)
		return nil, server.InternalError("failed to get dashboard sessions")
	}

	return &domain.DashboardSessionsResponse{
		Count: len(sessions),
		Items: sessions,
	}, nil
}

// handleRevokeDashboardSession — POST /dashboard/api/dashboard-sessions/:sid/revoke
func (h *dashboardHandler) handleRevokeDashboardSession(ctx context.Context, _ *domain.EmptyRequest) (*domain.MessageResponse, error) {
	claims := getClaims(ctx)

	sid := pathParam(ctx, "sid")
	if sid == "" {
		return nil, server.BadRequest("session id is required")
	}

	if err := h.sub.authSvc.RevokeSession(ctx, sid, claims.AdminID, getClientIP(ctx), getUserAgent(ctx)); err != nil {
		log.Errorf(ctx, "[dashboard] revoke dashboard session error: %v", err)
		return nil, server.InternalError("failed to revoke session")
	}

	return &domain.MessageResponse{Message: "dashboard session revoked"}, nil
}

// ===========================================================================
// Chat debug handlers
// ===========================================================================

// handleFriendChatStats — GET /dashboard/api/chat/friend/stats
func (h *dashboardHandler) handleFriendChatStats(ctx context.Context, _ *domain.EmptyRequest) (*domain.FriendChatStatsResponse, error) {
	if h.sub.chatDebugSvc == nil {
		return nil, serviceUnavailable("chat debug service unavailable")
	}

	stats, err := h.sub.chatDebugSvc.FriendChatStats(ctx)
	if err != nil {
		log.Errorf(ctx, "[dashboard] friend chat stats error: %v", err)
		return nil, server.InternalError("failed to load friend chat stats")
	}

	return stats, nil
}

// ===========================================================================
// Storage handlers
// ===========================================================================

// handleStorageInfo — GET /dashboard/api/storage/info
func (h *dashboardHandler) handleStorageInfo(ctx context.Context, _ *domain.EmptyRequest) (*domain.StorageInfo, error) {
	if h.sub.storageSvc == nil {
		return nil, serviceUnavailable("storage service unavailable")
	}

	info, err := h.sub.storageSvc.GetStorageInfo(ctx)
	if err != nil {
		log.Errorf(ctx, "[dashboard] storage info error: %v", err)
		return nil, server.InternalError("failed to load storage info")
	}

	return info, nil
}

// ===========================================================================
// Nodes handlers
// ===========================================================================

// handleNodes — GET /dashboard/api/nodes
func (h *dashboardHandler) handleNodes(ctx context.Context, _ *domain.EmptyRequest) (*domain.NodesOverview, error) {
	if h.sub.nodesSvc == nil {
		return nil, serviceUnavailable("nodes service unavailable")
	}

	overview, err := h.sub.nodesSvc.GetNodesOverview(ctx)
	if err != nil {
		log.Errorf(ctx, "[dashboard] nodes overview error: %v", err)
		return nil, server.InternalError("failed to load nodes")
	}

	return overview, nil
}

// ===========================================================================
// Path param parsing helpers
// ===========================================================================

// parsePathParamUint64 extracts a named path parameter and parses it as uint64.
func parsePathParamUint64(ctx context.Context, name string) (uint64, error) {
	raw := pathParam(ctx, name)
	return strconv.ParseUint(raw, 10, 64)
}
