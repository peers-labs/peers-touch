// Changelog:
// 2026-04-11 — Phase 3 integration: wired all service dependencies into
//   TurnHandlers via Handlers() factory. Services instantiated:
//   MemoryService, SkillService, SkillsGuardService, ErrorClassifierService,
//   PromptAssemblyService, CompressionService, PromptCachingService,
//   ProviderService, CredentialPoolService, ContextReferenceService,
//   DelegationService, TurnService.
// 2026-04-11 — Phase 4: added ToolRegistryService with memory/skill tool
//   handlers wired into TurnService for central tool dispatch.
// 2026-04-11 — Phase 5: wired MemoryHandlers(memorySvc) and SkillHandlers(skillSvc)
//   to replace 501 stubs with real service-backed handler implementations.
// 2026-04-11 — Phase 6: added ReviewService for background review. Wired into
//   TurnService constructor so Step 9 nudge evaluation delegates to ReviewService.
// 2026-04-11 — Phase 7: added GrowthMetricsService and GrowthHandlers exposing
//   11 REST endpoints for the Growth Supervision Dashboard (snapshot, audit log,
//   feedback, feedback history, memory rollback/snapshots/delete/freeze,
//   skill rollback/versions/toggle). GrowthMetricsService now injected into
//   MemoryService, SkillService, ReviewService, and TurnService for event recording.

package agent

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/handler"
	agentEvent "github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
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
	s.status = server.StatusStarting

	logger.Info(ctx, "end to initiate new agent subserver")
	return nil
}

func (s *agentSubServer) Start(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusRunning
	return nil
}

func (s *agentSubServer) Stop(ctx context.Context) error {
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
	eventBus := agentEvent.NewMemoryEventBus()

	// Phase 7: Growth Metrics — must be created early since MemoryService,
	// SkillService, ReviewService, and TurnService depend on it for event recording.
	growthMetricsSvc := service.NewGrowthMetricsService()
	diagnosticSvc := service.NewGrowthDiagnosticService()
	growthMetricsSvc.SetDiagnosticService(diagnosticSvc)

	// Phase 2 services.
	agentSvc := service.NewAgentService()
	memorySvc := service.NewMemoryService(growthMetricsSvc, memoryServiceOptionsFromConfig()...)
	skillsGuardSvc := service.NewSkillsGuardService()
	skillSvc := service.NewSkillService(skillsGuardSvc, growthMetricsSvc)
	errorClassifierSvc := service.NewErrorClassifierService()
	promptAssemblySvc := service.NewPromptAssemblyService(memorySvc, skillSvc)
	compressionSvc := service.NewCompressionService()

	// Phase 3 services.
	promptCachingSvc := service.NewPromptCachingService()
	providerSvc := service.NewProviderService(promptCachingSvc)
	credentialPoolSvc := service.NewCredentialPoolService()
	contextReferenceSvc := service.NewContextReferenceService()
	delegationSvc := service.NewDelegationService()

	// Phase 4: Tool Registry — central dispatch for memory, skills, delegation.
	toolRegistrySvc := service.NewToolRegistryService(memorySvc, skillSvc)

	// Session Search — cross-session learning via keyword search.
	sessionSearchSvc := service.NewSessionSearchService()
	service.RegisterSessionSearchTool(toolRegistrySvc, sessionSearchSvc)

	// Phase 6: Background Review — self-review with LLM after turn completion.
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
	turnSvc.SetEventBus(eventBus)

	// Dogfood self-verification service.
	dogfoodSvc := service.NewDogfoodService(memorySvc, skillSvc, growthMetricsSvc)

	// Scheduler — autonomous learning: periodic SILENT reviews + dogfood runs.
	schedulerSvc := service.NewSchedulerService(reviewSvc, dogfoodSvc, memorySvc, growthMetricsSvc)
	orchestrationSvc := service.NewOrchestrationService(agentSvc, turnSvc, toolRegistrySvc)
	orchestrationSvc.SetEventBus(eventBus)
	eventStreamSvc := service.NewEventStreamService(eventBus)

	agentHandlers := handler.NewAgentHandlers(agentSvc)
	turnHandlers := handler.NewTurnHandlers(turnSvc, toolRegistrySvc)
	memoryHandlers := handler.NewMemoryHandlers(memorySvc)
	skillHandlers := handler.NewSkillHandlers(skillSvc)
	dogfoodHandlers := handler.NewDogfoodHandlers(dogfoodSvc)
	schedulerHandlers := handler.NewSchedulerHandlers(schedulerSvc)
	orchestrationHandlers := handler.NewOrchestrationHandlers(orchestrationSvc)
	eventStreamHandlers := handler.NewEventStreamHandlers(eventStreamSvc)

	growthHandlers := handler.NewGrowthHandlers(growthMetricsSvc, memorySvc, skillSvc, diagnosticSvc)

	return []server.Handler{
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

		server.NewTypedHandler("agent-collaboration-create", "/agent/collaboration/create", server.POST, orchestrationHandlers.HandleCreateCollaborationTask, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-collaboration-get", "/agent/collaboration/get", server.POST, orchestrationHandlers.HandleGetCollaborationTask, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-collaboration-list", "/agent/collaboration/list", server.POST, orchestrationHandlers.HandleListCollaborationTasks, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-collaboration-cancel", "/agent/collaboration/cancel", server.POST, orchestrationHandlers.HandleCancelCollaborationTask, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("agent-events-subscribe", "/agent/events/subscribe", server.POST, eventStreamHandlers.HandleSubscribe, logIDWrapper, jwtWrapper),

		// POST: protobuf body carries ListMemoriesRequest (GET + empty body leaves agent_id unset).
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

		// Growth Dashboard endpoints.
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

		// Dogfood self-verification endpoint.
		server.NewTypedHandler("agent-dogfood-run", "/agent/dogfood/run", server.POST, dogfoodHandlers.HandleRunDogfood, logIDWrapper, jwtWrapper),

		// Scheduler — autonomous learning control.
		server.NewTypedHandler("agent-scheduler-start", "/agent/scheduler/start", server.POST, schedulerHandlers.HandleStart, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-scheduler-stop", "/agent/scheduler/stop", server.POST, schedulerHandlers.HandleStop, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-scheduler-status", "/agent/scheduler/status", server.GET, schedulerHandlers.HandleStatus, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-scheduler-add-job", "/agent/scheduler/add-job", server.POST, schedulerHandlers.HandleAddJob, logIDWrapper, jwtWrapper),
	}
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
