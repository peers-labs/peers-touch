package httpadapter

import (
	"context"
	"encoding/json"
	"net/http"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// RequireJWT validates the Bearer JWT and checks the embedded session through
// the supplied validator or the application-wide validator when one is set.
func RequireJWT(p coreauth.Provider, sv ...coreauth.SessionValidator) func(ctx context.Context, next http.Handler) http.Handler {
	return jwtMiddleware(p, true, sv...)
}

// OptionalJWT continues anonymously only when Authorization is absent. Every
// supplied malformed, invalid, expired, or revoked credential fails closed.
func OptionalJWT(p coreauth.Provider, sv ...coreauth.SessionValidator) func(ctx context.Context, next http.Handler) http.Handler {
	return jwtMiddleware(p, false, sv...)
}

func jwtMiddleware(
	provider coreauth.Provider,
	required bool,
	sessionValidators ...coreauth.SessionValidator,
) func(ctx context.Context, next http.Handler) http.Handler {
	return func(ctx context.Context, next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			result := coreauth.ValidateBearerCredential(
				ctx,
				r.Header.Get("Authorization"),
				provider,
				sessionValidators...,
			)
			switch result.Status {
			case coreauth.BearerCredentialAbsent:
				if !required {
					next.ServeHTTP(w, r)
					return
				}
				logger.Warn(ctx, "[RequireJWT] credentials rejected: missing or invalid bearer format")
				writeUnauthorized(w, "auth_required", "authentication required", "")
				return
			case coreauth.BearerCredentialMalformed:
				middlewareName := "[OptionalJWT]"
				code := "token_invalid"
				if required {
					middlewareName = "[RequireJWT]"
					code = "auth_required"
				}
				logger.Warn(ctx, middlewareName+" credentials rejected: missing or invalid bearer format")
				writeUnauthorized(w, code, "authentication required", "")
				return
			case coreauth.BearerCredentialInvalid:
				logger.Warn(ctx, "[JWT] credentials rejected: validation failed")
				writeUnauthorized(w, "token_invalid", "authentication required", "")
				return
			case coreauth.BearerCredentialRevoked:
				logger.Warn(ctx, "[JWT] credentials rejected: session invalid")
				writeUnauthorized(w, "session_revoked", "session has been revoked", result.RevocationReason)
				return
			case coreauth.BearerCredentialAuthenticated:
				logger.Info(ctx, "[JWT] authentication succeeded")
				ctxWithSubject := coreauth.WithSubject(r.Context(), result.Subject)
				next.ServeHTTP(w, r.WithContext(ctxWithSubject))
				return
			default:
				logger.Warn(ctx, "[JWT] credentials rejected: validation failed")
				writeUnauthorized(w, "token_invalid", "authentication required", "")
				return
			}
		})
	}
}

func writeUnauthorized(w http.ResponseWriter, code, message, reason string) {
	body := map[string]string{
		"code":  code,
		"error": message,
	}
	if reason != "" {
		body["reason"] = reason
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(body)
}
