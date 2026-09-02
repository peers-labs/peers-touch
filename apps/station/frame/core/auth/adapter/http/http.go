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
				logger.Warn(ctx, "[RequireJWT] credentials rejected: missing or invalid bearer format")
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(401)
				w.Write([]byte(`{"code":"auth_required","error":"authentication required"}`))
				return
			}

			token := authHeader[7:]
			logger.Debug(ctx, "[RequireJWT] credential validation started")

			subject, err := p.Validate(ctx, token)
			if err != nil {
				logger.Warn(ctx, "[RequireJWT] credentials rejected: validation failed")
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(401)
				w.Write([]byte(`{"code":"token_invalid","error":"authentication required"}`))
				return
			}

			if sessValidator != nil && subject.SessionID != "" {
				valid, reason := sessValidator.CheckSessionValid(ctx, subject.SessionID)
				if !valid {
					logger.Warn(ctx, "[RequireJWT] credentials rejected: session invalid")
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(401)
					w.Write([]byte(`{"code":"session_revoked","error":"session has been revoked","reason":"` + reason + `"}`))
					return
				}
			}

			logger.Info(ctx, "[RequireJWT] authentication succeeded")

			ctxWithSubject := coreauth.WithSubject(r.Context(), subject)
			next.ServeHTTP(w, r.WithContext(ctxWithSubject))
		})
	}
}
