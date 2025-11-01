package station

import (
	"github.com/peers-touch/peers-touch/station/frame/core/server"
)

const (
	RouterURLStationPhotoSync RouterPath = "/station/photo/sync"
	RouterURLStationPhotoList RouterPath = "/station/photo/list"
	RouterURLStationPhotoGet  RouterPath = "/station/photo/get"
)

const (
	RoutersNameStation = "station"
)

type RouterPath string

func (rp RouterPath) Name() string {
	return string(rp)
}

func (rp RouterPath) SubPath() string {
	return string(rp)
}

// StationRouters provides station photo endpoints for the service
type StationRouters struct{}

// Ensure StationRouters implements server.Routers interface
var _ server.Routers = (*StationRouters)(nil)

// Handlers registers all station-related handlers
func (sr *StationRouters) Handlers() []server.Handler {
	handlerInfos := GetStationHandlers()
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

func (sr *StationRouters) Name() string {
	return RoutersNameStation
}

// NewStationRouter creates a new station router instance
func NewStationRouter() server.Routers {
	return &StationRouters{}
}
