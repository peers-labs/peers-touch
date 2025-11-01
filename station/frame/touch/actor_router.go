package touch

import (
	"github.com/peers-touch/peers-touch/station/frame/core/server"
)

const (
	RouterURLActorSignUP  RouterPath = "/sign-up"
	RouterURLActorLogin   RouterPath = "/login"
	RouterURLActorProfile RouterPath = "/profile"
)

type ActorRouters struct{}

// Ensure ActorRouters implements server.Routers interface
var _ server.Routers = (*ActorRouters)(nil)

// Routers registers all actor-related handlers
func (mr *ActorRouters) Handlers() []server.Handler {
	handlerInfos := GetActorHandlers()
	handlers := make([]server.Handler, len(handlerInfos))

	for i, info := range handlerInfos {
		handlers[i] = server.NewHandler(
			info.RouterURL,
			info.Handler,
			server.WithMethod(info.Method),
			server.WithWrappers(info.Wrappers...),
		)
	}

	return handlers
}

func (mr *ActorRouters) Name() string {
	return RoutersNameUser
}

// NewActorRouter creates ActorRouters
func NewActorRouter() *ActorRouters {
	return &ActorRouters{}
}
