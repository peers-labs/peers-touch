package touch

import (
	"context"
	"errors"
	"net/http"

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

	response := map[string]interface{}{
		"tokens": map[string]interface{}{
			"token":         result.AccessToken,
			"access_token":  result.AccessToken,
			"refresh_token": result.RefreshToken,
			"token_type":    result.TokenType,
			"expires_at":    result.ExpiresAt,
		},
		"session_id": result.SessionID,
		"actor":      result.User,
	}

	SuccessResponse(c, ctx, "OAuth login successful", response)
}
