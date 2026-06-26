package agent

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/handler"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

var _ server.Subserver = (*agentSubServer)(nil)

type agentSubServer struct {
	opts       *Options
	addrs      []string
	status     server.Status
	jwtWrapper server.Wrapper
	eventBus   domain.EventBus
	modules    []AgentModule
}

func (s *agentSubServer) Init(ctx context.Context, opts ...option.Option) error {
	logger.Info(ctx, "begin to initiate new agent subserver")
	for _, opt := range opts {
		s.opts.Apply(opt)
	}

	logger.Infof(ctx, "initiated new agent db name: %s", s.opts.DBName)
	rds, err := store.GetRDS(ctx, store.WithRDSDBName(s.opts.DBName))
	if err != nil {
		return err
	}
	if err = rds.AutoMigrate(persistence.AllModels()...); err != nil {
		return err
	}

	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.jwtWrapper = server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))

	s.eventBus = event.NewMemoryEventBus()

	s.status = server.StatusStarting
	logger.Info(ctx, "end to initiate new agent subserver")
	return nil
}

func (s *agentSubServer) Start(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusRunning

	for _, module := range s.modules {
		if err := module.Start(ctx); err != nil {
			return err
		}
	}

	return nil
}

func (s *agentSubServer) Stop(ctx context.Context) error {
	for _, module := range s.modules {
		if err := module.Stop(ctx); err != nil {
			return err
		}
	}

	s.status = server.StatusStopped
	return nil
}

func (s *agentSubServer) Status() server.Status { return s.status }

func (s *agentSubServer) Name() string { return "agent" }

func (s *agentSubServer) Type() server.SubserverType { return server.SubserverTypeHTTP }

func (s *agentSubServer) Address() server.SubserverAddress {
	return server.SubserverAddress{Address: s.addrs}
}

