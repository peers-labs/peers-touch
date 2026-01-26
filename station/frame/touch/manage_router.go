package touch

import (
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
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

func (mr *ManageRouters) Name() string {
	return model.RouteNameManagement
}

// NewManageRouter creates a new router with management endpoints
func NewManageRouter() *ManageRouters {
	return &ManageRouters{}
}
