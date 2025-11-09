package touch

import (
	"context"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/peers-touch/peers-touch/station/frame/core/server"
)

// ManageHandlerInfo represents a single handler's information
type ManageHandlerInfo struct {
	RouterURL RouterPath
	Handler   func(context.Context, *app.RequestContext)
	Method    server.Method
	Wrappers  []server.Wrapper
}

// GetManageHandlers returns all management handler configurations
func GetManageHandlers() []ManageHandlerInfo {
	commonWrapper := CommonAccessControlWrapper(RoutersNameManagement)

	return []ManageHandlerInfo{
		{
			RouterURL: ManageRouterURLHealth,
			Handler:   HealthHandler,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper},
		},
		// {
		// 	RouterURL: ManageRouterURLPing,
		// 	Handler:   PingHandler,
		// 	Method:    server.GET,
		// 	Wrappers:  []server.Wrapper{commonWrapper},
		// },
	}
}

// Handler implementations

func HealthHandler(c context.Context, ctx *app.RequestContext) {
	ctx.String(http.StatusOK, "hello world, health")
}