func (s *agentSubServer) Handlers() []server.Handler {
	logIDWrapper := serverwrapper.LogID()
	jwtWrapper := s.jwtWrapper

	growthMetricsSvc := service.NewGrowthMetricsService()
	diagnosticSvc := service.NewGrowthDiagnosticService()
	growthMetricsSvc.SetDiagnosticService(diagnosticSvc)

	agentSvc := service.NewAgentService()
	memorySvc := service.NewMemoryService(growthMetricsSvc, memoryServiceOptionsFromConfig()...)
	skillsGuardSvc := service.NewSkillsGuardService()
	skillSvc := service.NewSkillService(skillsGuardSvc, growthMetricsSvc)
	errorClassifierSvc := service.NewErrorClassifierService()
	promptAssemblySvc := service.NewPromptAssemblyService(memorySvc, skillSvc)
	compressionSvc := service.NewCompressionService()

	promptCachingSvc := service.NewPromptCachingService()
	providerSvc := service.NewProviderService(promptCachingSvc)
	credentialPoolSvc := service.NewCredentialPoolService()
	contextReferenceSvc := service.NewContextReferenceService()
	delegationSvc := service.NewDelegationService()

	toolRegistrySvc := service.NewToolRegistryService(memorySvc, skillSvc)

	sessionSearchSvc := service.NewSessionSearchService()
	service.RegisterSessionSearchTool(toolRegistrySvc, sessionSearchSvc)

	reviewSvc := service.NewReviewService(
		credentialPoolSvc,
		errorClassifierSvc,
		providerSvc,
		memorySvc,
		skillSvc,
		toolRegistrySvc,
		growthMetricsSvc,
	)

	turnSvc := service.NewTurnService(
		errorClassifierSvc,
		memorySvc,
		skillSvc,
		promptAssemblySvc,
		compressionSvc,
		providerSvc,
		credentialPoolSvc,
		contextReferenceSvc,
		delegationSvc,
		toolRegistrySvc,
		reviewSvc,
		growthMetricsSvc,
	)
	turnSvc.SetEventBus(s.eventBus)

	eventStreamSvc := service.NewEventStreamService(s.eventBus)

	dogfoodSvc := service.NewDogfoodService(memorySvc, skillSvc, growthMetricsSvc)
	schedulerSvc := service.NewSchedulerService(reviewSvc, dogfoodSvc, memorySvc, growthMetricsSvc)

	agentHandlers := handler.NewAgentHandlers(agentSvc)
	turnHandlers := handler.NewTurnHandlers(turnSvc, toolRegistrySvc)
	memoryHandlers := handler.NewMemoryHandlers(memorySvc)
	skillHandlers := handler.NewSkillHandlers(skillSvc)
	dogfoodHandlers := handler.NewDogfoodHandlers(dogfoodSvc)
	schedulerHandlers := handler.NewSchedulerHandlers(schedulerSvc)
	growthHandlers := handler.NewGrowthHandlers(growthMetricsSvc, memorySvc, skillSvc, diagnosticSvc)
	workspaceSvc := service.NewWorkspaceService()
	workspaceHandlers := handler.NewWorkspaceHandlers(workspaceSvc)
	workspaceOSSHandlers := handler.NewWorkspaceOSSHandlers(service.NewWorkspaceOSSService(storage.NewLocalBackend("./storage")))
	configHandlers := handler.NewAgentConfigHandlers(service.NewAgentConfigService())
	eventStreamHandlers := handler.NewEventStreamHandlers(eventStreamSvc)
	offlineQueueHandlers := handler.NewOfflineQueueHandlers(service.NewOfflineQueueService())

	handlers := []server.Handler{
		server.NewTypedHandler("agent-list", "/agent/list", server.POST, agentHandlers.HandleListAgents, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-get", "/agent/get", server.POST, agentHandlers.HandleGetAgent, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-create", "/agent/create", server.POST, agentHandlers.HandleCreateAgent, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-update", "/agent/update", server.POST, agentHandlers.HandleUpdateAgent, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-delete", "/agent/delete", server.POST, agentHandlers.HandleDeleteAgent, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("agent-turn-execute", "/agent/turn/execute", server.POST, turnHandlers.HandleExecuteTurn, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("agent-turn-stream", "/agent/turn/stream", server.POST, turnHandlers.HandleExecuteTurnStream, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("agent-turn-local-tool-result", "/agent/turn/local-tool-result", server.POST, turnHandlers.HandleLocalToolResult, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-turn-trace-list", "/agent/turn/trace/list", server.POST, turnHandlers.HandleListTurnTraces, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-turn-trace-get", "/agent/turn/trace/get", server.POST, turnHandlers.HandleGetTurnTrace, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("agent-memory-list", "/agent/memory/list", server.POST, memoryHandlers.HandleListMemories, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-memory-get", "/agent/memory/get", server.POST, memoryHandlers.HandleGetMemory, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-memory-delete", "/agent/memory/delete", server.POST, memoryHandlers.HandleDeleteMemory, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-memory-search", "/agent/memory/search", server.POST, memoryHandlers.HandleSearchMemories, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-memory-persona", "/agent/memory/persona", server.POST, memoryHandlers.HandleGetPersona, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-memory-stats", "/agent/memory/stats", server.POST, memoryHandlers.HandleGetStats, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-memory-events", "/agent/memory/events", server.POST, memoryHandlers.HandleListEvents, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-memory-export", "/agent/memory/export", server.POST, memoryHandlers.HandleExport, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-memory-import", "/agent/memory/import", server.POST, memoryHandlers.HandleImport, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-memory-embedding-status", "/agent/memory/embedding-status", server.POST, memoryHandlers.HandleEmbeddingStatus, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-memory-reembed", "/agent/memory/reembed", server.POST, memoryHandlers.HandleReEmbed, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-memory-feedback", "/agent/memory/feedback", server.POST, memoryHandlers.HandleFeedback, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-memory-snapshot", "/agent/memory/snapshot", server.GET, memoryHandlers.HandleGetSnapshot, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("agent-skill-list", "/agent/skill/list", server.POST, skillHandlers.HandleListSkills, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-skill-get", "/agent/skill/get", server.GET, skillHandlers.HandleGetSkill, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-skill-install", "/agent/skill/install", server.POST, skillHandlers.HandleInstallSkill, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-skill-update", "/agent/skill/update", server.POST, skillHandlers.HandleUpdateSkill, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-skill-delete", "/agent/skill/delete", server.POST, skillHandlers.HandleDeleteSkill, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("agent-growth-snapshot", "/agent/growth/snapshot", server.POST, growthHandlers.HandleGetGrowthSnapshot, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-growth-audit", "/agent/growth/audit", server.GET, growthHandlers.HandleGetAuditLog, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-growth-feedback", "/agent/growth/feedback", server.POST, growthHandlers.HandleRecordFeedback, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-growth-memory-rollback", "/agent/growth/memory/rollback", server.POST, growthHandlers.HandleMemoryRollback, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-growth-memory-snapshots", "/agent/growth/memory/snapshots", server.GET, growthHandlers.HandleListMemorySnapshots, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-growth-memory-delete", "/agent/growth/memory/delete", server.POST, growthHandlers.HandleDeleteMemory, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-growth-memory-freeze", "/agent/growth/memory/freeze", server.POST, growthHandlers.HandleFreezeMemory, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-growth-skill-rollback", "/agent/growth/skill/rollback", server.POST, growthHandlers.HandleSkillRollback, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-growth-skill-versions", "/agent/growth/skill/versions", server.GET, growthHandlers.HandleListSkillVersions, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-growth-skill-toggle", "/agent/growth/skill/toggle", server.POST, growthHandlers.HandleToggleSkill, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-growth-feedback-history", "/agent/growth/feedback/history", server.GET, growthHandlers.HandleGetFeedbackHistory, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-growth-diagnostic", "/agent/growth/diagnostic", server.GET, growthHandlers.HandleGetDiagnostic, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-growth-diagnostic-clear", "/agent/growth/diagnostic/clear", server.POST, growthHandlers.HandleClearSuspectedItem, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("agent-dogfood-run", "/agent/dogfood/run", server.POST, dogfoodHandlers.HandleRunDogfood, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("agent-scheduler-start", "/agent/scheduler/start", server.POST, schedulerHandlers.HandleStart, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-scheduler-stop", "/agent/scheduler/stop", server.POST, schedulerHandlers.HandleStop, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-scheduler-status", "/agent/scheduler/status", server.GET, schedulerHandlers.HandleStatus, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-scheduler-add-job", "/agent/scheduler/add-job", server.POST, schedulerHandlers.HandleAddJob, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("agent-workspace-create", "/agent/workspace/create", server.POST, workspaceHandlers.HandleCreateWorkspace, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-workspace-get", "/agent/workspace/get", server.POST, workspaceHandlers.HandleGetWorkspace, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-workspace-list", "/agent/workspace/list", server.POST, workspaceHandlers.HandleListWorkspaces, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-workspace-update", "/agent/workspace/update", server.POST, workspaceHandlers.HandleUpdateWorkspace, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-workspace-delete", "/agent/workspace/delete", server.POST, workspaceHandlers.HandleDeleteWorkspace, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-workspace-files", "/agent/workspace/files", server.POST, workspaceHandlers.HandleListFiles, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-workspace-diff", "/agent/workspace/diff", server.POST, workspaceHandlers.HandleGetFileDiff, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-workspace-commit", "/agent/workspace/commit", server.POST, workspaceHandlers.HandleCommitChanges, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-workspace-delete-files", "/agent/workspace/delete-files", server.POST, workspaceHandlers.HandleDeleteFiles, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("agent-workspace-upload-url", "/agent/workspace/upload-url", server.POST, workspaceOSSHandlers.HandleGetUploadPresignedURL, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-workspace-download-url", "/agent/workspace/download-url", server.POST, workspaceOSSHandlers.HandleGetDownloadPresignedURL, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("agent-config-chat-get", "/agent/config/chat/get", server.POST, configHandlers.HandleGetChatConfig, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-config-chat-update", "/agent/config/chat/update", server.POST, configHandlers.HandleUpdateChatConfig, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("agent-config-model-get", "/agent/config/model/get", server.POST, configHandlers.HandleGetModelParams, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-config-model-update", "/agent/config/model/update", server.POST, configHandlers.HandleUpdateModelParams, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("agent-config-knowledge-list", "/agent/config/knowledge/list", server.POST, configHandlers.HandleListKnowledgeBindings, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-config-knowledge-create", "/agent/config/knowledge/create", server.POST, configHandlers.HandleCreateKnowledgeBinding, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-config-knowledge-update", "/agent/config/knowledge/update", server.POST, configHandlers.HandleUpdateKnowledgeBinding, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-config-knowledge-delete", "/agent/config/knowledge/delete", server.POST, configHandlers.HandleDeleteKnowledgeBinding, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("agent-config-skill-list", "/agent/config/skill/list", server.POST, configHandlers.HandleListSkillBindings, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-config-skill-create", "/agent/config/skill/create", server.POST, configHandlers.HandleCreateSkillBinding, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-config-skill-update", "/agent/config/skill/update", server.POST, configHandlers.HandleUpdateSkillBinding, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-config-skill-delete", "/agent/config/skill/delete", server.POST, configHandlers.HandleDeleteSkillBinding, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("agent-config-mcp-list", "/agent/config/mcp/list", server.POST, configHandlers.HandleListMcpBindings, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-config-mcp-create", "/agent/config/mcp/create", server.POST, configHandlers.HandleCreateMcpBinding, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-config-mcp-update", "/agent/config/mcp/update", server.POST, configHandlers.HandleUpdateMcpBinding, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-config-mcp-delete", "/agent/config/mcp/delete", server.POST, configHandlers.HandleDeleteMcpBinding, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("agent-config-voice-get", "/agent/config/voice/get", server.POST, configHandlers.HandleGetVoiceConfig, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-config-voice-update", "/agent/config/voice/update", server.POST, configHandlers.HandleUpdateVoiceConfig, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("agent-config-tool-profile-get", "/agent/config/tool-profile/get", server.POST, configHandlers.HandleGetToolProfile, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-config-tool-profile-update", "/agent/config/tool-profile/update", server.POST, configHandlers.HandleUpdateToolProfile, logIDWrapper, jwtWrapper),

		server.NewHTTPHandler("agent-events-subscribe", "/agent/events/subscribe", server.POST, eventStreamHandlers.HandleSubscribe, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("agent-offline-enqueue", "/agent/offline/enqueue", server.POST, offlineQueueHandlers.HandleEnqueue, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-offline-list-pending", "/agent/offline/list-pending", server.POST, offlineQueueHandlers.HandleListPending, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-offline-get", "/agent/offline/get", server.POST, offlineQueueHandlers.HandleGetOperation, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-offline-ack", "/agent/offline/ack", server.POST, offlineQueueHandlers.HandleAckOperation, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-offline-sync", "/agent/offline/sync", server.POST, offlineQueueHandlers.HandleSync, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-offline-resolve-conflict", "/agent/offline/resolve-conflict", server.POST, offlineQueueHandlers.HandleResolveConflict, logIDWrapper, jwtWrapper),
	}

	for _, module := range s.modules {
		handlers = append(handlers, module.Handlers()...)
	}

	return handlers
}

func (s *agentSubServer) RegisterModule(module AgentModule) {
	s.modules = append(s.modules, module)
}

func memoryServiceOptionsFromConfig() []service.MemoryServiceOption {
	embedding := agentOptions.Peers.Node.Server.Subserver.Agent.Memory.Embedding
	if embedding.ProviderID == "" {
		return nil
	}
	return []service.MemoryServiceOption{
		service.WithMemoryEmbeddingProvider(
			service.NewProviderMemoryEmbeddingProvider(
				embedding.ProviderID,
				embedding.Model,
				embedding.Dimensions,
			),
		),
	}
}

func NewAgentSubServer(opts ...option.Option) server.Subserver {
	return &agentSubServer{
		opts:   option.GetOptions(opts...).Ctx().Value(serverOptionsKey{}).(*Options),
		addrs:  []string{},
		status: server.StatusStopped,
	}
}
