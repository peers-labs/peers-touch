package httpadapter

import (
	"context"
	"net/http"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// RequireJWT validates the Bearer JWT and optionally checks the embedded session
// against the session store. If sv is nil, only JWT signature validation is performed.
func RequireJWT(p coreauth.Provider, sv ...coreauth.SessionValidator) func(ctx context.Context, next http.Handler) http.Handler {
	var sessValidator coreauth.SessionValidator
	if len(sv) > 0 {
		sessValidator = sv[0]
	}

	return func(ctx context.Context, next http.Handler) http.Handler {
		if sessValidator == nil {
			sessValidator = coreauth.GetGlobalSessionValidator()
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")

			if len(authHeader) < 7 || authHeader[:7] != "Bearer " {
				logger.Warnf(ctx, "[RequireJWT] Missing or invalid Bearer token format")
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(401)
				w.Write([]byte(`{"code":"auth_required","error":"authentication required"}`))
				return
			}

			token := authHeader[7:]
			logger.Debugf(ctx, "[RequireJWT] Token extracted, validating...")

			subject, err := p.Validate(ctx, token)
			if err != nil {
				logger.Warnf(ctx, "[RequireJWT] Token validation failed: %v", err)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(401)
				w.Write([]byte(`{"code":"token_invalid","error":"authentication required"}`))
				return
			}

			if sessValidator != nil && subject.SessionID != "" {
				valid, reason := sessValidator.CheckSessionValid(ctx, subject.SessionID)
				if !valid {
					logger.Warnf(ctx, "[RequireJWT] Session %s rejected: %s (user=%s)", subject.SessionID, reason, subject.ID)
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(401)
					w.Write([]byte(`{"code":"session_revoked","error":"session has been revoked","reason":"` + reason + `"}`))
					return
				}
			}

			logger.Infof(ctx, "[RequireJWT] Token valid, subject: %s, session: %s", subject.ID, subject.SessionID)

			ctxWithSubject := coreauth.WithSubject(r.Context(), subject)
			next.ServeHTTP(w, r.WithContext(ctxWithSubject))
		})
	}
}
