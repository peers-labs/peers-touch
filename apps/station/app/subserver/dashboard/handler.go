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
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/infrastructure"
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

	// OSS management plane. The dashboard owns the read paths
	// against the OSS subserver's tables; mutating endpoints
	// cover bucket lifecycle (create / patch / delete) plus the
	// existing operator trust actions (peer key pin / unpin).
	routeOSSBuckets        = "/dashboard/api/oss/buckets"
	routeOSSBucketDetail   = "/dashboard/api/oss/buckets/:id"
	routeOSSBucketObjects  = "/dashboard/api/oss/buckets/:id/objects"
	routeOSSBucketUpload   = "/dashboard/api/oss/buckets/:id/upload"
	routeOSSObjects        = "/dashboard/api/oss/objects"
	routeOSSObjectDetail   = "/dashboard/api/oss/objects/:id"
	routeOSSAudit          = "/dashboard/api/oss/audit"
	routeOSSUsage          = "/dashboard/api/oss/usage"
	routeOSSFedMe          = "/dashboard/api/oss/federation/me"
	routeOSSFedPeers       = "/dashboard/api/oss/federation/peers"
	routeOSSFedPeerPin     = "/dashboard/api/oss/federation/peers/:id/pin"
	routeOSSFedPeerUnpin   = "/dashboard/api/oss/federation/peers/:id/unpin"
	routeOSSFedPeerForget  = "/dashboard/api/oss/federation/peers/:id"
	routeOSSFedRotate      = "/dashboard/api/oss/federation/rotate-local-key"
	routeOSSWorkers        = "/dashboard/api/oss/workers"
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

		// -- OSS management plane --
		server.NewTypedHandler("dashboard-oss-buckets", routeOSSBuckets, server.GET,
			h.handleOSSListBuckets, auth),
		server.NewTypedHandler("dashboard-oss-bucket-create", routeOSSBuckets, server.POST,
			h.handleOSSCreateBucket, auth),
		server.NewTypedHandler("dashboard-oss-bucket-detail", routeOSSBucketDetail, server.GET,
			h.handleOSSGetBucket, auth),
		server.NewTypedHandler("dashboard-oss-bucket-update", routeOSSBucketDetail, server.PATCH,
			h.handleOSSUpdateBucket, auth),
		server.NewTypedHandler("dashboard-oss-bucket-delete", routeOSSBucketDetail, server.DELETE,
			h.handleOSSDeleteBucket, auth),
		server.NewTypedHandler("dashboard-oss-bucket-objects", routeOSSBucketObjects, server.GET,
			h.handleOSSListBucketObjects, auth),
		// Multipart upload — registered as a raw HTTP handler so we
		// can stream the request body through `r.ParseMultipartForm`
		// without round-tripping through the typed-handler JSON
		// codec. The auth wrapper still runs (claims live in ctx).
		server.NewHTTPHandler("dashboard-oss-bucket-upload", routeOSSBucketUpload, server.POST,
			server.HTTPHandlerFunc(h.handleOSSAdminUpload), auth),
		server.NewTypedHandler("dashboard-oss-objects", routeOSSObjects, server.GET,
			h.handleOSSListObjects, auth),
		server.NewTypedHandler("dashboard-oss-object-detail", routeOSSObjectDetail, server.GET,
			h.handleOSSGetObject, auth),
		server.NewTypedHandler("dashboard-oss-object-patch", routeOSSObjectDetail, server.PATCH,
			h.handleOSSAdminPatchObject, auth),
		server.NewTypedHandler("dashboard-oss-object-delete", routeOSSObjectDetail, server.DELETE,
			h.handleOSSAdminDeleteObject, auth),
		server.NewTypedHandler("dashboard-oss-audit", routeOSSAudit, server.GET,
			h.handleOSSListAudit, auth),
		server.NewTypedHandler("dashboard-oss-usage", routeOSSUsage, server.GET,
			h.handleOSSUsage, auth),
		server.NewTypedHandler("dashboard-oss-fed-me", routeOSSFedMe, server.GET,
			h.handleOSSFederationMe, auth),
		server.NewTypedHandler("dashboard-oss-fed-peers", routeOSSFedPeers, server.GET,
			h.handleOSSFederationPeers, auth),
		server.NewTypedHandler("dashboard-oss-fed-peer-pin", routeOSSFedPeerPin, server.POST,
			h.handleOSSFederationPinPeer, auth),
		server.NewTypedHandler("dashboard-oss-fed-peer-unpin", routeOSSFedPeerUnpin, server.POST,
			h.handleOSSFederationUnpinPeer, auth),
		server.NewTypedHandler("dashboard-oss-fed-rotate", routeOSSFedRotate, server.POST,
			h.handleOSSFederationRotateLocalKey, auth),
		server.NewTypedHandler("dashboard-oss-fed-peer-forget", routeOSSFedPeerForget, server.DELETE,
			h.handleOSSFederationForgetPeer, auth),
		server.NewTypedHandler("dashboard-oss-workers", routeOSSWorkers, server.GET,
			h.handleOSSListWorkers, auth),
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
// OSS management plane handlers
// ===========================================================================

// handleOSSListBuckets — GET /dashboard/api/oss/buckets
func (h *dashboardHandler) handleOSSListBuckets(ctx context.Context, _ *domain.EmptyRequest) (*domain.OSSBucketListResponse, error) {
	if h.sub.ossSvc == nil {
		return nil, serviceUnavailable("oss service unavailable")
	}
	resp, err := h.sub.ossSvc.ListBuckets(ctx)
	if err != nil {
		log.Errorf(ctx, "[dashboard] oss list buckets error: %v", err)
		return nil, server.InternalError("failed to list buckets")
	}
	return resp, nil
}

