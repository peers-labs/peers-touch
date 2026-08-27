// Change-log:
// 2026-04-11 — Initial implementation of TurnService: Turn Loop orchestration
//   that coordinates prompt assembly, context compression, error classification,
//   nudge state management, and persistence.
// 2026-04-11 — Phase 3 integration: replaced provider call / error recovery /
//   tool dispatch placeholders with real ProviderService, CredentialPoolService,
//   ContextReferenceService, DelegationService wiring. Added credential rotation
//   retry loop, context reference preprocessing, and tool call iteration loop.
// 2026-04-11 — Phase 4: integrated ToolRegistryService into processToolCalls,
//   replacing [tool_not_implemented] placeholder with central dispatch.
//   Implemented recursive delegation executor using scoped mini turn-loop.
// 2026-04-11 — Phase 5: runCompression now performs Knowledge Salvage via
//   FlushMemories() before compression, and executes an LLM call to produce
//   an actual summary from the compression prompt. Added executeSummaryLLM().
// 2026-04-11 — Phase 6: integrated ReviewService into Step 9 nudge evaluation.
//   TurnService now holds a *ReviewService and delegates background review
//   triggering to it after updating nudge counters.
// 2026-04-11 — Phase 7: Compression Session Split and MemoryProvider lifecycle
//   hooks. Added splitSession() to mark the old conversation as "compressed"
//   and create a child conversation post-compression. Added memoryProvider()
//   helper. Integrated on_turn_start, on_pre_compress, sync_turn, on_delegation
//   hooks into the turn loop for external memory backend synchronisation.
// 2026-04-11 — P1 Bug Fixes:
//   (1) NudgeState data race: replaced direct field access with thread-safe
//       IncrementTurnCounter / IncrementIterCounter methods.
//   (2) Delegation depth guard: added Depth field to TurnConfig, reject turns
//       exceeding MaxDelegationDepth, propagate depth to child configs.
//   (3) ShouldFallback recovery: added FallbackModel to TurnConfig, consume
//       ShouldFallback in providerCallWithRetry to switch model on billing /
//       model_not_found errors.
//   (4) ID collision: replaced all time.UnixNano IDs with crypto/rand-based
//       generateID() across turn_service, review_service, memory_service,
//       delegation_service, and skill_service.
// 2026-04-11 — Growth Metrics Integration: injected GrowthMetricsService dependency,
//   emit RecordEvent on turn completed (turn_completed), failed (turn_failed),
//   and retried (turn_retried).

package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

// ---------------------------------------------------------------------------
// TurnConfig
// ---------------------------------------------------------------------------

// TurnConfig holds per-execution configuration for a single turn.
type TurnConfig struct {
	TurnID                    string
	ExecutionContext          context.Context
	AgentID                   string
	ActorID                   string
	ConversationID            string
	Identity                  string
	AgentConfigPrompt         string
	Platform                  string
	AvailableTools            []string
	ContextWindowSize         int
	MaxRetries                int
	Provider                  string
	Model                     string
	Effort                    string // reasoning effort: "low" | "medium" | "high"
	FallbackModel             string // Alternate model for billing/model_not_found fallback recovery.
	WorkspaceRoot             string
	KnowledgeResources        []domain.KnowledgeResource
	PrecreatedTurnID          string
	ExistingTurnID            string
	SkipUserMessage           bool
	ContextBranchHeadID       string
	AssistantBranchID         string
	AssistantMessageID        string
	AssistantParentID         string
	AssistantReplacesID       string
	ClientCapabilitySessionID string
	RequestedBudgetJSON       json.RawMessage
	RotationStrategy          domain.RotationStrategy
	Depth                     int // Current delegation depth (0 = top-level).
	EventSink                 TurnEventSink
	// TaskID/StepID bind this turn to a Station-owned task step. When TaskID is
	// set, turn lifecycle events are written to the durable outbox (replayable
	// source of truth) in addition to the realtime event bus.
	TaskID string
	StepID string

	AttemptID string

	MemoryDisabled bool // When true, L3 memory snapshot is skipped in prompt assembly.
}

type TurnEventSink func(ctx context.Context, event TurnEvent)

type TurnEvent struct {
	Type             string `json:"type"`
	Seq              int64  `json:"seq,omitempty"`
	TurnID           string `json:"turnId,omitempty"`
	ConversationID   string `json:"conversationId,omitempty"`
	AgentID          string `json:"agentId,omitempty"`
	Stage            string `json:"stage,omitempty"`
	Text             string `json:"text,omitempty"`
	ToolCallID       string `json:"toolCallId,omitempty"`
	ToolName         string `json:"toolName,omitempty"`
	Arguments        string `json:"arguments,omitempty"`
	ApprovalID       string `json:"approvalId,omitempty"`
	DecisionID       string `json:"decisionId,omitempty"`
	DecisionRevision uint64 `json:"decisionRevision,omitempty"`
	Approved         bool   `json:"approved,omitempty"`
	PayloadHash      string `json:"payloadHash,omitempty"`
	Source           string `json:"source,omitempty"`
	ServerName       string `json:"serverName,omitempty"`
	Result           string `json:"result,omitempty"`
	Error            string `json:"error,omitempty"`
	Iteration        int    `json:"iteration,omitempty"`
}

type continuationProviderCall func(
	context.Context,
	*TurnConfig,
	string,
	*domain.TurnTrace,
	string,
	[]domain.Message,
) (string, []domain.ProviderCallRecord, bool, error)

// ---------------------------------------------------------------------------
// TurnService
// ---------------------------------------------------------------------------

// TurnService orchestrates the full lifecycle of a single agent turn:
// context reference preprocessing → prompt assembly → compression check →
// credential lease → provider call → error recovery → tool dispatch →
// nudge evaluation → persistence.
type TurnService struct {
	errorClassifier    *ErrorClassifierService
	memoryService      *MemoryService
	skillService       *SkillService
	promptAssembly     *PromptAssemblyService
	compression        *CompressionService
	providerService    *ProviderService
	credentialPool     *CredentialPoolService
	delegation         *DelegationService
	toolRegistry       *ToolRegistryService
	reviewService      *ReviewService
	growthMetrics      *GrowthMetricsService
	convService        *ConversationService
	nudgeState         *domain.NudgeState
	liveResumeBroker   *LiveResumeBroker
	toolDispatch       *ToolDispatchService
	chatTaskService    *ChatTaskService
	eventBus           domain.EventBus
	eventWriter        *TaskEventWriter
	activeTurns        sync.Mutex
	activeTurnCancel   map[string]context.CancelFunc
	admissionResolver  *RuntimeAdmissionResolver
	turnAdmission      *TurnAdmissionService
	resumeProviderCall continuationProviderCall
}

func (s *TurnService) SetAdmissionResolver(r *RuntimeAdmissionResolver) {
	s.admissionResolver = r
}

func (s *TurnService) SetTurnAdmissionService(admission *TurnAdmissionService) {
	s.turnAdmission = admission
}

// SetToolDispatch injects the durable ToolDispatchService for F4 tool governance.
func (s *TurnService) SetToolDispatch(td *ToolDispatchService) {
	s.toolDispatch = td
}

func (s *TurnService) SetChatTaskService(chatTasks *ChatTaskService) {
	s.chatTaskService = chatTasks
}

func NewTurnService(
	errorClassifier *ErrorClassifierService,
	memoryService *MemoryService,
	skillService *SkillService,
	promptAssembly *PromptAssemblyService,
	compression *CompressionService,
	providerService *ProviderService,
	credentialPool *CredentialPoolService,
	delegation *DelegationService,
	toolRegistry *ToolRegistryService,
	reviewService *ReviewService,
	growthMetrics *GrowthMetricsService,
	convService *ConversationService,
) *TurnService {
	return &TurnService{
		errorClassifier:  errorClassifier,
		memoryService:    memoryService,
		skillService:     skillService,
		promptAssembly:   promptAssembly,
		compression:      compression,
		providerService:  providerService,
		credentialPool:   credentialPool,
		delegation:       delegation,
		toolRegistry:     toolRegistry,
		reviewService:    reviewService,
		growthMetrics:    growthMetrics,
		convService:      convService,
		nudgeState:       domain.NewNudgeState(),
		liveResumeBroker: NewLiveResumeBroker(),
		activeTurnCancel: make(map[string]context.CancelFunc),
	}
}

func (s *TurnService) SetLiveResumeBroker(broker *LiveResumeBroker) {
	s.liveResumeBroker = broker
}

func (s *TurnService) SetEventBus(eventBus domain.EventBus) {
	s.eventBus = eventBus
	s.eventWriter = NewTaskEventWriter(eventBus)
}

