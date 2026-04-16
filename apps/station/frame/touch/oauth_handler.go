package touch

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/protocol"

	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	touchauth "github.com/peers-labs/peers-touch/station/frame/touch/auth"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

// OAuthLogin handles external OAuth gateway callback.
// Verifies HMAC signature, performs find-or-register, issues JWT + session.
func OAuthLogin(c context.Context, ctx *app.RequestContext) {
	var req model.OAuthBridgeRequest
	if err := ctx.Bind(&req); err != nil {
		log.Warnf(c, "[OAuth] bind: %v", err)
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if req.GetProvider() == "" || req.GetProviderUserId() == "" || req.GetEmail() == "" {
		FailedResponse(c, ctx, errors.New("provider, provider_user_id, and email are required"))
		return
	}

	if err := touchauth.VerifyBridgeSignature(&req); err != nil {
		log.Warnf(c, "[OAuth] signature verification failed: %v", err)
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": err.Error()})
		return
	}

	result, err := touchauth.OAuthBridgeLogin(c, &req,
		baseURLFrom(ctx),
		ctx.ClientIP(),
		string(ctx.GetHeader("User-Agent")),
	)
	if err != nil {
		log.Warnf(c, "[OAuth] login failed: %v", err)
		FailedResponse(c, ctx, err)
		return
	}

	ctx.SetCookie("session_id", result.SessionID, 86400, "/", "",
		protocol.CookieSameSiteDisabled, false, true)

	var actorIDNum int64
	if id, ok := result.User["id"].(uint64); ok {
		actorIDNum = int64(id)
	} else if idStr, ok := result.User["id"].(string); ok {
		if u, err := strconv.ParseUint(idStr, 10, 64); err == nil {
			actorIDNum = int64(u)
		}
	}

	response := &model.OAuthBridgeResponse{
		SessionId:    result.SessionID,
		AccessToken:  result.AccessToken,
		RefreshToken: result.RefreshToken,
		TokenType:    result.TokenType,
		ExpiresAt:    result.ExpiresAt.Format(time.RFC3339),
		ActorId:      touchString(result.User["id"]),
		ActorIdNum:   actorIDNum,
		Username:     touchString(result.User["username"]),
		DisplayName:  touchString(result.User["display_name"]),
		Email:        touchString(result.User["email"]),
	}

	SuccessResponse(c, ctx, "OAuth login successful", response)
}

func touchString(v interface{}) string {
	if v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	default:
		return fmt.Sprintf("%v", t)
	}
}
