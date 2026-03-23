package aichat

import (
	"context"

	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/ai_chat/handler"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"

	models "github.com/peers-labs/peers-touch/station/app/subserver/ai_chat/db/model"
)

var (
	_ server.Subserver = (*aiChatSubServer)(nil)
)

type aiChatSubServer struct {
	opts *Options

	addrs      []string       // Populated from configuration
	status     server.Status  // Track server status
	jwtWrapper server.Wrapper // JWT authentication wrapper
}

func (s *aiChatSubServer) Init(ctx context.Context, opts ...option.Option) error {
	logger.Info(ctx, "begin to initiate new ai-chat subserver")
	// apply options
	for _, opt := range opts {
		s.opts.Apply(opt)
	}

	logger.Infof(ctx, "initiated new ai-chat db name: %s", s.opts.DBName)
	rds, err := store.GetRDS(ctx, store.WithRDSDBName(s.opts.DBName))
	if err != nil {
		return err
	}
	if err = rds.AutoMigrate(
		&models.User{},
		&models.Provider{},
		&models.Session{},
		&models.Topic{},
		&models.Message{},
		&models.Attachment{},
	); err != nil {
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

	logger.Info(ctx, "end to initiate new ai-chat subserver")
	return nil
}

func (s *aiChatSubServer) Start(ctx context.Context, opts ...option.Option) error {
	// No standalone server to start; mark as running
	s.status = server.StatusRunning
	return nil
}

func (s *aiChatSubServer) Stop(ctx context.Context) error {
	s.status = server.StatusStopped
	return nil
}

func (s *aiChatSubServer) Status() server.Status {
	return s.status
}

// Name returns the subserver identifier
func (s *aiChatSubServer) Name() string {
	return "ai-chat"
}

// Type returns the subserver type (HTTP in this case)
func (s *aiChatSubServer) Type() server.SubserverType {
	return server.SubserverTypeHTTP
}

// Address returns the listening addresses
func (s *aiChatSubServer) Address() server.SubserverAddress {
	return server.SubserverAddress{
		Address: s.addrs,
	}
}

// Handlers defines the API endpoints
func (s *aiChatSubServer) Handlers() []server.Handler {
	logIDWrapper := serverwrapper.LogID()
	jwtWrapper := s.jwtWrapper
	providerHandlers := handler.NewProviderHandlers()
	sessionHandlers := handler.NewSessionHandlers()
	messageHandlers := handler.NewMessageHandlers()
	chatHandlers := handler.NewChatHandlers()

	return []server.Handler{
		server.NewTypedHandler(
			"aichat-provider-create",
			"/ai-chat/provider/new",
			server.POST,
			providerHandlers.HandleCreateProvider,
			logIDWrapper,
			jwtWrapper,
		),
		server.NewTypedHandler(
			"aichat-provider-update",
			"/ai-chat/provider/update",
			server.POST,
			providerHandlers.HandleUpdateProvider,
			logIDWrapper,
			jwtWrapper,
		),
		server.NewTypedHandler(
			"aichat-provider-delete",
			"/ai-chat/provider/delete",
			server.POST,
			providerHandlers.HandleDeleteProvider,
			logIDWrapper,
			jwtWrapper,
		),
		server.NewTypedHandler(
			"aichat-provider-get",
			"/ai-chat/provider/get",
			server.GET,
			providerHandlers.HandleGetProvider,
			logIDWrapper,
			jwtWrapper,
		),
		server.NewTypedHandler(
			"aichat-provider-list",
			"/ai-chat/providers",
			server.GET,
			providerHandlers.HandleListProviders,
			logIDWrapper,
			jwtWrapper,
		),
		server.NewTypedHandler(
			"aichat-provider-test",
			"/ai-chat/provider/test",
			server.POST,
			providerHandlers.HandleTestProvider,
			logIDWrapper,
			jwtWrapper,
		),
		server.NewTypedHandler(
			"aichat-session-create",
			"/ai-chat/session/new",
			server.POST,
			sessionHandlers.HandleCreateSession,
			logIDWrapper,
			jwtWrapper,
		),
		server.NewTypedHandler(
			"aichat-session-list",
			"/ai-chat/sessions",
			server.GET,
			sessionHandlers.HandleListSessions,
			logIDWrapper,
			jwtWrapper,
		),
		server.NewTypedHandler(
			"aichat-session-get",
			"/ai-chat/session/get",
			server.GET,
			sessionHandlers.HandleGetSession,
			logIDWrapper,
			jwtWrapper,
		),
		server.NewTypedHandler(
			"aichat-session-update",
			"/ai-chat/session/update",
			server.POST,
			sessionHandlers.HandleUpdateSession,
			logIDWrapper,
			jwtWrapper,
		),
		server.NewTypedHandler(
			"aichat-session-delete",
			"/ai-chat/session/delete",
			server.POST,
			sessionHandlers.HandleDeleteSession,
			logIDWrapper,
			jwtWrapper,
		),
		server.NewTypedHandler(
			"aichat-message-list",
			"/ai-chat/messages",
			server.GET,
			messageHandlers.HandleListMessages,
			logIDWrapper,
			jwtWrapper,
		),
		server.NewTypedHandler(
			"aichat-message-get",
			"/ai-chat/message/get",
			server.GET,
			messageHandlers.HandleGetMessage,
			logIDWrapper,
			jwtWrapper,
		),
		server.NewTypedHandler(
			"aichat-message-delete",
			"/ai-chat/message/delete",
			server.POST,
			messageHandlers.HandleDeleteMessage,
			logIDWrapper,
			jwtWrapper,
		),
		server.NewTypedHandler(
			"aichat-chat-completions",
			"/ai-chat/chat/completions",
			server.POST,
			chatHandlers.HandleCompletions,
			logIDWrapper,
			jwtWrapper,
		),
	}
}

func NewAIChatSubServer(opts ...option.Option) server.Subserver {
	return &aiChatSubServer{
		opts:   option.GetOptions(opts...).Ctx().Value(serverOptionsKey{}).(*Options),
		addrs:  []string{},
		status: server.StatusStopped,
	}
}

// initDefaultOllamaProvider creates the default Ollama provider if it doesn't exist
func (s *aiChatSubServer) initDefaultOllamaProvider(ctx context.Context, rds *gorm.DB) error {
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
