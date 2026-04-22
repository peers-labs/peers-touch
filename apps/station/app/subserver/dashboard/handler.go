// Package dashboard — HTTP handler layer. Translates HTTP requests into
// application service calls and serialises responses as JSON.
//
// Change History:
//   - 2026-04-10: Initial implementation — 22+ endpoints covering auth,
//     overview, actors, admins, audit, system, sessions.
//   - 2026-04-10: Refactored to depend on DDD application/domain layers
//     instead of flat package types.
package dashboard

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"

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
func (h *dashboardHandler) handlers() []server.Handler {
	return []server.Handler{
		// -- Auth --
		server.NewHTTPHandler("dashboard-login", routeLogin, server.POST,
			server.HertzHandlerFunc(h.handleLogin)),
		server.NewHTTPHandler("dashboard-logout", routeLogout, server.POST,
			server.HertzHandlerFunc(h.handleLogout)),
		server.NewHTTPHandler("dashboard-me", routeMe, server.GET,
			server.HertzHandlerFunc(h.handleMe)),
		server.NewHTTPHandler("dashboard-change-password", routeChangePassword, server.POST,
			server.HertzHandlerFunc(h.handleChangePassword)),

		// -- Overview --
		server.NewHTTPHandler("dashboard-overview-stats", routeOverviewStats, server.GET,
			server.HertzHandlerFunc(h.handleOverviewStats)),
		server.NewHTTPHandler("dashboard-overview-recent-actors", routeOverviewRecentActors, server.GET,
			server.HertzHandlerFunc(h.handleRecentActors)),
		server.NewHTTPHandler("dashboard-overview-recent-audit", routeOverviewRecentAudit, server.GET,
			server.HertzHandlerFunc(h.handleRecentAuditLogs)),

		// -- Actors --
		server.NewHTTPHandler("dashboard-list-actors", routeActors, server.GET,
			server.HertzHandlerFunc(h.handleListActors)),
		server.NewHTTPHandler("dashboard-get-actor", routeActorDetail, server.GET,
			server.HertzHandlerFunc(h.handleGetActor)),
		server.NewHTTPHandler("dashboard-actor-sessions", routeActorSessions, server.GET,
			server.HertzHandlerFunc(h.handleGetActorSessions)),
		server.NewHTTPHandler("dashboard-actor-reset-password", routeActorResetPassword, server.POST,
			server.HertzHandlerFunc(h.handleResetActorPassword)),
		server.NewHTTPHandler("dashboard-actor-revoke-session", routeActorRevokeSession, server.POST,
			server.HertzHandlerFunc(h.handleRevokeActorSession)),

		// -- Admins --
		server.NewHTTPHandler("dashboard-create-admin", routeAdmins, server.POST,
			server.HertzHandlerFunc(h.handleCreateAdmin)),
		server.NewHTTPHandler("dashboard-list-admins", routeAdmins, server.GET,
			server.HertzHandlerFunc(h.handleListAdmins)),
		server.NewHTTPHandler("dashboard-disable-admin", routeAdminDisable, server.POST,
			server.HertzHandlerFunc(h.handleDisableAdmin)),
		server.NewHTTPHandler("dashboard-enable-admin", routeAdminEnable, server.POST,
			server.HertzHandlerFunc(h.handleEnableAdmin)),
		server.NewHTTPHandler("dashboard-delete-admin", routeAdminDelete, server.DELETE,
			server.HertzHandlerFunc(h.handleDeleteAdmin)),

		// -- Audit logs --
		server.NewHTTPHandler("dashboard-audit-logs", routeAuditLogs, server.GET,
			server.HertzHandlerFunc(h.handleAuditLogs)),

		// -- System --
		server.NewHTTPHandler("dashboard-system-info", routeSystemInfo, server.GET,
			server.HertzHandlerFunc(h.handleSystemInfo)),
		server.NewHTTPHandler("dashboard-system-routes", routeSystemRoutes, server.GET,
			server.HertzHandlerFunc(h.handleSystemRoutes)),
		server.NewHTTPHandler("dashboard-system-subservers", routeSystemSubservers, server.GET,
			server.HertzHandlerFunc(h.handleSystemSubservers)),

		// -- Peers actor sessions --
		server.NewHTTPHandler("dashboard-peers-sessions", routePeersSessions, server.GET,
			server.HertzHandlerFunc(h.handleGetActivePeersSessions)),
		server.NewHTTPHandler("dashboard-peers-revoke-session", routePeersRevokeSession, server.POST,
			server.HertzHandlerFunc(h.handleRevokePeersSession)),

		// -- Dashboard admin sessions --
		server.NewHTTPHandler("dashboard-admin-sessions", routeDashboardSessions, server.GET,
			server.HertzHandlerFunc(h.handleDashboardSessions)),
		server.NewHTTPHandler("dashboard-admin-revoke-session", routeDashboardRevokeSession, server.POST,
			server.HertzHandlerFunc(h.handleRevokeDashboardSession)),

		// -- Chat debug --
		server.NewHTTPHandler("dashboard-friend-chat-stats", routeFriendChatStats, server.GET,
			server.HertzHandlerFunc(h.handleFriendChatStats)),

		// -- Storage --
		server.NewHTTPHandler("dashboard-storage-info", routeStorageInfo, server.GET,
			server.HertzHandlerFunc(h.handleStorageInfo)),

		// -- Nodes --
		server.NewHTTPHandler("dashboard-nodes", routeNodes, server.GET,
			server.HertzHandlerFunc(h.handleNodes)),
	}
}

