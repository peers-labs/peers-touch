package touch

import (
	"context"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
)

const (
	ManageRouterURLHealth RouterURL = "/health"
	ManageRouterURLPing   RouterURL = "/ping"
)

// ManageRouters provides management endpoints for the service
type ManageRouters struct{}

func (mr *ManageRouters) Routers() []Router {
	return []Router{
		server.NewHandler(ManageRouterURLHealth,
			func(c context.Context, ctx *app.RequestContext) {
				ctx.String(http.StatusOK, "hello world，health")
			}, server.WithMethod(server.GET)),
		server.NewHandler(ManageRouterURLPing.Name(), ManageRouterURLPing.URL(),
			func(c context.Context, ctx *app.RequestContext) {
				ctx.JSON(http.StatusOK, map[string]interface{}{
					"status": "ok",
					"message": "pong",
				})
			}, server.WithMethod(server.GET)),
	}
}

func (mr *ManageRouters) Name() string {
	return RoutersNameManagement
}

// NewManageRouter creates a new router with management endpoints
func NewManageRouter() *ManageRouters {
	return &ManageRouters{}
}
