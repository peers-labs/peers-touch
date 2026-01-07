package hertzadapter

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

type contextKey string

const SubjectContextKey contextKey = "auth_subject"

func RequireJWT(p coreauth.Provider) func(context.Context, *app.RequestContext) {
	return func(c context.Context, ctx *app.RequestContext) {
		h := string(ctx.GetHeader("Authorization"))
		logger.Debugf(c, "[RequireJWT] Authorization header: %s", h)

		if len(h) < 7 || h[:7] != "Bearer " {
			logger.Warnf(c, "[RequireJWT] Missing or invalid Bearer token format")
			ctx.SetStatusCode(401)
			ctx.JSON(401, map[string]string{"error": "Valid JWT token required"})
			ctx.Abort()
			return
		}
		token := h[7:]
		logger.Debugf(c, "[RequireJWT] Token extracted, validating...")

		subject, err := p.Validate(c, token)
		if err != nil {
			logger.Warnf(c, "[RequireJWT] Token validation failed: %v", err)
			ctx.SetStatusCode(401)
			ctx.JSON(401, map[string]string{"error": "Invalid or expired token"})
			ctx.Abort()
			return
		}
		logger.Infof(c, "[RequireJWT] Token valid, subject: %s", subject.ID)
		ctx.Set(string(SubjectContextKey), subject)
	}
}

func GetSubject(ctx *app.RequestContext) *coreauth.Subject {
	if v, exists := ctx.Get(string(SubjectContextKey)); exists {
		if subject, ok := v.(*coreauth.Subject); ok {
			return subject
		}
	}
	return nil
}
