package touch

import (
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

const (
	RouterURLWellKnown          RouterPath = "/"
	RouterURLWellKnownWebFinger RouterPath = "/webfinger"
	RouterURLWellKnownHostMeta  RouterPath = "/host-meta"
	RouterURLWellKnownNodeInfo  RouterPath = "/nodeinfo"
)

// WellKnownRouters provides .well-known endpoints for the service
// see: https://www.w3.org/community/reports/socialcg/CG-FINAL-apwf-20240608/
type WellKnownRouters struct{}

// Ensure WellKnownRouters implements server.Routers interface
var _ server.Routers = (*WellKnownRouters)(nil)

// Routers registers all well-known-related handlers
func (mr *WellKnownRouters) Handlers() []server.Handler {
	handlerInfos := GetWellKnownHandlers()
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

func (mr *WellKnownRouters) Name() string {
	return model.RouteNameWellKnown
}

// NewWellKnownRouter creates WellKnownRouters
func NewWellKnownRouter() *WellKnownRouters {
	return &WellKnownRouters{}
}
