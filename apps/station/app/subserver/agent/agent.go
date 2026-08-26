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
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/handler"
	agentevent "github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	hertzadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/hertz"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
)

var _ server.Subserver = (*agentSubServer)(nil)

type agentSubServer struct {
	opts           *Options
	addrs          []string
	status         server.Status
	jwtWrapper     server.Wrapper
	turnService    *service.TurnService
	stopTurnWorker context.CancelFunc
	deviceKeys     *touchactor.DeviceStore
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
	if err = persistence.MigrateAgentMessages(rds); err != nil {
		return err
	}
	if err = persistence.MigrateTurnEvents(rds); err != nil {
		return err
	}
	if err = persistence.MigrateConversations(rds); err != nil {
		return err
	}
	if err = persistence.MigrateFencedClientExecution(rds); err != nil {
		return err
	}
	if err = rds.AutoMigrate(persistence.AllModels()...); err != nil {
		return err
	}
	if err = persistence.MigrateTurnEvidence(rds); err != nil {
		return err
	}
	identityRDS, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}
	s.deviceKeys = touchactor.NewDeviceStore(identityRDS)

	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.jwtWrapper = server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))
	s.status = server.StatusStarting

	logger.Info(ctx, "end to initiate new agent subserver")
	return nil
}

func (s *agentSubServer) Start(ctx context.Context, opts ...option.Option) error {
	if s.turnService != nil {
		workerCtx, cancel := context.WithCancel(ctx)
		s.stopTurnWorker = cancel
		go s.turnService.RunToolContinuationWorker(workerCtx)
		go s.turnService.RunTurnQueueWorker(workerCtx)
	}
	s.status = server.StatusRunning
	return nil
}