func (s *TurnService) RunTurnQueueWorker(ctx context.Context) {
	if s.turnAdmission == nil {
		return
	}
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		if err := s.drainQueuedTurns(ctx); err != nil {
			logger.Errorf(ctx, "queued turn drain failed: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *TurnService) drainQueuedTurns(ctx context.Context) error {
	pending, err := s.turnAdmission.PendingConversations(ctx, 32)
	if err != nil {
		return err
	}
	for _, conversation := range pending {
		admitted, admitErr := s.turnAdmission.AdmitNext(
			ctx,
			conversation.ActorID,
			conversation.ConversationID,
		)
		if admitErr != nil {
			logger.Warnf(
				ctx,
				"queued turn admission failed: conversation_id=%s err=%v",
				conversation.ConversationID,
				admitErr,
			)
			continue
		}
		if admitted == nil {
			continue
		}
		go s.executeAdmittedQueuedTurn(
			context.WithoutCancel(ctx),
			conversation.ActorID,
			admitted,
		)
	}
	return nil
}

func (s *TurnService) executeAdmittedQueuedTurn(
	ctx context.Context,
	actorID string,
	admitted *AdmittedTurn,
) {
	if admitted == nil || admitted.Request == nil || admitted.Admission == nil {
		return
	}
	request := admitted.Request
	config := s.queuedTurnConfig(actorID, request, admitted.Admission.GetTurnId())
	if s.chatTaskService != nil {
		taskID, err := s.chatTaskService.EnsureChatTask(
			ctx,
			actorID,
			request.GetAgentId(),
			request.GetConversationId(),
			request.GetUserInput(),
		)
		if err != nil {
			_ = s.failTurn(
				ctx,
				request.GetAgentId(),
				admitted.Admission.GetTurnId(),
				"",
				"",
				"failed to prepare queued chat task",
			)
			return
		}
		stepID, err := s.chatTaskService.BeginChatStep(
			ctx,
			taskID,
			request.GetAgentId(),
			request.GetUserInput(),
		)
		if err != nil {
			_ = s.failTurn(
				ctx,
				request.GetAgentId(),
				admitted.Admission.GetTurnId(),
				taskID,
				"",
				"failed to begin queued chat step",
			)
			return
		}
		config.TaskID = taskID
		config.StepID = stepID
	}
	turn, err := s.ExecuteTurn(ctx, config, request.GetUserInput())
	if err != nil {
		if s.chatTaskService != nil && config.StepID != "" {
			_ = s.chatTaskService.FailChatStep(ctx, config.TaskID, config.StepID, err.Error())
		}
		return
	}
	if s.chatTaskService != nil &&
		config.StepID != "" &&
		turn != nil &&
		turn.Status == domain.TurnStatusCompleted {
		_ = s.chatTaskService.FinishChatStep(
			ctx,
			config.TaskID,
			config.StepID,
			turn.TurnID,
			turn.FinalResponse,
		)
	}
}

func (s *TurnService) queuedTurnConfig(
	actorID string,
	request *model.ExecuteTurnRequest,
	turnID string,
) *TurnConfig {
	contextWindowSize := int(request.GetContextWindowSize())
	if contextWindowSize <= 0 {
		contextWindowSize = 128000
	}
	maxRetries := int(request.GetMaxRetries())
	if maxRetries <= 0 {
		maxRetries = 3
	}
	var availableTools []string
	if s.toolRegistry != nil {
		availableTools = s.toolRegistry.ToolNames()
	}
	return &TurnConfig{
		TurnID:                    turnID,
		PrecreatedTurnID:          turnID,
		AgentID:                   request.GetAgentId(),
		ActorID:                   actorID,
		ConversationID:            request.GetConversationId(),
		Identity:                  request.GetIdentity(),
		AgentConfigPrompt:         request.GetAgentConfigPrompt(),
		AvailableTools:            availableTools,
		ContextWindowSize:         contextWindowSize,
		MaxRetries:                maxRetries,
		Provider:                  request.GetProvider(),
		Model:                     request.GetModel(),
		Effort:                    request.GetEffort(),
		ClientCapabilitySessionID: request.GetClientCapabilitySessionId(),
		KnowledgeResources:        queuedKnowledgeResources(request),
		MemoryDisabled:            request.GetMemoryDisabled(),
	}
}

func queuedKnowledgeResources(request *model.ExecuteTurnRequest) []domain.KnowledgeResource {
	resources := request.GetKnowledgeResources()
	result := make([]domain.KnowledgeResource, 0, len(resources))
	for _, resource := range resources {
		if strings.TrimSpace(resource.GetSource()) == "" {
			continue
		}
		result = append(result, domain.KnowledgeResource{
			ResourceID: resource.GetResourceId(),
			AgentID:    resource.GetAgentId(),
			Type:       queuedKnowledgeResourceType(resource.GetType()),
			Title:      resource.GetTitle(),
			Source:     resource.GetSource(),
			Policy:     queuedKnowledgeResourcePolicy(resource.GetPolicy()),
			Status:     resource.GetStatus().String(),
		})
	}
	return result
}

func queuedKnowledgeResourceType(
	value model.KnowledgeResourceType,
) domain.KnowledgeResourceType {
	switch value {
	case model.KnowledgeResourceType_KNOWLEDGE_RESOURCE_TYPE_FOLDER:
		return domain.KnowledgeResourceTypeFolder
	case model.KnowledgeResourceType_KNOWLEDGE_RESOURCE_TYPE_PROJECT:
		return domain.KnowledgeResourceTypeProject
	case model.KnowledgeResourceType_KNOWLEDGE_RESOURCE_TYPE_URL:
		return domain.KnowledgeResourceTypeURL
	case model.KnowledgeResourceType_KNOWLEDGE_RESOURCE_TYPE_NOTEBOOK:
		return domain.KnowledgeResourceTypeNotebook
	case model.KnowledgeResourceType_KNOWLEDGE_RESOURCE_TYPE_WORKSPACE:
		return domain.KnowledgeResourceTypeWorkspace
	default:
		return domain.KnowledgeResourceTypeDocument
	}
}

func queuedKnowledgeResourcePolicy(
	value model.KnowledgeResourcePolicy,
) domain.KnowledgeResourcePolicy {
	switch value {
	case model.KnowledgeResourcePolicy_KNOWLEDGE_RESOURCE_POLICY_AUTO:
		return domain.KnowledgeResourcePolicyAuto
	case model.KnowledgeResourcePolicy_KNOWLEDGE_RESOURCE_POLICY_ALWAYS:
		return domain.KnowledgeResourcePolicyAlways
	case model.KnowledgeResourcePolicy_KNOWLEDGE_RESOURCE_POLICY_DISABLED:
		return domain.KnowledgeResourcePolicyDisabled
	default:
		return domain.KnowledgeResourcePolicyManual
	}
}

func (s *TurnService) publishDomainEvent(ctx context.Context, agentID, turnID, taskID, stepID, eventType string, payload interface{}) {
	if s.eventBus == nil {
		return
	}

	// When the turn belongs to a Station-owned task, route the event through the
	// durable outbox so it can be replayed by cursor; otherwise publish realtime
	// only (legacy single-turn callers without a task).
	if strings.TrimSpace(taskID) != "" {
		writer := s.eventWriter
		if writer == nil {
			writer = NewTaskEventWriter(s.eventBus)
		}
		writer.Publish(ctx, agentID, eventType, payload, taskID, stepID, turnID, map[string]string{"turn_id": turnID})
		return
	}

	event := domain.DomainEvent{
		EventID:   generateID("evt"),
		EventType: eventType,
		ActorID:   agentID,
		Payload:   payload,
		Metadata: map[string]string{
			"agent_id": agentID,
			"turn_id":  turnID,
		},
	}

	_ = s.eventBus.Publish(ctx, event)
}

// SubmitToolDecision records an authenticated decision intent. Station owns
// claim creation and targeted dispatch.
func (s *TurnService) SubmitToolDecision(
	ctx context.Context,
	actorID string,
	request *model.SubmitToolApprovalDecisionRequest,
) (*model.SubmitToolApprovalDecisionResponse, error) {
	if s.toolDispatch == nil {
		return nil, fmt.Errorf("tool dispatch not configured")
	}
	return s.toolDispatch.SubmitDecision(ctx, actorID, request)
}

func (s *TurnService) RegisterClientCapabilityLease(
	ctx context.Context,
	actorID string,
	authSessionID string,
	deviceID string,
	request *model.RegisterClientCapabilityLeaseRequest,
) (*model.RegisterClientCapabilityLeaseResponse, error) {
	if s.toolDispatch == nil {
		return nil, fmt.Errorf("tool dispatch not configured")
	}
	return s.toolDispatch.RegisterCapabilityLease(ctx, actorID, authSessionID, deviceID, request)
}

func (s *TurnService) ListClientCapabilitySessions(
	ctx context.Context,
	actorID string,
) (*model.ListClientCapabilitySessionsResponse, error) {
	if s.toolDispatch == nil {
		return nil, fmt.Errorf("tool dispatch not configured")
	}
	return s.toolDispatch.ListCapabilitySessions(ctx, actorID)
}

func (s *TurnService) RenewClientCapabilityLease(
	ctx context.Context,
	actorID string,
	authSessionID string,
	deviceID string,
	request *model.RenewClientCapabilityLeaseRequest,
) (*model.RenewClientCapabilityLeaseResponse, error) {
	if s.toolDispatch == nil {
		return nil, fmt.Errorf("tool dispatch not configured")
	}
	return s.toolDispatch.RenewCapabilityLease(ctx, actorID, authSessionID, deviceID, request)
}

func (s *TurnService) RevokeClientCapabilityLease(
	ctx context.Context,
	actorID string,
	authSessionID string,
	deviceID string,
	request *model.RevokeClientCapabilityLeaseRequest,
) (*model.RevokeClientCapabilityLeaseResponse, error) {
	if s.toolDispatch == nil {
		return nil, fmt.Errorf("tool dispatch not configured")
	}
	return s.toolDispatch.RevokeCapabilityLease(ctx, actorID, authSessionID, deviceID, request)
}

func (s *TurnService) PullClientCapabilityRequests(
	ctx context.Context,
	actorID string,
	deviceID string,
	request *model.PullClientCapabilityRequestsRequest,
) (*model.PullClientCapabilityRequestsResponse, error) {
	if s.toolDispatch == nil {
		return nil, fmt.Errorf("tool dispatch not configured")
	}
	return s.toolDispatch.PullCapabilityRequests(ctx, actorID, deviceID, request)
}

func (s *TurnService) SubmitClientCapabilityReceipt(
	ctx context.Context,
	actorID string,
	deviceID string,
	request *model.SubmitClientCapabilityReceiptRequest,
) (*model.SubmitClientCapabilityReceiptResponse, error) {
	if s.toolDispatch == nil {
		return nil, fmt.Errorf("tool dispatch not configured")
	}
	return s.toolDispatch.SubmitReceipt(ctx, actorID, deviceID, request)
}

func (s *TurnService) SubmitClientCapabilityRecoveryReceipt(
	ctx context.Context,
	request *model.SubmitClientCapabilityRecoveryReceiptRequest,
) (*model.SubmitClientCapabilityRecoveryReceiptResponse, error) {
	if s.toolDispatch == nil {
		return nil, fmt.Errorf("tool dispatch not configured")
	}
	return s.toolDispatch.SubmitRecoveryReceipt(ctx, request)
}

func (s *TurnService) cancelActiveTurn(turnID string) bool {
	turnID = strings.TrimSpace(turnID)
	if turnID == "" {
		return false
	}
	s.activeTurns.Lock()
	cancel := s.activeTurnCancel[turnID]
	s.activeTurns.Unlock()
	if cancel == nil {
		return false
	}
	cancel()
	return true
}

func (s *TurnService) RequestCancelTurn(ctx context.Context, ptid, turnID string) (string, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return "", err
	}
	var turn persistence.AgentTurn
	if err := db.WithContext(ctx).Table("agent_turns AS turn").
		Select("turn.*").
		Joins("JOIN agent_conversations AS conversation ON conversation.id = turn.conversation_id").
		Where("turn.id = ? AND conversation.ptid = ?", strings.TrimSpace(turnID), strings.TrimSpace(ptid)).
		First(&turn).Error; err != nil {
		return "", errcode.New(errcode.AgentNotFound, http.StatusNotFound, "turn not found", err)
	}
	if turn.Status != string(domain.TurnStatusRunning) &&
		turn.Status != string(domain.TurnStatusWaitingLocalTool) {
		return turn.Status, nil
	}
	if s.cancelActiveTurn(turn.ID) {
		return "cancelling", nil
	}
	if err := s.cancelTurn(ctx, turn.AgentID, turn.ID, "", ""); err != nil {
		return "", err
	}
	return string(domain.TurnStatusCancelled), nil
}

func (s *TurnService) RegisterTurn(
	ctx context.Context,
	turnID string,
) (context.Context, func()) {
	executionCtx, cancel := context.WithCancel(ctx)
	s.activeTurns.Lock()
	if s.activeTurnCancel == nil {
		s.activeTurnCancel = make(map[string]context.CancelFunc)
	}
	s.activeTurnCancel[turnID] = cancel
	s.activeTurns.Unlock()
	var once sync.Once
	return executionCtx, func() {
		once.Do(func() {
			cancel()
			s.activeTurns.Lock()
			delete(s.activeTurnCancel, turnID)
			s.activeTurns.Unlock()
		})
	}
}

func (s *TurnService) AwaitLiveResume(ctx context.Context, taskID, stepID, turnID, interruptID string) (LiveResumeDecision, error) {
	broker := s.liveResumeBroker
	if broker == nil {
		return LiveResumeDecision{}, fmt.Errorf("live resume broker is not configured")
	}
	return broker.Await(ctx, taskID, stepID, turnID, interruptID)
}

func (s *TurnService) emitTurnEvent(ctx context.Context, config *TurnConfig, turnID string, event TurnEvent) {
	if config == nil {
		return
	}
	event.TurnID = turnID
	if event.ConversationID == "" {
		event.ConversationID = config.ConversationID
	}
	if event.AgentID == "" {
		event.AgentID = config.AgentID
	}
	if s.convService != nil && event.ConversationID != "" && event.TurnID != "" {
		payload := map[string]interface{}{}
		encoded, _ := json.Marshal(event)
		_ = json.Unmarshal(encoded, &payload)
		seq, err := s.convService.PersistTurnEvent(
			ctx,
			event.ConversationID,
			event.TurnID,
			event.Type,
			payload,
		)
		if err != nil {
			logger.Warnf(ctx, "failed to persist turn event: turn_id=%s type=%s err=%v", event.TurnID, event.Type, err)
		} else {
			event.Seq = seq
		}
	}
	if config.EventSink != nil {
		config.EventSink(ctx, event)
	}
}

// ---------------------------------------------------------------------------
// ExecuteTurn — full turn loop
// ---------------------------------------------------------------------------

// ExecuteTurn runs the complete turn loop and returns the finished Turn domain
// object. The loop follows these stages:
//
//	Step 1  — create turn record (status=running)
//	Step 2  — persist user message
//	Step 3  — preprocess context references (@file, @url, …)
//	Step 4  — assemble system prompt
//	Step 5  — load conversation messages
//	Step 6  — check / run compression
//	Step 7  — credential lease + provider call with error recovery loop
//	Step 8  — tool call iteration loop (includes delegation)
//	Step 9  — nudge state counters
//	Step 10 — persist assistant message + complete turn
//	Step 11 — save TurnTrace
func (s *TurnService) ExecuteTurn(ctx context.Context, config *TurnConfig, userInput string) (*domain.Turn, error) {
	if config == nil {
		return nil, errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"turn config is required",
			nil,
		)
	}
	if strings.TrimSpace(config.TurnID) == "" {
		config.TurnID = NewTurnID()
	}
	if config.ExecutionContext != nil {
		ctx = config.ExecutionContext
	} else {
		var release func()
		ctx, release = s.RegisterTurn(ctx, config.TurnID)
		defer release()
	}

	// Step 1 — Create or reopen the turn record (status=running).
	turnRecord, err := s.createOrReopenTurnRecord(ctx, config, userInput)
	if err != nil {
		return nil, err
	}
	turnID := turnRecord.ID
	if config.AttemptID == "" {
		config.AttemptID, err = s.ensureInitialTurnAttempt(ctx, turnID)
		if err != nil {
			return nil, err
		}
	}

	trace := &domain.TurnTrace{
		TraceID: generateID("trace"),
		TurnID:  turnID,
	}

	// Guard: reject turns that exceed the maximum delegation depth to prevent
	// unbounded recursive delegation chains.
	// Fix 2026-04-11: delegation depth was never checked, allowing infinite recursion.
	if config.Depth > domain.MaxDelegationDepth {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			fmt.Sprintf("delegation depth %d exceeds maximum %d", config.Depth, domain.MaxDelegationDepth),
			nil)
	}

	// Resolve agent identity/config defaults from DB when not provided per-turn.
	if config.Identity == "" || config.AgentConfigPrompt == "" || config.Provider == "" || config.Model == "" {
		s.resolveAgentDefaults(ctx, config)
	}

	logger.Infof(ctx, "turn started: turn_id=%s agent_id=%s conversation_id=%s provider=%s",
		turnID, config.AgentID, config.ConversationID, config.Provider)
	s.emitTurnEvent(ctx, config, turnID, TurnEvent{
		Type:  "progress",
		Stage: "turn_started",
	})
	s.publishDomainEvent(ctx, config.AgentID, turnID, config.TaskID, config.StepID, string(domain.EventTypeAgentTurnStarted), map[string]interface{}{
		"turn_id":         turnID,
		"conversation_id": config.ConversationID,
	})

	// MemoryProvider hook: on_turn_start — notify external backend of new turn.
	if mp := s.memoryProvider(); mp != nil {
		mp.OnTurnStart(turnID, userInput)
	}

	// Persist user message unless a revision command already created or selected
	// the immutable source branch.
	if !config.SkipUserMessage {
		if err := s.persistMessage(ctx, config.ConversationID, turnID, string(domain.MessageRoleUser), userInput, config.Model); err != nil {
			_ = s.failTurn(ctx, config.AgentID, turnID, config.TaskID, config.StepID, "failed to persist user message")
			return nil, err
		}
	}

	processedInput := userInput
	assemblyResult, err := s.promptAssembly.Assemble(
		ctx,
		config.AgentID,
		config.Identity,
		config.AgentConfigPrompt,
		config.AvailableTools,
		processedInput,
		config.KnowledgeResources,
		config.MemoryDisabled,
	)
	if err != nil {
		_ = s.failTurn(ctx, config.AgentID, turnID, config.TaskID, config.StepID, "prompt assembly failed")
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"prompt assembly failed", err)
	}

	systemPromptHash := sha256Short(assemblyResult.SystemPrompt)
	trace.SystemPromptHash = systemPromptHash
	trace.MemorySnapshotHash = assemblyResult.MemorySnapshotHash
	trace.SkillIndexHash = assemblyResult.SkillIndexHash
	trace.KnowledgeChunks = assemblyResult.KnowledgeChunks

	logger.Infof(ctx, "prompt assembled: turn_id=%s prompt_hash=%s skills=%d",
		turnID, systemPromptHash, assemblyResult.SkillCount)
	if len(trace.KnowledgeChunks) > 0 {
		knowledgeChunkPayload, _ := json.Marshal(trace.KnowledgeChunks)
		s.emitTurnEvent(ctx, config, turnID, TurnEvent{
			Type:      "progress",
			Stage:     "knowledge_retrieved",
			Iteration: len(trace.KnowledgeChunks),
			Result:    string(knowledgeChunkPayload),
		})
	}

	// Step 5 — Load conversation messages.
	messages, err := s.loadMessages(ctx, config.ConversationID)
	if err != nil {
		_ = s.failTurn(ctx, config.AgentID, turnID, config.TaskID, config.StepID, "failed to load conversation messages")
		return nil, err
	}
	if config.ContextBranchHeadID != "" {
		messages = projectMessageBranch(messages, config.ContextBranchHeadID)
	}

	// Replace the last user message content with the reference-expanded version
	// so the provider receives the enriched input.
	if processedInput != userInput && len(messages) > 0 {
		for i := len(messages) - 1; i >= 0; i-- {
			if messages[i].Role == domain.MessageRoleUser {
				messages[i].Content = processedInput
				break
			}
		}
	}

	// Step 6 — Check / run compression.
	estimatedTokens := s.compression.EstimateTokens(messages)
	shouldCompress := s.compression.ShouldCompress(estimatedTokens, config.ContextWindowSize)

	logger.Infof(ctx, "compression check: turn_id=%s tokens=%d window=%d should_compress=%v",
		turnID, estimatedTokens, config.ContextWindowSize, shouldCompress)

	if shouldCompress {
		messages, err = s.runCompression(ctx, config, turnID, trace, assemblyResult, messages)
		if err != nil {
			return nil, err
		}
	}

	// Persist ContextLedger to TurnAttempt (MCA-D04).
	if config.AttemptID != "" {
		ledgerJSON, ledgerErr := json.Marshal(assemblyResult.Segments)
		if ledgerErr != nil {
			return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"encode turn attempt context ledger", ledgerErr)
		}
		db, dbErr := s.getDB(ctx)
		if dbErr != nil {
			return nil, dbErr
		}
		if updateErr := db.WithContext(ctx).Model(&persistence.TurnAttempt{}).
			Where("id = ?", config.AttemptID).
			Update("context_ledger", string(ledgerJSON)).Error; updateErr != nil {
			return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"persist turn attempt context ledger", updateErr)
		}
	}

	// Step 6 — Admission gate: resolve capability/budget snapshot BEFORE
	// any provider call. Rejection here guarantees zero provider calls.
	if s.admissionResolver != nil {
		snapshot, admitErr := s.admissionResolver.Resolve(ctx, config.ActorID, config.Provider, config.Model)
		if admitErr != nil {
			_ = s.failTurn(ctx, config.AgentID, turnID, config.TaskID, config.StepID, "admission rejected")
			s.emitTurnEvent(ctx, config, turnID, TurnEvent{
				Type:  "error",
				Stage: "admission_rejected",
				Error: admitErr.Error(),
			})
			return nil, admitErr
		}
		trace.CapabilitySnapshotID = snapshot.SnapshotID
		if persistErr := s.persistRuntimeAuthority(ctx, config, snapshot); persistErr != nil {
			_ = s.failTurn(ctx, config.AgentID, turnID, config.TaskID, config.StepID, "runtime authority rejected")
			s.emitTurnEvent(ctx, config, turnID, TurnEvent{
				Type:  "error",
				Stage: "runtime_authority_rejected",
				Error: persistErr.Error(),
			})
			return nil, persistErr
		}
	}

	// Step 7 — Credential lease + provider call with error recovery loop.
	s.emitTurnEvent(ctx, config, turnID, TurnEvent{
		Type:  "progress",
		Stage: "provider_call_started",
	})
	assistantResponse, providerCalls, streamed, err := s.providerCallWithRetry(
		ctx, config, turnID, trace, assemblyResult.SystemPrompt, messages,
	)
	trace.ProviderCalls = providerCalls
	if err != nil {
		if usageErr := s.persistAttemptUsage(context.WithoutCancel(ctx), turnID, config.AttemptID, trace); usageErr != nil {
			return nil, fmt.Errorf("persist failed-attempt usage: %w", usageErr)
		}
		if errors.Is(err, context.Canceled) {
			_ = s.cancelTurn(ctx, config.AgentID, turnID, config.TaskID, config.StepID)
			s.emitTurnEvent(context.WithoutCancel(ctx), config, turnID, TurnEvent{
				Type:  "cancelled",
				Stage: "turn_cancelled",
			})
			return nil, err
		}
		_ = s.failTurn(ctx, config.AgentID, turnID, config.TaskID, config.StepID, fmt.Sprintf("provider call failed after retries: %v", err))
		s.emitTurnEvent(ctx, config, turnID, TurnEvent{
			Type:  "error",
			Error: err.Error(),
		})
		return nil, err
	}
	if !streamed {
		s.emitTurnEvent(ctx, config, turnID, TurnEvent{
			Type:  "text",
			Text:  assistantResponse,
			Stage: "provider_call_completed",
		})
	}

	// Step 8 — Tool call iteration loop.
	toolIterations, paused, err := s.processToolCalls(
		ctx, config, turnID, trace, assemblyResult.SystemPrompt, messages, &assistantResponse, 0,
	)
	if usageErr := s.persistAttemptUsage(ctx, turnID, config.AttemptID, trace); usageErr != nil {
		_ = s.failTurn(ctx, config.AgentID, turnID, config.TaskID, config.StepID, "failed to persist turn usage")
		return nil, usageErr
	}
	if err != nil {
		_ = s.failTurn(ctx, config.AgentID, turnID, config.TaskID, config.StepID, fmt.Sprintf("tool call processing failed: %v", err))
		s.emitTurnEvent(ctx, config, turnID, TurnEvent{
			Type:  "error",
			Error: err.Error(),
		})
		return nil, err
	}
	if paused {
		if err := s.markTurnWaitingForLocalTool(ctx, turnID, config.AttemptID, toolIterations); err != nil {
			_ = s.failTurn(ctx, config.AgentID, turnID, config.TaskID, config.StepID, "failed to persist local tool wait state")
			return nil, err
		}
		if s.chatTaskService != nil && config.StepID != "" {
			if err := s.chatTaskService.BindChatStepToTurn(
				ctx,
				config.TaskID,
				config.StepID,
				turnID,
			); err != nil {
				_ = s.failTurn(ctx, config.AgentID, turnID, config.TaskID, config.StepID, "failed to bind local tool wait step")
				return nil, err
			}
		}
		if err := s.saveTurnTrace(ctx, trace); err != nil {
			logger.Errorf(ctx, "failed to save paused turn trace: turn_id=%s err=%v", turnID, err)
		}
		s.emitTurnEvent(ctx, config, turnID, TurnEvent{
			Type:      "progress",
			Stage:     "waiting_local_tool",
			Iteration: toolIterations,
		})
		return &domain.Turn{
			TurnID:         turnID,
			ConversationID: config.ConversationID,
			AgentID:        config.AgentID,
			UserInput:      userInput,
			ToolIterations: toolIterations,
			Status:         domain.TurnStatusRunning,
			StartedAt:      turnRecord.StartedAt,
			Model:          config.Model,
		}, nil
	}

	assistantResponse = stripToolCallMarkup(assistantResponse)
	return s.finishTurnExecution(
		ctx,
		config,
		turnRecord,
		trace,
		messages,
		userInput,
		assistantResponse,
		toolIterations,
	)
}