// handleOSSGetBucket — GET /dashboard/api/oss/buckets/:id
func (h *dashboardHandler) handleOSSGetBucket(ctx context.Context, _ *domain.EmptyRequest) (*domain.OSSBucketSummary, error) {
	if h.sub.ossSvc == nil {
		return nil, serviceUnavailable("oss service unavailable")
	}
	id := pathParam(ctx, "id")
	if id == "" {
		return nil, server.BadRequest("bucket id is required")
	}
	row, err := h.sub.ossSvc.GetBucket(ctx, id)
	if err != nil {
		log.Errorf(ctx, "[dashboard] oss get bucket error: %v", err)
		return nil, server.InternalError("failed to load bucket")
	}
	if row == nil {
		return nil, server.NotFound("bucket not found")
	}
	return row, nil
}

// handleOSSCreateBucket — POST /dashboard/api/oss/buckets
//
// Operator-driven bucket creation. The dashboard NEVER creates
// `system`-kind buckets through this endpoint (those are auto-
// provisioned by the OSS subserver on first use); the service
// layer hardcodes `kind = user`.
//
// Audit emission is deliberate and dual:
//   - `oss_audit` row with `action = bucket_create` and the
//     operator's id stamped in `dashboard_actor_id` so the OSS
//     audit log captures the structural change with the right
//     attribution.
//   - dashboard admin audit so the operator activity stream shows
//     the action under the admin's name (matches the existing
//     pattern used by setPeerPin, etc.).
func (h *dashboardHandler) handleOSSCreateBucket(ctx context.Context, req *domain.OSSBucketCreateRequest) (*domain.OSSBucketSummary, error) {
	if h.sub.ossSvc == nil {
		return nil, serviceUnavailable("oss service unavailable")
	}
	if req == nil {
		return nil, server.BadRequest("request body is required")
	}
	claims := getClaims(ctx)
	row, err := h.sub.ossSvc.CreateBucket(ctx, *req)
	if err != nil {
		switch {
		case errors.Is(err, infrastructure.ErrBucketExists):
			h.recordOSSBucketAudit(ctx, claims, "bucket_create", "", req.OwnerActorID,
				"denied", "already_exists")
			return nil, server.Conflict("bucket already exists")
		case errors.Is(err, infrastructure.ErrBucketBadInput):
			return nil, server.BadRequest(err.Error())
		}
		// Service-layer validation errors (visibility, name, …)
		// surface as plain `errors.New("…")` strings; treat them
		// as 400 so admins see the precise complaint rather than
		// a 500 mystery.
		if strings.HasPrefix(err.Error(), "owner_actor_id") ||
			strings.HasPrefix(err.Error(), "name") ||
			strings.HasPrefix(err.Error(), "default_visibility") ||
			strings.HasPrefix(err.Error(), "quota_bytes") ||
			strings.HasPrefix(err.Error(), "ttl_days") ||
			strings.HasPrefix(err.Error(), "description") {
			return nil, server.BadRequest(err.Error())
		}
		log.Errorf(ctx, "[dashboard] oss create bucket error: %v", err)
		return nil, server.InternalError("failed to create bucket")
	}
	h.recordOSSBucketAudit(ctx, claims, "bucket_create", row.ID, row.OwnerActorID, "ok", "")
	h.sub.authSvc.RecordAudit(ctx, claims.AdminID, claims.Username, "oss_bucket_create", "oss_bucket",
		"bucket_id="+row.ID+" name="+row.Name, getClientIP(ctx), getUserAgent(ctx))
	return row, nil
}

// handleOSSUpdateBucket — PATCH /dashboard/api/oss/buckets/:id
//
// Partial-mutate of a bucket. The repo enforces "at least one
// field changed"; the service rejects unknown visibilities and
// negative numerics. Empty patches return 400 so the UI cannot
// silently no-op a "save" action.
func (h *dashboardHandler) handleOSSUpdateBucket(ctx context.Context, req *domain.OSSBucketUpdateRequest) (*domain.OSSBucketSummary, error) {
	if h.sub.ossSvc == nil {
		return nil, serviceUnavailable("oss service unavailable")
	}
	id := pathParam(ctx, "id")
	if id == "" {
		return nil, server.BadRequest("bucket id is required")
	}
	if req == nil {
		return nil, server.BadRequest("request body is required")
	}
	claims := getClaims(ctx)
	row, err := h.sub.ossSvc.UpdateBucket(ctx, id, *req)
	if err != nil {
		switch {
		case errors.Is(err, infrastructure.ErrBucketNotFound):
			return nil, server.NotFound("bucket not found")
		case errors.Is(err, infrastructure.ErrBucketBadInput):
			return nil, server.BadRequest(err.Error())
		}
		if strings.HasPrefix(err.Error(), "default_visibility") ||
			strings.HasPrefix(err.Error(), "quota_bytes") ||
			strings.HasPrefix(err.Error(), "ttl_days") ||
			strings.HasPrefix(err.Error(), "description") ||
			strings.HasPrefix(err.Error(), "at least one field") ||
			strings.HasPrefix(err.Error(), "bucket id") {
			return nil, server.BadRequest(err.Error())
		}
		log.Errorf(ctx, "[dashboard] oss update bucket error: %v", err)
		return nil, server.InternalError("failed to update bucket")
	}
	h.recordOSSBucketAudit(ctx, claims, "bucket_update", row.ID, row.OwnerActorID, "ok", "")
	h.sub.authSvc.RecordAudit(ctx, claims.AdminID, claims.Username, "oss_bucket_update", "oss_bucket",
		"bucket_id="+row.ID, getClientIP(ctx), getUserAgent(ctx))
	return row, nil
}

