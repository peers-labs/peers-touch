package wrapper

import (
	"context"

	"github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

// RequireFederationToken wires the framework's federation
// verifier into the server.Wrapper signature subservers register
// against. Strict mode by default (passthroughOnNonFederation =
// false): a non-federation Authorization header is rejected with
// 401. Use RequireFederationOrPassthrough on the one route
// (OSS file GET) that legitimately mixes federation + subject
// access tokens on the same handler.
func RequireFederationToken(
	scopeName string,
	store federation.PeerKeyStore,
	audResolver httpadapter.AudienceResolver,
) server.Wrapper {
	return server.HTTPWrapperAdapter(
		httpadapter.RequireFederationToken(scopeName, store, audResolver, false),
	)
}

// RequireFederationOrPassthrough is the lenient variant: a
// missing-or-non-federation Authorization header is forwarded
// to `next` untouched; the downstream handler is responsible
// for its own auth decision. Used by the OSS file GET handler
// where a federation peer JWT and a local user-JWT both have
// to win.
func RequireFederationOrPassthrough(
	scopeName string,
	store federation.PeerKeyStore,
	audResolver httpadapter.AudienceResolver,
) server.Wrapper {
	return server.HTTPWrapperAdapter(
		httpadapter.RequireFederationToken(scopeName, store, audResolver, true),
	)
}

// GetVerifiedFederationClaims is the handler-side accessor for
// the VerifiedClaims attached by the wrapper. Mirrors the
// pattern of GetSubject for subject access JWTs.
func GetVerifiedFederationClaims(ctx context.Context, _ server.Request) *federation.VerifiedClaims {
	return httpadapter.GetVerifiedClaims(ctx)
}