func (s *TurnService) finishTurnExecution(
	ctx context.Context,
	config *TurnConfig,
	turnRecord *persistence.AgentTurn,
	trace *domain.TurnTrace,
	messages []domain.Message,
	userInput string,
	assistantResponse string,
	toolIterations int,
) (*domain.Turn, error) {
	turnID := turnRecord.ID
	// Step 9 — Update nudge state counters and trigger background review.
	// Fix 2026-04-11: use thread-safe accessor methods to avoid data race with
	// the background review goroutine that resets these counters concurrently.
	s.nudgeState.IncrementTurnCounter()
	s.nudgeState.IncrementIterCounter(toolIterations)

	if s.reviewService != nil {
		s.reviewService.CheckAndTriggerReview(
			ctx,
			s.nudgeState,
			turnID,
			config.ConversationID,
			config.AgentID,
			config.Provider,
			config.Model,
			messages,
			false,
		)
	}

	if s.nudgeState.ShouldTriggerMemoryReview() {
		trace.ReviewTriggered = true
	}
	if s.nudgeState.ShouldTriggerSkillReview() {
		trace.ReviewTriggered = true
	}

	// Step 10 — Persist assistant message and update turn status.
	if err := s.completeAssistantMessage(ctx, config, turnID, assistantResponse); err != nil {
		_ = s.failTurn(ctx, config.AgentID, turnID, config.TaskID, config.StepID, "failed to persist assistant message")
		return nil, err
	}

	if err := s.completeTurn(ctx, turnID, assistantResponse, toolIterations); err != nil {
		return nil, err
	}

	// MemoryProvider hook: sync_turn — persist this turn to external backend.
	if mp := s.memoryProvider(); mp != nil {
		if syncErr := mp.SyncTurn(userInput, assistantResponse); syncErr != nil {
			logger.Warnf(ctx, "MemoryProvider.SyncTurn failed (non-fatal): turn_id=%s err=%v", turnID, syncErr)
		}
	}

	// Step 11 — Save TurnTrace.
	if err := s.saveTurnTrace(ctx, trace); err != nil {
		logger.Errorf(ctx, "failed to save turn trace (non-fatal): turn_id=%s err=%v", turnID, err)
	}

	now := time.Now()
	// Extract the model name from the last successful provider call record.
	turnModel := config.Model
	for i := len(trace.ProviderCalls) - 1; i >= 0; i-- {
		if trace.ProviderCalls[i].Model != "" {
			turnModel = trace.ProviderCalls[i].Model
			break
		}
	}
	turn := &domain.Turn{
		TurnID:         turnID,
		ConversationID: config.ConversationID,
		AgentID:        config.AgentID,
		UserInput:      userInput,
		FinalResponse:  assistantResponse,
		ToolIterations: toolIterations,
		Status:         domain.TurnStatusCompleted,
		StartedAt:      turnRecord.StartedAt,
		EndedAt:        &now,
		Model:          turnModel,
	}

	logger.Infof(ctx, "turn completed: turn_id=%s iterations=%d", turnID, toolIterations)
	s.emitTurnEvent(ctx, config, turnID, TurnEvent{
		Type:      "progress",
		Stage:     "turn_completed",
		Iteration: toolIterations,
	})
	s.publishDomainEvent(ctx, config.AgentID, turnID, config.TaskID, config.StepID, string(domain.EventTypeAgentTurnCompleted), map[string]interface{}{
		"turn_id":         turnID,
		"conversation_id": config.ConversationID,
		"iterations":      toolIterations,
	})

	if s.growthMetrics != nil {
		s.growthMetrics.RecordEvent(ctx, config.AgentID, EventTurnCompleted, CategoryTurn, turnID, fmt.Sprintf("iterations=%d", toolIterations), "success")
	}

	if s.memoryService != nil {
		go s.memoryService.ExtractFromTurn(context.Background(), config.AgentID, config.ConversationID, turnID, userInput, assistantResponse)
	}

	// Update skill usage stats for skills loaded during this turn.
	if len(trace.SkillsLoaded) > 0 && s.skillService != nil {
		s.skillService.RecordSkillUsage(ctx, config.AgentID, trace.SkillsLoaded, true)
	}

	return turn, nil
}

func (s *TurnService) ensureInitialTurnAttempt(ctx context.Context, turnID string) (string, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return "", err
	}
	var existing persistence.TurnAttempt
	err = db.WithContext(ctx).
		Where("turn_id = ?", turnID).
		Order("attempt_index ASC").
		First(&existing).Error
	if err == nil {
		return existing.ID, nil
	}
	if err != gorm.ErrRecordNotFound {
		return "", fmt.Errorf("load initial turn attempt: %w", err)
	}
	attempt := &persistence.TurnAttempt{
		ID:           generateID("attempt"),
		TurnID:       turnID,
		AttemptIndex: 1,
		Status:       string(domain.TurnStatusRunning),
		StartedAt:    time.Now().UTC(),
	}
	if err := db.WithContext(ctx).Create(attempt).Error; err != nil {
		return "", fmt.Errorf("persist initial turn attempt: %w", err)
	}
	return attempt.ID, nil
}

// ---------------------------------------------------------------------------
// runCompression — encapsulates the full compression sub-flow
// ---------------------------------------------------------------------------

func (s *TurnService) runCompression(
	ctx context.Context,
	config *TurnConfig,
	turnID string,
	trace *domain.TurnTrace,
	assemblyResult *PromptAssemblyResult,
	messages []domain.Message,
) ([]domain.Message, error) {

	trace.CompressionTriggered = true

	// MemoryProvider hook: on_pre_compress — let external backend archive before eviction.
	if mp := s.memoryProvider(); mp != nil {
		if notifyErr := mp.OnPreCompress(messages); notifyErr != nil {
			logger.Warnf(ctx, "compression: MemoryProvider.OnPreCompress failed (non-fatal): turn_id=%s err=%v", turnID, notifyErr)
		}
	}

	// Step 1 — Knowledge Salvage: flush important context to memory before compression.
	// 2026-04-11 — Fix: pass config.Provider instead of relying on hardcoded "openai"
	//   inside FlushMemories, so flush works with any configured provider type.
	if flushErr := s.memoryService.FlushMemories(ctx, config.AgentID, messages, s.providerService, s.credentialPool, s.toolRegistry, config.Provider); flushErr != nil {
		logger.Warnf(ctx, "compression: flush_memories failed (non-fatal): turn_id=%s err=%v", turnID, flushErr)
	} else {
		logger.Infof(ctx, "compression: flush_memories completed, turn_id=%s", turnID)
	}

	// Step 2 — Execute compression (prune + split + build summary prompt).
	compResult, compErr := s.compression.Compress(ctx, messages, config.ContextWindowSize)
	if compErr != nil {
		logger.Errorf(ctx, "compression failed: turn_id=%s err=%v", turnID, compErr)
		_ = s.failTurn(ctx, config.AgentID, turnID, config.TaskID, config.StepID, "context compression failed")
		return nil, errcode.New(errcode.AgentCompressionFailed, http.StatusInternalServerError,
			"context compression failed", compErr)
	}

	trace.CompressionBefore = compResult.TokensBefore
	trace.CompressionAfter = compResult.TokensAfter

	// Step 3 — Execute LLM summary call if summary prompt was generated.
	if compResult.Summary != "" {
		summaryText, summaryErr := s.executeSummaryLLM(ctx, config, compResult.Summary)
		if summaryErr != nil {
			logger.Warnf(ctx, "compression: summary LLM call failed (non-fatal): turn_id=%s err=%v", turnID, summaryErr)
		} else {
			// Prepend summary as a system message to the compressed messages.
			summaryMsg := domain.Message{
				MessageID: generateID("summary"),
				Role:      domain.MessageRoleSystem,
				Content:   summaryText,
				CreatedAt: time.Now(),
				UpdatedAt: time.Now(),
			}
			compResult.Messages = append([]domain.Message{summaryMsg}, compResult.Messages...)

			logger.Infof(ctx, "compression: summary generated, turn_id=%s summary_len=%d", turnID, len(summaryText))
		}
	}

	messages = compResult.Messages

	logger.Infof(ctx, "compression applied: turn_id=%s before=%d after=%d pruned=%v",
		turnID, compResult.TokensBefore, compResult.TokensAfter, compResult.WasPruned)

	// Rebuild system prompt with fresh snapshot after compression.
	freshAssembly, freshErr := s.promptAssembly.Assemble(
		ctx,
		config.AgentID,
		config.Identity,
		config.AgentConfigPrompt,
		config.AvailableTools,
		messages[len(messages)-1].Content,
		config.KnowledgeResources,
		config.MemoryDisabled,
	)
	if freshErr != nil {
		logger.Warnf(ctx, "post-compression prompt reassembly failed: turn_id=%s err=%v", turnID, freshErr)
	} else {
		*assemblyResult = *freshAssembly
		trace.MemorySnapshotHash = freshAssembly.MemorySnapshotHash
		trace.SkillIndexHash = freshAssembly.SkillIndexHash
		trace.KnowledgeChunks = freshAssembly.KnowledgeChunks
	}

	// Step 4 — Session Split: mark old conversation as compressed, create
	// a child conversation linked via parent_session_id.
	oldConvID := config.ConversationID
	newConvID, splitErr := s.splitSession(ctx, config)
	if splitErr != nil {
		logger.Warnf(ctx, "compression: session split failed (non-fatal): turn_id=%s err=%v", turnID, splitErr)
	} else {
		config.ConversationID = newConvID
		logger.Infof(ctx, "compression: session split completed, turn_id=%s old_conv=%s new_conv=%s", turnID, oldConvID, newConvID)
	}

	return messages, nil
}

// ---------------------------------------------------------------------------
// executeSummaryLLM — produce actual summary text from a summary prompt
// ---------------------------------------------------------------------------