// handleOSSDeleteBucket — DELETE /dashboard/api/oss/buckets/:id
//
// Soft-deletes via `gorm.DeletedAt`. `?force=true` skips the
// "non-empty bucket" guard but NEVER overrides the system-bucket
// guard — the OSS upload path lazy-recreates system buckets, so
// hard-deleting one would produce a confusing audit history.
func (h *dashboardHandler) handleOSSDeleteBucket(ctx context.Context, _ *domain.EmptyRequest) (*domain.MessageResponse, error) {
	if h.sub.ossSvc == nil {
		return nil, serviceUnavailable("oss service unavailable")
	}
	id := pathParam(ctx, "id")
	if id == "" {
		return nil, server.BadRequest("bucket id is required")
	}
	force := strings.EqualFold(strings.TrimSpace(queryParam(ctx, "force")), "true")
	claims := getClaims(ctx)

	// Fetch first so we can attribute the audit row to the right
	// owner even after the row vanishes; cheap (single PK lookup).
	row, _ := h.sub.ossSvc.GetBucket(ctx, id)

	if err := h.sub.ossSvc.DeleteBucket(ctx, id, force); err != nil {
		switch {
		case errors.Is(err, infrastructure.ErrBucketNotFound):
			return nil, server.NotFound("bucket not found")
		case errors.Is(err, infrastructure.ErrBucketNotEmpty):
			h.recordOSSBucketAudit(ctx, claims, "bucket_delete", id, ownerID(row),
				"denied", "not_empty")
			return nil, server.Conflict("bucket not empty (use ?force=true)")
		case errors.Is(err, infrastructure.ErrBucketSystem):
			h.recordOSSBucketAudit(ctx, claims, "bucket_delete", id, ownerID(row),
				"denied", "system_bucket")
			return nil, server.Forbidden("system buckets cannot be deleted")
		}
		log.Errorf(ctx, "[dashboard] oss delete bucket error: %v", err)
		return nil, server.InternalError("failed to delete bucket")
	}
	h.recordOSSBucketAudit(ctx, claims, "bucket_delete", id, ownerID(row), "ok", "")
	h.sub.authSvc.RecordAudit(ctx, claims.AdminID, claims.Username, "oss_bucket_delete", "oss_bucket",
		"bucket_id="+id+" force="+strconv.FormatBool(force), getClientIP(ctx), getUserAgent(ctx))
	return &domain.MessageResponse{Message: "bucket deleted"}, nil
}

// recordOSSBucketAudit emits one row into oss_audit for a bucket
// lifecycle event. Failures are logged-not-returned so a
// downstream audit outage cannot turn a successful mutation into
// a 500.
func (h *dashboardHandler) recordOSSBucketAudit(ctx context.Context, claims *domain.DashboardClaims,
	action, bucketID, ownerActorID, outcome, reason string) {
	if h.sub.ossSvc == nil {
		return
	}
	dashID := ""
	if claims != nil {
		dashID = strconv.FormatUint(claims.AdminID, 10)
	}
	if err := h.sub.ossSvc.RecordOSSAudit(ctx, infrastructure.OSSAuditAppend{
		Action:           action,
		BucketID:         bucketID,
		ActorID:          ownerActorID,
		DashboardActorID: dashID,
		Outcome:          outcome,
		Reason:           reason,
	}); err != nil {
		log.Warnf(ctx, "[dashboard] oss_audit append failed (action=%s bucket=%s): %v",
			action, bucketID, err)
	}
}

// ownerID is a tiny null-safe accessor so the audit recorder can
// attribute "delete on missing bucket" to the empty owner without
// dereferencing a nil pointer.
func ownerID(b *domain.OSSBucketSummary) string {
	if b == nil {
		return ""
	}
	return b.OwnerActorID
}

