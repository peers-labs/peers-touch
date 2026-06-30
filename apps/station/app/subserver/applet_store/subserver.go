// Package applet_store wires the applet marketplace (catalog, install state,
// bundle delivery, audit) onto the Station main HTTP server.
//
// Until this subserver existed the store only had a standalone CLI
// (cmd/store_cli) and a set of handlers that were never registered with the
// main server, so clients hitting /api/v1/applets/* received 404. This file
// assembles the existing service + handler layers into a server.Subserver and
// is registered from app/main.go alongside the other subservers.
package applet_store

import (
	"context"
	"path/filepath"

	storehandler "github.com/peers-labs/peers-touch/station/app/subserver/applet_store/handler"
	"github.com/peers-labs/peers-touch/station/app/subserver/applet_store/service"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

// storePathBase is the public HTTP prefix for all applet store routes. It must
// stay aligned with the desktop client (STORE_BASE in applet_store.rs) and the
// bundleURL builder in service.bundleURL.
const storePathBase = "/api/v1/applets"

// defaultBundleStoragePath is used when no explicit storage path is configured.
const defaultBundleStoragePath = "data/applets/store-bundles"

type subServer struct {
	status  server.Status
	addrs   []string
	handler *storehandler.AppletHandler
}

// NewAppletStoreSubServer constructs the applet store subserver.
func NewAppletStoreSubServer(_ ...option.Option) server.Subserver {
	return &subServer{
		status: server.StatusStopped,
		addrs:  []string{},
	}
}

func (s *subServer) Init(ctx context.Context, _ ...option.Option) error {
	s.status = server.StatusStarting

	rds, err := store.GetRDS(ctx)
	if err != nil {
		s.status = server.StatusError
		return err
	}

	storagePath := config.
		Get("peers", "node", "server", "subserver", "applet_store", "storage-path").
		String(defaultBundleStoragePath)
	if !filepath.IsAbs(storagePath) {
		storagePath = filepath.Clean(storagePath)
	}

	svc := service.NewStoreService(rds, storagePath)
	if err := svc.Migrate(); err != nil {
		s.status = server.StatusError
		return err
	}

	// Actor-scoped routes (catalog/installed/install/uninstall/version/audit
	// ingest) require an authenticated subject; publish/bundle/admin routes
	// stay open for the CLI/dev publishing flow.
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	authWrapper := server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))

	s.handler = storehandler.NewAppletHandler(storePathBase, svc, authWrapper)
	return nil
}

func (s *subServer) Start(context.Context, ...option.Option) error {
	s.status = server.StatusRunning
	return nil
}

func (s *subServer) Stop(context.Context) error {
	s.status = server.StatusStopped
	return nil
}

func (s *subServer) Name() string               { return "applet_store" }
func (s *subServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *subServer) Status() server.Status      { return s.status }
func (s *subServer) Address() server.SubserverAddress {
	return server.SubserverAddress{Address: s.addrs}
}

func (s *subServer) Handlers() []server.Handler {
	if s.handler == nil {
		return nil
	}
	return s.handler.Handlers()
}