// executeSummaryLLM leases a credential and calls the LLM to generate a
// concise summary from the given summary prompt. The summary prompt is
// produced by CompressionService.Compress and contains the conversation
// text to summarize along with formatting instructions.
func (s *TurnService) executeSummaryLLM(ctx context.Context, config *TurnConfig, summaryPrompt string) (string, error) {
	credential, err := s.credentialPool.Lease(ctx, config.ActorID, config.Provider, domain.RotationRoundRobin)
	if err != nil {
		return "", fmt.Errorf("no credential for summary: %w", err)
	}
	defer s.credentialPool.Release(ctx, credential.CredentialID)

	resp, err := s.providerService.Call(ctx, &ProviderCallRequest{
		ProviderID:   credential.CredentialID,
		Model:        config.Model,
		SystemPrompt: "You are a summarization assistant. Produce a concise structured summary.",
		Messages: []domain.Message{{
			Role:    domain.MessageRoleUser,
			Content: summaryPrompt,
		}},
		ProviderType: config.Provider,
	})
	if err != nil {
		return "", err
	}

	return resp.Content, nil
}

// ---------------------------------------------------------------------------
// memoryProvider — accessor for the external MemoryProvider (may be nil)
// ---------------------------------------------------------------------------

// memoryProvider returns the external MemoryProvider if one is attached, or nil.
func (s *TurnService) memoryProvider() domain.MemoryProvider {
	return s.memoryService.GetMemoryProvider()
}

// ---------------------------------------------------------------------------
// splitSession — compression session split
// ---------------------------------------------------------------------------

// splitSession marks the current conversation as "compressed" and creates a
// new child conversation linked via ParentID. This implements Session Split
// from the architecture spec (Session Split -> Rebuild System Prompt).
func (s *TurnService) splitSession(ctx context.Context, config *TurnConfig) (string, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return "", fmt.Errorf("split session: db access failed: %w", err)
	}

	// Mark the old conversation as compressed.
	if err := db.Model(&persistence.Conversation{}).
		Where("id = ?", config.ConversationID).
		Updates(map[string]interface{}{
			"status":     "compressed",
			"updated_at": time.Now(),
		}).Error; err != nil {
		return "", fmt.Errorf("split session: failed to mark old conversation: %w", err)
	}

	// Create a new child conversation inheriting the parent's settings.
	newID := generateID("conv")
	parentID := config.ConversationID
	newConv := persistence.Conversation{
		ID:         newID,
		AgentID:    config.AgentID,
		Ptid:       config.ActorID,
		Title:      "Continued (post-compression)",
		ProviderID: config.Provider,
		Status:     "active",
		ParentID:   &parentID,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}
	if err := db.Create(&newConv).Error; err != nil {
		return "", fmt.Errorf("split session: failed to create child conversation: %w", err)
	}

	return newID, nil
}

// ---------------------------------------------------------------------------
// providerCallWithRetry — credential rotation + error recovery loop
// ---------------------------------------------------------------------------

// providerCallWithRetry performs the LLM provider call with a retry loop that
// integrates error classification, credential rotation, compression fallback,
// and model fallback. Returns the assistant response text and all provider
// call records for trace logging.
func (s *TurnService) providerCallWithRetry(
	ctx context.Context,
	config *TurnConfig,
	turnID string,
	trace *domain.TurnTrace,
	systemPrompt string,
	messages []domain.Message,
) (string, []domain.ProviderCallRecord, bool, error) {

	maxRetries := config.MaxRetries
	if maxRetries <= 0 {
		maxRetries = 3
	}

	var providerCalls []domain.ProviderCallRecord

	// Recover any cooled-down credentials before starting the retry loop.
	if recovered, _ := s.credentialPool.RecoverCooledDown(ctx); recovered > 0 {
		logger.Infof(ctx, "credential recovery: %d credentials restored before provider call", recovered)
	}

	strategy := config.RotationStrategy
	if strategy == "" {
		strategy = domain.RotationRoundRobin
	}

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if err := ctx.Err(); err != nil {
			return "", providerCalls, false, err
		}

		providerID := strings.TrimSpace(config.Provider)
		if providerID == "" {
			return "", providerCalls, false, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
				"provider is required in turn config", nil)
		}

		// Turn-time revalidation: verify provider and model are valid before execution.
		if attempt == 0 {
			if revalErr := s.revalidateProviderState(ctx, config.ActorID, providerID, config.Model); revalErr != nil {
				return "", providerCalls, false, revalErr
			}
		}

		// Lease a credential for the provider.
		credential, leaseErr := s.credentialPool.Lease(ctx, config.ActorID, providerID, strategy)
		if leaseErr != nil {
			logger.Errorf(ctx, "credential lease failed: turn_id=%s attempt=%d err=%v",
				turnID, attempt, leaseErr)

			// If no credential is available on a retry, it's fatal.
			if attempt > 0 {
				return "", providerCalls, false, errcode.New(errcode.AgentCredentialFailed,
					http.StatusServiceUnavailable, "no credentials available after rotation", leaseErr)
			}
			return "", providerCalls, false, leaseErr
		}

		logger.Infof(ctx, "credential leased: turn_id=%s attempt=%d credential_id=%s",
			turnID, attempt, credential.CredentialID)

		callStart := time.Now()

		resp, callErr := s.providerService.Call(ctx, &ProviderCallRequest{
			ProviderID:   credential.CredentialID,
			Model:        config.Model,
			SystemPrompt: systemPrompt,
			Messages:     messages,
			ProviderType: config.Provider,
			Effort:       config.Effort,
			DeltaSink: func(deltaCtx context.Context, delta ProviderDelta) {
				s.emitTurnEvent(deltaCtx, config, turnID, TurnEvent{
					Type:  delta.Type,
					Text:  delta.Content,
					Stage: "provider_delta",
				})
			},
		})

		callDuration := time.Since(callStart)
		if err := ctx.Err(); err != nil {
			return "", providerCalls, false, err
		}

		// Build provider call record for trace regardless of outcome.
		callRecord := domain.ProviderCallRecord{
			Provider:     config.Provider,
			Model:        config.Model,
			Latency:      callDuration,
			CredentialID: credential.CredentialID,
		}

		if resp != nil {
			callRecord.InputTokens = resp.InputTokens
			callRecord.OutputTokens = resp.OutputTokens
			callRecord.CacheHit = resp.CacheHit
			if resp.Model != "" {
				callRecord.Model = resp.Model
			}
		}
		providerCalls = append(providerCalls, callRecord)

		// Release credential (no-op today, future distributed lock support).
		_ = s.credentialPool.Release(ctx, credential.CredentialID)

		// Success path.
		if callErr == nil && resp != nil {
			logger.Infof(ctx, "provider call success: turn_id=%s attempt=%d model=%s input=%d output=%d latency=%s",
				turnID, attempt, resp.Model, resp.InputTokens, resp.OutputTokens, callDuration)
			return resp.Content, providerCalls, resp.Streamed, nil
		}

		// Error classification and recovery decision.
		classified := s.errorClassifier.Classify(
			callErr,
			config.Provider,
			config.Model,
			s.compression.EstimateTokens(messages),
			config.ContextWindowSize,
		)
		trace.ErrorClassified = append(trace.ErrorClassified, *classified)

		logger.Warnf(ctx, "provider call failed: turn_id=%s attempt=%d reason=%s retryable=%v",
			turnID, attempt, classified.Reason.String(), classified.Retryable)

		if attempt > 0 && s.growthMetrics != nil {
			s.growthMetrics.RecordEvent(ctx, config.AgentID, EventTurnRetried, CategoryTurn, turnID, fmt.Sprintf("attempt=%d reason=%s", attempt, classified.Reason.String()), "retry")
		}

		// Recovery: mark credential based on error type.
		if classified.ShouldRotateCredential {
			if classified.Reason == domain.FailoverReasonAuth || classified.Reason == domain.FailoverReasonBilling {
				_ = s.credentialPool.MarkExhausted(ctx, credential.CredentialID, classified.HTTPStatus)
			} else {
				_ = s.credentialPool.MarkError(ctx, credential.CredentialID)
			}
		}

		// Recovery: trigger compression on context overflow.
		if classified.ShouldCompress && !trace.CompressionTriggered {
			logger.Infof(ctx, "error recovery: triggering compression, turn_id=%s", turnID)
			compResult, compErr := s.compression.Compress(ctx, messages, config.ContextWindowSize)
			if compErr == nil {
				trace.CompressionTriggered = true
				trace.CompressionBefore = compResult.TokensBefore
				trace.CompressionAfter = compResult.TokensAfter
				messages = compResult.Messages
			} else {
				logger.Errorf(ctx, "error recovery compression failed: turn_id=%s err=%v", turnID, compErr)
			}
		}

		// Recovery: fallback to alternate model on billing/model_not_found errors.
		// Fix 2026-04-11: ShouldFallback was classified but never acted on,
		// causing billing and model_not_found errors to exhaust retries instead
		// of switching to the configured fallback model.
		if classified.ShouldFallback && config.FallbackModel != "" && config.Model != config.FallbackModel {
			logger.Infof(ctx, "error recovery: falling back to model %s, turn_id=%s reason=%s",
				config.FallbackModel, turnID, classified.Reason.String())
			config.Model = config.FallbackModel
		}

		// Non-retryable errors terminate the loop immediately.
		if !classified.Retryable && !classified.ShouldCompress && !classified.ShouldRotateCredential && !classified.ShouldFallback {
			return "", providerCalls, false, errcode.New(errcode.AgentProviderFailed, http.StatusBadGateway,
				fmt.Sprintf("non-retryable provider error: %s", classified.Reason.String()), callErr)
		}
	}

	return "", providerCalls, false, errcode.New(errcode.AgentProviderFailed, http.StatusBadGateway,
		fmt.Sprintf("provider call exhausted %d retries", maxRetries), nil)
}

// ---------------------------------------------------------------------------
// processToolCalls — tool call iteration loop
// ---------------------------------------------------------------------------

// maxToolIterations is the hard upper bound on tool call rounds per turn
// to prevent infinite loops from adversarial or buggy tool responses.
const (
	maxToolIterations = 25
	localToolTimeout  = 120 * time.Second

	toolContinuationPollInterval      = 250 * time.Millisecond
	toolContinuationLeaseTTL          = 2 * time.Minute
	preparedTakeoverReconcileInterval = 5 * time.Second
)

// processToolCalls parses tool_calls from the assistant response, executes
// them (including delegation), appends results as tool-role messages,
// re-invokes the provider, and loops until the assistant stops producing
// tool calls. The final assistant response is updated in-place via the
// responsePtr parameter.
func (s *TurnService) processToolCalls(
	ctx context.Context,
	config *TurnConfig,
	turnID string,
	trace *domain.TurnTrace,
	systemPrompt string,
	messages []domain.Message,
	responsePtr *string,
	startingIterations int,
) (int, bool, error) {
	iterations := startingIterations

	for iterations < maxToolIterations {
		toolCalls := s.parseToolCalls(*responsePtr)
		if len(toolCalls) == 0 {
			break
		}

		iterations++
		logger.Infof(ctx, "tool iteration %d: turn_id=%s tool_count=%d", iterations, turnID, len(toolCalls))

		if err := s.persistMessage(
			ctx,
			config.ConversationID,
			turnID,
			string(domain.MessageRoleAssistant),
			*responsePtr,
			config.Model,
		); err != nil {
			return iterations, false, fmt.Errorf("persist assistant tool-call message: %w", err)
		}
		messages = append(messages, domain.Message{
			MessageID:      generateID("msg"),
			ConversationID: config.ConversationID,
			TurnID:         turnID,
			Role:           domain.MessageRoleAssistant,
			Content:        *responsePtr,
			CreatedAt:      time.Now(),
			UpdatedAt:      time.Now(),
		})

		toolBatchID := stableToolBatchID(turnID, config.AttemptID, iterations)
		clientProposals := make([]ClientToolProposal, 0, len(toolCalls))

		for index, tc := range toolCalls {
			callStart := time.Now()
			callID := stableToolCallID(toolBatchID, index, tc)
			s.emitTurnEvent(ctx, config, turnID, TurnEvent{
				Type:       "tool_call",
				ToolCallID: callID,
				ToolName:   tc.ToolName,
				Arguments:  tc.Arguments,
				Iteration:  iterations,
			})

			if isClientOwnedTool(tc.ToolName) {
				capabilityID := capabilityIDForTool(tc.ToolName)
				if capabilityID == "" {
					return iterations, false, fmt.Errorf("client capability mapping missing for %s", tc.ToolName)
				}
				clientProposals = append(clientProposals, ClientToolProposal{
					ToolCallID:    callID,
					ToolName:      tc.ToolName,
					CapabilityID:  capabilityID,
					SchemaVersion: "1",
					Arguments:     []byte(tc.Arguments),
				})
				continue
			}

			var toolResult string
			var toolErr error

			meta := &domain.ToolCallMeta{
				AgentID:        config.AgentID,
				ConversationID: config.ConversationID,
				TurnID:         turnID,
			}

			if tc.ToolName == "station_human_decision_resume" {
				toolResult, toolErr = s.executeStationHumanDecisionResumeTool(ctx, config, turnID, tc)
			} else if tc.ToolName == "delegate_task" {
				toolResult, toolErr = s.executeDelegation(ctx, turnID, tc, config)
			} else {
				result := s.toolRegistry.Dispatch(ctx, meta, tc.ToolName, tc.Arguments)
				toolResult = result.Content
				if result.IsError {
					toolErr = fmt.Errorf("%s", result.Content)
				}
			}

			if err := s.recordToolOutcome(
				ctx,
				config,
				turnID,
				trace,
				&messages,
				callID,
				tc,
				toolResult,
				toolErr,
				time.Since(callStart),
				iterations,
				true,
			); err != nil {
				return iterations, false, err
			}
		}

		if len(clientProposals) > 0 {
			if s.toolDispatch == nil {
				return iterations, false, fmt.Errorf("tool dispatch not configured")
			}
			if strings.TrimSpace(config.ClientCapabilitySessionID) == "" {
				return iterations, false, errcode.New(
					errcode.AgentInvalidRequest,
					http.StatusConflict,
					"client capability session is required for device-local tools",
					nil,
				)
			}
			decisions, err := s.toolDispatch.ProposeBatch(ctx, ToolBatchProposal{
				ActorID:                   config.ActorID,
				TurnID:                    turnID,
				AttemptID:                 config.AttemptID,
				ToolBatchID:               toolBatchID,
				ConversationID:            config.ConversationID,
				AgentID:                   config.AgentID,
				Provider:                  config.Provider,
				Model:                     config.Model,
				Effort:                    config.Effort,
				SystemPrompt:              systemPrompt,
				Iteration:                 uint32(iterations),
				MaxRetries:                uint32(config.MaxRetries),
				ContextWindowSize:         uint32(config.ContextWindowSize),
				TaskID:                    config.TaskID,
				StepID:                    config.StepID,
				ClientCapabilitySessionID: config.ClientCapabilitySessionID,
				Deadline:                  time.Now().UTC().Add(localToolTimeout),
				Calls:                     clientProposals,
			})
			if err != nil {
				return iterations, false, err
			}
			for _, decision := range decisions {
				s.emitTurnEvent(ctx, config, turnID, toolDecisionTurnEvent(decision, iterations))
			}
			return iterations, true, nil
		}

		nextResponse, providerCalls, _, reCallErr := s.providerCallWithRetry(
			ctx, config, turnID, trace, systemPrompt, messages,
		)
		if reCallErr != nil {
			return iterations, false, fmt.Errorf("provider re-call after tool iteration %d: %w", iterations, reCallErr)
		}
		trace.ProviderCalls = append(trace.ProviderCalls, providerCalls...)

		*responsePtr = nextResponse
	}

	if iterations >= maxToolIterations {
		logger.Warnf(ctx, "tool iteration hard limit reached: turn_id=%s iterations=%d", turnID, iterations)
		*responsePtr = stripToolCallMarkup(*responsePtr)
	}

	return iterations, false, nil
}

