package touch

import (
	"context"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/touch/activitypub"
	"github.com/peers-labs/peers-touch/station/frame/touch/auth"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

const (
	RouterURLActorsOnline RouterPath = "/actors/online"
	RouterURLHeartbeat    RouterPath = "/heartbeat"
)

// GetOnlineActorsHandler handles GET /actors/online
func GetOnlineActorsHandler(c context.Context, ctx *app.RequestContext) {
	// 1. Resolve current user from token
	currentActorID, err := resolveActorID(c, ctx)
	if err != nil {
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	// 2. Get online actors
	actors, err := activitypub.GetOnlineActors(c, currentActorID)
	if err != nil {
		log.Warnf(c, "Failed to get online actors: %v", err)
		FailedResponse(ctx, err)
		return
	}

	SuccessResponse(ctx, "Online actors retrieved", actors)
}

// HeartbeatHandler handles POST /heartbeat
func HeartbeatHandler(c context.Context, ctx *app.RequestContext) {
	// 1. Resolve current user from token
	currentActorID, err := resolveActorID(c, ctx)
	if err != nil {
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	// 2. Get client info (optional)
	clientInfo := string(ctx.GetHeader("User-Agent"))

	// 3. Keep-alive session if exists
	// Try to get session_id from cookie or header
	sessionID := string(ctx.Cookie("session_id"))
	if sessionID != "" && auth.GlobalSessionManager != nil {
		// Validate will touch the session, extending its life
		_, err := auth.GlobalSessionManager.Validate(c, sessionID)
		if err != nil {
			log.Warnf(c, "Session validation failed during heartbeat: %v", err)
			// Don't fail the heartbeat request itself, just log warning
			// Ideally we should tell client their session is invalid, but heartbeat usually runs in background
		}
	}

	// 4. Update status in DB/Redis
	err = activitypub.UpdateActorStatus(c, currentActorID, db.ActorStatusOnline, clientInfo)
	if err != nil {
		log.Warnf(c, "Failed to update heartbeat: %v", err)
		FailedResponse(ctx, err)
		return
	}

	SuccessResponse(ctx, "Heartbeat received", nil)
}
