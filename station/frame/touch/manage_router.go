package touch

import (
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/manage/handler"
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
	commonWrapper := CommonAccessControlWrapper(model.RouteNameManagement)

	return []server.Handler{
		server.NewTypedHandler(
			ManageRouterURLHealth.Name(),
			ManageRouterURLHealth.SubPath(),
			server.GET,
			handler.HandleHealth,
			commonWrapper,
		),
	}
}

func (mr *ManageRouters) Name() string {
	return model.RouteNameManagement
}

// NewManageRouter creates a new router with management endpoints
func NewManageRouter() *ManageRouters {
	return &ManageRouters{}
}