// handleStorageInfo — GET /dashboard/api/storage/info
func (h *dashboardHandler) handleStorageInfo(c context.Context, ctx *app.RequestContext) {
	if h.requireAuth(c, ctx) == nil {
		return
	}
	if h.sub.storageSvc == nil {
		jsonError(ctx, http.StatusServiceUnavailable, "storage service unavailable")
		return
	}
	info, err := h.sub.storageSvc.GetStorageInfo(c)
	if err != nil {
		log.Errorf(c, "[dashboard] storage info error: %v", err)
		jsonError(ctx, http.StatusInternalServerError, "failed to load storage info")
		return
	}
	jsonOK(ctx, info)
}

// handleNodes — GET /dashboard/api/nodes
func (h *dashboardHandler) handleNodes(c context.Context, ctx *app.RequestContext) {
	if h.requireAuth(c, ctx) == nil {
		return
	}
	if h.sub.nodesSvc == nil {
		jsonError(ctx, http.StatusServiceUnavailable, "nodes service unavailable")
		return
	}
	overview, err := h.sub.nodesSvc.GetNodesOverview(c)
	if err != nil {
		log.Errorf(c, "[dashboard] nodes overview error: %v", err)
		jsonError(ctx, http.StatusInternalServerError, "failed to load nodes")
		return
	}
	jsonOK(ctx, overview)
}


// handleFriendChatStats — GET /dashboard/api/chat/friend/stats
func (h *dashboardHandler) handleFriendChatStats(c context.Context, ctx *app.RequestContext) {
	claims := h.requireAuth(c, ctx)
	if claims == nil {
		return
	}
	if h.sub.chatDebugSvc == nil {
		jsonError(ctx, http.StatusServiceUnavailable, "chat debug service unavailable")
		return
	}
	stats, err := h.sub.chatDebugSvc.FriendChatStats(c)
	if err != nil {
		log.Errorf(c, "[dashboard] friend chat stats error: %v", err)
		jsonError(ctx, http.StatusInternalServerError, "failed to load friend chat stats")
		return
	}
	jsonOK(ctx, stats)
}

// ===========================================================================
// Helper: JSON response utilities
// ===========================================================================

