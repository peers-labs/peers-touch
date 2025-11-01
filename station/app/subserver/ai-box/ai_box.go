package aibox

import (
	"context"
	"fmt"

	"github.com/peers-touch/peers-touch/station/frame/core/logger"
	"github.com/peers-touch/peers-touch/station/frame/core/option"
	"github.com/peers-touch/peers-touch/station/frame/core/server"
	"github.com/peers-touch/peers-touch/station/frame/core/store"
)

type AIBoxSubServer struct {
	status  server.Status
	store   store.Store
	service *Service
	handler *Handler
}

func NewAIBoxSubServer(opts ...option.Option) server.Subserver {
	return &AIBoxSubServer{
		status: server.StatusStopped,
	}
}

func (s *AIBoxSubServer) Name() string {
	return "ai-box"
}

func (s *AIBoxSubServer) Type() server.SubserverType {
	return server.SubserverTypeHTTP
}

type AIBoxRouterURL struct {
	name string
	path string
}

func (a AIBoxRouterURL) SubPath() string {
	return a.path
}

func (a AIBoxRouterURL) Name() string {
	return a.name
}

func (s *AIBoxSubServer) Handlers() []server.Handler {
	return []server.Handler{
		// Health check
		server.NewHandler(
			AIBoxRouterURL{name: "health", path: "/health"},
			s.handler.HandleHealth,
			server.WithMethod(server.GET),
		),

		// Agent management
		server.NewHandler(
			AIBoxRouterURL{name: "create-agent", path: "/agents"},
			s.handler.HandleCreateAgent,
			server.WithMethod(server.POST),
		),
		server.NewHandler(
			AIBoxRouterURL{name: "list-agents", path: "/agents"},
			s.handler.HandleListAgents,
			server.WithMethod(server.GET),
		),
		server.NewHandler(
			AIBoxRouterURL{name: "get-agent", path: "/agents/:agent_id"},
			s.handler.HandleGetAgent,
			server.WithMethod(server.GET),
		),
		server.NewHandler(
			AIBoxRouterURL{name: "create-agent-config", path: "/agents/:agent_id/configuration"},
			s.handler.HandleCreateAgentConfiguration,
			server.WithMethod(server.POST),
		),
		server.NewHandler(
			AIBoxRouterURL{name: "get-agent-config", path: "/agents/:agent_id/configuration"},
			s.handler.HandleGetAgentConfiguration,
			server.WithMethod(server.GET),
		),

		// Conversation management
		server.NewHandler(
			AIBoxRouterURL{name: "create-conversation", path: "/conversations"},
			s.handler.HandleCreateConversation,
			server.WithMethod(server.POST),
		),
		server.NewHandler(
			AIBoxRouterURL{name: "list-conversations", path: "/agents/:agent_id/conversations"},
			s.handler.HandleListConversations,
			server.WithMethod(server.GET),
		),

		// Chat
		server.NewHandler(
			AIBoxRouterURL{name: "chat", path: "/chat"},
			s.handler.HandleChat,
			server.WithMethod(server.POST),
		),

		// Providers
		server.NewHandler(
			AIBoxRouterURL{name: "providers", path: "/providers"},
			s.handler.HandleProviders,
			server.WithMethod(server.GET),
		),
		server.NewHandler(
			AIBoxRouterURL{name: "provider-infos", path: "/providers/info"},
			s.handler.HandleListProviderInfos,
			server.WithMethod(server.GET),
		),
		server.NewHandler(
			AIBoxRouterURL{name: "provider-info", path: "/providers/:provider_name"},
			s.handler.HandleProviderInfo,
			server.WithMethod(server.GET),
		),
		server.NewHandler(
			AIBoxRouterURL{name: "update-provider-config", path: "/providers/:provider_name/config"},
			s.handler.HandleUpdateProviderConfig,
			server.WithMethod(server.PUT),
		),
		server.NewHandler(
			AIBoxRouterURL{name: "set-provider-enabled", path: "/providers/:provider_name/enabled"},
			s.handler.HandleSetProviderEnabled,
			server.WithMethod(server.PUT),
		),
		server.NewHandler(
			AIBoxRouterURL{name: "test-provider", path: "/providers/:provider_name/test"},
			s.handler.HandleTestProviderConnection,
			server.WithMethod(server.POST),
		),

		// Knowledge Base Management
		server.NewHandler(
			AIBoxRouterURL{name: "create-knowledge-base", path: "/knowledge-bases"},
			s.handler.HandleCreateKnowledgeBase,
			server.WithMethod(server.POST),
		),
		server.NewHandler(
			AIBoxRouterURL{name: "list-knowledge-bases", path: "/knowledge-bases"},
			s.handler.HandleListKnowledgeBases,
			server.WithMethod(server.GET),
		),
		server.NewHandler(
			AIBoxRouterURL{name: "associate-kb", path: "/agents/:agent_id/knowledge-bases"},
			s.handler.HandleAssociateAgentKnowledgeBase,
			server.WithMethod(server.POST),
		),
		server.NewHandler(
			AIBoxRouterURL{name: "get-agent-kbs", path: "/agents/:agent_id/knowledge-bases"},
			s.handler.HandleGetAgentKnowledgeBases,
			server.WithMethod(server.GET),
		),
	}
}

// Legacy handlers removed for MVP

func (s *AIBoxSubServer) Address() server.SubserverAddress {
	return server.SubserverAddress{}
}

func (s *AIBoxSubServer) Init(ctx context.Context, opts ...option.Option) error {
	// Get store from context
	st, err := store.GetStore(ctx)
	if err != nil {
		return fmt.Errorf("failed to get store: %w", err)
	}
	s.store = st

	// Initialize service
	s.service = NewService(s.store)
	if err := s.service.Initialize(ctx); err != nil {
		return fmt.Errorf("failed to initialize AI box service: %w", err)
	}

	// Initialize handler
	s.handler = NewHandler(s.service)

	logger.Logf(logger.InfoLevel, "AI box subserver initialized successfully")
	return nil
}

func (s *AIBoxSubServer) Start(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusRunning
	if s.service != nil && s.handler != nil {
		// Service is already initialized in Init
		return nil
	}
	return fmt.Errorf("service not initialized")
}

func (s *AIBoxSubServer) Stop(ctx context.Context) error {
	s.status = server.StatusStopped
	return nil
}

func (s *AIBoxSubServer) Status() server.Status {
	return s.status
}