// handleOSSAdminUpload — POST /dashboard/api/oss/buckets/:id/upload
//
// Operator-driven upload to a specific bucket. The bucket's
// `OwnerActorID` is what the OSS subserver stamps on the resulting
// `oss_files` row — the operator is acting on behalf of that owner,
// the same model that backs the existing
// `admin_visibility_override` and `admin_delete` paths.
//
// Auth: standard dashboard JWT (the auth wrapper still applies to
// HTTP-style handlers; we read the claims from ctx).
//
// Multipart shape (mirrors `/sub-oss/upload`):
//
//   - `file`              — the bytes (required)
//   - `visibility`        — public / chat / private (optional;
//                            falls back to bucket DefaultVisibility)
//   - `chat_session_id`   — required iff resolved visibility=chat
//   - `filename`          — display-name override (optional)
//
// Audits are dual:
//
//   - `oss_audit` row with action=`admin_upload` and the operator's
//     id stamped in `dashboard_actor_id` so the OSS audit log
//     captures the structural change with the right attribution.
//   - dashboard admin audit so the operator activity stream shows
//     the action under the admin's name.
//
// Errors map to:
//
//   - 400 invalid_multipart / file_required / chat_session_required /
//         visibility / quota_exceeded (when the OSS service rejects)
//   - 404 bucket not found
//   - 413 file_too_large (size > MaxFileSize)
//   - 503 admin upload not wired (oss subserver missing)
func (h *dashboardHandler) handleOSSAdminUpload(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if h.sub.ossSvc == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "oss_service_unavailable", "oss service unavailable")
		return
	}

	bucketID := pathParam(ctx, "id")
	if bucketID == "" {
		writeJSONError(w, http.StatusBadRequest, "bucket_required", "bucket id is required")
		return
	}

	maxSize := h.sub.ossSvc.AdminUploadFileSize()
	if maxSize <= 0 {
		// FileService is not wired — surface a clean 503 instead of
		// silently parsing the entire request body.
		writeJSONError(w, http.StatusServiceUnavailable, "admin_upload_unavailable",
			"oss admin upload is not available — oss subserver not wired")
		return
	}

	// Mirror `/sub-oss/upload`'s parse budget: max upload size + a
	// 1 MiB cushion for multipart frame overhead. The OSS handler
	// does the same — keeping the budget identical means the same
	// request body that succeeds against `/sub-oss/upload` succeeds
	// here too.
	r.Body = http.MaxBytesReader(w, r.Body, maxSize+(1<<20))
	if err := r.ParseMultipartForm(maxSize); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_multipart", "invalid multipart form")
		return
	}

	file, hdr, err := r.FormFile("file")
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "file_required", "file is required")
		return
	}
	defer file.Close()
	if hdr.Size > maxSize {
		writeJSONErrorObj(w, http.StatusRequestEntityTooLarge, map[string]any{
			"code":     "file_too_large",
			"error":    "file too large",
			"max_size": maxSize,
		})
		return
	}

	in := application.AdminUploadInput{
		BucketID:      bucketID,
		Visibility:    strings.TrimSpace(r.FormValue("visibility")),
		ChatSessionID: strings.TrimSpace(r.FormValue("chat_session_id")),
		Filename:      strings.TrimSpace(r.FormValue("filename")),
		File:          file,
		Header:        hdr,
	}

	claims := getClaims(ctx)
	row, err := h.sub.ossSvc.AdminUploadObject(ctx, in)
	if err != nil {
		h.translateAdminUploadError(ctx, w, claims, bucketID, err)
		return
	}

	h.recordOSSObjectAudit(ctx, claims, "admin_upload", row.ID, row, "ok", "")
	h.sub.authSvc.RecordAudit(ctx, claims.AdminID, claims.Username, "oss_object_admin_upload", "oss_object",
		"object_id="+row.ID+" bucket_id="+bucketID, getClientIP(ctx), getUserAgent(ctx))

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(row)
}

// translateAdminUploadError maps service-layer errors from the
// OSS file service into HTTP responses with stable `code` strings
// the frontend can match on. Mirrors the mapping
// `writeUploadServiceError` performs in the OSS subserver so an
// operator using either upload path sees the same vocabulary.
func (h *dashboardHandler) translateAdminUploadError(ctx context.Context, w http.ResponseWriter,
	claims *domain.DashboardClaims, bucketID string, err error) {
	msg := err.Error()
	switch {
	case errors.Is(err, application.ErrAdminUploadUnavailable):
		writeJSONError(w, http.StatusServiceUnavailable, "admin_upload_unavailable", msg)
	case errors.Is(err, application.ErrAdminUploadBucketRequired):
		writeJSONError(w, http.StatusBadRequest, "bucket_required", msg)
	case strings.HasPrefix(msg, "bucket not found"),
		strings.HasPrefix(msg, "bucket has no owner_actor_id"):
		h.recordOSSBucketAudit(ctx, claims, "admin_upload", bucketID, "", "denied", "bucket_not_found")
		writeJSONError(w, http.StatusNotFound, "bucket_not_found", msg)
	case strings.HasPrefix(msg, "visibility"):
		writeJSONError(w, http.StatusBadRequest, "invalid_visibility", msg)
	default:
		// Fall through with a generic 500 plus the underlying message.
		// The OSS service emits `chat_session_required`, `quota_exceeded`
		// etc. as wrapped errors; we surface them verbatim so an
		// operator sees the precise complaint.
		log.Errorf(ctx, "[dashboard] oss admin upload error: %v", err)
		switch {
		case strings.Contains(msg, "chat_session_id"):
			writeJSONError(w, http.StatusBadRequest, "chat_session_required", msg)
		case strings.Contains(msg, "quota"):
			writeJSONError(w, http.StatusRequestEntityTooLarge, "quota_exceeded", msg)
		default:
			writeJSONError(w, http.StatusInternalServerError, "upload_failed", msg)
		}
	}
}

// writeJSONError emits a stable JSON error envelope so the dashboard
// frontend can match on `code` rather than parse English.
func writeJSONError(w http.ResponseWriter, status int, code, message string) {
	writeJSONErrorObj(w, status, map[string]any{"code": code, "error": message})
}

