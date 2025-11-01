package touch

import (
	"github.com/peers-touch/peers-touch/station/frame/core/server"
)

const (
	RouterURLUserSignUP  RouterPath = "/sign-up"
	RouterURLUserLogin   RouterPath = "/login"
	RouterURLUserProfile RouterPath = "/profile"
)

type UserRouters struct{}

// Ensure UserRouters implements server.Routers interface
var _ server.Routers = (*UserRouters)(nil)

// Routers registers all user-related handlers
func (mr *UserRouters) Handlers() []server.Handler {
	handlerInfos := GetUserHandlers()
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

func (mr *UserRouters) Name() string {
	return RoutersNameUser
}

// NewUserRouter creates UserRouters
func NewUserRouter() *UserRouters {
	return &UserRouters{}
}
