package httpadapter

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/scope"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// AudienceResolver derives "what is the local station identity"
// from a request. Most consumers return a static string captured
// at handler-registration time (the local station ID); some
// (multi-tenant gateways) project a header into the value.
//
// Returning ("", error) makes the wrapper respond 500 — the
// inability to determine our own audience is an operator
// problem, not a request-validation one.
type AudienceResolver func(*http.Request) (string, error)

// StaticAudience is the canonical resolver: just return the same
// string for every request. Sugar so the common case is one
// line.
func StaticAudience(aud string) AudienceResolver {
	return func(*http.Request) (string, error) {
		if aud == "" {
			return "", errors.New("httpadapter: federation: empty static audience")
		}
		return aud, nil
	}
}

// federationContextKey is the per-request slot we stash the
// VerifiedClaims into. Private to this package + the GetClaims
// accessor below; downstream handlers MUST go through GetClaims
// rather than poking at the context map themselves.
type federationContextKey struct{}

// withVerifiedClaims is the sole writer of the context slot.
func withVerifiedClaims(ctx context.Context, c *federation.VerifiedClaims) context.Context {
	return context.WithValue(ctx, federationContextKey{}, c)
}

// GetVerifiedClaims returns the federation claims attached by
// RequireFederationToken to the request context. Returns nil
// when the request did NOT pass through the wrapper — handlers
// that mix federation + subject access tokens on a single route
// branch on this nil-ness.
func GetVerifiedClaims(ctx context.Context) *federation.VerifiedClaims {
	if c, ok := ctx.Value(federationContextKey{}).(*federation.VerifiedClaims); ok {
		return c
	}
	return nil
}

// RequireFederationToken is the federation counterpart to
// RequireJWT. It expects the caller to:
//
//   - register the scope (via scope.MustRegister) before any
//     request arrives;
//   - supply the per-process PeerKeyStore that owns the TOFU
//     cache;
//   - supply an AudienceResolver that knows what local-station
//     identity to compare against the JWT `aud` claim.
//
// On a wrong-typ token, the wrapper does NOT fall through —
// it 401s. Handlers that need to mix federation + subject access
// tokens on the same route should NOT use this wrapper; they
// should call federation.Verify directly inside the handler and
// dispatch on ErrNotFederationToken.
//
// The fallthrough split keeps the "mostly federation" routes
// (the entire OSS pull edge after migration) crisp: install one
// wrapper, get a populated VerifiedClaims, refuse anything else.
//
// `passthroughOnNonFederation` exposes the fallthrough behaviour
// for the route that legitimately needs it (OSS file GET, today
// the only example). When true the wrapper hands non-federation
// requests off to `next` untouched; downstream handler is
// responsible for its own auth decision.
func RequireFederationToken(
	scopeName string,
	store federation.PeerKeyStore,
	audResolver AudienceResolver,
	passthroughOnNonFederation bool,
) func(ctx context.Context, next http.Handler) http.Handler {
	if scopeName == "" {
		panic("httpadapter: federation: scope name is required")
	}
	// Validate scope at install time so a typo trips on boot,
	// not on the first request.
	if _, err := scope.Get(scopeName); err != nil {
		panic("httpadapter: federation: " + err.Error())
	}
	if store == nil {
		panic("httpadapter: federation: nil PeerKeyStore")
	}
	if audResolver == nil {
		panic("httpadapter: federation: nil audience resolver")
	}

	return func(ctx context.Context, next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if !strings.HasPrefix(authHeader, "Bearer ") {
				if passthroughOnNonFederation {
					next.ServeHTTP(w, r)
					return
				}
				writeAuthError(w, "auth_required", 401, "authentication required")
				return
			}
			token := strings.TrimPrefix(authHeader, "Bearer ")

			audience, err := audResolver(r)
			if err != nil {
				logger.Error(ctx, "[FederationToken] audience resolution failed")
				writeAuthError(w, "internal_error", 500, "audience resolution failed")
				return
			}

			claims, err := federation.Verify(r.Context(), store, token, scopeName, audience)
			if err != nil {
				if errors.Is(err, federation.ErrNotFederationToken) {
					if passthroughOnNonFederation {
						next.ServeHTTP(w, r)
						return
					}
					writeAuthError(w, "token_invalid", 401, "federation token required")
					return
				}
				logger.Warn(ctx, "[FederationToken] credentials rejected: validation failed")
				writeAuthError(w, "token_invalid", 401, "token validation failed")
				return
			}

			logger.Debug(ctx, "[FederationToken] authentication succeeded")
			next.ServeHTTP(w, r.WithContext(withVerifiedClaims(r.Context(), claims)))
		})
	}
}

func writeAuthError(w http.ResponseWriter, code string, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	body, _ := json.Marshal(map[string]string{"code": code, "error": message})
	_, _ = w.Write(body)
}