func (s *agentSubServer) Stop(ctx context.Context) error {
	if s.stopTurnWorker != nil {
		s.stopTurnWorker()
		s.stopTurnWorker = nil
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
	deviceIDWrapper := serverwrapper.DeviceID()
	jwtWrapper := s.jwtWrapper
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	hertzJWTWrapper := hertzadapter.RequireJWT(provider)
	eventBus := agentevent.NewMemoryEventBus()

	// Phase 7: Growth Metrics — must be created early since MemoryService,
	// SkillService, ReviewService, and TurnService depend on it for event recording.
	growthMetricsSvc := service.NewGrowthMetricsService()
	diagnosticSvc := service.NewGrowthDiagnosticService()
	growthMetricsSvc.SetDiagnosticService(diagnosticSvc)

	// Phase 2 services.
	agentSvc := service.NewAgentService()
	memorySvc := service.NewMemoryService(growthMetricsSvc, memoryServiceOptionsFromConfig()...)
	workspaceSvc := service.NewWorkspaceService()
	configSvc := service.NewAgentConfigService()
	offlineQueueSvc := service.NewOfflineQueueService()
	eventStreamSvc := service.NewEventStreamService(eventBus)
	skillsGuardSvc := service.NewSkillsGuardService()
	skillSvc := service.NewSkillService(skillsGuardSvc, growthMetricsSvc)
	errorClassifierSvc := service.NewErrorClassifierService()
	promptAssemblySvc := service.NewPromptAssemblyService(memorySvc, skillSvc)
	compressionSvc := service.NewCompressionService()

	// Phase 3 services.
	promptCachingSvc := service.NewPromptCachingService()
	providerSvc := service.NewProviderService(promptCachingSvc)
	providerConfigSvc := service.NewProviderConfigService()
	modelConfigSvc := service.NewModelConfigService()
	credentialConfigSvc := service.NewCredentialConfigService()
	admissionResolver := service.NewRuntimeAdmissionResolver(providerConfigSvc, modelConfigSvc)
	runtimeEvidenceSvc := service.NewRuntimeEvidenceService()
	runtimeReadinessSvc := service.NewRuntimeReadinessService(agentSvc, admissionResolver)
	credentialPoolSvc := service.NewCredentialPoolService()
	delegationSvc := service.NewDelegationService()

	// Phase 4: Tool Registry — central dispatch for memory, skills, delegation.
	toolRegistrySvc := service.NewToolRegistryService(memorySvc, skillSvc)

	// Conversation service — owns conversation CRUD, message listing, seq allocation, and event persistence.
	convSvc := service.NewConversationService()

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
		delegationSvc,
		toolRegistrySvc,
		reviewSvc,
		growthMetricsSvc,
		convSvc,
	)
	turnSvc.SetEventBus(eventBus)

	// Dogfood self-verification service.
	dogfoodSvc := service.NewDogfoodService(memorySvc, skillSvc, growthMetricsSvc)

	// Scheduler — autonomous learning: periodic SILENT reviews + dogfood runs.
	schedulerSvc := service.NewSchedulerService(reviewSvc, dogfoodSvc, memorySvc, growthMetricsSvc)
	orchestrationSvc := service.NewOrchestrationService(agentSvc, turnSvc, toolRegistrySvc)
	schedulerSvc.SetOrchestrationService(orchestrationSvc)
	orchestrationSvc.SetEventBus(eventBus)
	orchestrationSvc.StartTaskRecovery(context.Background())

	// Chat root task: Station owns the Chat surface as a long-lived task so a
	// turn outlives the client connection. Reclaim interrupted steps on boot.
	chatTaskSvc := service.NewChatTaskService(eventBus)

	agentHandlers := handler.NewAgentHandlers(agentSvc, eventBus)
	turnHandlers := handler.NewTurnHandlers(turnSvc, toolRegistrySvc, chatTaskSvc, convSvc)
	turnAdmissionSvc := service.NewTurnAdmissionService()
	turnHandlers.SetAdmissionService(turnAdmissionSvc)
	turnSvc.SetTurnAdmissionService(turnAdmissionSvc)
	turnQueueHandlers := handler.NewTurnQueueHandlers(turnAdmissionSvc)
	convHandlers := handler.NewConversationHandlers(convSvc, turnSvc)
	revisionHandlers := handler.NewRevisionHandlers(service.NewRevisionService(convSvc, turnSvc))
	threadHandlers := handler.NewThreadHandlers(service.NewThreadService())
	memoryHandlers := handler.NewMemoryHandlers(memorySvc)
	workspaceHandlers := handler.NewWorkspaceHandlers(workspaceSvc)
	configHandlers := handler.NewAgentConfigHandlers(configSvc)
	offlineQueueHandlers := handler.NewOfflineQueueHandlers(offlineQueueSvc)
	eventStreamHandlers := handler.NewEventStreamHandlers(eventStreamSvc)
	skillHandlers := handler.NewSkillHandlers(skillSvc)
	dogfoodHandlers := handler.NewDogfoodHandlers(dogfoodSvc)
	schedulerHandlers := handler.NewSchedulerHandlers(schedulerSvc)
	orchestrationHandlers := handler.NewOrchestrationHandlers(orchestrationSvc)
	atelierProjectionHandlers := handler.NewAtelierProjectionHandlers(service.NewAtelierProjectionService(orchestrationSvc, memorySvc))

	growthHandlers := handler.NewGrowthHandlers(growthMetricsSvc, memorySvc, skillSvc, diagnosticSvc)

	// M11: Ecosystem handlers — localStorage→Station migration.
	ecosystemSvc := service.NewEcosystemService()
	ecosystemHandlers := handler.NewEcosystemHandlers(ecosystemSvc)
	agentTaskHandlers := handler.NewAgentTaskHandlers(service.NewAgentTaskService())

	providerHandlers := handler.NewProviderHandlers(
		providerConfigSvc,
		modelConfigSvc,
		credentialConfigSvc,
		admissionResolver,
	)
	runtimeEvidenceHandlers := handler.NewRuntimeEvidenceHandlers(
		runtimeEvidenceSvc,
		runtimeReadinessSvc,
	)
	turnSvc.SetAdmissionResolver(admissionResolver)

	// F4: Durable tool dispatch service with policy and fencing.
	proofSvc := service.NewClientCapabilityProofService(
		s.deviceKeys,
		actorPTIDResolverAdapter{},
		func() time.Time { return time.Now().UTC() },
	)
	toolDispatchSvc := service.NewToolDispatchService()
	toolDispatchSvc.SetCapabilityProofService(proofSvc)
	runtimeReadinessSvc.SetCapabilitySessionResolver(toolDispatchSvc)
	turnSvc.SetToolDispatch(toolDispatchSvc)
	turnSvc.SetChatTaskService(chatTaskSvc)
	s.turnService = turnSvc
	chatTaskSvc.RecoverRunningChatTasks(context.Background())

	handlers := []server.Handler{
		server.NewTypedHandler("agent-list", "/agent/list", server.POST, agentHandlers.HandleListAgents, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-list-get", "/agent/list", server.GET, agentHandlers.HandleListAgents, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-get", "/agent/get", server.POST, agentHandlers.HandleGetAgent, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("agent-create", "/agent/create", server.POST, agentHandlers.HandleCreateAgentRaw, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-update", "/agent/update", server.POST, agentHandlers.HandleUpdateAgent, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-delete", "/agent/delete", server.POST, agentHandlers.HandleDeleteAgent, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("agent-turn-execute", "/agent/turn/execute", server.POST, turnHandlers.HandleExecuteTurn, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("agent-turn-stream", "/agent/turn/stream", server.POST, turnHandlers.HandleExecuteTurnStream, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("agent-turn-cancel", "/agent/turn/cancel", server.POST, turnHandlers.HandleCancelTurn, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-turn-queue-list", "/agent/turn/queue/list", server.POST, turnQueueHandlers.HandleListQueuedTurns, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-turn-queue-cancel", "/agent/turn/queue/cancel", server.POST, turnQueueHandlers.HandleCancelQueuedTurn, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-tool-decision", "/agent/tool/decision", server.POST, turnHandlers.HandleSubmitToolDecision, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-capability-lease-register", "/agent/capability/lease/register", server.POST, turnHandlers.HandleRegisterClientCapabilityLease, logIDWrapper, deviceIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-capability-session-list", "/agent/capability/session/list", server.POST, turnHandlers.HandleListClientCapabilitySessions, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-capability-lease-renew", "/agent/capability/lease/renew", server.POST, turnHandlers.HandleRenewClientCapabilityLease, logIDWrapper, deviceIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-capability-lease-revoke", "/agent/capability/lease/revoke", server.POST, turnHandlers.HandleRevokeClientCapabilityLease, logIDWrapper, deviceIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-capability-requests-pull", "/agent/capability/requests/pull", server.POST, turnHandlers.HandlePullClientCapabilityRequests, logIDWrapper, deviceIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-capability-receipt", "/agent/capability/receipt", server.POST, turnHandlers.HandleSubmitClientCapabilityReceipt, logIDWrapper, deviceIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-capability-receipt-recover", "/agent/capability/receipt/recover", server.POST, turnHandlers.HandleSubmitClientCapabilityRecoveryReceipt, logIDWrapper),
		server.NewHTTPHandler("agent-quick-completion", "/agent/quick-completion", server.POST, turnHandlers.HandleQuickCompletion, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-turn-trace-list", "/agent/turn/trace/list", server.POST, turnHandlers.HandleListTurnTraces, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-turn-trace-get", "/agent/turn/trace/get", server.POST, turnHandlers.HandleGetTurnTrace, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-turn-diagnostics-export", "/agent/turn/diagnostics/export", server.POST, turnHandlers.HandleExportTurnDiagnostics, logIDWrapper, jwtWrapper),

		server.NewHTTPHandler("agent-conversation-list", "/agent/conversation/list", server.POST, convHandlers.HandleListConversations, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("agent-conversation-get", "/agent/conversation/get", server.POST, convHandlers.HandleGetConversation, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("agent-conversation-create", "/agent/conversation/create", server.POST, convHandlers.HandleCreateConversation, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("agent-conversation-update", "/agent/conversation/update", server.POST, convHandlers.HandleUpdateConversation, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("agent-conversation-archive", "/agent/conversation/archive", server.POST, convHandlers.HandleArchiveConversation, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("agent-conversation-messages", "/agent/conversation/messages", server.POST, convHandlers.HandleListMessages, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("agent-message-translate", "/agent/conversation/message/translate", server.POST, convHandlers.HandleSetMessageTranslation, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("agent-conversation-events", "/agent/conversation/events", server.POST, convHandlers.HandleStreamConversationEvents, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-turn-retry", "/agent/turn/retry", server.POST, revisionHandlers.HandleRetryTurn, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-turn-regenerate", "/agent/turn/regenerate", server.POST, revisionHandlers.HandleRegenerateTurn, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-message-edit-resend", "/agent/message/edit-resend", server.POST, revisionHandlers.HandleEditAndResend, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-conversation-select-branch", "/agent/conversation/select-branch", server.POST, revisionHandlers.HandleSelectActiveBranch, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-message-tombstone", "/agent/message/tombstone", server.POST, revisionHandlers.HandleTombstoneMessage, logIDWrapper, jwtWrapper),

		server.NewHTTPHandler("agent-thread-create", "/agent/thread/create", server.POST, threadHandlers.HandleCreateThread, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("agent-thread-list", "/agent/thread/list", server.POST, threadHandlers.HandleListThreads, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("agent-thread-messages", "/agent/thread/messages", server.POST, threadHandlers.HandleListThreadMessages, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("agent-provider-list", "/agent/provider/list", server.POST, providerHandlers.HandleProviderList, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-provider-get", "/agent/provider/get", server.POST, providerHandlers.HandleProviderGet, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-provider-create", "/agent/provider/create", server.POST, providerHandlers.HandleProviderCreate, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-provider-update", "/agent/provider/update", server.POST, providerHandlers.HandleProviderUpdate, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-provider-delete", "/agent/provider/delete", server.POST, providerHandlers.HandleProviderDelete, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-model-list", "/agent/model/list", server.POST, providerHandlers.HandleModelList, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-model-create", "/agent/model/create", server.POST, providerHandlers.HandleModelCreate, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-model-update", "/agent/model/update", server.POST, providerHandlers.HandleModelUpdate, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-model-available", "/agent/model/available", server.POST, providerHandlers.HandleListAvailableModels, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-credential-set", "/agent/credential/set", server.POST, providerHandlers.HandleCredentialSet, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-credential-delete", "/agent/credential/delete", server.POST, providerHandlers.HandleCredentialDelete, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-credential-status", "/agent/credential/status", server.POST, providerHandlers.HandleCredentialStatus, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-credential-resolve", "/agent/credential/resolve", server.POST, providerHandlers.HandleCredentialResolve, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-model-hide", "/agent/provider/model/hide", server.POST, providerHandlers.HandleModelHide, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-model-hidden-list", "/agent/provider/model/hidden", server.POST, providerHandlers.HandleModelHiddenList, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-runtime-profile-effective", "/agent/runtime/profile/effective", server.POST, runtimeEvidenceHandlers.HandleEffectiveRuntimeProfile, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-runtime-activity", "/agent/runtime/activity", server.POST, runtimeEvidenceHandlers.HandleRuntimeActivity, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-capability-readiness", "/agent/capability/readiness", server.POST, runtimeEvidenceHandlers.HandleCapabilityReadiness, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("agent-collaboration-create", "/agent/collaboration/create", server.POST, orchestrationHandlers.HandleCreateCollaborationTask, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-collaboration-get", "/agent/collaboration/get", server.POST, orchestrationHandlers.HandleGetCollaborationTask, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-collaboration-list", "/agent/collaboration/list", server.POST, orchestrationHandlers.HandleListCollaborationTasks, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-collaboration-events-list", "/agent/collaboration/events/list", server.POST, orchestrationHandlers.HandleListTaskEvents, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-collaboration-cancel", "/agent/collaboration/cancel", server.POST, orchestrationHandlers.HandleCancelCollaborationTask, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-collaboration-resume", "/agent/collaboration/resume", server.POST, orchestrationHandlers.HandleResumeCollaborationTask, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-collaboration-node-submit-result", "/agent/collaboration/node/submit-result", server.POST, orchestrationHandlers.HandleSubmitCollaborationNodeResult, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-collaboration-executor-claim", "/agent/collaboration/executor/claim", server.POST, orchestrationHandlers.HandleClaimDesktopExecutorTask, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-collaboration-executor-heartbeat", "/agent/collaboration/executor/heartbeat", server.POST, orchestrationHandlers.HandleHeartbeatExecutorLease, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-collaboration-executor-release", "/agent/collaboration/executor/release", server.POST, orchestrationHandlers.HandleReleaseExecutorLease, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-atelier-workspace-load", "/agent/atelier/workspace/load", server.POST, atelierProjectionHandlers.HandleLoadWorkspace, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-atelier-project-create-from-goal", "/agent/atelier/project/create-from-goal", server.POST, atelierProjectionHandlers.HandleCreateProjectFromGoal, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-atelier-message-send", "/agent/atelier/message/send", server.POST, atelierProjectionHandlers.HandleSendMessage, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-atelier-escalation-resolve", "/agent/atelier/escalation/resolve", server.POST, atelierProjectionHandlers.HandleResolveDecision, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-atelier-task-set-status", "/agent/atelier/task/set-status", server.POST, atelierProjectionHandlers.HandleSetTaskStatus, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-atelier-task-purge", "/agent/atelier/task/purge", server.POST, atelierProjectionHandlers.HandlePurgeTask, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-atelier-provider-capabilities", "/agent/atelier/provider/capabilities", server.POST, atelierProjectionHandlers.HandleProviderCapabilities, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-atelier-feedback-submit", "/agent/atelier/feedback/submit", server.POST, atelierProjectionHandlers.HandleSubmitFeedback, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-atelier-memory-confirm-candidate", "/agent/atelier/memory/confirm-candidate", server.POST, atelierProjectionHandlers.HandleConfirmMemoryCandidate, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-atelier-feedback-confirm-rerun", "/agent/atelier/feedback/confirm-rerun", server.POST, atelierProjectionHandlers.HandleConfirmRerun, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-atelier-artifact-body-fetch", "/agent/atelier/artifact/body/fetch", server.POST, atelierProjectionHandlers.HandleFetchArtifactBody, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("agent-events-subscribe", "/agent/events/subscribe", server.POST, eventStreamHandlers.HandleSubscribe, logIDWrapper, jwtWrapper),

		// POST: protobuf body carries ListMemoriesRequest (GET + empty body leaves agent_id unset).
		server.NewTypedHandler("agent-memory-list", "/agent/memory/list", server.POST, memoryHandlers.HandleListMemories, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-memory-get", "/agent/memory/get", server.POST, memoryHandlers.HandleGetMemory, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-memory-delete", "/agent/memory/delete", server.POST, memoryHandlers.HandleDeleteMemory, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-memory-update", "/agent/memory/update", server.POST, memoryHandlers.HandleUpdateMemory, logIDWrapper, jwtWrapper),
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

		// Compatibility aliases for the Agent resource management surface.
		server.NewTypedHandler("agent-memory-list-compat", "/memory/list", server.POST, memoryHandlers.HandleListMemories, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-memory-list-compat-get", "/memory/list", server.GET, memoryHandlers.HandleListMemories, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("agent-workspace-create", "/workspace/create", server.POST, workspaceHandlers.HandleCreateWorkspace, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-workspace-get", "/workspace/get", server.POST, workspaceHandlers.HandleGetWorkspace, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-workspace-list", "/workspace/list", server.POST, workspaceHandlers.HandleListWorkspaces, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-workspace-list-get", "/workspace/list", server.GET, workspaceHandlers.HandleListWorkspaces, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-workspace-update", "/workspace/update", server.POST, workspaceHandlers.HandleUpdateWorkspace, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-workspace-delete", "/workspace/delete", server.POST, workspaceHandlers.HandleDeleteWorkspace, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-workspace-files", "/workspace/files", server.POST, workspaceHandlers.HandleListFiles, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-workspace-diff", "/workspace/diff", server.POST, workspaceHandlers.HandleGetFileDiff, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-workspace-commit", "/workspace/commit", server.POST, workspaceHandlers.HandleCommitChanges, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-workspace-delete-files", "/workspace/delete-files", server.POST, workspaceHandlers.HandleDeleteFiles, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("agent-config-knowledge-list", "/config/knowledge/list", server.POST, configHandlers.HandleListKnowledgeBindings, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-config-knowledge-create", "/config/knowledge/create", server.POST, configHandlers.HandleCreateKnowledgeBinding, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-config-knowledge-update", "/config/knowledge/update", server.POST, configHandlers.HandleUpdateKnowledgeBinding, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-config-knowledge-delete", "/config/knowledge/delete", server.POST, configHandlers.HandleDeleteKnowledgeBinding, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-config-skill-list", "/config/skill/list", server.POST, configHandlers.HandleListSkillBindings, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-config-skill-create", "/config/skill/create", server.POST, configHandlers.HandleCreateSkillBinding, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-config-skill-update", "/config/skill/update", server.POST, configHandlers.HandleUpdateSkillBinding, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-config-skill-delete", "/config/skill/delete", server.POST, configHandlers.HandleDeleteSkillBinding, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-config-mcp-list", "/config/mcp/list", server.POST, configHandlers.HandleListMcpBindings, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-config-mcp-create", "/config/mcp/create", server.POST, configHandlers.HandleCreateMcpBinding, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-config-mcp-update", "/config/mcp/update", server.POST, configHandlers.HandleUpdateMcpBinding, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-config-mcp-delete", "/config/mcp/delete", server.POST, configHandlers.HandleDeleteMcpBinding, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("agent-offline-queue-enqueue", "/offline-queue/enqueue", server.POST, offlineQueueHandlers.HandleEnqueue, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-offline-queue-list", "/offline-queue/list", server.POST, offlineQueueHandlers.HandleListPending, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-offline-queue-list-get", "/offline-queue/list", server.GET, offlineQueueHandlers.HandleListPending, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-offline-queue-get", "/offline-queue/get", server.POST, offlineQueueHandlers.HandleGetOperation, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-offline-queue-ack", "/offline-queue/ack", server.POST, offlineQueueHandlers.HandleAckOperation, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-offline-queue-sync", "/offline-queue/sync", server.POST, offlineQueueHandlers.HandleSync, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-offline-queue-resolve", "/offline-queue/resolve", server.POST, offlineQueueHandlers.HandleResolveConflict, logIDWrapper, jwtWrapper),

		server.NewHertzHandler("agent-events-stream", "/events/stream", server.GET, eventStreamHandlers.HandleSubscribeHertz, hertzJWTWrapper),

		server.NewTypedHandler("agent-skill-list", "/agent/skill/list", server.POST, skillHandlers.HandleListSkills, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-skill-get", "/agent/skill/get", server.GET, skillHandlers.HandleGetSkill, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-skill-install", "/agent/skill/install", server.POST, skillHandlers.HandleInstallSkill, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-skill-update", "/agent/skill/update", server.POST, skillHandlers.HandleUpdateSkill, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-skill-delete", "/agent/skill/delete", server.POST, skillHandlers.HandleDeleteSkill, logIDWrapper, jwtWrapper),

		// Growth Dashboard endpoints.
		server.NewTypedHandler("agent-growth-snapshot", "/agent/growth/snapshot", server.POST, growthHandlers.HandleGetGrowthSnapshot, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-growth-audit", "/agent/growth/audit", server.GET, growthHandlers.HandleGetAuditLog, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-growth-feedback", "/agent/growth/feedback", server.POST, growthHandlers.HandleRecordFeedback, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("agent-growth-feedback-turn-list", "/agent/growth/feedback/turn/list", server.POST, growthHandlers.HandleListTurnFeedback, logIDWrapper, jwtWrapper),
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

		// Ecosystem: Agent Groups (M11 localStorage→Station migration).
		server.NewHTTPHandler("ecosystem-group-create", "/agent/ecosystem/group/create", server.POST, ecosystemHandlers.HandleCreateAgentGroup, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("ecosystem-group-update", "/agent/ecosystem/group/update", server.POST, ecosystemHandlers.HandleUpdateAgentGroup, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("ecosystem-group-delete", "/agent/ecosystem/group/delete", server.POST, ecosystemHandlers.HandleDeleteAgentGroup, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("ecosystem-group-list", "/agent/ecosystem/group/list", server.POST, ecosystemHandlers.HandleListAgentGroups, logIDWrapper, jwtWrapper),

		// Ecosystem: Topic Comments.
		server.NewHTTPHandler("ecosystem-comment-create", "/agent/ecosystem/comment/create", server.POST, ecosystemHandlers.HandleCreateTopicComment, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("ecosystem-comment-delete", "/agent/ecosystem/comment/delete", server.POST, ecosystemHandlers.HandleDeleteTopicComment, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("ecosystem-comment-list", "/agent/ecosystem/comment/list", server.POST, ecosystemHandlers.HandleListTopicComments, logIDWrapper, jwtWrapper),

		// Ecosystem: Eval Datasets.
		server.NewHTTPHandler("ecosystem-eval-create", "/agent/ecosystem/eval/create", server.POST, ecosystemHandlers.HandleCreateEvalDataset, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("ecosystem-eval-update", "/agent/ecosystem/eval/update", server.POST, ecosystemHandlers.HandleUpdateEvalDataset, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("ecosystem-eval-delete", "/agent/ecosystem/eval/delete", server.POST, ecosystemHandlers.HandleDeleteEvalDataset, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("ecosystem-eval-list", "/agent/ecosystem/eval/list", server.POST, ecosystemHandlers.HandleListEvalDatasets, logIDWrapper, jwtWrapper),

		// Ecosystem: Custom Plugins.
		server.NewHTTPHandler("ecosystem-plugin-create", "/agent/ecosystem/plugin/create", server.POST, ecosystemHandlers.HandleCreateCustomPlugin, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("ecosystem-plugin-update", "/agent/ecosystem/plugin/update", server.POST, ecosystemHandlers.HandleUpdateCustomPlugin, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("ecosystem-plugin-delete", "/agent/ecosystem/plugin/delete", server.POST, ecosystemHandlers.HandleDeleteCustomPlugin, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("ecosystem-plugin-list", "/agent/ecosystem/plugin/list", server.POST, ecosystemHandlers.HandleListCustomPlugins, logIDWrapper, jwtWrapper),

		// Agent Tasks: user-created single-agent task lifecycle (O3).
		server.NewHTTPHandler("agent-task-create", "/agent/task/create", server.POST, agentTaskHandlers.HandleCreateTask, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("agent-task-list", "/agent/task/list", server.POST, agentTaskHandlers.HandleListTasks, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("agent-task-status", "/agent/task/status", server.POST, agentTaskHandlers.HandleUpdateTaskStatus, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("agent-task-delete", "/agent/task/delete", server.POST, agentTaskHandlers.HandleDeleteTask, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("agent-task-subtask-add", "/agent/task/subtask/add", server.POST, agentTaskHandlers.HandleAddSubtask, logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("agent-task-subtask-complete", "/agent/task/subtask/complete", server.POST, agentTaskHandlers.HandleCompleteSubtask, logIDWrapper, jwtWrapper),
	}
	return prefixHandlers(s.opts.Path, handlers)
}

func prefixHandlers(base string, handlers []server.Handler) []server.Handler {
	base = strings.TrimRight(base, "/")
	if base == "" {
		return handlers
	}
	out := make([]server.Handler, 0, len(handlers))
	for _, h := range handlers {
		out = append(out, server.NewHandler(
			h.Name(),
			base+h.Path(),
			h.Method(),
			h.Type(),
			h.Handler(),
			h.Wrappers()...,
		))
	}
	return out
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
