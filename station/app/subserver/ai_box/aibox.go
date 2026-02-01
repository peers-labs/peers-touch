package aibox

import (
	"context"

	"gorm.io/gorm"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"

	models "github.com/peers-labs/peers-touch/station/app/subserver/ai_box/db/model"
)

var (
	_ server.Subserver = (*aiBoxSubServer)(nil)
)

// aiBoxSubServer handles AI provider management
type aiBoxSubServer struct {
	opts *Options

	addrs      []string       // Populated from configuration
	status     server.Status  // Track server status
	jwtWrapper server.Wrapper // JWT authentication wrapper
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

	// Initialize default Ollama provider if not exists
	if err = s.initDefaultOllamaProvider(ctx, rds); err != nil {
		logger.Warnf(ctx, "failed to init default Ollama provider: %v", err)
		// Don't return error as this is optional
	}

	// Initialize JWT wrapper
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.jwtWrapper = server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))

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

// Handlers defines the API endpoints
func (s *aiBoxSubServer) Handlers() []server.Handler {
	logIDWrapper := serverwrapper.LogID()
	jwtWrapper := s.jwtWrapper

	return []server.Handler{
		// Provider management
		server.NewHTTPHandler("aibox-provider-create", "/ai-box/provider/new", server.POST, server.HTTPHandlerFunc(s.handleNewProvider), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("aibox-provider-update", "/ai-box/provider/update", server.POST, server.HTTPHandlerFunc(s.handleUpdateProvider), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("aibox-provider-delete", "/ai-box/provider/delete", server.POST, server.HTTPHandlerFunc(s.handleDeleteProvider), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("aibox-provider-get", "/ai-box/provider/get", server.GET, server.HTTPHandlerFunc(s.handleGetProvider), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("aibox-provider-list", "/ai-box/providers", server.GET, server.HTTPHandlerFunc(s.handleListProviders), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("aibox-provider-test", "/ai-box/provider/test", server.POST, server.HTTPHandlerFunc(s.handleTestProvider), logIDWrapper, jwtWrapper),
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

// initDefaultOllamaProvider creates the default Ollama provider if it doesn't exist
func (s *aiBoxSubServer) initDefaultOllamaProvider(ctx context.Context, rds *gorm.DB) error {
	// Check if default provider already exists
	var count int64
	if err := rds.Model(&models.Provider{}).Where("id = ? AND peers_user_id = ?", "ollama-default", "system").Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		logger.Debug(ctx, "default Ollama provider already exists, skipping")
		return nil
	}

	// Create default Ollama provider
	defaultProvider := &models.Provider{
		ID:          "ollama-default",
		Name:        "Ollama",
		PeersUserID: "system",
		Sort:        1,
		Enabled:     true,
		CheckModel:  "llama3.2:latest",
		Logo:        "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEyIDJMMTMuMDkgOC4yNkwyMCA5TDEzLjA5IDE1Ljc0TDEyIDIyTDEwLjkxIDE1Ljc0TDQgOUwxMC45MSA4LjI2TDEyIDJaIiBmaWxsPSIjRkY2QzAwIi8+Cjwvc3ZnPgo=",
		Description: "Ollama 是一个开源的本地 AI 模型运行平台，支持多种大语言模型的本地部署和推理。",
		KeyVaults:   "{}",
		SourceType:  "local",
		Settings:    []byte("{}"),
		Config:      []byte(`{"health_check":{"enabled":true,"interval":30,"endpoint":"/api/tags"},"auto_pull":{"enabled":false,"models":["llama3.2:latest"]},"performance":{"gpu_layers":-1,"num_ctx":8192,"num_predict":4096,"repeat_penalty":1.1,"top_k":40,"top_p":0.9},"ui":{"show_model_info":true,"show_performance_stats":true,"default_model":"llama3.2:latest"}}`),
	}

	if err := rds.Create(defaultProvider).Error; err != nil {
		return err
	}

	logger.Info(ctx, "default Ollama provider created successfully")
	return nil
}
