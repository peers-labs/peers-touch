package hertzadapter

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

type contextKey string

const SubjectContextKey contextKey = "auth_subject"

// RequireJWT validates the Bearer JWT and optionally checks the embedded session
// against the session store. If sv is nil, only JWT signature validation is performed.
func RequireJWT(p coreauth.Provider, sv ...coreauth.SessionValidator) func(context.Context, *app.RequestContext) {
	var sessValidator coreauth.SessionValidator
	if len(sv) > 0 {
		sessValidator = sv[0]
	}

	return func(c context.Context, ctx *app.RequestContext) {
		if sessValidator == nil {
			sessValidator = coreauth.GetGlobalSessionValidator()
		}
		h := string(ctx.GetHeader("Authorization"))

		if len(h) < 7 || h[:7] != "Bearer " {
			logger.Warn(c, "[RequireJWT] credentials rejected: missing or invalid bearer format")
			ctx.SetStatusCode(401)
			ctx.JSON(401, map[string]interface{}{"error": "Valid JWT token required", "code": "auth_required"})
			ctx.Abort()
			return
		}
		token := h[7:]
		logger.Debug(c, "[RequireJWT] credential validation started")

		subject, err := p.Validate(c, token)
		if err != nil {
			logger.Warn(c, "[RequireJWT] credentials rejected: validation failed")
			ctx.SetStatusCode(401)
			ctx.JSON(401, map[string]interface{}{"error": "Invalid or expired token", "code": "token_invalid"})
			ctx.Abort()
			return
		}

		if sessValidator != nil && subject.SessionID != "" {
			valid, reason := sessValidator.CheckSessionValid(c, subject.SessionID)
			if !valid {
				writeSessionRevoked(c, ctx, subject, reason)
				return
			}
		} else if valid, reason := coreauth.CheckSubjectSessionValid(c, subject); !valid {
			writeSessionRevoked(c, ctx, subject, reason)
			return
		}

		logger.Info(c, "[RequireJWT] authentication succeeded")
		ctx.Set(string(SubjectContextKey), subject)
	}
}

func writeSessionRevoked(c context.Context, ctx *app.RequestContext, subject *coreauth.Subject, reason string) {
	logger.Warnf(c, "[RequireJWT] Session %s rejected: %s (user=%s)", subject.SessionID, reason, subject.ID)

	// Resolve the device_type from the session record so multi-device clients
	// can filter revocations that target a different device class.
	deviceType := ""
	if resolver, ok := coreauth.GetGlobalSessionValidator().(coreauth.SessionDeviceTypeResolver); ok {
		deviceType = resolver.ResolveSessionDeviceType(c, subject.SessionID)
	}

	body := map[string]interface{}{
		"error":  "Session has been revoked",
		"code":   "session_revoked",
		"reason": reason,
	}
	if deviceType != "" {
		body["device_type"] = deviceType
	}

	ctx.SetStatusCode(401)
	ctx.JSON(401, body)
	ctx.Abort()
}

func GetSubject(ctx *app.RequestContext) *coreauth.Subject {
	if v, exists := ctx.Get(string(SubjectContextKey)); exists {
		if subject, ok := v.(*coreauth.Subject); ok {
			return subject
		}
	}
	return nil
}