func toolDecisionTurnEvent(decision ProposalDecision, iteration int) TurnEvent {
	if decision.Status == persistence.ToolCallStatusWaitingApproval {
		return TurnEvent{
			Type:             "tool_approval_required",
			ToolCallID:       decision.ToolCallID,
			ToolName:         decision.ToolName,
			Arguments:        decision.Arguments,
			ApprovalID:       decision.ApprovalID,
			DecisionRevision: decision.DecisionRevision,
			Iteration:        iteration,
		}
	}
	return TurnEvent{
		Type:       "tool_dispatch_state",
		ToolCallID: decision.ToolCallID,
		Stage:      decision.Status,
		Iteration:  iteration,
	}
}

func (s *TurnService) markTurnWaitingForLocalTool(
	ctx context.Context,
	turnID string,
	attemptID string,
	toolIterations int,
) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&persistence.AgentTurn{}).
			Where("id = ? AND status IN ?", turnID, []string{
				string(domain.TurnStatusRunning),
				string(domain.TurnStatusWaitingLocalTool),
			}).
			Updates(map[string]interface{}{
				"status":          string(domain.TurnStatusWaitingLocalTool),
				"tool_iterations": toolIterations,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return fmt.Errorf("turn %s is not eligible to wait for a local tool", turnID)
		}
		return tx.Model(&persistence.TurnAttempt{}).
			Where("id = ? AND turn_id = ?", attemptID, turnID).
			Update("status", string(domain.TurnStatusWaitingLocalTool)).Error
	})
}

func (s *TurnService) RunToolContinuationWorker(ctx context.Context) {
	ticker := time.NewTicker(toolContinuationPollInterval)
	defer ticker.Stop()
	nextTakeoverReconciliation := time.Time{}

	for {
		now := time.Now()
		if !now.Before(nextTakeoverReconciliation) {
			if _, err := s.toolDispatch.ReconcilePreparedCapabilityTakeovers(ctx); err != nil {
				logger.Errorf(ctx, "prepared capability takeover failed: %v", err)
			}
			nextTakeoverReconciliation = now.Add(preparedTakeoverReconcileInterval)
		}
		if _, err := s.toolDispatch.SettleExpiredToolCalls(ctx); err != nil {
			logger.Errorf(ctx, "expired tool settlement failed: %v", err)
		} else if err := s.settleBlockedToolBatches(ctx); err != nil {
			logger.Errorf(ctx, "blocked tool batch settlement failed: %v", err)
		} else if err := s.toolDispatch.ReconcileExpiredContinuations(ctx); err != nil {
			logger.Errorf(ctx, "tool continuation reconciliation failed: %v", err)
		} else if err := s.settleReconciliationRequiredTurns(ctx); err != nil {
			logger.Errorf(ctx, "tool continuation settlement failed: %v", err)
		}
		for {
			resumed, err := s.ResumeReadyToolContinuation(ctx, toolContinuationLeaseTTL)
			if err != nil {
				logger.Errorf(ctx, "tool continuation worker failed: %v", err)
				break
			}
			if !resumed {
				break
			}
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *TurnService) settleBlockedToolBatches(ctx context.Context) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	var rows []struct {
		TurnID         string
		AgentID        string
		ConversationID string
		TaskID         string
		StepID         string
	}
	if err := db.WithContext(ctx).
		Table("agent_tool_batches AS batch").
		Select("batch.turn_id, batch.agent_id, batch.conversation_id, batch.task_id, batch.step_id").
		Joins("JOIN agent_turns AS turn_record ON turn_record.id = batch.turn_id").
		Where(
			"batch.status = ? AND turn_record.status = ?",
			persistence.ToolBatchStatusBlocked,
			string(domain.TurnStatusWaitingLocalTool),
		).
		Scan(&rows).Error; err != nil {
		return fmt.Errorf("load blocked tool batches: %w", err)
	}
	for _, row := range rows {
		if err := s.interruptTurnForToolBlock(
			ctx,
			row.AgentID,
			row.TurnID,
			row.ConversationID,
			row.TaskID,
			row.StepID,
			"tool_batch_blocked",
		); err != nil {
			return err
		}
		if s.chatTaskService != nil && row.StepID != "" {
			if err := s.chatTaskService.FailChatStep(
				ctx,
				row.TaskID,
				row.StepID,
				"tool batch blocked",
			); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *TurnService) settleReconciliationRequiredTurns(ctx context.Context) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	var rows []struct {
		TurnID         string
		AgentID        string
		ConversationID string
		TaskID         string
		StepID         string
	}
	if err := db.WithContext(ctx).
		Table("agent_tool_continuations AS continuation").
		Select("batch.turn_id, batch.agent_id, batch.conversation_id, batch.task_id, batch.step_id").
		Joins("JOIN agent_tool_batches AS batch ON batch.id = continuation.tool_batch_id").
		Joins("JOIN agent_turns AS turn_record ON turn_record.id = batch.turn_id").
		Where(
			"continuation.status = ? AND turn_record.status = ?",
			persistence.ToolContinuationStatusReconciliationRequired,
			string(domain.TurnStatusWaitingLocalTool),
		).
		Scan(&rows).Error; err != nil {
		return fmt.Errorf("load reconciliation-required turns: %w", err)
	}
	for _, row := range rows {
		if err := s.interruptTurnForToolBlock(
			ctx,
			row.AgentID,
			row.TurnID,
			row.ConversationID,
			row.TaskID,
			row.StepID,
			"tool_continuation_reconciliation_required",
		); err != nil {
			return err
		}
		if s.chatTaskService != nil && row.StepID != "" {
			if err := s.chatTaskService.FailChatStep(
				ctx,
				row.TaskID,
				row.StepID,
				"tool continuation requires reconciliation",
			); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *TurnService) interruptTurnForToolBlock(
	ctx context.Context,
	agentID string,
	turnID string,
	conversationID string,
	taskID string,
	stepID string,
	reasonCode string,
) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	now := time.Now()
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&persistence.AgentTurn{}).
			Where("id = ? AND status = ?", turnID, string(domain.TurnStatusWaitingLocalTool)).
			Updates(map[string]interface{}{
				"status":         string(domain.TurnStatusInterrupted),
				"final_response": reasonCode,
				"ended_at":       now,
			}).Error; err != nil {
			return err
		}
		return tx.Model(&persistence.TurnAttempt{}).
			Where("turn_id = ? AND ended_at IS NULL", turnID).
			Updates(map[string]interface{}{
				"status":     string(domain.TurnStatusInterrupted),
				"error_code": reasonCode,
				"ended_at":   now,
			}).Error
	}); err != nil {
		return fmt.Errorf("interrupt reconciliation-required turn: %w", err)
	}
	s.emitTurnEvent(ctx, &TurnConfig{
		AgentID:        agentID,
		ConversationID: conversationID,
		TaskID:         taskID,
		StepID:         stepID,
	}, turnID, TurnEvent{
		Type:  "error",
		Stage: reasonCode,
		Error: reasonCode,
	})
	return nil
}

func (s *TurnService) ResumeReadyToolContinuation(
	ctx context.Context,
	leaseDuration time.Duration,
) (bool, error) {
	if s.toolDispatch == nil {
		return false, fmt.Errorf("tool dispatch not configured")
	}
	if err := s.toolDispatch.ReconcileExpiredContinuations(ctx); err != nil {
		return false, err
	}
	continuation, err := s.toolDispatch.ClaimReadyContinuation(ctx, leaseDuration)
	if err == gorm.ErrRecordNotFound {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	db, err := s.getDB(ctx)
	if err != nil {
		return true, err
	}
	var batch persistence.ToolBatch
	if err := db.WithContext(ctx).First(&batch, "id = ?", continuation.ToolBatchID).Error; err != nil {
		return true, fmt.Errorf("load continuation tool batch: %w", err)
	}
	var turnRecord persistence.AgentTurn
	if err := db.WithContext(ctx).First(&turnRecord, "id = ?", continuation.TurnID).Error; err != nil {
		return true, fmt.Errorf("load continuation turn: %w", err)
	}
	if turnRecord.Status != string(domain.TurnStatusWaitingLocalTool) {
		return true, fmt.Errorf("turn %s is not waiting for a local tool", turnRecord.ID)
	}

	config := &TurnConfig{
		TurnID:                    batch.TurnID,
		AgentID:                   batch.AgentID,
		ActorID:                   batch.ActorID,
		ConversationID:            batch.ConversationID,
		ContextWindowSize:         int(batch.ContextWindowSize),
		MaxRetries:                int(batch.MaxRetries),
		Provider:                  batch.Provider,
		Model:                     batch.Model,
		Effort:                    batch.Effort,
		ClientCapabilitySessionID: batch.CapabilitySessionID,
		TaskID:                    batch.TaskID,
		StepID:                    batch.StepID,
		AttemptID:                 batch.AttemptID,
	}
	trace, err := s.loadTurnTraceForResume(ctx, batch.TurnID)
	if err != nil {
		return true, err
	}
	messages, err := s.loadMessages(ctx, batch.ConversationID)
	if err != nil {
		return true, err
	}
	if err := s.appendClientToolResultsToTrace(ctx, trace, batch.ID); err != nil {
		return true, err
	}
	if err := s.toolDispatch.MarkContinuationEmitted(
		ctx,
		continuation.ID,
		continuation.LeaseID,
		continuation.FencingToken,
		false,
	); err != nil {
		return true, err
	}

	providerCall := s.resumeProviderCall
	if providerCall == nil {
		providerCall = s.providerCallWithRetry
	}
	nextResponse, providerCalls, _, callErr := providerCall(
		ctx,
		config,
		batch.TurnID,
		trace,
		batch.SystemPrompt,
		messages,
	)
	trace.ProviderCalls = append(trace.ProviderCalls, providerCalls...)
	if callErr != nil {
		if usageErr := s.persistAttemptUsage(ctx, batch.TurnID, batch.AttemptID, trace); usageErr != nil {
			return true, fmt.Errorf("persist continuation usage: %w", usageErr)
		}
		_ = s.saveTurnTrace(ctx, trace)
		_ = s.toolDispatch.CompleteContinuation(
			ctx,
			continuation.ID,
			continuation.LeaseID,
			continuation.FencingToken,
			nil,
		)
		_ = s.failTurn(ctx, batch.AgentID, batch.TurnID, batch.TaskID, batch.StepID, "provider continuation failed")
		if s.chatTaskService != nil && batch.StepID != "" {
			_ = s.chatTaskService.FailChatStep(ctx, batch.TaskID, batch.StepID, "provider continuation failed")
		}
		return true, fmt.Errorf("continue provider after tool batch: %w", callErr)
	}

	toolIterations, paused, processErr := s.processToolCalls(
		ctx,
		config,
		batch.TurnID,
		trace,
		batch.SystemPrompt,
		messages,
		&nextResponse,
		int(batch.Iteration),
	)
	if usageErr := s.persistAttemptUsage(ctx, batch.TurnID, batch.AttemptID, trace); usageErr != nil {
		return true, fmt.Errorf("persist continuation usage: %w", usageErr)
	}
	if processErr != nil {
		_ = s.saveTurnTrace(ctx, trace)
		_ = s.toolDispatch.CompleteContinuation(
			ctx,
			continuation.ID,
			continuation.LeaseID,
			continuation.FencingToken,
			[]byte(nextResponse),
		)
		_ = s.failTurn(ctx, batch.AgentID, batch.TurnID, batch.TaskID, batch.StepID, "tool continuation processing failed")
		if s.chatTaskService != nil && batch.StepID != "" {
			_ = s.chatTaskService.FailChatStep(ctx, batch.TaskID, batch.StepID, "tool continuation processing failed")
		}
		return true, processErr
	}

	if paused {
		if err := s.markTurnWaitingForLocalTool(ctx, batch.TurnID, batch.AttemptID, toolIterations); err != nil {
			return true, err
		}
		if err := s.saveTurnTrace(ctx, trace); err != nil {
			logger.Errorf(ctx, "failed to save resumed turn trace: turn_id=%s err=%v", batch.TurnID, err)
		}
		s.emitTurnEvent(ctx, config, batch.TurnID, TurnEvent{
			Type:      "progress",
			Stage:     "waiting_local_tool",
			Iteration: toolIterations,
		})
	} else {
		nextResponse = stripToolCallMarkup(nextResponse)
		if _, err := s.finishTurnExecution(
			ctx,
			config,
			&turnRecord,
			trace,
			messages,
			stringValue(turnRecord.UserInput),
			nextResponse,
			toolIterations,
		); err != nil {
			return true, err
		}
		if s.chatTaskService != nil && batch.StepID != "" {
			if err := s.chatTaskService.FinishChatStep(
				ctx,
				batch.TaskID,
				batch.StepID,
				batch.TurnID,
				nextResponse,
			); err != nil {
				return true, err
			}
		}
	}

	if err := s.toolDispatch.CompleteContinuation(
		ctx,
		continuation.ID,
		continuation.LeaseID,
		continuation.FencingToken,
		[]byte(nextResponse),
	); err != nil {
		return true, err
	}
	return true, nil
}

func (s *TurnService) loadTurnTraceForResume(ctx context.Context, turnID string) (*domain.TurnTrace, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var record persistence.TurnTrace
	err = db.WithContext(ctx).Where("turn_id = ?", turnID).First(&record).Error
	if err == gorm.ErrRecordNotFound {
		return &domain.TurnTrace{TraceID: generateID("trace"), TurnID: turnID}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load turn trace for continuation: %w", err)
	}
	entry, err := persistenceTurnTraceToDomain(&record)
	if err != nil {
		return nil, fmt.Errorf("decode turn trace for continuation: %w", err)
	}
	return &entry.Trace, nil
}

func (s *TurnService) appendClientToolResultsToTrace(
	ctx context.Context,
	trace *domain.TurnTrace,
	toolBatchID string,
) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	var calls []persistence.ToolCall
	if err := db.WithContext(ctx).
		Where("tool_batch_id = ?", toolBatchID).
		Order("created_at ASC").
		Find(&calls).Error; err != nil {
		return fmt.Errorf("load tool calls for continuation trace: %w", err)
	}
	for i := range calls {
		trace.ToolCalls = append(trace.ToolCalls, domain.ToolCallRecord{
			ToolName:  calls[i].ToolName,
			Arguments: string(calls[i].BoundedArguments),
			Result:    calls[i].ResultRef,
		})
	}
	return nil
}

