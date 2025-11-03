package aibox

import (
	"context"
	_ "embed"

	"github.com/peers-touch/peers-touch/station/frame/core/logger"
	"github.com/peers-touch/peers-touch/station/frame/core/option"
	"github.com/peers-touch/peers-touch/station/frame/core/server"
	"github.com/peers-touch/peers-touch/station/frame/core/store"

	"github.com/peers-touch/peers-touch/station/app/subserver/ai-box/db/models"
	aiboxpb "github.com/peers-touch/peers-touch/station/app/subserver/ai-box/proto_gen/v1/peers_touch_station/ai_box"
)

//go:embed db/models/init.sql
var initSQL string

var (
	_ server.Subserver = (*aiBoxSubServer)(nil)
)

// aiBoxURL implements server.RouterURL for station endpoints
type aiBoxURL struct {
	name string
	path string
}

func (s aiBoxURL) SubPath() string {
	return s.path
}

func (s aiBoxURL) Name() string {
	return s.name
}

// aiBoxSubServer handles photo upload requests
type aiBoxSubServer struct {
	opts *Options

	addrs  []string      // Populated from configuration
	status server.Status // Track server status
}

func (s *aiBoxSubServer) Init(ctx context.Context, opts ...option.Option) error {
	logger.Info(ctx, "begin to initiate new ai-box subserver")
	// apply options
	for _, opt := range opts {
		s.opts.Apply(opt)
	}

	// migrate tables for ai-box
	logger.Infof(ctx, "initiated new ai-box db name: %s", s.opts.DBName)
	rds, err := store.GetRDS(ctx, store.WithRDSDBName(s.opts.DBName))
	if err != nil {
		return err
	}
	if err = rds.AutoMigrate(&models.Provider{}); err != nil {
		return err
	}

	// Execute initialization SQL to insert default Ollama configuration
	if initSQL != "" {
		logger.Info(ctx, "executing ai-box initialization SQL")
		if err = rds.Exec(initSQL).Error; err != nil {
			logger.Warnf(ctx, "failed to execute init SQL (this may be expected if data already exists): %v", err)
			// Don't return error as this might be expected if data already exists
		} else {
			logger.Info(ctx, "ai-box initialization SQL executed successfully")
		}
	}

	s.status = server.StatusStarting

	logger.Info(ctx, "end to initiate new ai-box subserver")
	return nil
}

func (s *aiBoxSubServer) Start(ctx context.Context, opts ...option.Option) error {
	// No standalone server to start; mark as running
	s.status = server.StatusRunning
	return nil
}

func (s *aiBoxSubServer) Stop(ctx context.Context) error {
	s.status = server.StatusStopped
	return nil
}

func (s *aiBoxSubServer) Status() server.Status {
	return s.status
}

// Name returns the subserver identifier
func (s *aiBoxSubServer) Name() string {
	return "ai-box"
}

// Type returns the subserver type (HTTP in this case)
func (s *aiBoxSubServer) Type() server.SubserverType {
	return server.SubserverTypeHTTP
}

// Address returns the listening addresses
func (s *aiBoxSubServer) Address() server.SubserverAddress {
	return server.SubserverAddress{
		Address: s.addrs,
	}
}

// Handlers defines the upload, list, and get endpoints
func (s *aiBoxSubServer) Handlers() []server.Handler {
	return []server.Handler{
		server.NewHandler(
			aiBoxURL{name: "ai-box-create", path: "/ai-box/provider/new"},
			s.handleNewProvider,
			server.WithMethod(server.POST),
		),
		server.NewHandler(
			aiBoxURL{name: "ai-box-update", path: "/ai-box/provider/update"},
			s.handleUpdateProvider,
			server.WithMethod(server.POST),
		),
		server.NewHandler(
			aiBoxURL{name: "ai-box-delete", path: "/ai-box/provider/delete"},
			s.handleDeleteProvider,
			server.WithMethod(server.POST),
		),
		server.NewHandler(
			aiBoxURL{name: "ai-box-get", path: "/ai-box/provider/get"},
			s.handleGetProvider,
			server.WithMethod(server.GET),
		),
		server.NewHandler(
			aiBoxURL{name: "ai-box-list", path: "/ai-box/providers"},
			s.handleListProviders,
			server.WithMethod(server.GET),
		),
		server.NewHandler(
			aiBoxURL{name: "ai-box-test", path: "/ai-box/provider/test"},
			s.handleTestProvider,
			server.WithMethod(server.POST),
		),
	}
}

// NewAIBoxSubServer creates a new AI-Box subserver
func NewAIBoxSubServer(opts ...option.Option) server.Subserver {
	return &aiBoxSubServer{
		opts:   option.GetOptions(opts...).Ctx().Value(serverOptionsKey{}).(*Options),
		addrs:  []string{},
		status: server.StatusStopped,
	}
}

// local request types
type serviceRequestCreateProvider struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Logo        string `json:"logo"`
}
type serviceRequestUpdateProvider struct {
	Id          string  `json:"id"`
	DisplayName *string `json:"display_name"`
	Description *string `json:"description"`
	Logo        *string `json:"logo"`
	Enabled     *bool   `json:"enabled"`
}

func (r serviceRequestCreateProvider) ToProto() *aiboxpb.CreateProviderRequest {
	return &aiboxpb.CreateProviderRequest{Name: r.Name, Description: r.Description, Logo: r.Logo}
}
func (r serviceRequestUpdateProvider) ToProto() *aiboxpb.UpdateProviderRequest {
	return &aiboxpb.UpdateProviderRequest{Id: r.Id, DisplayName: r.DisplayName, Description: r.Description, Logo: r.Logo, Enabled: r.Enabled}
}

// helpers
func parseInt32(b []byte) (int32, bool) {
	var n int64
	for _, c := range b {
		if c < '0' || c > '9' {
			return 0, false
		}
		n = n*10 + int64(c-'0')
	}
	if n > int64(1<<31-1) {
		return 0, false
	}
	return int32(n), true
}
