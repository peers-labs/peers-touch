// actor_router.go — Actor management route definitions and router registration.
//
// Extracted from activitypub_router.go during the activitypub→actor rename refactoring.
// AP protocol routes remain in activitypub_router.go; only client-facing actor
// management routes live here.
//
// Route prefix is automatically derived from Name() → "actor", so all paths
// are served under /actor/* (e.g. /actor/sign-up, /actor/login).

package touch

import (
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

// ---------------------------------------------------------------------------
// Actor management route constants
// ---------------------------------------------------------------------------

const (
	// RouterURLActorSignUP Client sign-up: create a local actor account
	RouterURLActorSignUP RouterPath = "/sign-up"

	// RouterURLActorLogin Client login: obtain session/tokens
	RouterURLActorLogin RouterPath = "/login"

	// RouterURLActorLogout Client logout: invalidate session
	RouterURLActorLogout RouterPath = "/logout"

	// RouterURLActorSessionTakeover Client session rotation: use a valid
	// persisted session to become this Station's sole active login.
	RouterURLActorSessionTakeover RouterPath = "/session/takeover"

	// RouterURLAccessAttemptStart starts a Station access gate attempt.
	RouterURLAccessAttemptStart RouterPath = "/access/start"

	// RouterURLAccessGateSubmit submits an action for the current access gate.
	RouterURLAccessGateSubmit RouterPath = "/access/submit"

	// RouterURLAccessDecision returns the current access decision for an attempt.
	RouterURLAccessDecision RouterPath = "/access/decision"

	// RouterURLAccessAttemptCancel cancels a live access gate attempt.
	RouterURLAccessAttemptCancel RouterPath = "/access/cancel"

	// RouterURLActorChangePassword Client change password
	RouterURLActorChangePassword RouterPath = "/change-password"

	// RouterURLActorProfile Actor profile: GET/POST to read or update profile attributes
	RouterURLActorProfile RouterPath = "/profile"

	// RouterURLPublicProfile Public actor profile: GET to read extended profile by username
	RouterURLPublicProfile RouterPath = "/:actor/profile"

	// RouterURLActorList Actor list: enumerate local actors (for admin/testing)
	RouterURLActorList RouterPath = "/list"

	// RouterURLActorSearch Actor search: search local actors by query (fuzzy match)
	RouterURLActorSearch RouterPath = "/search"

	// RouterURLActorBasicInfo Public basic info by actor ID (no auth required).
	// Returns: displayName, avatarUrl, coverUrl (non-sensitive public info)
	RouterURLActorBasicInfo RouterPath = "/actors/:id/basic-info"

	// RouterURLActorPublicProfileByID Authenticated lookup of an actor's public
	// profile by numeric actor ID. The desktop client uses this to render rich
	// peer profile cards (chat detail panel, contacts detail panel) where only
	// the peer's DID/actor-id is known. The endpoint returns the same
	// `ActorProfile` projection as `/actor/profile`, but for the requested
	// peer; only public fields are exposed. Auth is required to keep peer
	// directory access bound to a logged-in actor.
	RouterURLActorPublicProfileByID RouterPath = "/actors/:id/profile"

	// RouterURLOAuthLogin OAuth login: external gateway callback for OAuth-based login/registration
	RouterURLOAuthLogin RouterPath = "/oauth-bridge"

	// RouterURLFederationProfile is the home-station endpoint that returns
	// a signed ActorProfileEnvelope for one of its local actors. Public
	// (no JWT). The federated user-discovery resolver on a peer station
	// hits this endpoint via /relay/forward to retrieve verified profile
	// snapshots without granting itself a session on this station.
	RouterURLFederationProfile RouterPath = "/federation/profile"

	// RouterURLFederationMe returns the federation snapshot of the
	// currently logged-in actor (handle, visibility, locator_seq).
	// JWT-protected — never anonymous, since the response identifies a
	// specific account on this station. Used by Desktop's "settings ›
	// federation" panel and as the source-of-truth for a fresh login's
	// "who am I in the federation" hydration.
	RouterURLFederationMe RouterPath = "/federation/me"

	// RouterURLFederationVisibility flips the logged-in actor's
	// visibility. JWT-protected; PUT-only (POST is reserved for future
	// "publish-now-with-extras" workflows). The handler triggers an
	// async republish so the DHT picks up the change without making
	// the user wait for libp2p I/O.
	RouterURLFederationVisibility RouterPath = "/federation/visibility"

	// RouterURLFederationResolve resolves a remote handle to a verified
	// profile envelope. JWT-protected — federation resolution is a
	// signed-in-user action (the response carries a profile a UI will
	// render). Internally wraps frame/touch/federation/resolver, with
	// federation cache and relay-forward both engaged transparently.
	RouterURLFederationResolve RouterPath = "/federation/resolve"

	// RouterURLFederationHealth is the public readiness probe.
	// No JWT — operators (Prometheus / external uptime checks) and
	// the Desktop pre-login splash both consume it. The handler
	// always returns 200 with the body's `ready` field carrying the
	// truth; the transport layer is never an error path so health
	// scrapers never alert on a mere "not joined yet".
	RouterURLFederationHealth RouterPath = "/federation/health"
)

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

// ActorRouters provides actor management endpoints under the /actor prefix.
type ActorRouters struct{}

// Ensure ActorRouters implements server.Routers interface at compile time.
var _ server.Routers = (*ActorRouters)(nil)

// Handlers converts every ActorHandlerInfo into a server.Handler for framework registration.
func (ar *ActorRouters) Handlers() []server.Handler {
	handlerInfos := GetActorHandlers()
	handlers := make([]server.Handler, len(handlerInfos))

	for i, info := range handlerInfos {
		handlers[i] = server.NewHTTPHandler(
			info.RouterURL.Name(),
			info.RouterURL.SubPath(),
			info.Method,
			server.HertzHandlerFunc(info.Handler),
			info.Wrappers...,
		)
	}

	return handlers
}

// Name returns the route group name. The framework uses this value as the URL
// prefix, so all actor management routes are served under /actor/*.
func (ar *ActorRouters) Name() string {
	return model.RouteNameActor
}

// NewActorRouter creates a new ActorRouters instance.
func NewActorRouter() *ActorRouters {
	return &ActorRouters{}
}