func jsonOK(ctx *app.RequestContext, data interface{}) {
	ctx.JSON(http.StatusOK, data)
}

func jsonCreated(ctx *app.RequestContext, data interface{}) {
	ctx.JSON(http.StatusCreated, data)
}

func jsonError(ctx *app.RequestContext, status int, message string) {
	ctx.JSON(status, map[string]interface{}{
		"error": message,
		"code":  status,
	})
}

// ===========================================================================
// Helper: extract IP and User-Agent from Hertz request context
// ===========================================================================

func clientIP(ctx *app.RequestContext) string {
	return ctx.ClientIP()
}

func userAgent(ctx *app.RequestContext) string {
	return string(ctx.UserAgent())
}

// ===========================================================================
// Helper: requireAuth extracts and validates the Bearer token.
// Returns the claims on success, or writes an error response and returns nil.
// ===========================================================================

func (h *dashboardHandler) requireAuth(c context.Context, ctx *app.RequestContext) *domain.DashboardClaims {
	authHeader := string(ctx.GetHeader("Authorization"))
	if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
		jsonError(ctx, http.StatusUnauthorized, "missing or invalid authorization header")
		return nil
	}

	tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
	claims, err := h.sub.authSvc.ValidateToken(c, tokenStr)
	if err != nil {
		jsonError(ctx, http.StatusUnauthorized, "invalid or expired token")
		return nil
	}

	return claims
}

// ===========================================================================
// Auth handlers
// ===========================================================================