func (s *TurnService) recordToolOutcome(
	ctx context.Context,
	config *TurnConfig,
	turnID string,
	trace *domain.TurnTrace,
	messages *[]domain.Message,
	callID string,
	tc toolCallEntry,
	toolResult string,
	toolErr error,
	duration time.Duration,
	iteration int,
	persist bool,
) error {
	resultContent := toolResult
	if toolErr != nil {
		resultContent = fmt.Sprintf("[tool_error] %s: %v", tc.ToolName, toolErr)
		logger.Warnf(ctx, "tool call failed: turn_id=%s tool=%s err=%v", turnID, tc.ToolName, toolErr)
	}
	event := TurnEvent{
		Type:       "tool_result",
		ToolCallID: callID,
		ToolName:   tc.ToolName,
		Result:     resultContent,
		Iteration:  iteration,
	}
	if toolErr != nil {
		event.Error = toolErr.Error()
	}
	s.emitTurnEvent(ctx, config, turnID, event)

	if tc.ToolName == "skill_view" && toolErr == nil {
		var viewArgs struct {
			Name string `json:"name"`
		}
		if json.Unmarshal([]byte(tc.Arguments), &viewArgs) == nil && viewArgs.Name != "" {
			seen := false
			for _, skillName := range trace.SkillsLoaded {
				if skillName == viewArgs.Name {
					seen = true
					break
				}
			}
			if !seen {
				trace.SkillsLoaded = append(trace.SkillsLoaded, viewArgs.Name)
			}
		}
	}

	trace.ToolCalls = append(trace.ToolCalls, domain.ToolCallRecord{
		ToolName:  tc.ToolName,
		Arguments: tc.Arguments,
		Result:    resultContent,
		Duration:  duration,
	})
	toolMessage := fmt.Sprintf("[%s] %s", tc.ToolName, resultContent)
	if persist {
		if err := s.persistMessage(
			ctx,
			config.ConversationID,
			turnID,
			string(domain.MessageRoleTool),
			toolMessage,
			config.Model,
		); err != nil {
			return fmt.Errorf("persist tool message %s: %w", tc.ToolName, err)
		}
	}
	now := time.Now()
	*messages = append(*messages, domain.Message{
		MessageID:      generateID("msg"),
		ConversationID: config.ConversationID,
		TurnID:         turnID,
		Role:           domain.MessageRoleTool,
		Content:        toolMessage,
		CreatedAt:      now,
		UpdatedAt:      now,
	})
	return nil
}

func isClientOwnedTool(toolName string) bool {
	return capabilityIDForTool(toolName) != ""
}

func capabilityIDForTool(toolName string) string {
	switch toolName {
	case "local_file_read":
		return "filesystem.read"
	case "local_workspace_list":
		return "filesystem.list"
	case "local_clipboard_read":
		return "clipboard.read"
	case "local_clipboard_write":
		return "clipboard.write"
	case "local_shell_safe":
		return "shell.execute"
	case "local_mcp":
		return "mcp.invoke"
	default:
		return ""
	}
}

func stableToolBatchID(turnID string, attemptID string, iteration int) string {
	value := hashString(fmt.Sprintf("%s\x00%s\x00%d", turnID, attemptID, iteration))
	return "tool_batch_" + value[:24]
}

func stableToolCallID(toolBatchID string, index int, call toolCallEntry) string {
	value := hashString(fmt.Sprintf("%s\x00%d\x00%s\x00%s", toolBatchID, index, call.ToolName, call.Arguments))
	return "tool_call_" + value[:24]
}

func (s *TurnService) executeStationHumanDecisionResumeTool(
	ctx context.Context,
	config *TurnConfig,
	turnID string,
	tc toolCallEntry,
) (string, error) {
	if config == nil {
		return "", fmt.Errorf("turn config is required")
	}
	taskID := strings.TrimSpace(config.TaskID)
	stepID := strings.TrimSpace(config.StepID)
	if taskID == "" || stepID == "" {
		return "", fmt.Errorf("station_human_decision_resume requires task-bound turn config")
	}

	var args struct {
		InterruptID      string `json:"interrupt_id"`
		InterruptIDCamel string `json:"interruptId"`
		TaskID           string `json:"task_id"`
		TaskIDCamel      string `json:"taskId"`
	}
	if err := json.Unmarshal([]byte(tc.Arguments), &args); err != nil {
		return "", fmt.Errorf("invalid station_human_decision_resume arguments: %w", err)
	}
	if candidate := strings.TrimSpace(args.TaskID); candidate != "" && candidate != taskID {
		return "", fmt.Errorf("station_human_decision_resume task_id does not match bound task")
	}
	if candidate := strings.TrimSpace(args.TaskIDCamel); candidate != "" && candidate != taskID {
		return "", fmt.Errorf("station_human_decision_resume taskId does not match bound task")
	}
	interruptID := strings.TrimSpace(args.InterruptID)
	if interruptID == "" {
		interruptID = strings.TrimSpace(args.InterruptIDCamel)
	}
	if interruptID == "" {
		return "", fmt.Errorf("station_human_decision_resume requires interrupt_id")
	}

	waitCtx, cancel := context.WithTimeout(ctx, localToolTimeout)
	defer cancel()
	decision, err := s.AwaitLiveResume(waitCtx, taskID, stepID, turnID, interruptID)
	if err != nil {
		return "", fmt.Errorf("station_human_decision_resume wait failed: %w", err)
	}
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return "", fmt.Errorf("station_human_decision_resume db access failed: %w", err)
	}
	if err := markCollaborationResumeContextConsumed(ctx, db, interruptID, decision.StepID, decision.TurnID); err != nil {
		return "", fmt.Errorf("station_human_decision_resume consume failed: %w", err)
	}
	payload := map[string]interface{}{
		"interrupt_id":        decision.InterruptID,
		"task_id":             decision.TaskID,
		"step_id":             decision.StepID,
		"turn_id":             decision.TurnID,
		"event_id":            decision.EventID,
		"event_seq":           decision.EventSeq,
		"reason":              decision.Reason,
		"resume_payload_json": decision.ResumePayloadJSON,
		"resume_source":       "station.live_resume_broker",
	}
	encoded, _ := json.Marshal(payload)
	return string(encoded), nil
}

// ---------------------------------------------------------------------------
// executeDelegation — dispatch delegate_task tool calls
// ---------------------------------------------------------------------------

func (s *TurnService) executeDelegation(
	ctx context.Context,
	turnID string,
	tc toolCallEntry,
	config *TurnConfig,
) (string, error) {

	var task domain.DelegationTask
	if err := json.Unmarshal([]byte(tc.Arguments), &task); err != nil {
		return "", fmt.Errorf("invalid delegation task payload: %w", err)
	}

	// Fix 2026-04-11: propagate incremented depth to prevent infinite recursion.
	task.Depth = config.Depth + 1
	task.ParentTurnID = turnID

	// Recursive executor: runs a scoped mini turn-loop for each child task.
	// The child inherits the parent's provider/model settings but receives a
	// restricted toolset and incremented depth counter.
	executor := func(execCtx context.Context, t *domain.DelegationTask, toolset []string) (*domain.DelegationResult, error) {

		childConfig := &TurnConfig{
			AgentID:           config.AgentID,
			ConversationID:    fmt.Sprintf("%s_child_%s", config.ConversationID, t.TaskID),
			Identity:          config.Identity,
			AgentConfigPrompt: config.AgentConfigPrompt,
			AvailableTools:    toolset,
			ContextWindowSize: config.ContextWindowSize,
			MaxRetries:        config.MaxRetries,
			Provider:          config.Provider,
			Model:             config.Model,
			Effort:            config.Effort,
			FallbackModel:     config.FallbackModel,
			RotationStrategy:  config.RotationStrategy,
			Depth:             config.Depth + 1,
		}

		childInput := fmt.Sprintf("You are a delegated sub-agent. Your task:\n\n%s\n\n"+
			"Available tools: %v\n"+
			"Complete this task and return a concise summary of results.",
			t.Description, toolset)

		startedAt := time.Now()

		childTurn, err := s.ExecuteTurn(execCtx, childConfig, childInput)
		if err != nil {
			return nil, fmt.Errorf("child turn failed: %w", err)
		}

		endedAt := time.Now()
		return &domain.DelegationResult{
			TaskID:          t.TaskID,
			ParentTurnID:    t.ParentTurnID,
			TaskDescription: t.Description,
			ChildToolset:    toolset,
			Status:          domain.DelegationStatusCompleted,
			ResultSummary:   childTurn.FinalResponse,
			ToolIterations:  childTurn.ToolIterations,
			StartedAt:       startedAt,
			EndedAt:         &endedAt,
		}, nil
	}

	results, err := s.delegation.Execute(ctx, turnID, []domain.DelegationTask{task}, config.AvailableTools, executor)
	if err != nil {
		return "", err
	}

	// MemoryProvider hook: on_delegation — record delegation context in external backend.
	if mp := s.memoryProvider(); mp != nil {
		for _, r := range results {
			_ = mp.OnDelegation(r.TaskDescription, r.ResultSummary)
		}
	}

	resultJSON, _ := json.Marshal(results)
	return string(resultJSON), nil
}

// ---------------------------------------------------------------------------
// toolCallEntry / parseToolCalls — extract tool calls from assistant response
// ---------------------------------------------------------------------------

type toolCallEntry struct {
	ToolName  string
	Arguments string
}

func (s *TurnService) parseToolCalls(response string) []toolCallEntry {
	var calls []toolCallEntry
	calls = append(calls, parseToolCallsJSON(response)...)
	calls = append(calls, parseToolCallsArk(response)...)
	calls = append(calls, parseToolCallsSeedXML(response)...)
	return calls
}

func parseToolCallsJSON(response string) []toolCallEntry {
	var calls []toolCallEntry
	const openTag = "<tool_call>"
	const closeTag = "</tool_call>"
	remaining := response
	for {
		openIdx := indexOf(remaining, openTag)
		if openIdx < 0 {
			break
		}
		closeRelIdx := indexOf(remaining[openIdx:], closeTag)
		if closeRelIdx < 0 {
			break
		}
		jsonStr := strings.TrimSpace(remaining[openIdx+len(openTag) : openIdx+closeRelIdx])
		var parsed struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal([]byte(jsonStr), &parsed); err == nil && parsed.Name != "" {
			args := string(parsed.Arguments)
			if args == "" {
				args = "{}"
			}
			calls = append(calls, toolCallEntry{ToolName: parsed.Name, Arguments: args})
		}
		remaining = remaining[openIdx+closeRelIdx+len(closeTag):]
	}
	return calls
}

func parseToolCallsArk(response string) []toolCallEntry {
	var calls []toolCallEntry
	const openTag = "<|FunctionCallBegin|>"
	const closeTag = "<|FunctionCallEnd|>"
	remaining := response
	for {
		openIdx := indexOf(remaining, openTag)
		if openIdx < 0 {
			break
		}
		closeRelIdx := indexOf(remaining[openIdx:], closeTag)
		if closeRelIdx < 0 {
			break
		}
		jsonStr := strings.TrimSpace(remaining[openIdx+len(openTag) : openIdx+closeRelIdx])
		var arkCalls []struct {
			Name       string          `json:"name"`
			Parameters json.RawMessage `json:"parameters"`
		}
		if err := json.Unmarshal([]byte(jsonStr), &arkCalls); err == nil {
			for _, ac := range arkCalls {
				if ac.Name != "" {
					args := string(ac.Parameters)
					if args == "" {
						args = "{}"
					}
					calls = append(calls, toolCallEntry{ToolName: ac.Name, Arguments: args})
				}
			}
		}
		remaining = remaining[openIdx+closeRelIdx+len(closeTag):]
	}
	return calls
}

func parseToolCallsSeedXML(response string) []toolCallEntry {
	var calls []toolCallEntry
	const openTag = "<seed:tool_call>"
	const closeTag = "</seed:tool_call>"
	remaining := response
	for {
		openIdx := indexOf(remaining, openTag)
		if openIdx < 0 {
			break
		}
		closeRelIdx := indexOf(remaining[openIdx:], closeTag)
		if closeRelIdx < 0 {
			break
		}
		block := remaining[openIdx+len(openTag) : openIdx+closeRelIdx]
		funcOpen := "<function name=\""
		fIdx := indexOf(block, funcOpen)
		if fIdx >= 0 {
			afterFunc := block[fIdx+len(funcOpen):]
			endQuote := indexOf(afterFunc, "\"")
			if endQuote > 0 {
				funcName := afterFunc[:endQuote]
				funcBodyStart := afterFunc[endQuote+1:]
				funcClose := "</function>"
				fcIdx := indexOf(funcBodyStart, funcClose)
				if fcIdx >= 0 {
					funcBody := funcBodyStart[:fcIdx]
					params := parseSeedXMLParams(funcBody)
					argsJSON, _ := json.Marshal(params)
					if funcName != "" {
						calls = append(calls, toolCallEntry{ToolName: funcName, Arguments: string(argsJSON)})
					}
				}
			}
		}
		remaining = remaining[openIdx+closeRelIdx+len(closeTag):]
	}
	return calls
}

func parseSeedXMLParams(body string) map[string]string {
	params := make(map[string]string)
	remaining := body
	pClose := "</parameter>"
	for {
		pOpenTag := "<parameter name=\""
		pIdx := indexOf(remaining, pOpenTag)
		if pIdx < 0 {
			break
		}
		afterParam := remaining[pIdx+len(pOpenTag):]
		endQuote := indexOf(afterParam, "\"")
		if endQuote < 0 {
			break
		}
		paramName := afterParam[:endQuote]
		afterQuote := afterParam[endQuote+1:]
		pClOffset := indexOf(afterQuote, pClose)
		if pClOffset < 0 {
			break
		}
		paramVal := strings.TrimSpace(afterQuote[:pClOffset])
		if paramName != "" {
			params[paramName] = paramVal
		}
		remaining = afterQuote[pClOffset+len(pClose):]
	}
	return params
}

func stripToolCallMarkup(response string) string {
	cleaned := response
	for {
		openIdx := indexOf(cleaned, "<|FunctionCallBegin|>")
		if openIdx < 0 {
			break
		}
		closeRelIdx := indexOf(cleaned[openIdx:], "<|FunctionCallEnd|>")
		if closeRelIdx < 0 {
			cleaned = cleaned[:openIdx]
			break
		}
		cleaned = cleaned[:openIdx] + cleaned[openIdx+closeRelIdx+len("<|FunctionCallEnd|>"):]
	}
	for {
		openIdx := indexOf(cleaned, "<tool_call>")
		if openIdx < 0 {
			break
		}
		closeRelIdx := indexOf(cleaned[openIdx:], "</tool_call>")
		if closeRelIdx < 0 {
			cleaned = cleaned[:openIdx]
			break
		}
		cleaned = cleaned[:openIdx] + cleaned[openIdx+closeRelIdx+len("</tool_call>"):]
	}
	for {
		openIdx := indexOf(cleaned, "<seed:tool_call>")
		if openIdx < 0 {
			break
		}
		closeRelIdx := indexOf(cleaned[openIdx:], "</seed:tool_call>")
		if closeRelIdx < 0 {
			cleaned = cleaned[:openIdx]
			break
		}
		cleaned = cleaned[:openIdx] + cleaned[openIdx+closeRelIdx+len("</seed:tool_call>"):]
	}
	return strings.TrimSpace(cleaned)
}

// indexOf returns the index of substr in s, or -1 if not found.
func indexOf(s, substr string) int {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}

// ---------------------------------------------------------------------------
// Helper: createTurnRecord
// ---------------------------------------------------------------------------

