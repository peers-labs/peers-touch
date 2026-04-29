package oss

import (
	"context"
	"net/http"
	"strings"

	"github.com/oklog/ulid/v2"
)

// requestIDHeader is the response header surfaced to clients so they
// can correlate logs / audit rows across systems. We use the
// canonical-cased `X-Request-ID` rather than the OSS subserver's
// internal `X-Log-Id` because federation peers and dashboards have
// other systems that already understand X-Request-ID; reusing it
// keeps the operator's grep simple.
const requestIDHeader = "X-Request-ID"

// requestIDCtxKey is the unexported context key under which the
// request ID is stamped. We deliberately keep the type unexported
// so callers must go through the helpers below — this enforces a
// single canonical reader path.
type requestIDCtxKey struct{}

// requestIDMiddleware generates a fresh ULID per inbound request,
// stamps it into the request context AND the response header, then
// hands off to the next handler. The audit repo helpers read the
// value off the context to populate `oss_audit.request_id` so
// operators can stitch every log / audit row caused by one inbound
// request.
//
// If an upstream proxy already set `X-Request-ID` we honour it —
// reverse proxies and CDN edges generate request IDs of their own
// and overwriting them breaks cross-tier correlation. We do still
// validate the inbound value is short and ASCII so a malicious
// header cannot smuggle arbitrary bytes into our audit table.
func requestIDMiddleware(_ context.Context, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimSpace(r.Header.Get(requestIDHeader))
		if !isValidRequestID(id) {
			id = ulid.Make().String()
		}
		w.Header().Set(requestIDHeader, id)
		ctx := context.WithValue(r.Context(), requestIDCtxKey{}, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequestIDFromContext returns the per-request correlation token
// stamped by `requestIDMiddleware`, or the empty string when the
// middleware was not in the chain. Callers writing audit rows pass
// the result into `Audit.RequestID`.
//
// Empty string is treated as "no correlation available" by the
// audit table; callers should not synthesise a placeholder.
func RequestIDFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(requestIDCtxKey{}).(string); ok {
		return v
	}
	return ""
}

// isValidRequestID applies the upstream-trust rule: we accept an
// inbound `X-Request-ID` only when it looks like a sane correlation
// token (printable ASCII, ≤128 chars, no whitespace). Anything
// stranger gets replaced with a fresh ULID — defending against an
// attacker stamping `\n`-separated payloads into our audit table.
func isValidRequestID(s string) bool {
	if s == "" || len(s) > 128 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c < 0x20 || c > 0x7e {
			return false
		}
	}
	return true
}
