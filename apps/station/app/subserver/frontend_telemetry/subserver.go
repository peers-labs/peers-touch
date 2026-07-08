package frontend_telemetry

import (
	"context"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

type subServer struct {
	status     server.Status
	addrs      []string
	jwtWrapper server.Wrapper
	store      *rawEventStore
}

func NewFrontendTelemetrySubServer(opts ...option.Option) server.Subserver {
	return &subServer{
		status: server.StatusStopped,
		addrs:  []string{},
	}
}

func (s *subServer) Init(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusStarting

	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.jwtWrapper = server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}
	rawStore := newRawEventStore(rds)
	if err := rawStore.AutoMigrate(); err != nil {
		return err
	}
	s.store = rawStore
	return nil
}

func (s *subServer) Start(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusRunning
	return nil
}

func (s *subServer) Stop(ctx context.Context) error {
	s.status = server.StatusStopped
	return nil
}

func (s *subServer) Name() string               { return "frontend_telemetry" }
func (s *subServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *subServer) Status() server.Status      { return s.status }
func (s *subServer) Address() server.SubserverAddress {
	return server.SubserverAddress{Address: s.addrs}
}

func (s *subServer) Handlers() []server.Handler {
	return []server.Handler{
		server.NewTypedHandler("frontend-telemetry-ingest", "/telemetry/frontend/events/batch", server.POST, s.handleIngest, s.jwtWrapper),
		server.NewTypedHandler("frontend-telemetry-query", "/telemetry/frontend/events/query", server.POST, s.handleQuery, s.jwtWrapper),
		server.NewTypedHandler("frontend-telemetry-rollup-query", "/telemetry/frontend/rollups/query", server.POST, s.handleRollupQuery, s.jwtWrapper),
	}
}
