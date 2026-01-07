package httpadapter

import (
	"context"
	"net/http"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

const SubjectContextKey = "auth_subject"

func RequireJWT(p coreauth.Provider) func(ctx context.Context, next http.Handler) http.Handler {
	return func(ctx context.Context, next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			logger.Debugf(ctx, "[RequireJWT] Authorization header: %s", authHeader)

			if len(authHeader) < 7 || authHeader[:7] != "Bearer " {
				logger.Warnf(ctx, "[RequireJWT] Missing or invalid Bearer token format")
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(401)
				w.Write([]byte(`{"error":"Valid JWT token required"}`))
				return
			}

			token := authHeader[7:]
			logger.Debugf(ctx, "[RequireJWT] Token extracted, validating...")

			subject, err := p.Validate(ctx, token)
			if err != nil {
				logger.Warnf(ctx, "[RequireJWT] Token validation failed: %v", err)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(401)
				w.Write([]byte(`{"error":"Invalid or expired token"}`))
				return
			}

			logger.Infof(ctx, "[RequireJWT] Token valid, subject: %s", subject.ID)

			ctxWithSubject := context.WithValue(r.Context(), SubjectContextKey, subject)
			next.ServeHTTP(w, r.WithContext(ctxWithSubject))
		})
	}
}

func GetSubject(r *http.Request) *coreauth.Subject {
	if subject, ok := r.Context().Value(SubjectContextKey).(*coreauth.Subject); ok {
		return subject
	}
	return nil
}
