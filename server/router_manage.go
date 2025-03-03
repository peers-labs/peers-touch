package server

import (
	"context"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
)

const (
	ManageRouterURLHealth RouterURL = "/health"
)

// ManageRouters provides management endpoints for the service
type ManageRouters struct{}

func (mr *ManageRouters) Routers() []Router {
	return []Router{
		server.NewHandler(ManageRouterURLHealth.Name(), ManageRouterURLHealth.URL(),
			func(c context.Context, ctx *app.RequestContext) {
				ctx.String(http.StatusOK, "hello world，health")
			}),
	}
}

// NewManageRouter creates a new router with management endpoints
func NewManageRouter() *ManageRouters {
	return &ManageRouters{}
}
