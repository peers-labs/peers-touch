// Package dashboard — middleware and context helpers for TypedHandler-based
// dashboard API endpoints. Replaces the old requireAuth() + manual parameter
// extraction with a clean server.Wrapper that stores all per-request metadata
// in context.Context.
//
// Change History:
//   - 2026-04-22: Created during TypedHandler migration. Extracts dashboard
//     JWT auth, client IP, User-Agent, path params, and query params into
//     context for use by typed handler functions.
package dashboard

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

// ---------------------------------------------------------------------------
// Dashboard request context — carried through context.Context
// ---------------------------------------------------------------------------

// dashboardCtx stores per-request metadata extracted by the middleware
// wrapper. Handlers retrieve it via the typed accessor functions below.
type dashboardCtx struct {
	claims    *domain.DashboardClaims
	clientIP  string
	userAgent string
	params    map[string]string // path params (e.g. "id", "sid")
	query     map[string]string // query params (e.g. "page", "limit")
}

type dashboardCtxKey struct{}

// getDashCtx retrieves the per-request dashboard context.
// Returns nil if the wrapper has not run (should never happen for
// properly registered handlers).
func getDashCtx(ctx context.Context) *dashboardCtx {
	if v, ok := ctx.Value(dashboardCtxKey{}).(*dashboardCtx); ok {
		return v
	}
	return nil
}

// getClaims returns the validated dashboard JWT claims from context.
func getClaims(ctx context.Context) *domain.DashboardClaims {
	if dc := getDashCtx(ctx); dc != nil {
		return dc.claims
	}
	return nil
}

// getClientIP returns the client IP address extracted by the middleware.
func getClientIP(ctx context.Context) string {
	if dc := getDashCtx(ctx); dc != nil {
		return dc.clientIP
	}
	return ""
}

// getUserAgent returns the User-Agent header extracted by the middleware.
func getUserAgent(ctx context.Context) string {
	if dc := getDashCtx(ctx); dc != nil {
		return dc.userAgent
	}
	return ""
}

// pathParam returns a named path parameter (e.g. ":id" -> "123").
func pathParam(ctx context.Context, name string) string {
	if dc := getDashCtx(ctx); dc != nil {
		return dc.params[name]
	}
	return ""
}

// queryParam returns a named query parameter value.
func queryParam(ctx context.Context, name string) string {
	if dc := getDashCtx(ctx); dc != nil {
		return dc.query[name]
	}
	return ""
}

// queryParamInt returns a named query parameter parsed as int.
// Falls back to defaultVal on empty, non-numeric, or negative values.
func queryParamInt(ctx context.Context, name string, defaultVal int) int {
	raw := queryParam(ctx, name)
	if raw == "" {
		return defaultVal
	}
	val, err := strconv.Atoi(raw)
	if err != nil || val < 1 {
		return defaultVal
	}
	return val
}

// ---------------------------------------------------------------------------
// Wrapper constructors
// ---------------------------------------------------------------------------

// authWrapper returns a server.Wrapper that validates the dashboard JWT
// and populates the context with claims + request metadata + params.
// All authenticated endpoints use this wrapper.
func (h *dashboardHandler) authWrapper() server.Wrapper {
	return h.buildContextWrapper(true)
}

// metaWrapper returns a server.Wrapper that populates context with request
// metadata + params WITHOUT requiring authentication. Used for the login
// endpoint which needs client IP but has no JWT yet.
func (h *dashboardHandler) metaWrapper() server.Wrapper {
	return h.buildContextWrapper(false)
}

// buildContextWrapper is the shared implementation for authWrapper and
// metaWrapper. It extracts Hertz-level metadata (IP, UA, path/query params)
// and optionally validates the dashboard JWT.
func (h *dashboardHandler) buildContextWrapper(requireAuth bool) server.Wrapper {
	return func(next server.EndpointHandler) server.EndpointHandler {
		return func(ctx context.Context, req server.Request, resp server.Response) error {
			dc := &dashboardCtx{
				params: make(map[string]string),
				query:  make(map[string]string),
			}

			// Extract path params and query params from the Hertz adapter.
			// The hertzRequestWithContext implements GetHertzContext() which
			// returns the underlying *app.RequestContext.
			type hertzContextGetter interface {
				GetHertzContext() interface{}
			}
			if getter, ok := req.(hertzContextGetter); ok {
				if hc, ok := getter.GetHertzContext().(*app.RequestContext); ok {
					dc.clientIP = hc.ClientIP()
					dc.userAgent = string(hc.UserAgent())

					// Extract known path params used by dashboard routes.
					// Hertz does not expose a VisitAll for path params, so
					// we extract the two param names used across all routes.
					if v := hc.Param("id"); v != "" {
						dc.params["id"] = v
					}
					if v := hc.Param("sid"); v != "" {
						dc.params["sid"] = v
					}

					// Extract all query params
					hc.QueryArgs().VisitAll(func(key, value []byte) {
						dc.query[string(key)] = string(value)
					})
				}
			}

			// Fallback: try extracting IP and UA from headers if Hertz
			// context was not available (e.g. unit tests).
			if dc.clientIP == "" {
				dc.clientIP = extractClientIPFromHeaders(req.Header())
			}
			if dc.userAgent == "" {
				dc.userAgent = req.Header()["User-Agent"]
			}

			// JWT validation when authentication is required.
			if requireAuth {
				authHeader := req.Header()["Authorization"]
				if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
					return server.Unauthorized("missing or invalid authorization header")
				}
				tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
				claims, err := h.sub.authSvc.ValidateToken(ctx, tokenStr)
				if err != nil {
					return server.Unauthorized("invalid or expired token")
				}
				dc.claims = claims
			}

			ctx = context.WithValue(ctx, dashboardCtxKey{}, dc)
			return next(ctx, req, resp)
		}
	}
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// extractClientIPFromHeaders derives the client IP from standard proxy
// headers when the Hertz context is unavailable (fallback path).
func extractClientIPFromHeaders(headers map[string]string) string {
	if forwarded := headers["X-Forwarded-For"]; forwarded != "" {
		parts := strings.SplitN(forwarded, ",", 2)
		return strings.TrimSpace(parts[0])
	}
	if realIP := headers["X-Real-Ip"]; realIP != "" {
		return realIP
	}
	return ""
}

// ServiceUnavailable creates a HandlerError with HTTP 503 status.
// Not provided by the framework's errors.go, so defined here for
// dashboard-specific use.
func serviceUnavailable(message string) *server.HandlerError {
	return server.NewHandlerError(http.StatusServiceUnavailable, message)
}

// Conflict creates a HandlerError with HTTP 409 status.
func conflict(message string) *server.HandlerError {
	return server.NewHandlerError(http.StatusConflict, message)
}
