package oss

import (
	"context"
	"path/filepath"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/oss/db/repo"
	"github.com/peers-labs/peers-touch/station/app/subserver/oss/service"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/appdir"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

type ossSubServer struct {
	status       server.Status
	addrs        []string
	pathBase     string
	dbName       string
	storePath    string
	signSecret   string
	backend      storage.Backend
	authProvider auth.Provider
	fileService  service.FileService
}

func NewOSSSubServer(opts ...option.Option) server.Subserver {
	o := getOptions(opts...)
	s := &ossSubServer{status: server.StatusStopped, addrs: []string{}}
	s.pathBase = o.Path
	s.dbName = o.DBName
	s.storePath = o.StorePath
	s.signSecret = o.SignSecret
	s.authProvider = o.AuthProvider
	if s.pathBase == "" {
		s.pathBase = "/sub-oss"
	}
	if s.storePath == "" {
		// Use appdir to resolve default data directory
		dataDir, err := appdir.Resolve("station", "data")
		if err == nil {
			s.storePath = filepath.Join(dataDir, "oss")
		} else {
			// Fallback if appdir fails (unlikely)
			s.storePath = "/tmp/oss"
		}
	}
	s.backend = storage.NewLocalBackend(s.storePath)

	// Initialize Service Layer
	fileRepo := repo.NewFileRepository(s.dbName)
	s.fileService = service.NewFileService(fileRepo, s.backend)

	return s
}

func (s *ossSubServer) Init(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusStarting
	if s.dbName != "" {
		if rds, err := store.GetRDS(ctx, store.WithRDSDBName(s.dbName)); err == nil {
			_ = rds.AutoMigrate(&ossmodel.FileMeta{})
		}
	}
	return nil
}

func (s *ossSubServer) Start(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusRunning
	return nil
}

func (s *ossSubServer) Stop(ctx context.Context) error { s.status = server.StatusStopped; return nil }
func (s *ossSubServer) Status() server.Status          { return s.status }
func (s *ossSubServer) Name() string                   { return "oss" }
func (s *ossSubServer) Type() server.SubserverType     { return server.SubserverTypeHTTP }
func (s *ossSubServer) Address() server.SubserverAddress {
	return server.SubserverAddress{Address: s.addrs}
}
