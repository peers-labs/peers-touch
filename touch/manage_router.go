package touch

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
)

const (
	ManageRouterURLHealth RouterPath = "/health"
	ManageRouterURLPing   RouterPath = "/ping"
)

// ManageRouters provides management endpoints for the service
type ManageRouters struct{}

// Ensure ManageRouters implements server.Routers interface
var _ server.Routers = (*ManageRouters)(nil)

// Routers registers all management-related handlers
func (mr *ManageRouters) Handlers() []server.Handler {
	handlerInfos := GetManageHandlers()
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

func (mr *ManageRouters) Name() string {
	return RoutersNameManagement
}

// NewManageRouter creates a new router with management endpoints
func NewManageRouter() *ManageRouters {
	return &ManageRouters{}
}
