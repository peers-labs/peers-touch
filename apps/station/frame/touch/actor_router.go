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

	// RouterURLOAuthLogin OAuth login: external gateway callback for OAuth-based login/registration
	RouterURLOAuthLogin RouterPath = "/oauth-bridge"
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
