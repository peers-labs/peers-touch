package touch

import (
	"context"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
)

const (
	RouterURLWellKnown          RouterURL = "/.well-known"
	RouterURLWellKnownWebFinger RouterURL = "/.well-known/webfinger"
)

// WellKnownRouters provides .well-known endpoints for the service
// see: https://www.w3.org/community/reports/socialcg/CG-FINAL-apwf-20240608/
type WellKnownRouters struct{}

func (mr *WellKnownRouters) Routers() []Router {
	return []Router{
		server.NewHandler(RouterURLWellKnown.Name(), RouterURLWellKnown.URL(),
			func(c context.Context, ctx *app.RequestContext) {
				ctx.String(http.StatusOK, "hello world，well-known")
			}),
		server.NewHandler(RouterURLWellKnownWebFinger.Name(), RouterURLWellKnownWebFinger.URL(), Webfinger),
	}
}

func (mr *WellKnownRouters) Name() string {
	return RoutersNameWellKnown
}

// NewWellKnownRouter creates WellKnownRouters
func NewWellKnownRouter() *WellKnownRouters {
	return &WellKnownRouters{}
}