// handleLogin — POST /dashboard/api/auth/login
func (h *dashboardHandler) handleLogin(c context.Context, ctx *app.RequestContext) {
	// Enforce local-only access if configured
	cfg := GetConfig()
	if cfg.Peers.Dashboard.LocalOnly && !domain.IsLocalRequest(clientIP(ctx)) {
		jsonError(ctx, http.StatusForbidden, "dashboard access is restricted to local network")
		return
	}

	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := ctx.Bind(&req); err != nil {
		jsonError(ctx, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Username == "" || req.Password == "" {
		jsonError(ctx, http.StatusBadRequest, "username and password are required")
		return
	}

	result, err := h.sub.authSvc.Login(c, req.Username, req.Password, clientIP(ctx), userAgent(ctx))
	if err != nil {
		switch err {
		case domain.ErrInvalidCredentials:
			jsonError(ctx, http.StatusUnauthorized, err.Error())
		case domain.ErrAdminDisabled:
			jsonError(ctx, http.StatusForbidden, err.Error())
		case domain.ErrSuperUserExpired:
			jsonError(ctx, http.StatusForbidden, err.Error())
		default:
			log.Errorf(c, "[dashboard] login error: %v", err)
			jsonError(ctx, http.StatusInternalServerError, "internal error")
		}
		return
	}

	jsonOK(ctx, result)
}

// handleLogout — POST /dashboard/api/auth/logout
func (h *dashboardHandler) handleLogout(c context.Context, ctx *app.RequestContext) {
	claims := h.requireAuth(c, ctx)
	if claims == nil {
		return
	}

	if err := h.sub.authSvc.Logout(c, claims.SessionID, claims.AdminID, clientIP(ctx), userAgent(ctx)); err != nil {
		log.Errorf(c, "[dashboard] logout error: %v", err)
		jsonError(ctx, http.StatusInternalServerError, "logout failed")
		return
	}

	jsonOK(ctx, map[string]string{"message": "logged out"})
}

// handleMe — GET /dashboard/api/auth/me
func (h *dashboardHandler) handleMe(c context.Context, ctx *app.RequestContext) {
	claims := h.requireAuth(c, ctx)
	if claims == nil {
		return
	}

	jsonOK(ctx, domain.AdminInfo{
		ID:          claims.AdminID,
		Username:    claims.Username,
		Role:        domain.AdminRole(claims.Role),
		IsSuperUser: claims.Role == string(domain.AdminRoleSuper),
	})
}

// handleChangePassword — POST /dashboard/api/auth/change-password
func (h *dashboardHandler) handleChangePassword(c context.Context, ctx *app.RequestContext) {
	claims := h.requireAuth(c, ctx)
	if claims == nil {
		return
	}

	var req struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if err := ctx.Bind(&req); err != nil {
		jsonError(ctx, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.OldPassword == "" || req.NewPassword == "" {
		jsonError(ctx, http.StatusBadRequest, "old_password and new_password are required")
		return
	}

	if len(req.NewPassword) < 8 {
		jsonError(ctx, http.StatusBadRequest, "new password must be at least 8 characters")
		return
	}

	if err := h.sub.authSvc.ChangePassword(c, claims.AdminID, req.OldPassword, req.NewPassword, clientIP(ctx), userAgent(ctx)); err != nil {
		if err == domain.ErrInvalidCredentials {
			jsonError(ctx, http.StatusForbidden, "old password is incorrect")
			return
		}
		log.Errorf(c, "[dashboard] change password error: %v", err)
		jsonError(ctx, http.StatusInternalServerError, "failed to change password")
		return
	}

	jsonOK(ctx, map[string]string{"message": "password changed, please re-login"})
}

// ===========================================================================
// Overview handlers
// ===========================================================================

// handleOverviewStats — GET /dashboard/api/overview/stats
func (h *dashboardHandler) handleOverviewStats(c context.Context, ctx *app.RequestContext) {
	claims := h.requireAuth(c, ctx)
	if claims == nil {
		return
	}

	stats, err := h.sub.overviewSvc.GetOverview(c,
		h.sub.getSubservers(),
		h.sub.startedAt,
		h.sub.listenAddr,
	)
	if err != nil {
		log.Errorf(c, "[dashboard] overview stats error: %v", err)
		jsonError(ctx, http.StatusInternalServerError, "failed to get overview stats")
		return
	}

	jsonOK(ctx, stats)
}

// handleRecentActors — GET /dashboard/api/overview/recent-actors
func (h *dashboardHandler) handleRecentActors(c context.Context, ctx *app.RequestContext) {
	claims := h.requireAuth(c, ctx)
	if claims == nil {
		return
	}

	limit := queryInt(ctx, "limit", 10)
	actors, err := h.sub.overviewSvc.GetRecentActors(c, limit)
	if err != nil {
		log.Errorf(c, "[dashboard] recent actors error: %v", err)
		jsonError(ctx, http.StatusInternalServerError, "failed to get recent actors")
		return
	}

	jsonOK(ctx, map[string]interface{}{"items": actors})
}

// handleRecentAuditLogs — GET /dashboard/api/overview/recent-audit-logs
func (h *dashboardHandler) handleRecentAuditLogs(c context.Context, ctx *app.RequestContext) {
	claims := h.requireAuth(c, ctx)
	if claims == nil {
		return
	}

	limit := queryInt(ctx, "limit", 10)
	logs, err := h.sub.overviewSvc.GetRecentAuditLogs(c, limit)
	if err != nil {
		log.Errorf(c, "[dashboard] recent audit logs error: %v", err)
		jsonError(ctx, http.StatusInternalServerError, "failed to get recent audit logs")
		return
	}

	jsonOK(ctx, map[string]interface{}{"items": logs})
}

// ===========================================================================
// Actor handlers
// ===========================================================================

// handleListActors — GET /dashboard/api/actors
func (h *dashboardHandler) handleListActors(c context.Context, ctx *app.RequestContext) {
	claims := h.requireAuth(c, ctx)
	if claims == nil {
		return
	}

	query := domain.ActorListQuery{
		Page:     queryInt(ctx, "page", 1),
		PageSize: queryInt(ctx, "page_size", 20),
		Search:   string(ctx.QueryArgs().Peek("search")),
		Status:   string(ctx.QueryArgs().Peek("status")),
	}

	result, err := h.sub.actorsSvc.ListActors(c, query)
	if err != nil {
		log.Errorf(c, "[dashboard] list actors error: %v", err)
		jsonError(ctx, http.StatusInternalServerError, "failed to list actors")
		return
	}

	jsonOK(ctx, result)
}

// handleGetActor — GET /dashboard/api/actors/:id
func (h *dashboardHandler) handleGetActor(c context.Context, ctx *app.RequestContext) {
	claims := h.requireAuth(c, ctx)
	if claims == nil {
		return
	}

	actorID, err := strconv.ParseUint(ctx.Param("id"), 10, 64)
	if err != nil {
		jsonError(ctx, http.StatusBadRequest, "invalid actor id")
		return
	}

	detail, err := h.sub.actorsSvc.GetActorDetail(c, actorID)
	if err != nil {
		jsonError(ctx, http.StatusNotFound, "actor not found")
		return
	}

	jsonOK(ctx, detail)
}

// handleGetActorSessions — GET /dashboard/api/actors/:id/sessions
func (h *dashboardHandler) handleGetActorSessions(c context.Context, ctx *app.RequestContext) {
	claims := h.requireAuth(c, ctx)
	if claims == nil {
		return
	}

	actorID, err := strconv.ParseUint(ctx.Param("id"), 10, 64)
	if err != nil {
		jsonError(ctx, http.StatusBadRequest, "invalid actor id")
		return
	}

	sessions, err := h.sub.actorsSvc.GetActorSessions(c, actorID)
	if err != nil {
		log.Errorf(c, "[dashboard] actor sessions error: %v", err)
		jsonError(ctx, http.StatusInternalServerError, "failed to get actor sessions")
		return
	}

	jsonOK(ctx, map[string]interface{}{"items": sessions})
}

// handleResetActorPassword — POST /dashboard/api/actors/:id/reset-password
func (h *dashboardHandler) handleResetActorPassword(c context.Context, ctx *app.RequestContext) {
	claims := h.requireAuth(c, ctx)
	if claims == nil {
		return
	}

	actorID, err := strconv.ParseUint(ctx.Param("id"), 10, 64)
	if err != nil {
		jsonError(ctx, http.StatusBadRequest, "invalid actor id")
		return
	}

	var req struct {
		NewPassword string `json:"new_password"`
	}
	if err := ctx.Bind(&req); err != nil {
		jsonError(ctx, http.StatusBadRequest, "invalid request body")
		return
	}

	if len(req.NewPassword) < 8 {
		jsonError(ctx, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}

	if err := h.sub.actorsSvc.ResetActorPassword(c, actorID, req.NewPassword); err != nil {
		log.Errorf(c, "[dashboard] reset actor password error: %v", err)
		jsonError(ctx, http.StatusInternalServerError, "failed to reset password")
		return
	}

	h.sub.authSvc.RecordAudit(c, claims.AdminID, claims.Username, "reset_actor_password", "actor",
		"actor_id="+strconv.FormatUint(actorID, 10), clientIP(ctx), userAgent(ctx))

	jsonOK(ctx, map[string]string{"message": "password reset successfully"})
}

// handleRevokeActorSession — POST /dashboard/api/actors/:id/sessions/:sid/revoke
func (h *dashboardHandler) handleRevokeActorSession(c context.Context, ctx *app.RequestContext) {
	claims := h.requireAuth(c, ctx)
	if claims == nil {
		return
	}

	sid := ctx.Param("sid")
	if sid == "" {
		jsonError(ctx, http.StatusBadRequest, "session id is required")
		return
	}

	if err := h.sub.actorsSvc.RevokeActorSession(c, sid); err != nil {
		log.Errorf(c, "[dashboard] revoke actor session error: %v", err)
		jsonError(ctx, http.StatusInternalServerError, "failed to revoke session")
		return
	}

	h.sub.authSvc.RecordAudit(c, claims.AdminID, claims.Username, "revoke_actor_session", "session",
		"session_id="+sid, clientIP(ctx), userAgent(ctx))

	jsonOK(ctx, map[string]string{"message": "session revoked"})
}

// ===========================================================================
// Admin handlers
// ===========================================================================

// handleCreateAdmin — POST /dashboard/api/admins
func (h *dashboardHandler) handleCreateAdmin(c context.Context, ctx *app.RequestContext) {
	claims := h.requireAuth(c, ctx)
	if claims == nil {
		return
	}

	var req domain.CreateAdminRequest
	if err := ctx.Bind(&req); err != nil {
		jsonError(ctx, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Username == "" || req.Password == "" {
		jsonError(ctx, http.StatusBadRequest, "username and password are required")
		return
	}

	if len(req.Password) < 8 {
		jsonError(ctx, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}

	admin, err := h.sub.authSvc.CreateAdmin(c, req, claims.AdminID, clientIP(ctx), userAgent(ctx))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") || strings.Contains(err.Error(), "duplicate") {
			jsonError(ctx, http.StatusConflict, "username already exists")
			return
		}
		log.Errorf(c, "[dashboard] create admin error: %v", err)
		jsonError(ctx, http.StatusInternalServerError, "failed to create admin")
		return
	}

	jsonCreated(ctx, domain.AdminInfo{
		ID:          admin.ID,
		Username:    admin.Username,
		DisplayName: admin.DisplayName,
		Role:        admin.Role,
		IsSuperUser: admin.IsSuperUser,
	})
}

// handleListAdmins — GET /dashboard/api/admins
func (h *dashboardHandler) handleListAdmins(c context.Context, ctx *app.RequestContext) {
	claims := h.requireAuth(c, ctx)
	if claims == nil {
		return
	}

	admins, err := h.sub.authSvc.ListAdmins(c)
	if err != nil {
		log.Errorf(c, "[dashboard] list admins error: %v", err)
		jsonError(ctx, http.StatusInternalServerError, "failed to list admins")
		return
	}

	jsonOK(ctx, map[string]interface{}{"items": admins})
}

// handleDisableAdmin — POST /dashboard/api/admins/:id/disable
func (h *dashboardHandler) handleDisableAdmin(c context.Context, ctx *app.RequestContext) {
	claims := h.requireAuth(c, ctx)
	if claims == nil {
		return
	}

	adminID, err := strconv.ParseUint(ctx.Param("id"), 10, 64)
	if err != nil {
		jsonError(ctx, http.StatusBadRequest, "invalid admin id")
		return
	}

	if err := h.sub.authSvc.DisableAdmin(c, adminID, claims.AdminID, clientIP(ctx), userAgent(ctx)); err != nil {
		jsonError(ctx, http.StatusBadRequest, err.Error())
		return
	}

	jsonOK(ctx, map[string]string{"message": "admin disabled"})
}

// handleEnableAdmin — POST /dashboard/api/admins/:id/enable
func (h *dashboardHandler) handleEnableAdmin(c context.Context, ctx *app.RequestContext) {
	claims := h.requireAuth(c, ctx)
	if claims == nil {
		return
	}

	adminID, err := strconv.ParseUint(ctx.Param("id"), 10, 64)
	if err != nil {
		jsonError(ctx, http.StatusBadRequest, "invalid admin id")
		return
	}

	if err := h.sub.authSvc.EnableAdmin(c, adminID, claims.AdminID, clientIP(ctx), userAgent(ctx)); err != nil {
		jsonError(ctx, http.StatusBadRequest, err.Error())
		return
	}

	jsonOK(ctx, map[string]string{"message": "admin enabled"})
}

// handleDeleteAdmin — DELETE /dashboard/api/admins/:id
func (h *dashboardHandler) handleDeleteAdmin(c context.Context, ctx *app.RequestContext) {
	claims := h.requireAuth(c, ctx)
	if claims == nil {
		return
	}

	adminID, err := strconv.ParseUint(ctx.Param("id"), 10, 64)
	if err != nil {
		jsonError(ctx, http.StatusBadRequest, "invalid admin id")
		return
	}

	if err := h.sub.authSvc.DeleteAdmin(c, adminID, claims.AdminID, clientIP(ctx), userAgent(ctx)); err != nil {
		jsonError(ctx, http.StatusBadRequest, err.Error())
		return
	}

	jsonOK(ctx, map[string]string{"message": "admin deleted"})
}

// ===========================================================================
// Audit log handlers
// ===========================================================================

// handleAuditLogs — GET /dashboard/api/audit-logs
func (h *dashboardHandler) handleAuditLogs(c context.Context, ctx *app.RequestContext) {
	claims := h.requireAuth(c, ctx)
	if claims == nil {
		return
	}

	page := queryInt(ctx, "page", 1)
	pageSize := queryInt(ctx, "page_size", 20)
	if pageSize > 100 {
		pageSize = 100
	}

	logs, total, err := h.sub.authSvc.GetAuditLogs(c, page, pageSize)
	if err != nil {
		log.Errorf(c, "[dashboard] audit logs error: %v", err)
		jsonError(ctx, http.StatusInternalServerError, "failed to get audit logs")
		return
	}

	jsonOK(ctx, map[string]interface{}{
		"items": logs,
		"total": total,
		"page":  page,
	})
}

// ===========================================================================
// System handlers
// ===========================================================================

// handleSystemInfo — GET /dashboard/api/system/info
func (h *dashboardHandler) handleSystemInfo(c context.Context, ctx *app.RequestContext) {
	claims := h.requireAuth(c, ctx)
	if claims == nil {
		return
	}

	stats, err := h.sub.overviewSvc.GetOverview(c,
		h.sub.getSubservers(),
		h.sub.startedAt,
		h.sub.listenAddr,
	)
	if err != nil {
		log.Errorf(c, "[dashboard] system info error: %v", err)
		jsonError(ctx, http.StatusInternalServerError, "failed to get system info")
		return
	}

	jsonOK(ctx, stats.System)
}

// handleSystemRoutes — GET /dashboard/api/system/routes
func (h *dashboardHandler) handleSystemRoutes(c context.Context, ctx *app.RequestContext) {
	claims := h.requireAuth(c, ctx)
	if claims == nil {
		return
	}

	handlers := server.GetOptions().Handlers
	type routeInfo struct {
		Name   string `json:"name"`
		Path   string `json:"path"`
		Method string `json:"method"`
	}

	routes := make([]routeInfo, 0, len(handlers))
	for _, handler := range handlers {
		routes = append(routes, routeInfo{
			Name:   handler.Name(),
			Path:   handler.Path(),
			Method: string(handler.Method()),
		})
	}

	jsonOK(ctx, map[string]interface{}{
		"count":  len(routes),
		"routes": routes,
	})
}

// handleSystemSubservers — GET /dashboard/api/system/subservers
func (h *dashboardHandler) handleSystemSubservers(c context.Context, ctx *app.RequestContext) {
	claims := h.requireAuth(c, ctx)
	if claims == nil {
		return
	}

	subservers := h.sub.getSubservers()
	items := make([]domain.SubServerInfo, 0, len(subservers))
	for _, sub := range subservers {
		items = append(items, domain.SubServerInfo{
			Name:   sub.Name(),
			Type:   string(sub.Type()),
			Status: string(sub.Status()),
		})
	}

	jsonOK(ctx, map[string]interface{}{
		"count": len(items),
		"items": items,
	})
}

// ===========================================================================
// Peers session handlers (actor sessions, not dashboard admin sessions)
// ===========================================================================

// handleGetActivePeersSessions — GET /dashboard/api/sessions/active
//
// Returns ALL currently-active actor sessions across the station, joined
// with the owning actor's preferred_username/email for display.
//
// Bug history: previously called actorsSvc.GetActorSessions(c, 0) which
// translated to "WHERE user_id = 0" and silently returned an empty list,
// making the Sessions page appear permanently empty.
func (h *dashboardHandler) handleGetActivePeersSessions(c context.Context, ctx *app.RequestContext) {
	claims := h.requireAuth(c, ctx)
	if claims == nil {
		return
	}

	limit := queryInt(ctx, "limit", 100)
	if limit > 500 {
		limit = 500
	}

	sessions, err := h.sub.actorsSvc.ListActivePeersSessions(c, limit)
	if err != nil {
		log.Errorf(c, "[dashboard] get active peers sessions error: %v", err)
		jsonError(ctx, http.StatusInternalServerError, "failed to get active sessions")
		return
	}

	jsonOK(ctx, map[string]interface{}{
		"count": len(sessions),
		"items": sessions,
	})
}

// handleRevokePeersSession — POST /dashboard/api/sessions/:sid/revoke
func (h *dashboardHandler) handleRevokePeersSession(c context.Context, ctx *app.RequestContext) {
	claims := h.requireAuth(c, ctx)
	if claims == nil {
		return
	}

	sid := ctx.Param("sid")
	if sid == "" {
		jsonError(ctx, http.StatusBadRequest, "session id is required")
		return
	}

	if err := h.sub.actorsSvc.RevokeActorSession(c, sid); err != nil {
		log.Errorf(c, "[dashboard] revoke peers session error: %v", err)
		jsonError(ctx, http.StatusInternalServerError, "failed to revoke session")
		return
	}

	h.sub.authSvc.RecordAudit(c, claims.AdminID, claims.Username, "revoke_peers_session", "session",
		"session_id="+sid, clientIP(ctx), userAgent(ctx))

	jsonOK(ctx, map[string]string{"message": "session revoked"})
}

// ===========================================================================
// Dashboard admin session handlers
// ===========================================================================

// handleDashboardSessions — GET /dashboard/api/dashboard-sessions
func (h *dashboardHandler) handleDashboardSessions(c context.Context, ctx *app.RequestContext) {
	claims := h.requireAuth(c, ctx)
	if claims == nil {
		return
	}

	sessions, err := h.sub.authSvc.GetActiveSessions(c)
	if err != nil {
		log.Errorf(c, "[dashboard] get dashboard sessions error: %v", err)
		jsonError(ctx, http.StatusInternalServerError, "failed to get dashboard sessions")
		return
	}

	jsonOK(ctx, map[string]interface{}{
		"count": len(sessions),
		"items": sessions,
	})
}

// handleRevokeDashboardSession — POST /dashboard/api/dashboard-sessions/:sid/revoke
func (h *dashboardHandler) handleRevokeDashboardSession(c context.Context, ctx *app.RequestContext) {
	claims := h.requireAuth(c, ctx)
	if claims == nil {
		return
	}

	sid := ctx.Param("sid")
	if sid == "" {
		jsonError(ctx, http.StatusBadRequest, "session id is required")
		return
	}

	if err := h.sub.authSvc.RevokeSession(c, sid, claims.AdminID, clientIP(ctx), userAgent(ctx)); err != nil {
		log.Errorf(c, "[dashboard] revoke dashboard session error: %v", err)
		jsonError(ctx, http.StatusInternalServerError, "failed to revoke session")
		return
	}

	jsonOK(ctx, map[string]string{"message": "dashboard session revoked"})
}

// ===========================================================================
// Query parameter helpers
// ===========================================================================

func queryInt(ctx *app.RequestContext, key string, defaultVal int) int {
	raw := string(ctx.QueryArgs().Peek(key))
	if raw == "" {
		return defaultVal
	}

	val, err := strconv.Atoi(raw)
	if err != nil || val < 1 {
		return defaultVal
	}

	return val
}
