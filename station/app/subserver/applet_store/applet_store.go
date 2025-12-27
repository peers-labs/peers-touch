package applet_store

import (
    "context"
    "path/filepath"

    "github.com/peers-labs/peers-touch/station/app/subserver/applet_store/db/model"
    applet_handler "github.com/peers-labs/peers-touch/station/app/subserver/applet_store/handler"
    "github.com/peers-labs/peers-touch/station/app/subserver/applet_store/service"
    "github.com/peers-labs/peers-touch/station/frame/core/facility/appdir"
    "github.com/peers-labs/peers-touch/station/frame/core/option"
    "github.com/peers-labs/peers-touch/station/frame/core/server"
    "github.com/peers-labs/peers-touch/station/frame/core/store"
)

type appletStoreSubServer struct {
    status    server.Status
    addrs     []string
    pathBase  string
    dbName    string
    storePath string
    svc       *service.StoreService
}

func NewAppletStoreSubServer(opts ...option.Option) server.Subserver {
    o := option.GetOptions(opts...).Ctx().Value(optionsKey{}).(*Options)
    s := &appletStoreSubServer{status: server.StatusStopped, addrs: []string{}}
    s.pathBase = o.PathBase
    if s.pathBase == "" { s.pathBase = "/api/v1/applets" }
    s.dbName = o.DBName
    s.storePath = o.StorePath
    if s.storePath == "" {
        if dir, err := appdir.Resolve("station", "data"); err == nil {
            s.storePath = filepath.Join(dir, "applet_store")
        } else {
            s.storePath = "/tmp/applet_store"
        }
    }
    return s
}

func (s *appletStoreSubServer) Init(ctx context.Context, opts ...option.Option) error {
    s.status = server.StatusStarting
    rds, err := store.GetRDS(ctx, store.WithRDSDBName(s.dbName))
    if err != nil { return err }
    if err = rds.AutoMigrate(&model.Applet{}, &model.AppletVersion{}); err != nil { return err }
    s.svc = service.NewStoreService(rds, s.storePath)
    return nil
}

func (s *appletStoreSubServer) Start(ctx context.Context, opts ...option.Option) error { s.status = server.StatusRunning; return nil }
func (s *appletStoreSubServer) Stop(ctx context.Context) error { s.status = server.StatusStopped; return nil }
func (s *appletStoreSubServer) Status() server.Status { return s.status }
func (s *appletStoreSubServer) Name() string { return "applet-store" }
func (s *appletStoreSubServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *appletStoreSubServer) Address() server.SubserverAddress { return server.SubserverAddress{Address: s.addrs} }

func (s *appletStoreSubServer) Handlers() []server.Handler {
    h := applet_handler.NewAppletHandler(s.pathBase, s.svc)
    return h.Handlers()
}