func writeJSONErrorObj(w http.ResponseWriter, status int, body map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// handleOSSListBucketObjects — GET /dashboard/api/oss/buckets/:id/objects
//
// This is a sugar route over /objects?bucket_id=:id; it short-circuits
// when the bucket does not exist so the dashboard does not have to
// disambiguate "empty bucket" from "no bucket".
func (h *dashboardHandler) handleOSSListBucketObjects(ctx context.Context, _ *domain.EmptyRequest) (*domain.OSSObjectListResponse, error) {
	if h.sub.ossSvc == nil {
		return nil, serviceUnavailable("oss service unavailable")
	}
	id := pathParam(ctx, "id")
	if id == "" {
		return nil, server.BadRequest("bucket id is required")
	}
	bucket, err := h.sub.ossSvc.GetBucket(ctx, id)
	if err != nil {
		log.Errorf(ctx, "[dashboard] oss bucket lookup error: %v", err)
		return nil, server.InternalError("failed to load bucket")
	}
	if bucket == nil {
		return nil, server.NotFound("bucket not found")
	}
	q := infrastructure.OSSObjectQuery{
		BucketID:     id,
		OwnerActorID: queryParam(ctx, "owner_actor_id"),
		Visibility:   queryParam(ctx, "visibility"),
		Mime:         queryParam(ctx, "mime"),
		Page:         queryParamInt(ctx, "page", 1),
		PageSize:     queryParamInt(ctx, "page_size", 50),
	}
	if q.PageSize > 200 {
		q.PageSize = 200
	}
	resp, err := h.sub.ossSvc.ListObjects(ctx, q)
	if err != nil {
		log.Errorf(ctx, "[dashboard] oss list bucket objects error: %v", err)
		return nil, server.InternalError("failed to list objects")
	}
	return resp, nil
}

// handleOSSGetObject — GET /dashboard/api/oss/objects/:id
//
// Returns the admin detail for a single file, including soft-
// deleted rows so the operator can inspect the lifecycle history
// before acting.
func (h *dashboardHandler) handleOSSGetObject(ctx context.Context, _ *domain.EmptyRequest) (*domain.OSSObjectAdminDetail, error) {
	if h.sub.ossSvc == nil {
		return nil, serviceUnavailable("oss service unavailable")
	}
	id := pathParam(ctx, "id")
	if id == "" {
		return nil, server.BadRequest("object id is required")
	}
	row, err := h.sub.ossSvc.GetObject(ctx, id)
	if err != nil {
		log.Errorf(ctx, "[dashboard] oss get object error: %v", err)
		return nil, server.InternalError("failed to load object")
	}
	if row == nil {
		return nil, server.NotFound("object not found")
	}
	return row, nil
}

// handleOSSAdminPatchObject — PATCH /dashboard/api/oss/objects/:id
//
// Operator-driven object mutate. Bypasses owner permission
// checks (this is the operator's escape hatch) but DOES enforce
// the same visibility / chat-session invariants as the user
// PATCH path so the row never lands in an invalid state.
//
// Bucket-move is intentionally NOT supported here — quota
// transfer is owner-scoped by design (see file_service.PatchFile);
// operators who need to move a file across buckets should ask
// the owner to use the user PATCH endpoint.
//
// Audits are dual: `oss_audit` row with action=
// `admin_visibility_override` plus dashboard admin audit.
func (h *dashboardHandler) handleOSSAdminPatchObject(ctx context.Context, req *domain.OSSObjectAdminPatchRequest) (*domain.OSSObjectAdminDetail, error) {
	if h.sub.ossSvc == nil {
		return nil, serviceUnavailable("oss service unavailable")
	}
	id := pathParam(ctx, "id")
	if id == "" {
		return nil, server.BadRequest("object id is required")
	}
	if req == nil {
		return nil, server.BadRequest("request body is required")
	}
	claims := getClaims(ctx)

	row, err := h.sub.ossSvc.AdminPatchObject(ctx, id, *req)
	if err != nil {
		switch {
		case errors.Is(err, infrastructure.ErrFileNotFound):
			return nil, server.NotFound("object not found")
		case errors.Is(err, infrastructure.ErrFileAlreadyDeleted):
			h.recordOSSObjectAudit(ctx, claims, "admin_visibility_override", id, nil,
				"denied", "already_deleted")
			return nil, server.Conflict("object is already deleted")
		case errors.Is(err, infrastructure.ErrFileChatNeedsSession):
			return nil, server.BadRequest("visibility=chat requires chat_session_id")
		case errors.Is(err, infrastructure.ErrFileBadInput):
			return nil, server.BadRequest("invalid patch input")
		}
		if strings.HasPrefix(err.Error(), "visibility") ||
			strings.HasPrefix(err.Error(), "object id") ||
			strings.HasPrefix(err.Error(), "at least one field") {
			return nil, server.BadRequest(err.Error())
		}
		log.Errorf(ctx, "[dashboard] oss admin patch object error: %v", err)
		return nil, server.InternalError("failed to patch object")
	}
	h.recordOSSObjectAudit(ctx, claims, "admin_visibility_override", id, row, "ok", "")
	h.sub.authSvc.RecordAudit(ctx, claims.AdminID, claims.Username, "oss_object_admin_patch", "oss_object",
		"object_id="+id, getClientIP(ctx), getUserAgent(ctx))
	return row, nil
}

// handleOSSAdminDeleteObject — DELETE /dashboard/api/oss/objects/:id
//
// Operator force-delete. Idempotent: a re-delete of an already
// soft-deleted row returns 200 with the existing detail and
// emits an audit row with reason=already_deleted.
//
// We do NOT debit bucket usage or decrement blob refcount here —
// per the v3 plan, the BucketReconciler / BlobGC workers (S11+)
// own ground-truth reconciliation. Doing the debit synchronously
// from the dashboard would risk drift between this path and the
// OSS subserver's owner-scoped DeleteFile.
func (h *dashboardHandler) handleOSSAdminDeleteObject(ctx context.Context, _ *domain.EmptyRequest) (*domain.OSSObjectAdminDetail, error) {
	if h.sub.ossSvc == nil {
		return nil, serviceUnavailable("oss service unavailable")
	}
	id := pathParam(ctx, "id")
	if id == "" {
		return nil, server.BadRequest("object id is required")
	}
	claims := getClaims(ctx)

	row, err := h.sub.ossSvc.AdminDeleteObject(ctx, id)
	if err != nil {
		if errors.Is(err, infrastructure.ErrFileAlreadyDeleted) && row != nil {
			h.recordOSSObjectAudit(ctx, claims, "admin_delete", id, row, "ok", "already_deleted")
			h.sub.authSvc.RecordAudit(ctx, claims.AdminID, claims.Username, "oss_object_admin_delete", "oss_object",
				"object_id="+id+" already_deleted", getClientIP(ctx), getUserAgent(ctx))
			return row, nil
		}
		if errors.Is(err, infrastructure.ErrFileNotFound) {
			return nil, server.NotFound("object not found")
		}
		log.Errorf(ctx, "[dashboard] oss admin delete object error: %v", err)
		return nil, server.InternalError("failed to delete object")
	}
	h.recordOSSObjectAudit(ctx, claims, "admin_delete", id, row, "ok", "")
	h.sub.authSvc.RecordAudit(ctx, claims.AdminID, claims.Username, "oss_object_admin_delete", "oss_object",
		"object_id="+id, getClientIP(ctx), getUserAgent(ctx))
	return row, nil
}

// recordOSSObjectAudit emits one row into oss_audit for an
// admin-driven object mutation. Same fire-and-forget contract
// as recordOSSBucketAudit — auditing must not turn a successful
// mutation into a 500.
func (h *dashboardHandler) recordOSSObjectAudit(ctx context.Context, claims *domain.DashboardClaims,
	action, fileID string, row *domain.OSSObjectAdminDetail, outcome, reason string) {
	if h.sub.ossSvc == nil {
		return
	}
	dashID := ""
	if claims != nil {
		dashID = strconv.FormatUint(claims.AdminID, 10)
	}
	evt := infrastructure.OSSAuditAppend{
		Action:           action,
		FileID:           fileID,
		DashboardActorID: dashID,
		Outcome:          outcome,
		Reason:           reason,
	}
	if row != nil {
		evt.FileKey = row.Key
		evt.BucketID = row.BucketID
		evt.ActorID = row.OwnerActorID
		evt.SizeBytes = row.Size
	}
	if err := h.sub.ossSvc.RecordOSSAudit(ctx, evt); err != nil {
		log.Warnf(ctx, "[dashboard] oss_audit append failed (action=%s file=%s): %v",
			action, fileID, err)
	}
}

// handleOSSListObjects — GET /dashboard/api/oss/objects
//
// Filters: bucket_id, owner_actor_id, visibility, mime, page,
// page_size. All optional; an unfiltered call returns the most
// recent N rows across all buckets.
func (h *dashboardHandler) handleOSSListObjects(ctx context.Context, _ *domain.EmptyRequest) (*domain.OSSObjectListResponse, error) {
	if h.sub.ossSvc == nil {
		return nil, serviceUnavailable("oss service unavailable")
	}
	q := infrastructure.OSSObjectQuery{
		BucketID:     queryParam(ctx, "bucket_id"),
		OwnerActorID: queryParam(ctx, "owner_actor_id"),
		Visibility:   queryParam(ctx, "visibility"),
		Mime:         queryParam(ctx, "mime"),
		Page:         queryParamInt(ctx, "page", 1),
		PageSize:     queryParamInt(ctx, "page_size", 50),
	}
	if q.PageSize > 200 {
		q.PageSize = 200
	}
	resp, err := h.sub.ossSvc.ListObjects(ctx, q)
	if err != nil {
		log.Errorf(ctx, "[dashboard] oss list objects error: %v", err)
		return nil, server.InternalError("failed to list objects")
	}
	return resp, nil
}

// handleOSSListAudit — GET /dashboard/api/oss/audit
//
// Filters: action, actor_id, bucket_id, file_key, outcome, since,
// until, page, page_size. `since`/`until` accept RFC3339 timestamps;
// unparseable values are treated as zero (i.e. no bound).
func (h *dashboardHandler) handleOSSListAudit(ctx context.Context, _ *domain.EmptyRequest) (*domain.OSSAuditListResponse, error) {
	if h.sub.ossSvc == nil {
		return nil, serviceUnavailable("oss service unavailable")
	}
	q := infrastructure.OSSAuditQuery{
		Action:   queryParam(ctx, "action"),
		ActorID:  queryParam(ctx, "actor_id"),
		BucketID: queryParam(ctx, "bucket_id"),
		FileKey:  queryParam(ctx, "file_key"),
		Outcome:  queryParam(ctx, "outcome"),
		Page:     queryParamInt(ctx, "page", 1),
		PageSize: queryParamInt(ctx, "page_size", 50),
	}
	if q.PageSize > 200 {
		q.PageSize = 200
	}
	if raw := queryParam(ctx, "since"); raw != "" {
		if t, err := time.Parse(time.RFC3339, raw); err == nil {
			q.Since = t
		}
	}
	if raw := queryParam(ctx, "until"); raw != "" {
		if t, err := time.Parse(time.RFC3339, raw); err == nil {
			q.Until = t
		}
	}
	resp, err := h.sub.ossSvc.ListAudit(ctx, q)
	if err != nil {
		log.Errorf(ctx, "[dashboard] oss list audit error: %v", err)
		return nil, server.InternalError("failed to list audit events")
	}
	return resp, nil
}

// handleOSSUsage — GET /dashboard/api/oss/usage
func (h *dashboardHandler) handleOSSUsage(ctx context.Context, _ *domain.EmptyRequest) (*domain.OSSUsageSummary, error) {
	if h.sub.ossSvc == nil {
		return nil, serviceUnavailable("oss service unavailable")
	}
	resp, err := h.sub.ossSvc.Usage(ctx)
	if err != nil {
		log.Errorf(ctx, "[dashboard] oss usage error: %v", err)
		return nil, server.InternalError("failed to load usage")
	}
	return resp, nil
}

// handleOSSFederationMe — GET /dashboard/api/oss/federation/me
//
// Returns this station's outbound federation key — public material
// only. The private key never leaves oss_meta; the dashboard would
// have no legitimate reason to expose it.
func (h *dashboardHandler) handleOSSFederationMe(ctx context.Context, _ *domain.EmptyRequest) (*domain.OSSFederationLocalKey, error) {
	if h.sub.ossSvc == nil {
		return nil, serviceUnavailable("oss service unavailable")
	}
	resp, err := h.sub.ossSvc.GetFederationLocal(ctx)
	if err != nil {
		log.Errorf(ctx, "[dashboard] oss federation me error: %v", err)
		return nil, server.InternalError("failed to load federation key")
	}
	return resp, nil
}

// handleOSSFederationPeers — GET /dashboard/api/oss/federation/peers
func (h *dashboardHandler) handleOSSFederationPeers(ctx context.Context, _ *domain.EmptyRequest) (*domain.OSSFederationPeersResponse, error) {
	if h.sub.ossSvc == nil {
		return nil, serviceUnavailable("oss service unavailable")
	}
	resp, err := h.sub.ossSvc.ListFederationPeers(ctx)
	if err != nil {
		log.Errorf(ctx, "[dashboard] oss federation peers error: %v", err)
		return nil, server.InternalError("failed to list peers")
	}
	return resp, nil
}

// handleOSSFederationPinPeer — POST /dashboard/api/oss/federation/peers/:id/pin
//
// Promoting a TOFU row to Pinned=true is the operator's commitment
// that this peer's current key is correct. We record it in the
// dashboard audit trail so a future audit can prove who flipped it
// when. The `:id` segment is the peer station id (NOT a numeric).
func (h *dashboardHandler) handleOSSFederationPinPeer(ctx context.Context, _ *domain.EmptyRequest) (*domain.MessageResponse, error) {
	return h.setPeerPin(ctx, true)
}

// handleOSSFederationUnpinPeer — POST /dashboard/api/oss/federation/peers/:id/unpin
func (h *dashboardHandler) handleOSSFederationUnpinPeer(ctx context.Context, _ *domain.EmptyRequest) (*domain.MessageResponse, error) {
	return h.setPeerPin(ctx, false)
}

func (h *dashboardHandler) setPeerPin(ctx context.Context, pinned bool) (*domain.MessageResponse, error) {
	if h.sub.ossSvc == nil {
		return nil, serviceUnavailable("oss service unavailable")
	}
	claims := getClaims(ctx)
	peerID := pathParam(ctx, "id")
	if peerID == "" {
		return nil, server.BadRequest("peer station id is required")
	}
	if err := h.sub.ossSvc.SetPeerPin(ctx, peerID, pinned); err != nil {
		if errors.Is(err, infrastructure.ErrPeerNotFound) {
			return nil, server.NotFound("peer not found")
		}
		log.Errorf(ctx, "[dashboard] oss set peer pin error: %v", err)
		return nil, server.InternalError("failed to update peer pin")
	}
	action := "oss_pin_peer"
	msg := "peer pinned"
	if !pinned {
		action = "oss_unpin_peer"
		msg = "peer unpinned"
	}
	h.sub.authSvc.RecordAudit(ctx, claims.AdminID, claims.Username, action, "oss_peer",
		"peer_station_id="+peerID, getClientIP(ctx), getUserAgent(ctx))
	return &domain.MessageResponse{Message: msg}, nil
}

// handleOSSFederationRotateLocalKey — POST /dashboard/api/oss/federation/rotate-local-key
//
// Provisions a fresh Ed25519 keypair for this station's outbound
// federation identity. The previous keypair is demoted to the
// `_prev` slot for the dual-sign grace window so peers that
// cached our pubkey can still verify in-flight tokens until the
// `KeyRotationFinalizer` worker (S12) clears them.
//
// Two audit rows are emitted:
//   - the dashboard's own admin trail (who triggered it, from
//     where), via `authSvc.RecordAudit`
//   - the OSS subserver's `oss_audit` trail (action=`key_rotate`,
//     reason carries `prev_kid` / `new_kid`), via
//     `recordOSSFederationAudit`
//
// The OSS subserver's in-memory federation key cache reloads on
// its own short TTL, so callers do not need to coordinate with
// the OSS subserver here.
func (h *dashboardHandler) handleOSSFederationRotateLocalKey(ctx context.Context, _ *domain.EmptyRequest) (*domain.OSSFederationRotateResponse, error) {
	if h.sub.ossSvc == nil {
		return nil, serviceUnavailable("oss service unavailable")
	}
	claims := getClaims(ctx)

	resp, err := h.sub.ossSvc.RotateFederationLocalKey(ctx)
	if err != nil {
		log.Errorf(ctx, "[dashboard] oss federation rotate error: %v", err)
		// Audit the failure too — the operator initiated a
		// security-sensitive action, the trail must capture
		// outcomes regardless of success.
		h.recordOSSFederationAudit(ctx, claims, "", "", "error", err.Error())
		if claims != nil {
			h.sub.authSvc.RecordAudit(ctx, claims.AdminID, claims.Username,
				"oss_federation_rotate", "oss_federation",
				"error="+err.Error(), getClientIP(ctx), getUserAgent(ctx))
		}
		return nil, server.InternalError("failed to rotate federation key")
	}

	h.recordOSSFederationAudit(ctx, claims, resp.NewKID, resp.PreviousKID, "ok", "")
	if claims != nil {
		reason := "new_kid=" + resp.NewKID
		if resp.PreviousKID != "" {
			reason += " prev_kid=" + resp.PreviousKID
		}
		h.sub.authSvc.RecordAudit(ctx, claims.AdminID, claims.Username,
			"oss_federation_rotate", "oss_federation",
			reason, getClientIP(ctx), getUserAgent(ctx))
	}
	return resp, nil
}

// recordOSSFederationAudit emits one row into oss_audit for a
// federation key-rotation event. Same fail-soft semantics as
// recordOSSBucketAudit / recordOSSObjectAudit — auditing must not
// turn a successful rotation into a 500.
func (h *dashboardHandler) recordOSSFederationAudit(ctx context.Context, claims *domain.DashboardClaims,
	newKID, prevKID, outcome, errReason string) {
	if h.sub.ossSvc == nil {
		return
	}
	dashID := ""
	if claims != nil {
		dashID = strconv.FormatUint(claims.AdminID, 10)
	}
	reason := "new_kid=" + newKID
	if prevKID != "" {
		reason += " prev_kid=" + prevKID
	}
	if errReason != "" {
		reason = errReason
	}
	if err := h.sub.ossSvc.RecordOSSAudit(ctx, infrastructure.OSSAuditAppend{
		Action:           "key_rotate",
		DashboardActorID: dashID,
		Outcome:          outcome,
		Reason:           reason,
	}); err != nil {
		log.Warnf(ctx, "[dashboard] oss_audit append failed (action=key_rotate new_kid=%s): %v",
			newKID, err)
	}
}

// handleOSSFederationForgetPeer — DELETE /dashboard/api/oss/federation/peers/:id
//
// Hard-removes the peer's TOFU row. Distinct from
// `handleOSSFederationUnpinPeer`, which only flips the pinned
// flag — forgetting drops the kid entirely so the next inbound
// request from the peer re-pairs from scratch. We record both an
// admin-side audit row and an `oss_audit` row tagged with the
// dashboard actor id so the operator's intent is captured in the
// federation-side trail too.
func (h *dashboardHandler) handleOSSFederationForgetPeer(ctx context.Context, _ *domain.EmptyRequest) (*domain.MessageResponse, error) {
	if h.sub.ossSvc == nil {
		return nil, serviceUnavailable("oss service unavailable")
	}
	claims := getClaims(ctx)
	peerID := pathParam(ctx, "id")
	if peerID == "" {
		return nil, server.BadRequest("peer station id is required")
	}
	if err := h.sub.ossSvc.ForgetPeer(ctx, peerID); err != nil {
		if errors.Is(err, infrastructure.ErrPeerNotFound) {
			return nil, server.NotFound("peer not found")
		}
		log.Errorf(ctx, "[dashboard] oss forget peer error: %v", err)
		// Audit the failure on both trails — the operator
		// initiated a security-sensitive action.
		h.recordOSSFederationAudit(ctx, claims, "", peerID, "error", err.Error())
		if claims != nil {
			h.sub.authSvc.RecordAudit(ctx, claims.AdminID, claims.Username,
				"oss_forget_peer", "oss_peer",
				"peer_station_id="+peerID+" error="+err.Error(),
				getClientIP(ctx), getUserAgent(ctx))
		}
		return nil, server.InternalError("failed to forget peer")
	}

	h.recordOSSFederationAudit(ctx, claims, "", peerID, "ok", "")
	if claims != nil {
		h.sub.authSvc.RecordAudit(ctx, claims.AdminID, claims.Username,
			"oss_forget_peer", "oss_peer",
			"peer_station_id="+peerID, getClientIP(ctx), getUserAgent(ctx))
	}
	return &domain.MessageResponse{Message: "peer forgotten"}, nil
}

// handleOSSListWorkers — GET /dashboard/api/oss/workers
//
// Returns the per-worker heartbeat projection over `oss_audit`.
// The lookback window is taken from the optional `?hours=` query
// param (defaulting to 24h, capped at 30d so a curious operator
// cannot accidentally walk the entire audit table).
func (h *dashboardHandler) handleOSSListWorkers(ctx context.Context, _ *domain.EmptyRequest) (*domain.OSSWorkersSummary, error) {
	if h.sub.ossSvc == nil {
		return nil, serviceUnavailable("oss service unavailable")
	}
	const (
		defaultLookback = 24 * time.Hour
		maxLookback     = 30 * 24 * time.Hour
	)
	lookback := defaultLookback
	if hoursStr := queryParam(ctx, "hours"); hoursStr != "" {
		hours, err := strconv.ParseFloat(hoursStr, 64)
		if err != nil || hours <= 0 {
			return nil, server.BadRequest("hours must be a positive number")
		}
		lookback = time.Duration(hours * float64(time.Hour))
		if lookback > maxLookback {
			lookback = maxLookback
		}
	}
	resp, err := h.sub.ossSvc.ListWorkers(ctx, lookback)
	if err != nil {
		log.Errorf(ctx, "[dashboard] oss list workers error: %v", err)
		return nil, server.InternalError("failed to load workers")
	}
	return resp, nil
}

// ===========================================================================
// Path param parsing helpers
// ===========================================================================

// parsePathParamUint64 extracts a named path parameter and parses it as uint64.
func parsePathParamUint64(ctx context.Context, name string) (uint64, error) {
	raw := pathParam(ctx, name)
	return strconv.ParseUint(raw, 10, 64)
}
