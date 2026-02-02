package handler

import (
	"context"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/touch/auth"
)

const SubjectContextKey = "auth_subject"

func VerifySession(c context.Context, ctx *app.RequestContext) {
	subject, ok := c.Value(SubjectContextKey).(*coreauth.Subject)
	if !ok || subject == nil {
		logger.Debug(c, "session verification failed: no subject in context")
		ctx.JSON(http.StatusUnauthorized, map[string]interface{}{
			"valid":  false,
			"reason": "no_auth",
		})
		return
	}

	// Check session ID if provided (for kick detection)
	sessionID := string(ctx.GetHeader("X-Session-ID"))
	if sessionID == "" {
		sessionID = string(ctx.Cookie("session_id"))
	}
	
	if sessionID != "" {
		valid, reason := auth.ValidateSession(c, sessionID)
		if !valid {
			logger.Debug(c, "session revoked or expired", "session_id", sessionID, "reason", reason)
			ctx.JSON(http.StatusOK, map[string]interface{}{
				"valid":  false,
				"reason": reason,
			})
			return
		}
	}

	logger.Debug(c, "session verified successfully", "subject_id", subject.ID)

	ctx.JSON(http.StatusOK, map[string]interface{}{
		"valid":      true,
		"subject_id": subject.ID,
		"attributes": subject.Attributes,
	})
}
