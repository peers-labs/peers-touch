package hertzadapter

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

type contextKey string

const SubjectContextKey contextKey = "auth_subject"

// RequireJWT validates the Bearer JWT and checks the embedded session through
// the supplied validator or the application-wide validator when one is set.
func RequireJWT(p coreauth.Provider, sv ...coreauth.SessionValidator) func(context.Context, *app.RequestContext) {
	return jwtMiddleware(p, true, sv...)
}

// OptionalJWT continues anonymously only when Authorization is absent. Every
// supplied malformed, invalid, expired, or revoked credential fails closed.
func OptionalJWT(p coreauth.Provider, sv ...coreauth.SessionValidator) func(context.Context, *app.RequestContext) {
	return jwtMiddleware(p, false, sv...)
}

func jwtMiddleware(
	provider coreauth.Provider,
	required bool,
	sessionValidators ...coreauth.SessionValidator,
) func(context.Context, *app.RequestContext) {
	return func(c context.Context, ctx *app.RequestContext) {
		result := coreauth.ValidateBearerCredential(
			c,
			string(ctx.GetHeader("Authorization")),
			provider,
			sessionValidators...,
		)
		switch result.Status {
		case coreauth.BearerCredentialAbsent:
			if !required {
				ctx.Next(c)
				return
			}
			logger.Warn(c, "[RequireJWT] credentials rejected: missing or invalid bearer format")
			ctx.JSON(401, map[string]interface{}{"error": "Valid JWT token required", "code": "auth_required"})
			ctx.Abort()
			return
		case coreauth.BearerCredentialMalformed:
			middlewareName := "[OptionalJWT]"
			code := "token_invalid"
			if required {
				middlewareName = "[RequireJWT]"
				code = "auth_required"
			}
			logger.Warn(c, middlewareName+" credentials rejected: missing or invalid bearer format")
			ctx.JSON(401, map[string]interface{}{"error": "Valid JWT token required", "code": code})
			ctx.Abort()
			return
		case coreauth.BearerCredentialInvalid:
			logger.Warn(c, "[JWT] credentials rejected: validation failed")
			ctx.JSON(401, map[string]interface{}{"error": "Invalid or expired token", "code": "token_invalid"})
			ctx.Abort()
			return
		case coreauth.BearerCredentialRevoked:
			writeSessionRevoked(c, ctx, result)
			return
		case coreauth.BearerCredentialAuthenticated:
			logger.Info(c, "[JWT] authentication succeeded")
			ctx.Set(string(SubjectContextKey), result.Subject)
			ctx.Next(coreauth.WithSubject(c, result.Subject))
			return
		default:
			logger.Warn(c, "[JWT] credentials rejected: validation failed")
			ctx.JSON(401, map[string]interface{}{"error": "Invalid or expired token", "code": "token_invalid"})
			ctx.Abort()
			return
		}
	}
}

func writeSessionRevoked(c context.Context, ctx *app.RequestContext, result coreauth.BearerCredentialResult) {
	logger.Warn(c, "[JWT] credentials rejected: session invalid")

	// Resolve the device_type from the session record so multi-device clients
	// can filter revocations that target a different device class.
	deviceType := ""
	if resolver, ok := result.SessionValidator.(coreauth.SessionDeviceTypeResolver); ok {
		deviceType = resolver.ResolveSessionDeviceType(c, result.Subject.SessionID)
	}

	body := map[string]interface{}{
		"error":  "Session has been revoked",
		"code":   "session_revoked",
		"reason": result.RevocationReason,
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
