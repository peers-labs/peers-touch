package middleware

import (
	"context"
	"net/http"

	"github.com/oklog/ulid/v2"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type logIDKey struct{}

func LogIDWrapper() server.Wrapper {
	return func(ctx context.Context, next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			logID := ulid.Make().String()
			w.Header().Set("X-Log-Id", logID)
			
			ctx = context.WithValue(r.Context(), logIDKey{}, logID)
			r = r.WithContext(ctx)
			
			next.ServeHTTP(w, r)
		})
	}
}

func GetLogID(ctx context.Context) string {
	if logID, ok := ctx.Value(logIDKey{}).(string); ok {
		return logID
	}
	return ""
}