func (s *TurnService) createOrReopenTurnRecord(ctx context.Context, config *TurnConfig, userInput string) (*persistence.AgentTurn, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	if precreatedTurnID := strings.TrimSpace(config.PrecreatedTurnID); precreatedTurnID != "" {
		var record persistence.AgentTurn
		if err := db.WithContext(ctx).
			Where("id = ? AND conversation_id = ? AND status = ?", precreatedTurnID, config.ConversationID, string(domain.TurnStatusRunning)).
			First(&record).Error; err != nil {
			return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusConflict,
				"precreated turn admission is unavailable", err)
		}
		config.TurnID = record.ID
		return &record, nil
	}
	if existingTurnID := strings.TrimSpace(config.ExistingTurnID); existingTurnID != "" {
		var record persistence.AgentTurn
		if err := db.WithContext(ctx).
			Where("id = ? AND conversation_id = ? AND status IN ?", existingTurnID, config.ConversationID, []string{
				string(domain.TurnStatusFailed),
				string(domain.TurnStatusCancelled),
			}).
			First(&record).Error; err != nil {
			return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusConflict,
				"source turn is not retryable", err)
		}
		if err := db.WithContext(ctx).Model(&record).Updates(map[string]interface{}{
			"status":         string(domain.TurnStatusRunning),
			"started_at":     now,
			"ended_at":       nil,
			"final_response": nil,
		}).Error; err != nil {
			return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"failed to reopen turn record", err)
		}
		config.TurnID = record.ID
		record.Status = string(domain.TurnStatusRunning)
		record.StartedAt = now
		record.EndedAt = nil
		record.FinalResponse = nil
		return &record, nil
	}

	record := &persistence.AgentTurn{
		ID:             strings.TrimSpace(config.TurnID),
		ConversationID: config.ConversationID,
		AgentID:        config.AgentID,
		UserInput:      &userInput,
		ToolIterations: 0,
		Status:         string(domain.TurnStatusRunning),
		StartedAt:      now,
	}
	if record.ID == "" {
		record.ID = generateID("turn")
	}

	if err := db.WithContext(ctx).Create(record).Error; err != nil {
		logger.Errorf(ctx, "failed to create turn record: agent_id=%s err=%v", config.AgentID, err)
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to create turn record", err)
	}

	return record, nil
}

// ---------------------------------------------------------------------------
// Helper: persistMessage
// ---------------------------------------------------------------------------

func (s *TurnService) persistMessage(ctx context.Context, conversationID, turnID, role, content, modelName string) error {
	return s.persistMessageWithLineage(
		ctx, conversationID, turnID, role, content, modelName, "", "", "",
	)
}

func (s *TurnService) persistMessageWithLineage(
	ctx context.Context,
	conversationID string,
	turnID string,
	role string,
	content string,
	modelName string,
	branchID string,
	parentMessageID string,
	replacesMessageID string,
) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	now := time.Now()
	msg := &persistence.AgentMessage{
		ID:             generateID("msg"),
		ConversationID: conversationID,
		TurnID:         &turnID,
		Role:           role,
		Status:         "completed",
		Content:        &content,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if modelName != "" {
		msg.ModelName = &modelName
	}
	if branchID != "" {
		msg.BranchID = &branchID
	}
	if replacesMessageID != "" {
		msg.ReplacesMessageID = &replacesMessageID
	}

	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var conversation persistence.Conversation
		if err := tx.First(&conversation, "id = ?", conversationID).Error; err != nil {
			return err
		}
		var maxSeq struct{ MaxSeq int64 }
		if err := tx.Model(&persistence.AgentMessage{}).
			Where("conversation_id = ?", conversationID).
			Select("COALESCE(MAX(seq), 0) as max_seq").
			Scan(&maxSeq).Error; err != nil {
			return err
		}
		msg.Seq = maxSeq.MaxSeq + 1
		effectiveParentID := strings.TrimSpace(parentMessageID)
		if effectiveParentID == "" {
			effectiveParentID = conversation.ActiveBranchMessageID
		}
		msg.ParentMessageID = optionalString(effectiveParentID)
		if err := tx.Create(msg).Error; err != nil {
			return err
		}
		return tx.Model(&conversation).Updates(map[string]interface{}{
			"active_branch_message_id": msg.ID,
			"updated_at":               now,
			"version":                  gorm.Expr("version + 1"),
		}).Error
	}); err != nil {
		logger.Errorf(ctx, "failed to persist message: conversation_id=%s role=%s seq=%d err=%v",
			conversationID, role, msg.Seq, err)
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to persist message", err)
	}

	return nil
}

func (s *TurnService) completeAssistantMessage(
	ctx context.Context,
	config *TurnConfig,
	turnID string,
	content string,
) error {
	if strings.TrimSpace(config.AssistantMessageID) == "" {
		return s.persistMessageWithLineage(
			ctx,
			config.ConversationID,
			turnID,
			string(domain.MessageRoleAssistant),
			content,
			config.Model,
			config.AssistantBranchID,
			config.AssistantParentID,
			config.AssistantReplacesID,
		)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	result := db.WithContext(ctx).Model(&persistence.AgentMessage{}).
		Where("id = ? AND conversation_id = ? AND turn_id = ?", config.AssistantMessageID, config.ConversationID, turnID).
		Updates(map[string]interface{}{
			"content":    content,
			"model_name": config.Model,
			"status":     "completed",
			"updated_at": time.Now(),
		})
	if result.Error != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to complete assistant message", result.Error)
	}
	if result.RowsAffected != 1 {
		return errcode.New(errcode.AgentVersionConflict, http.StatusConflict,
			"pending assistant message changed", nil)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Helper: loadMessages
// ---------------------------------------------------------------------------

func (s *TurnService) loadMessages(ctx context.Context, conversationID string) ([]domain.Message, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var rows []persistence.AgentMessage
	if err := db.WithContext(ctx).
		Where("conversation_id = ? AND tombstoned_at IS NULL", conversationID).
		Order("seq ASC").
		Find(&rows).Error; err != nil {
		logger.Errorf(ctx, "failed to load messages: conversation_id=%s err=%v", conversationID, err)
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to load conversation messages", err)
	}

	messages := make([]domain.Message, 0, len(rows))
	for _, row := range rows {
		m := domain.Message{
			MessageID:      row.ID,
			ConversationID: row.ConversationID,
			Role:           domain.MessageRole(row.Role),
			ReasoningJSON:  row.ReasoningJSON,
			ToolCallsJSON:  row.ToolCallsJSON,
			MetadataJSON:   row.MetadataJSON,
			ErrorJSON:      row.ErrorJSON,
			Seq:            row.Seq,
			CreatedAt:      row.CreatedAt,
			UpdatedAt:      row.UpdatedAt,
		}

		if row.TurnID != nil {
			m.TurnID = *row.TurnID
		}
		if row.ModelName != nil {
			m.ModelName = *row.ModelName
		}
		if row.Content != nil {
			m.Content = *row.Content
		}
		if row.BranchID != nil {
			m.BranchID = *row.BranchID
		}
		if row.ParentMessageID != nil {
			m.ParentMessageID = *row.ParentMessageID
		}
		if row.ReplacesMessageID != nil {
			m.ReplacesMessageID = *row.ReplacesMessageID
		}
		if row.TombstonedAt != nil {
			m.TombstonedAt = row.TombstonedAt
		}

		messages = append(messages, m)
	}

	return messages, nil
}

func projectMessageBranch(messages []domain.Message, headID string) []domain.Message {
	byID := make(map[string]domain.Message, len(messages))
	for _, message := range messages {
		if message.TombstonedAt == nil {
			byID[message.MessageID] = message
		}
	}
	selected := make(map[string]struct{}, len(messages))
	for current := strings.TrimSpace(headID); current != ""; {
		message, ok := byID[current]
		if !ok {
			break
		}
		selected[current] = struct{}{}
		current = message.ParentMessageID
	}
	projected := make([]domain.Message, 0, len(selected))
	for _, message := range messages {
		if _, ok := selected[message.MessageID]; ok {
			projected = append(projected, message)
		}
	}
	return projected
}

// ---------------------------------------------------------------------------
// Helper: saveTurnTrace
// ---------------------------------------------------------------------------

func (s *TurnService) persistAttemptUsage(
	ctx context.Context,
	turnID string,
	attemptID string,
	trace *domain.TurnTrace,
) error {
	if strings.TrimSpace(attemptID) == "" || trace == nil {
		return errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"attempt usage requires attempt_id and trace",
			nil,
		)
	}

	usage := domain.TurnUsage{
		TurnID:        turnID,
		AttemptID:     attemptID,
		ToolCallCount: uint32(len(trace.ToolCalls)),
	}
	for _, call := range trace.ProviderCalls {
		usage.InputTokens += uint64(max(call.InputTokens, 0))
		usage.OutputTokens += uint64(max(call.OutputTokens, 0))
		usage.ProviderLatency += call.Latency
		usage.ProviderCallCount++
		if call.Provider != "" {
			usage.ProviderID = call.Provider
		}
		if call.Model != "" {
			usage.ModelID = call.Model
		}
	}
	for _, call := range trace.ToolCalls {
		usage.ToolLatency += call.Duration
	}

	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	var calls []persistence.ToolCall
	if err := db.WithContext(ctx).
		Where("turn_id = ? AND attempt_id = ?", turnID, attemptID).
		Order("created_at ASC").
		Find(&calls).Error; err != nil {
		return errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"failed to load attempt tool lineage",
			err,
		)
	}
	if len(calls) > 0 {
		if len(calls) > int(usage.ToolCallCount) {
			usage.ToolCallCount = uint32(len(calls))
		}
		usage.ToolCallIDs = make([]string, 0, len(calls))
		for _, call := range calls {
			usage.ToolCallIDs = append(usage.ToolCallIDs, call.ToolCallID)
		}
	}

	encoded, err := json.Marshal(usage)
	if err != nil {
		return errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"failed to encode attempt usage",
			err,
		)
	}
	result := db.WithContext(ctx).
		Model(&persistence.TurnAttempt{}).
		Where("id = ? AND turn_id = ? AND ended_at IS NULL", attemptID, turnID).
		Update("usage_json", encoded)
	if result.Error != nil {
		return errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"failed to persist attempt usage",
			result.Error,
		)
	}
	if result.RowsAffected != 1 {
		return errcode.New(
			errcode.AgentVersionConflict,
			http.StatusConflict,
			"attempt usage cannot modify a missing or terminal attempt",
			nil,
		)
	}
	return nil
}

func (s *TurnService) ListTurnTraces(ctx context.Context, options domain.TurnTraceListOptions) ([]domain.TurnTraceEntry, int64, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, 0, err
	}
	if strings.TrimSpace(options.Ptid) == "" {
		return nil, 0, errcode.New(errcode.AgentUnauthorized, http.StatusUnauthorized,
			"actor identity is required", nil)
	}
	if strings.TrimSpace(options.AgentID) == "" {
		return nil, 0, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			"agent_id is required", nil)
	}

	page := options.Page
	if page <= 0 {
		page = 1
	}
	pageSize := options.PageSize
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}

	query := db.WithContext(ctx).
		Model(&persistence.TurnTrace{}).
		Joins("JOIN agent_turns ON agent_turns.id = agent_turn_traces.turn_id").
		Joins("JOIN agent_conversations ON agent_conversations.id = agent_turns.conversation_id").
		Where("agent_turns.agent_id = ? AND agent_conversations.ptid = ?", options.AgentID, options.Ptid)
	if strings.TrimSpace(options.ConversationID) != "" {
		query = query.Where("agent_turns.conversation_id = ?", options.ConversationID)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		logger.Errorf(ctx, "failed to count turn traces: agent_id=%s err=%v", options.AgentID, err)
		return nil, 0, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to count turn traces", err)
	}

	var records []persistence.TurnTrace
	if err := query.
		Preload("Turn").
		Order("agent_turns.started_at DESC").
		Limit(pageSize).
		Offset((page - 1) * pageSize).
		Find(&records).Error; err != nil {
		logger.Errorf(ctx, "failed to list turn traces: agent_id=%s err=%v", options.AgentID, err)
		return nil, 0, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to list turn traces", err)
	}

	entries := make([]domain.TurnTraceEntry, 0, len(records))
	for i := range records {
		entry, err := persistenceTurnTraceToDomain(&records[i])
		if err != nil {
			logger.Errorf(ctx, "failed to decode turn trace: trace_id=%s err=%v", records[i].ID, err)
			return nil, 0, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"failed to decode turn trace", err)
		}
		entries = append(entries, entry)
	}

	return entries, total, nil
}

func (s *TurnService) GetTurnTrace(ctx context.Context, ptid, traceID, turnID string) (*domain.TurnTraceEntry, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	ptid = strings.TrimSpace(ptid)
	traceID = strings.TrimSpace(traceID)
	turnID = strings.TrimSpace(turnID)
	if ptid == "" {
		return nil, errcode.New(errcode.AgentUnauthorized, http.StatusUnauthorized,
			"actor identity is required", nil)
	}
	if traceID == "" && turnID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			"trace_id or turn_id is required", nil)
	}

	query := db.WithContext(ctx).
		Preload("Turn").
		Joins("JOIN agent_turns ON agent_turns.id = agent_turn_traces.turn_id").
		Joins("JOIN agent_conversations ON agent_conversations.id = agent_turns.conversation_id").
		Where("agent_conversations.ptid = ?", ptid)
	if traceID != "" {
		query = query.Where("agent_turn_traces.id = ?", traceID)
	}
	if turnID != "" {
		query = query.Where("agent_turn_traces.turn_id = ?", turnID)
	}

	var record persistence.TurnTrace
	if err := query.First(&record).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound,
				"turn trace not found", err)
		}
		logger.Errorf(ctx, "failed to get turn trace: trace_id=%s turn_id=%s err=%v", traceID, turnID, err)
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to get turn trace", err)
	}

	entry, err := persistenceTurnTraceToDomain(&record)
	if err != nil {
		logger.Errorf(ctx, "failed to decode turn trace: trace_id=%s err=%v", record.ID, err)
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to decode turn trace", err)
	}
	return &entry, nil
}

func (s *TurnService) saveTurnTrace(ctx context.Context, trace *domain.TurnTrace) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	skillsJSON, _ := json.Marshal(trace.SkillsLoaded)
	toolCallsJSON, _ := json.Marshal(trace.ToolCalls)
	providerCallsJSON, _ := json.Marshal(trace.ProviderCalls)
	errorsJSON, _ := json.Marshal(trace.ErrorClassified)
	delegationJSON, _ := json.Marshal(trace.DelegationResults)
	knowledgeChunksJSON, _ := json.Marshal(trace.KnowledgeChunks)

	record := &persistence.TurnTrace{
		ID:                   trace.TraceID,
		TurnID:               trace.TurnID,
		SkillsLoaded:         skillsJSON,
		ToolCalls:            toolCallsJSON,
		ProviderCalls:        providerCallsJSON,
		ReviewTriggered:      trace.ReviewTriggered,
		ErrorsClassified:     errorsJSON,
		CompressionTriggered: trace.CompressionTriggered,
		DelegationResults:    delegationJSON,
		KnowledgeChunks:      knowledgeChunksJSON,
	}

	if trace.SystemPromptHash != "" {
		record.SystemPromptHash = &trace.SystemPromptHash
	}
	if trace.MemorySnapshotHash != "" {
		record.MemorySnapshotHash = &trace.MemorySnapshotHash
	}
	if trace.SkillIndexHash != "" {
		record.SkillIndexHash = &trace.SkillIndexHash
	}
	if trace.CompressionTriggered {
		record.CompressionBefore = &trace.CompressionBefore
		record.CompressionAfter = &trace.CompressionAfter
	}

	if err := db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "turn_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"system_prompt_hash",
			"memory_snapshot_hash",
			"skill_index_hash",
			"skills_loaded",
			"tool_calls",
			"provider_calls",
			"review_triggered",
			"errors_classified",
			"compression_triggered",
			"compression_before",
			"compression_after",
			"delegation_results",
			"knowledge_chunks",
		}),
	}).Create(record).Error; err != nil {
		logger.Errorf(ctx, "failed to save turn trace: turn_id=%s err=%v", trace.TurnID, err)
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to save turn trace", err)
	}

	return nil
}

