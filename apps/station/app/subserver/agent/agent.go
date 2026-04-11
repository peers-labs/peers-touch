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

	// Phase 7: Growth Metrics — must be created early since MemoryService,
	// SkillService, ReviewService, and TurnService depend on it for event recording.
	growthMetricsSvc := service.NewGrowthMetricsService()
	diagnosticSvc := service.NewGrowthDiagnosticService()
	growthMetricsSvc.SetDiagnosticService(diagnosticSvc)

	// Phase 2 services.
	memorySvc := service.NewMemoryService(growthMetricsSvc)
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

	// Dogfood self-verification service.
	dogfoodSvc := service.NewDogfoodService(memorySvc, skillSvc, growthMetricsSvc)

	// Scheduler — autonomous learning: periodic SILENT reviews + dogfood runs.
	schedulerSvc := service.NewSchedulerService(reviewSvc, dogfoodSvc, memorySvc, growthMetricsSvc)

	turnHandlers := handler.NewTurnHandlers(turnSvc, toolRegistrySvc)
	memoryHandlers := handler.NewMemoryHandlers(memorySvc)
	skillHandlers := handler.NewSkillHandlers(skillSvc)
	dogfoodHandlers := handler.NewDogfoodHandlers(dogfoodSvc)
	schedulerHandlers := handler.NewSchedulerHandlers(schedulerSvc)

	growthHandlers := handler.NewGrowthHandlers(growthMetricsSvc, memorySvc, skillSvc, diagnosticSvc)

	return []server.Handler{
		server.NewTypedHandler("agent-turn-execute", "/agent/turn/execute", server.POST, turnHandlers.HandleExecuteTurn, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("agent-memory-list", "/agent/memory/list", server.GET, memoryHandlers.HandleListMemories, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-memory-snapshot", "/agent/memory/snapshot", server.GET, memoryHandlers.HandleGetSnapshot, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("agent-skill-list", "/agent/skill/list", server.GET, skillHandlers.HandleListSkills, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-skill-get", "/agent/skill/get", server.GET, skillHandlers.HandleGetSkill, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-skill-install", "/agent/skill/install", server.POST, skillHandlers.HandleInstallSkill, logIDWrapper, jwtWrapper),

		// Growth Dashboard endpoints.
		server.NewTypedHandler("agent-growth-snapshot", "/agent/growth/snapshot", server.GET, growthHandlers.HandleGetGrowthSnapshot, logIDWrapper, jwtWrapper),
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

func NewAgentSubServer(opts ...option.Option) server.Subserver {
	return &agentSubServer{
		opts:   option.GetOptions(opts...).Ctx().Value(serverOptionsKey{}).(*Options),
		addrs:  []string{},
		status: server.StatusStopped,
	}
}
