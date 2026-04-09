package touch

import (
	"net/http"

	"github.com/peers-labs/peers-touch/station/frame/core/metrics"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

const (
	MetricsRouterURLMetrics RouterPath = "/metrics"
)

type MetricsRouters struct{}

var _ server.Routers = (*MetricsRouters)(nil)

func (mr *MetricsRouters) Handlers() []server.Handler {
	return []server.Handler{
		server.NewHTTPHandler(
			MetricsRouterURLMetrics.Name(),
			MetricsRouterURLMetrics.SubPath(),
			server.GET,
			server.HTTPHandlerFunc(metricsHTTPHandler),
		),
	}
}

func (mr *MetricsRouters) Name() string {
	return model.RouteNameManagement
}

func NewMetricsRouter() *MetricsRouters {
	return &MetricsRouters{}
}

func metricsHTTPHandler(w http.ResponseWriter, r *http.Request) {
	metrics.Get().Handler().ServeHTTP(w, r)
}