func persistenceTurnTraceToDomain(record *persistence.TurnTrace) (domain.TurnTraceEntry, error) {
	trace := domain.TurnTrace{
		TraceID:              record.ID,
		TurnID:               record.TurnID,
		ReviewTriggered:      record.ReviewTriggered,
		CompressionTriggered: record.CompressionTriggered,
	}
	if record.SystemPromptHash != nil {
		trace.SystemPromptHash = *record.SystemPromptHash
	}
	if record.MemorySnapshotHash != nil {
		trace.MemorySnapshotHash = *record.MemorySnapshotHash
	}
	if record.SkillIndexHash != nil {
		trace.SkillIndexHash = *record.SkillIndexHash
	}
	if record.CompressionBefore != nil {
		trace.CompressionBefore = *record.CompressionBefore
	}
	if record.CompressionAfter != nil {
		trace.CompressionAfter = *record.CompressionAfter
	}
	if err := json.Unmarshal(record.SkillsLoaded, &trace.SkillsLoaded); err != nil && len(record.SkillsLoaded) > 0 {
		return domain.TurnTraceEntry{}, err
	}
	if err := json.Unmarshal(record.ToolCalls, &trace.ToolCalls); err != nil && len(record.ToolCalls) > 0 {
		return domain.TurnTraceEntry{}, err
	}
	for index := range trace.ToolCalls {
		trace.ToolCalls[index].Arguments = redactDiagnosticText(trace.ToolCalls[index].Arguments)
		trace.ToolCalls[index].Result = redactDiagnosticText(trace.ToolCalls[index].Result)
	}
	if err := json.Unmarshal(record.ProviderCalls, &trace.ProviderCalls); err != nil && len(record.ProviderCalls) > 0 {
		return domain.TurnTraceEntry{}, err
	}
	for index := range trace.ProviderCalls {
		trace.ProviderCalls[index].CredentialID = ""
	}
	if err := json.Unmarshal(record.ErrorsClassified, &trace.ErrorClassified); err != nil && len(record.ErrorsClassified) > 0 {
		return domain.TurnTraceEntry{}, err
	}
	if err := json.Unmarshal(record.DelegationResults, &trace.DelegationResults); err != nil && len(record.DelegationResults) > 0 {
		return domain.TurnTraceEntry{}, err
	}
	if err := json.Unmarshal(record.KnowledgeChunks, &trace.KnowledgeChunks); err != nil && len(record.KnowledgeChunks) > 0 {
		return domain.TurnTraceEntry{}, err
	}

	return domain.TurnTraceEntry{
		Turn: domain.Turn{
			TurnID:         record.Turn.ID,
			ConversationID: record.Turn.ConversationID,
			AgentID:        record.Turn.AgentID,
			UserInput:      stringValue(record.Turn.UserInput),
			FinalResponse:  stringValue(record.Turn.FinalResponse),
			ToolIterations: record.Turn.ToolIterations,
			Status:         domain.TurnStatus(record.Turn.Status),
			StartedAt:      record.Turn.StartedAt,
			EndedAt:        record.Turn.EndedAt,
		},
		Trace: trace,
	}, nil
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// ---------------------------------------------------------------------------
// Helper: completeTurn
// ---------------------------------------------------------------------------

func (s *TurnService) completeTurn(ctx context.Context, turnID, finalResponse string, toolIterations int) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	now := time.Now()
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&persistence.AgentTurn{}).
			Where("id = ?", turnID).
			Updates(map[string]interface{}{
				"status":          string(domain.TurnStatusCompleted),
				"final_response":  finalResponse,
				"tool_iterations": toolIterations,
				"terminal_reason": "completed",
				"ended_at":        now,
			}).Error; err != nil {
			return err
		}
		return tx.Model(&persistence.TurnAttempt{}).
			Where("turn_id = ? AND ended_at IS NULL", turnID).
			Updates(map[string]interface{}{
				"status":   string(domain.TurnStatusCompleted),
				"ended_at": now,
			}).Error
	}); err != nil {
		logger.Errorf(ctx, "failed to complete turn: turn_id=%s err=%v", turnID, err)
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to update turn status", err)
	}

	return nil
}

// ---------------------------------------------------------------------------
// Helper: failTurn
// ---------------------------------------------------------------------------

func (s *TurnService) failTurn(ctx context.Context, agentID, turnID, taskID, stepID, reason string) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	now := time.Now()
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&persistence.AgentTurn{}).
			Where("id = ?", turnID).
			Updates(map[string]interface{}{
				"status":          string(domain.TurnStatusFailed),
				"final_response":  reason,
				"terminal_reason": reason,
				"ended_at":        now,
			}).Error; err != nil {
			return err
		}
		return tx.Model(&persistence.TurnAttempt{}).
			Where("turn_id = ? AND ended_at IS NULL", turnID).
			Updates(map[string]interface{}{
				"status":     string(domain.TurnStatusFailed),
				"error_code": reason,
				"ended_at":   now,
			}).Error
	}); err != nil {
		logger.Errorf(ctx, "failed to mark turn as failed: turn_id=%s err=%v", turnID, err)
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to mark turn as failed", err)
	}

	logger.Warnf(ctx, "turn failed: turn_id=%s reason=%s", turnID, reason)

	s.publishDomainEvent(ctx, agentID, turnID, taskID, stepID, string(domain.EventTypeAgentTurnFailed), map[string]interface{}{
		"turn_id": turnID,
		"reason":  reason,
	})

	if s.growthMetrics != nil {
		s.growthMetrics.RecordEvent(ctx, agentID, EventTurnFailed, CategoryTurn, turnID, reason, "failure")
	}

	return nil
}

func (s *TurnService) cancelTurn(ctx context.Context, agentID, turnID, taskID, stepID string) error {
	ctx = context.WithoutCancel(ctx)
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	now := time.Now()
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&persistence.AgentTurn{}).
			Where("id = ? AND status IN ?", turnID, []string{
				string(domain.TurnStatusRunning),
				string(domain.TurnStatusWaitingLocalTool),
			}).
			Updates(map[string]interface{}{
				"status":          string(domain.TurnStatusCancelled),
				"final_response":  "cancelled by user",
				"terminal_reason": "cancelled_by_user",
				"ended_at":        now,
			}).Error; err != nil {
			return err
		}
		if err := tx.Model(&persistence.TurnAttempt{}).
			Where("turn_id = ? AND ended_at IS NULL", turnID).
			Updates(map[string]interface{}{
				"status":   string(domain.TurnStatusCancelled),
				"ended_at": now,
			}).Error; err != nil {
			return err
		}
		var batchIDs []string
		if err := tx.Model(&persistence.ToolBatch{}).
			Where("turn_id = ? AND status = ?", turnID, persistence.ToolBatchStatusOpen).
			Pluck("id", &batchIDs).Error; err != nil {
			return err
		}
		if len(batchIDs) == 0 {
			return nil
		}
		if err := tx.Model(&persistence.ToolCall{}).
			Where("tool_batch_id IN ? AND status IN ?", batchIDs, []string{
				persistence.ToolCallStatusProposed,
				persistence.ToolCallStatusWaitingApproval,
				persistence.ToolCallStatusApproved,
				persistence.ToolCallStatusDispatchCommitted,
			}).
			Updates(map[string]interface{}{
				"status":     persistence.ToolCallStatusCancelled,
				"error_code": "turn_cancelled",
				"ended_at":   now,
				"updated_at": now,
			}).Error; err != nil {
			return err
		}
		if err := tx.Model(&persistence.ToolCall{}).
			Where("tool_batch_id IN ? AND status = ?", batchIDs, persistence.ToolCallStatusPrepared).
			Updates(map[string]interface{}{
				"status":     persistence.ToolCallStatusUnknownSideEffect,
				"error_code": "turn_cancelled_after_prepare",
				"ended_at":   now,
				"updated_at": now,
			}).Error; err != nil {
			return err
		}
		return tx.Model(&persistence.ToolBatch{}).
			Where("id IN ? AND status = ?", batchIDs, persistence.ToolBatchStatusOpen).
			Updates(map[string]interface{}{
				"status":     persistence.ToolBatchStatusBlocked,
				"settled_at": now,
				"updated_at": now,
			}).Error
	}); err != nil {
		return errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"failed to mark turn as cancelled",
			err,
		)
	}
	s.publishDomainEvent(ctx, agentID, turnID, taskID, stepID, string(domain.EventTypeAgentTurnCancelled), map[string]interface{}{
		"turn_id": turnID,
		"reason":  "cancelled by user",
	})
	return nil
}

// ---------------------------------------------------------------------------
// Internal: getDB
// ---------------------------------------------------------------------------

// revalidateProviderState checks that the provider and model exist, are enabled,
// and belong to the requesting actor before turn execution begins.
func (s *TurnService) revalidateProviderState(ctx context.Context, actorID, providerID, modelID string) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	var provider persistence.AgentProvider
	if err := db.WithContext(ctx).
		Where("actor_id = ? AND name = ?", actorID, providerID).
		First(&provider).Error; err != nil {
		return errcode.New(errcode.AgentProviderDisabled, http.StatusBadRequest,
			fmt.Sprintf("provider %q not found for actor", providerID), err)
	}

	if !provider.Enabled {
		return errcode.New(errcode.AgentProviderDisabled, http.StatusBadRequest,
			fmt.Sprintf("provider %q is disabled", providerID), nil)
	}

	if modelID != "" {
		var model persistence.AgentModel
		if err := db.WithContext(ctx).
			Where("actor_id = ? AND provider_id = ? AND model_id = ?", actorID, providerID, modelID).
			First(&model).Error; err == nil {
			if !model.Enabled {
				return errcode.New(errcode.AgentProviderDisabled, http.StatusBadRequest,
					fmt.Sprintf("model %q is disabled for provider %q", modelID, providerID), nil)
			}
		}
	}

	return nil
}

func (s *TurnService) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to open agent db", err)
	}
	return db, nil
}

func (s *TurnService) resolveAgentDefaults(ctx context.Context, config *TurnConfig) {
	db, err := s.getDB(ctx)
	if err != nil {
		return
	}
	var agent persistence.Agent
	if err := db.WithContext(ctx).Where("id = ?", config.AgentID).First(&agent).Error; err != nil {
		return
	}
	var cfg map[string]interface{}
	_ = json.Unmarshal([]byte(agent.ConfigJSON), &cfg)
	if cfg == nil {
		return
	}
	extractStr := func(keys ...string) string {
		for _, k := range keys {
			if v, ok := cfg[k]; ok {
				if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
					return s
				}
			}
		}
		return ""
	}
	if config.Identity == "" {
		config.Identity = extractStr("identity", "soulMd", "soul_md", "soul", "systemPrompt", "system_prompt")
	}
	if config.AgentConfigPrompt == "" {
		config.AgentConfigPrompt = extractStr("agentConfigPrompt", "agent_config_prompt", "agentsMd", "agents_md", "agents")
	}
	if config.Provider == "" {
		config.Provider = strings.TrimSpace(agent.ProviderID)
	}
	if config.Model == "" {
		config.Model = strings.TrimSpace(agent.ModelName)
	}
}

// generateID creates a unique identifier with the given prefix (e.g. "turn", "msg", "trace").
// Uses crypto/rand to avoid collisions under concurrent requests.
// Fix 2026-04-11: replaced time.UnixNano-based IDs which collide under concurrent requests.
func generateID(prefix string) string {
	// Keep IDs within the varchar(36) columns used by agent persistence models.
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%s_%x", prefix, b)
}

func NewTurnID() string {
	return generateID("turn")
}

// sha256Short returns the first 16 hex characters of the SHA-256 digest.
func sha256Short(data string) string {
	h := sha256.Sum256([]byte(data))
	return hex.EncodeToString(h[:8])
}

// QuickCompletion performs a one-shot LLM call without conversation context.
// Used for lightweight tasks like translation.
func (s *TurnService) QuickCompletion(ctx context.Context, config *TurnConfig, prompt string) (string, error) {
	if config.Provider == "" || config.Model == "" {
		return "", fmt.Errorf("provider and model are required for quick completion")
	}

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	resp, err := s.providerService.Call(ctx, &ProviderCallRequest{
		ProviderID: config.Provider,
		Model:      config.Model,
		Messages:   []domain.Message{{Role: "user", Content: prompt}},
		UserID:     config.ActorID,
		Effort:     "low",
	})
	if err != nil {
		return "", err
	}
	return resp.Content, nil
}

// GenerateFollowUpSuggestions uses the same provider/model as the agent to
// produce a short list of follow-up questions the user might ask next.
// Returns nil on any failure (graceful degradation — done event still sends).
func (s *TurnService) GenerateFollowUpSuggestions(ctx context.Context, config *TurnConfig, userInput string, assistantResponse string) []string {
	if config.Provider == "" || config.Model == "" {
		return nil
	}

	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	prompt := fmt.Sprintf(
		"Based on this conversation, suggest exactly 3 brief follow-up questions the user might ask next. "+
			"Return ONLY a JSON array of 3 strings, no other text.\n\n"+
			"User: %s\n\nAssistant: %s",
		truncate(userInput, 500),
		truncate(assistantResponse, 1000),
	)

	resp, err := s.providerService.Call(ctx, &ProviderCallRequest{
		ProviderID:   config.Provider,
		Model:        config.Model,
		SystemPrompt: "You generate follow-up question suggestions. Always respond with a JSON array of exactly 3 short questions.",
		Messages:     []domain.Message{{Role: "user", Content: prompt}},
		UserID:       config.ActorID,
		Effort:       "low",
	})
	if err != nil {
		logger.Warnf(ctx, "follow-up suggestion generation failed: %v", err)
		return nil
	}

	var suggestions []string
	content := strings.TrimSpace(resp.Content)
	if idx := strings.Index(content, "["); idx >= 0 {
		content = content[idx:]
	}
	if idx := strings.LastIndex(content, "]"); idx >= 0 {
		content = content[:idx+1]
	}
	if err := json.Unmarshal([]byte(content), &suggestions); err != nil {
		logger.Warnf(ctx, "follow-up suggestion parse failed: %v", err)
		return nil
	}
	if len(suggestions) > 3 {
		suggestions = suggestions[:3]
	}
	return suggestions
}
