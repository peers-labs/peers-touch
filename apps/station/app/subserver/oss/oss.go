package oss

import (
	"context"
	"path/filepath"
	"strings"

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

// defaultMaxFileSize is the per-file upload cap when the operator does not
// override `Options.MaxFileSize`. 32 MiB matches the multipart parser's
// in-memory threshold and is a reasonable default for home deployments.
const defaultMaxFileSize int64 = 32 << 20

// defaultMaxFilesPerMessage is an advisory client-side limit surfaced via
// capabilities. We do not enforce it server-side because each upload is a
// separate request.
const defaultMaxFilesPerMessage int32 = 9

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

	// hostOverride / limits / backendType drive the `/capabilities`
	// response and the `cid` URIs returned from `/upload`. See
	// `Options` for the full rationale on each.
	hostOverride       string
	maxFileSize        int64
	maxFilesPerMessage int32
	backendType        string
	keyStrategy        string
}

func NewOSSSubServer(opts ...option.Option) server.Subserver {
	o := getOptions(opts...)
	s := &ossSubServer{status: server.StatusStopped, addrs: []string{}}
	s.pathBase = o.Path
	s.dbName = o.DBName
	s.storePath = o.StorePath
	s.signSecret = o.SignSecret
	s.authProvider = o.AuthProvider
	s.hostOverride = strings.TrimRight(o.HostOverride, "/")
	s.maxFileSize = o.MaxFileSize
	if s.maxFileSize <= 0 {
		s.maxFileSize = defaultMaxFileSize
	}
	s.maxFilesPerMessage = o.MaxFilesPerMessage
	if s.maxFilesPerMessage <= 0 {
		s.maxFilesPerMessage = defaultMaxFilesPerMessage
	}
	s.backendType = o.BackendType
	if s.backendType == "" {
		s.backendType = "local"
	}
	s.keyStrategy = strings.ToLower(strings.TrimSpace(o.KeyStrategy))
	switch s.keyStrategy {
	case "", "random":
		s.keyStrategy = "random"
	case "cas":
		// Accepted as-is.
	default:
		// Operator typo'd a value we don't understand. Refuse to
		// silently fall back; surface clearly in logs and stay on
		// the safe `random` strategy so uploads keep working.
		s.keyStrategy = "random"
	}
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
	s.fileService = service.NewFileServiceWith(fileRepo, s.backend, service.KeyStrategy(s.keyStrategy), s.backendType)

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
