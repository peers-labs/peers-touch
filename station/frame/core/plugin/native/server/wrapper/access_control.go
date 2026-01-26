package wrapper

import (
	"context"
	"net/http"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type AccessControlConfig interface {
	IsEnabled(routeName string) bool
}

func AccessControl(routeName string, config AccessControlConfig) server.Wrapper {
	httpWrapper := func(ctx context.Context, next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !config.IsEnabled(routeName) {
				logger.Warnf(r.Context(), "Router %s is disabled by configuration", routeName)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusNotFound)
				w.Write([]byte(`{"error":"Page not found"}`))
				return
			}

			next.ServeHTTP(w, r)
		})
	}
	return server.HTTPWrapperAdapter(httpWrapper)
}
