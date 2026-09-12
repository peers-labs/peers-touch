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
// 2026-04-11 — Phase 5: runCompression executes an LLM call to produce an
//   actual summary from the compression prompt. Added executeSummaryLLM().
// 2026-04-11 — Phase 6: integrated ReviewService into Step 9 nudge evaluation.
//   TurnService now holds a *ReviewService and delegates background review
//   triggering to it after updating nudge counters.
// 2026-04-11 — Phase 7: MemoryProvider lifecycle hooks. Added memoryProvider()
//   helper and integrated on_turn_start, on_pre_compress, sync_turn, and
//   on_delegation hooks into the turn loop for external memory synchronisation.
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
// 2026-08-28 — Route every post-admission event and context preparation
//   failure through the durable Turn lifecycle settlement authority.
// 2026-08-29 — Allow the current execution generation to finalize usage after
//   durable user cancellation without admitting superseded terminal writes.

package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
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
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
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
	RestrictedTools           []string
	ContextWindowSize         int
	MaxRetries                int
	Provider                  string
	Model                     string
	ProviderConfigVersion     string
	CapabilitySourceVersion   string
	Effort                    string // reasoning effort: "low" | "medium" | "high"
	ThinkingMode              domain.ThinkingMode
	FallbackModel             string // Alternate model for billing/model_not_found fallback recovery.
	WorkspaceRoot             string
	WorkspaceReference        string
	AuthorizedCapabilities    *AuthorizedCapabilitySet
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
	RuntimeBudget             *model.RuntimeBudget
	RuntimeCapabilities       *model.RuntimeCapabilitySnapshot
	Attachments               []*model.AgentAttachmentRef
	AdmittedAttachments       []AdmittedAttachment
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
	promptAssembly *PromptAssemblyResult
	currentInput   string
}

type TurnEventSink func(ctx context.Context, event TurnEvent)

type TurnEvent struct {
	Type             string            `json:"type"`
	Seq              int64             `json:"seq,omitempty"`
	TurnID           string            `json:"turnId,omitempty"`
	AttemptID        string            `json:"attemptId,omitempty"`
	ConversationID   string            `json:"conversationId,omitempty"`
	AgentID          string            `json:"agentId,omitempty"`
	Stage            string            `json:"stage,omitempty"`
	Text             string            `json:"text,omitempty"`
	ToolCallID       string            `json:"toolCallId,omitempty"`
	ToolName         string            `json:"toolName,omitempty"`
	Arguments        string            `json:"arguments,omitempty"`
	ApprovalID       string            `json:"approvalId,omitempty"`
	DecisionID       string            `json:"decisionId,omitempty"`
	DecisionRevision uint64            `json:"decisionRevision,omitempty"`
	ExpiresAt        string            `json:"expiresAt,omitempty"`
	Approved         bool              `json:"approved,omitempty"`
	PayloadHash      string            `json:"payloadHash,omitempty"`
	Source           string            `json:"source,omitempty"`
	ServerName       string            `json:"serverName,omitempty"`
	Result           string            `json:"result,omitempty"`
	Error            string            `json:"error,omitempty"`
	ErrorType        string            `json:"error_type,omitempty"`
	LocaleKey        string            `json:"locale_key,omitempty"`
	Retryable        *bool             `json:"retryable,omitempty"`
	Terminal         *bool             `json:"terminal,omitempty"`
	Details          map[string]string `json:"details,omitempty"`
	OutcomeError     json.RawMessage   `json:"outcome_error,omitempty"`
	Iteration        int               `json:"iteration,omitempty"`
}

var errTurnEventPersistence = errors.New("turn event persistence failed")
var errExplicitUserCancellation = errors.New("turn explicitly cancelled by user")
var errTurnExecutionSuperseded = errors.New("turn execution superseded by a newer registration")

type activeTurnRegistration struct {
	generation uint64
	cancel     context.CancelCauseFunc
}

type turnExecutionOwnership struct {
	turnID     string
	generation uint64
}

type turnExecutionOwnershipContextKey struct{}

type turnCancellationResult struct {
	Event     TurnEvent
	Status    string
	Cancelled bool
}

func IsTurnEventPersistenceError(err error) bool {
	return errors.Is(err, errTurnEventPersistence)
}

type continuationProviderCall func(
	context.Context,
	*TurnConfig,
	string,
	*domain.TurnTrace,
	string,
	[]domain.Message,
) (string, []ProviderToolCall, []domain.ProviderCallRecord, bool, error)

type turnProviderCall func(
	context.Context,
	*ProviderCallRequest,
) (*ProviderCallResponse, error)

type executionLifecycle struct {
	ctx       context.Context
	cancel    context.CancelFunc
	mu        sync.Mutex
	stopping  bool
	active    sync.WaitGroup
	drained   chan struct{}
	drainOnce sync.Once
}

func newExecutionLifecycle(parent context.Context) *executionLifecycle {
	ctx, cancel := context.WithCancel(parent)
	return &executionLifecycle{
		ctx:     ctx,
		cancel:  cancel,
		drained: make(chan struct{}),
	}
}

func (l *executionLifecycle) acquire() (context.Context, func(), bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.stopping || l.ctx.Err() != nil {
		return l.ctx, func() {}, false
	}
	l.active.Add(1)

	var once sync.Once
	return l.ctx, func() {
		once.Do(l.active.Done)
	}, true
}

func (l *executionLifecycle) stop(ctx context.Context) error {
	l.mu.Lock()
	l.stopping = true
	l.cancel()
	l.drainOnce.Do(func() {
		go func() {
			l.active.Wait()
			close(l.drained)
		}()
	})
	l.mu.Unlock()

	select {
	case <-l.drained:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("wait for Agent execution lifecycle shutdown: %w", ctx.Err())
	}
}

// ---------------------------------------------------------------------------
// TurnService
// ---------------------------------------------------------------------------

// TurnService orchestrates the full lifecycle of a single agent turn:
// context reference preprocessing → prompt assembly → compression check →
// credential lease → provider call → error recovery → tool dispatch →
// nudge evaluation → persistence.
type TurnService struct {
	errorClassifier      *ErrorClassifierService
	memoryService        *MemoryService
	skillService         *SkillService
	promptAssembly       *PromptAssemblyService
	compression          *CompressionService
	providerService      *ProviderService
	credentialPool       *CredentialPoolService
	delegation           *DelegationService
	toolRegistry         *ToolRegistryService
	reviewService        *ReviewService
	growthMetrics        *GrowthMetricsService
	convService          *ConversationService
	nudgeState           *domain.NudgeState
	liveResumeBroker     *LiveResumeBroker
	toolDispatch         *ToolDispatchService
	chatTaskService      *ChatTaskService
	eventBus             domain.EventBus
	eventWriter          *TaskEventWriter
	activeTurns          sync.Mutex
	activeTurnCancel     map[string]activeTurnRegistration
	activeTurnGeneration uint64
	lifecycle            *executionLifecycle
	admissionResolver    *RuntimeAdmissionResolver
	capabilityReadiness  *CapabilityAuthorityReadinessService
	turnAdmission        *TurnAdmissionService
	attachmentAdmission  *AttachmentAdmissionService
	resumeProviderCall   continuationProviderCall
	providerCall         turnProviderCall
}

func (s *TurnService) SetAdmissionResolver(r *RuntimeAdmissionResolver) {
	s.admissionResolver = r
}

func (s *TurnService) SetCapabilityReadiness(
	readiness *CapabilityAuthorityReadinessService,
) {
	s.capabilityReadiness = readiness
}

func (s *TurnService) SetTurnAdmissionService(admission *TurnAdmissionService) {
	s.turnAdmission = admission
}

func (s *TurnService) SetAttachmentAdmissionService(admission *AttachmentAdmissionService) {
	s.attachmentAdmission = admission
}

func (s *TurnService) PreflightTurn(
	ctx context.Context,
	actorID string,
	request *model.ExecuteTurnRequest,
) error {
	if request == nil {
		return nil
	}
	config, err := s.queuedTurnConfig(actorID, request, "")
	if err != nil {
		return err
	}
	s.resolveAgentDefaults(ctx, config)
	if s.admissionResolver == nil {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"runtime admission authority is required",
			nil,
		)
	}
	runtimeSnapshot, err := s.admissionResolver.Resolve(
		ctx,
		config.ActorID,
		config.Provider,
		config.Model,
	)
	if err != nil {
		return err
	}
	effectiveBudget, err := effectiveRuntimeBudget(
		runtimeSnapshot.Budget,
		config.RequestedBudgetJSON,
	)
	if err != nil {
		return err
	}
	if err := validateInputBudgetBeforePersistence(
		s.compression,
		effectiveBudget,
		request.GetUserInput(),
	); err != nil {
		return err
	}
	if len(request.GetAttachments()) == 0 {
		return nil
	}
	_, err = s.attachmentAdmission.Admit(
		ctx,
		config.ActorID,
		config.ConversationID,
		config.Attachments,
		runtimeSnapshot.Capabilities,
		effectiveBudget,
	)
	return err
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
	service := &TurnService{
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
		activeTurnCancel: make(map[string]activeTurnRegistration),
	}
	if providerService != nil {
		service.providerCall = providerService.Call
	}
	return service
}

func (s *TurnService) SetLiveResumeBroker(broker *LiveResumeBroker) {
	s.liveResumeBroker = broker
}

func (s *TurnService) SetEventBus(eventBus domain.EventBus) {
	s.eventBus = eventBus
	s.eventWriter = NewTaskEventWriter(eventBus)
}

// SetExecutionLifecycle binds detached turn execution to the Station
// subserver lifecycle rather than to an individual transport request.
func (s *TurnService) SetExecutionLifecycle(ctx context.Context) context.Context {
	lifecycle := newExecutionLifecycle(ctx)
	s.activeTurns.Lock()
	s.lifecycle = lifecycle
	s.activeTurns.Unlock()
	return lifecycle.ctx
}

// RunExecutionWorker registers a long-lived worker with the same shutdown
// barrier as detached turns. Stop can therefore wait until the worker has
// returned from any in-flight reconciliation before persistence is torn down.
func (s *TurnService) RunExecutionWorker(worker func(context.Context)) bool {
	ctx, release, accepted := s.acquireExecutionLifecycle(context.Background())
	if !accepted {
		return false
	}
	go func() {
		defer release()
		worker(ctx)
	}()
	return true
}

// StopExecutionLifecycle closes lifecycle admission, cancels every registered
// operation, and waits for workers and detached turns to drain.
func (s *TurnService) StopExecutionLifecycle(ctx context.Context) error {
	s.activeTurns.Lock()
	lifecycle := s.lifecycle
	s.activeTurns.Unlock()
	if lifecycle == nil {
		return nil
	}
	return lifecycle.stop(ctx)
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
		turnCtx, releaseTurn := s.RegisterTurn(
			ctx,
			admitted.Admission.GetTurnId(),
		)
		go func(actorID string, admittedTurn *AdmittedTurn) {
			defer releaseTurn()
			s.executeAdmittedQueuedTurn(turnCtx, actorID, admittedTurn)
		}(conversation.ActorID, admitted)
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
	config, configErr := s.queuedTurnConfig(actorID, request, admitted.Admission.GetTurnId())
	if configErr != nil {
		if err := s.failTurn(
			ctx,
			request.GetAgentId(),
			admitted.Admission.GetTurnId(),
			"",
			"",
			"failed to decode queued runtime budget",
		); err != nil {
			logger.Errorf(ctx, "failed to settle queued turn after config decode failure: turn_id=%s err=%v", admitted.Admission.GetTurnId(), err)
		}
		return
	}
	if s.chatTaskService != nil {
		taskID, err := s.chatTaskService.EnsureChatTask(
			ctx,
			actorID,
			request.GetAgentId(),
			request.GetConversationId(),
			request.GetUserInput(),
		)
		if err != nil {
			if settleErr := s.failTurn(
				ctx,
				request.GetAgentId(),
				admitted.Admission.GetTurnId(),
				"",
				"",
				"failed to prepare queued chat task",
			); settleErr != nil {
				logger.Errorf(ctx, "failed to settle queued turn after task preparation failure: turn_id=%s err=%v", admitted.Admission.GetTurnId(), settleErr)
			}
			return
		}
		stepID, err := s.chatTaskService.BeginChatStep(
			ctx,
			taskID,
			request.GetAgentId(),
			request.GetUserInput(),
		)
		if err != nil {
			if settleErr := s.failTurn(
				ctx,
				request.GetAgentId(),
				admitted.Admission.GetTurnId(),
				taskID,
				"",
				"failed to begin queued chat step",
			); settleErr != nil {
				logger.Errorf(ctx, "failed to settle queued turn after step creation failure: turn_id=%s err=%v", admitted.Admission.GetTurnId(), settleErr)
			}
			return
		}
		config.TaskID = taskID
		config.StepID = stepID
	}
	if _, err := s.ExecuteTurn(ctx, config, request.GetUserInput()); err != nil {
		logger.Warnf(
			ctx,
			"queued turn execution settled with error: turn_id=%s err=%v",
			admitted.Admission.GetTurnId(),
			err,
		)
	}
}

func (s *TurnService) queuedTurnConfig(
	actorID string,
	request *model.ExecuteTurnRequest,
	turnID string,
) (*TurnConfig, error) {
	contextWindowSize := int(request.GetContextWindowSize())
	if contextWindowSize <= 0 {
		contextWindowSize = 128000
	}
	maxRetries := int(request.GetMaxRetries())
	if maxRetries <= 0 {
		maxRetries = 3
	}
	requestedBudgetJSON, err := marshalRequestedRuntimeBudget(request.GetRequestedBudget())
	if err != nil {
		return nil, err
	}
	return &TurnConfig{
		TurnID:                    turnID,
		PrecreatedTurnID:          turnID,
		AgentID:                   request.GetAgentId(),
		ActorID:                   actorID,
		ConversationID:            request.GetConversationId(),
		Identity:                  request.GetIdentity(),
		AgentConfigPrompt:         request.GetAgentConfigPrompt(),
		ContextWindowSize:         contextWindowSize,
		MaxRetries:                maxRetries,
		Provider:                  request.GetProvider(),
		Model:                     request.GetModel(),
		Effort:                    request.GetEffort(),
		ThinkingMode:              domain.ThinkingMode(request.GetThinkingMode()),
		ClientCapabilitySessionID: request.GetClientCapabilitySessionId(),
		RequestedBudgetJSON:       requestedBudgetJSON,
		Attachments:               request.GetAttachments(),
		MemoryDisabled:            request.GetMemoryDisabled(),
	}, nil
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
		AgentID:   agentID,
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
	registration, ok := s.activeTurnCancel[turnID]
	s.activeTurns.Unlock()
	if !ok || registration.cancel == nil {
		return false
	}
	registration.cancel(errExplicitUserCancellation)
	return true
}

func (s *TurnService) RequestCancelTurn(ctx context.Context, ptid, turnID string) (string, error) {
	result, err := s.cancelTurnWithResult(
		ctx,
		"",
		strings.TrimSpace(turnID),
		"",
		"",
		strings.TrimSpace(ptid),
	)
	if err != nil {
		return "", err
	}
	if result.Cancelled {
		s.cancelActiveTurn(turnID)
	}
	return result.Status, nil
}

func (s *TurnService) RegisterTurn(
	ctx context.Context,
	turnID string,
) (context.Context, func()) {
	parent, releaseLifecycle, accepted := s.acquireExecutionLifecycle(ctx)
	if !accepted {
		return parent, func() {}
	}
	s.activeTurns.Lock()
	executionCtx, cancel := context.WithCancelCause(parent)
	if s.activeTurnCancel == nil {
		s.activeTurnCancel = make(map[string]activeTurnRegistration)
	}
	s.activeTurnGeneration++
	registration := activeTurnRegistration{
		generation: s.activeTurnGeneration,
		cancel:     cancel,
	}
	previous, replaced := s.activeTurnCancel[turnID]
	s.activeTurnCancel[turnID] = registration
	s.activeTurns.Unlock()
	if replaced && previous.cancel != nil {
		previous.cancel(errTurnExecutionSuperseded)
	}
	executionCtx = context.WithValue(executionCtx, turnExecutionOwnershipContextKey{}, turnExecutionOwnership{
		turnID:     turnID,
		generation: registration.generation,
	})
	var once sync.Once
	return executionCtx, func() {
		once.Do(func() {
			cancel(nil)
			s.activeTurns.Lock()
			if current, exists := s.activeTurnCancel[turnID]; exists &&
				current.generation == registration.generation {
				delete(s.activeTurnCancel, turnID)
			}
			s.activeTurns.Unlock()
			releaseLifecycle()
		})
	}
}

func (s *TurnService) acquireExecutionLifecycle(
	fallback context.Context,
) (context.Context, func(), bool) {
	s.activeTurns.Lock()
	lifecycle := s.lifecycle
	s.activeTurns.Unlock()
	if lifecycle == nil {
		return context.WithoutCancel(fallback), func() {}, true
	}
	return lifecycle.acquire()
}

func (s *TurnService) lockTurnExecutionOwnership(
	ctx context.Context,
	turnID string,
) (func(), error) {
	ownership, fenced := ctx.Value(turnExecutionOwnershipContextKey{}).(turnExecutionOwnership)
	if !fenced {
		return func() {}, nil
	}
	if ownership.turnID != strings.TrimSpace(turnID) {
		return func() {}, errTurnExecutionSuperseded
	}

	s.activeTurns.Lock()
	current, exists := s.activeTurnCancel[ownership.turnID]
	if !exists || current.generation != ownership.generation ||
		errors.Is(context.Cause(ctx), errTurnExecutionSuperseded) {
		s.activeTurns.Unlock()
		return func() {}, errTurnExecutionSuperseded
	}
	return s.activeTurns.Unlock, nil
}

func (s *TurnService) AwaitLiveResume(ctx context.Context, taskID, stepID, turnID, interruptID string) (LiveResumeDecision, error) {
	broker := s.liveResumeBroker
	if broker == nil {
		return LiveResumeDecision{}, fmt.Errorf("live resume broker is not configured")
	}
	return broker.Await(ctx, taskID, stepID, turnID, interruptID)
}

func (s *TurnService) emitTurnEvent(ctx context.Context, config *TurnConfig, turnID string, event TurnEvent) error {
	if config == nil {
		return fmt.Errorf("turn event config is required")
	}
	unlockOwnership, err := s.lockTurnExecutionOwnership(ctx, turnID)
	if err != nil {
		return err
	}
	ownershipLocked := true
	defer func() {
		if ownershipLocked {
			unlockOwnership()
		}
	}()

	event.TurnID = turnID
	if event.ConversationID == "" {
		event.ConversationID = config.ConversationID
	}
	if event.AgentID == "" {
		event.AgentID = config.AgentID
	}
	if event.AttemptID == "" {
		event.AttemptID = config.AttemptID
	}
	if s.convService != nil && event.ConversationID != "" && event.TurnID != "" {
		payload := map[string]interface{}{}
		encoded, err := json.Marshal(event)
		if err != nil {
			return fmt.Errorf("%w: encode turn_id=%s type=%s: %w", errTurnEventPersistence, event.TurnID, event.Type, err)
		}
		if err := json.Unmarshal(encoded, &payload); err != nil {
			return fmt.Errorf("%w: decode turn_id=%s type=%s: %w", errTurnEventPersistence, event.TurnID, event.Type, err)
		}
		var seq int64
		if event.Type == "text" && event.Text != "" {
			var assistantMessageID string
			seq, assistantMessageID, err = s.convService.PersistTurnTextEvent(
				ctx,
				event.ConversationID,
				event.TurnID,
				event.AttemptID,
				config.AssistantMessageID,
				config.Model,
				config.AssistantBranchID,
				config.AssistantParentID,
				config.AssistantReplacesID,
				payload,
				event.Text,
			)
			if err == nil && config.AssistantMessageID == "" {
				config.AssistantMessageID = assistantMessageID
			}
		} else {
			seq, err = s.convService.PersistTurnAttemptEvent(
				ctx,
				event.ConversationID,
				event.TurnID,
				event.AttemptID,
				event.Type,
				payload,
			)
		}
		if err != nil {
			return fmt.Errorf(
				"%w: turn_id=%s type=%s: %w",
				errTurnEventPersistence,
				event.TurnID,
				event.Type,
				err,
			)
		}
		event.Seq = seq
	}
	unlockOwnership()
	ownershipLocked = false
	if config.EventSink != nil {
		config.EventSink(ctx, event)
	}

	return nil
}

func emitLiveTurnEvent(ctx context.Context, config *TurnConfig, turnID string, event TurnEvent) {
	if config == nil || config.EventSink == nil {
		return
	}
	event.TurnID = turnID
	if event.ConversationID == "" {
		event.ConversationID = config.ConversationID
	}
	if event.AgentID == "" {
		event.AgentID = config.AgentID
	}
	if event.AttemptID == "" {
		event.AttemptID = config.AttemptID
	}
	config.EventSink(ctx, event)
}

func (s *TurnService) failTurnAfterError(
	ctx context.Context,
	config *TurnConfig,
	turnID string,
	reason string,
	cause error,
) error {
	event, err := s.failTurnWithEvent(
		ctx,
		config.AgentID,
		turnID,
		config.TaskID,
		config.StepID,
		reason,
		cause,
	)
	if err != nil {
		return errors.Join(cause, err)
	}
	if event.Seq > 0 {
		emitLiveTurnEvent(context.WithoutCancel(ctx), config, turnID, event)
	}
	return cause
}

func (s *TurnService) cancelTurnAfterError(
	ctx context.Context,
	config *TurnConfig,
	turnID string,
	cause error,
) error {
	event, err := s.cancelTurnWithEvent(
		ctx,
		config.AgentID,
		turnID,
		config.TaskID,
		config.StepID,
	)
	if err != nil {
		return errors.Join(cause, err)
	}
	if event.Seq > 0 {
		emitLiveTurnEvent(context.WithoutCancel(ctx), config, turnID, event)
	}
	return cause
}

func (s *TurnService) interruptTurnAfterError(
	ctx context.Context,
	config *TurnConfig,
	turnID string,
	reason string,
	cause error,
) error {
	event, err := s.interruptTurnWithEvent(
		ctx,
		config.AgentID,
		turnID,
		config.ConversationID,
		config.TaskID,
		config.StepID,
		reason,
	)
	if err != nil {
		return errors.Join(cause, err)
	}
	if event.Seq > 0 {
		emitLiveTurnEvent(context.WithoutCancel(ctx), config, turnID, event)
	}
	return cause
}

func (s *TurnService) settleAdmittedTurnAfterError(
	ctx context.Context,
	config *TurnConfig,
	turnID string,
	reason string,
	cause error,
) error {
	semanticCause := executionContextError(ctx)
	if semanticCause == nil {
		semanticCause = cause
	}
	returnedCause := cause
	if returnedCause == nil {
		returnedCause = semanticCause
	} else if semanticCause != nil && !errors.Is(returnedCause, semanticCause) {
		returnedCause = errors.Join(returnedCause, semanticCause)
	}

	if errors.Is(semanticCause, errTurnExecutionSuperseded) {
		return returnedCause
	}
	if errors.Is(semanticCause, errExplicitUserCancellation) {
		return s.cancelTurnAfterError(ctx, config, turnID, returnedCause)
	}
	if isStationLifecycleCancellation(ctx, semanticCause) {
		return s.interruptTurnAfterError(
			ctx,
			config,
			turnID,
			"station_lifecycle_interrupted",
			returnedCause,
		)
	}
	if budgetReason, exhausted := runtimeBudgetExhaustionReason(semanticCause); exhausted {
		reason = budgetReason
	}
	return s.failTurnAfterError(ctx, config, turnID, reason, returnedCause)
}

func (s *TurnService) SettleAdmittedTurnAfterError(
	ctx context.Context,
	config *TurnConfig,
	turnID string,
	reason string,
	cause error,
) error {
	if config == nil {
		config = &TurnConfig{}
	}
	return s.settleAdmittedTurnAfterError(ctx, config, turnID, reason, cause)
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
		switch {
		case strings.TrimSpace(config.PrecreatedTurnID) != "":
			config.TurnID = strings.TrimSpace(config.PrecreatedTurnID)
		case strings.TrimSpace(config.ExistingTurnID) != "":
			config.TurnID = strings.TrimSpace(config.ExistingTurnID)
		default:
			config.TurnID = NewTurnID()
		}
	}
	if config.ExecutionContext != nil {
		ctx = config.ExecutionContext
	} else {
		var release func()
		ctx, release = s.RegisterTurn(ctx, config.TurnID)
		defer release()
	}
	admittedTurnID := strings.TrimSpace(config.PrecreatedTurnID)
	if admittedTurnID == "" {
		admittedTurnID = strings.TrimSpace(config.ExistingTurnID)
	}
	settleAdmissionFailure := func(reason string, cause error) error {
		if admittedTurnID == "" {
			return cause
		}
		return s.settleAdmittedTurnAfterError(ctx, config, admittedTurnID, reason, cause)
	}

	// Guard: reject turns that exceed the maximum delegation depth to prevent
	// unbounded recursive delegation chains.
	// Fix 2026-04-11: delegation depth was never checked, allowing infinite recursion.
	if config.Depth > domain.MaxDelegationDepth {
		cause := errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			fmt.Sprintf("delegation depth %d exceeds maximum %d", config.Depth, domain.MaxDelegationDepth),
			nil,
		)
		return nil, settleAdmissionFailure("delegation depth rejected", cause)
	}

	// Resolve agent identity/config defaults from DB when not provided per-turn.
	if config.Identity == "" ||
		config.AgentConfigPrompt == "" ||
		config.Provider == "" ||
		config.Model == "" ||
		config.ThinkingMode == "" {
		s.resolveAgentDefaults(ctx, config)
	}
	thinkingMode, err := normalizeThinkingMode(config.ThinkingMode)
	if err != nil {
		return nil, settleAdmissionFailure("thinking mode rejected", err)
	}
	config.ThinkingMode = thinkingMode

	if s.admissionResolver == nil {
		cause := errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"runtime admission authority is required",
			nil,
		)
		return nil, settleAdmissionFailure("runtime admission authority is unavailable", cause)
	}
	runtimeSnapshot, admitErr := s.admissionResolver.Resolve(
		ctx,
		config.ActorID,
		config.Provider,
		config.Model,
	)
	if admitErr != nil {
		return nil, settleAdmissionFailure("runtime admission rejected", admitErr)
	}
	if capabilityErr := validateTurnRuntimeCapabilities(
		config,
		runtimeSnapshot.Capabilities,
	); capabilityErr != nil {
		return nil, settleAdmissionFailure(
			"runtime capability rejected before execution",
			capabilityErr,
		)
	}
	config.RuntimeBudget, err = effectiveRuntimeBudget(
		runtimeSnapshot.Budget,
		config.RequestedBudgetJSON,
	)
	if err != nil {
		return nil, settleAdmissionFailure("runtime budget rejected", err)
	}
	runtimeSnapshot.Budget = cloneRuntimeBudget(config.RuntimeBudget)
	config.RuntimeCapabilities = proto.Clone(
		runtimeSnapshot.Capabilities,
	).(*model.RuntimeCapabilitySnapshot)
	if maxDepth := config.RuntimeBudget.GetMaxDelegationDepth(); maxDepth > 0 &&
		uint32(config.Depth) > maxDepth {
		budgetErr := runtimeBudgetExhausted(
			maxDelegationDepthExhaustedReason,
			maxDepth,
			uint32(config.Depth),
		)
		return nil, settleAdmissionFailure(maxDelegationDepthExhaustedReason, budgetErr)
	}
	if admittedTurnID == "" {
		if err := validateInputBudgetBeforePersistence(
			s.compression,
			config.RuntimeBudget,
			userInput,
		); err != nil {
			return nil, err
		}
	} else if err := validateAdmittedInputBudget(
		s.compression,
		config.RuntimeBudget,
		userInput,
	); err != nil {
		return nil, settleAdmissionFailure(maxInputTokensExhaustedReason, err)
	}
	admittedAttachments, attachmentErr := s.attachmentAdmission.Admit(
		ctx,
		config.ActorID,
		config.ConversationID,
		config.Attachments,
		runtimeSnapshot.Capabilities,
		config.RuntimeBudget,
	)
	if attachmentErr != nil {
		return nil, settleAdmissionFailure(
			"attachment admission failed before execution",
			attachmentErr,
		)
	}
	config.AdmittedAttachments = admittedAttachments
	config.Attachments = attachmentRefs(admittedAttachments)

	// Attachment admission is intentionally complete before any Turn, attempt,
	// runtime binding, message, or provider state is persisted.
	turnRecord, err := s.createOrReopenTurnRecord(ctx, config, userInput)
	if err != nil {
		return nil, settleAdmissionFailure("failed to establish admitted turn record", err)
	}
	turnID := turnRecord.ID
	if config.AttemptID == "" {
		config.AttemptID, err = s.ensureInitialTurnAttempt(ctx, turnID)
		if err != nil {
			return nil, s.settleAdmittedTurnAfterError(
				ctx,
				config,
				turnID,
				"failed to establish admitted turn attempt",
				err,
			)
		}
	}
	ctx, cancelRuntimeBudget := withRuntimeBudgetDeadline(
		ctx,
		config.RuntimeBudget,
		turnRecord.StartedAt,
	)
	defer cancelRuntimeBudget()
	config.ExecutionContext = ctx
	settleRunningFailure := func(reason string, cause error) error {
		return s.settleAdmittedTurnAfterError(ctx, config, turnID, reason, cause)
	}
	if s.chatTaskService != nil && strings.TrimSpace(config.StepID) != "" {
		if err := s.chatTaskService.BindChatStepToTurn(
			ctx,
			config.TaskID,
			config.StepID,
			turnID,
		); err != nil {
			return nil, settleRunningFailure("failed to bind chat step to running turn", err)
		}
	}
	trace := &domain.TurnTrace{
		TraceID: generateID("trace"),
		TurnID:  turnID,
	}

	if s.capabilityReadiness == nil {
		cause := errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"capability readiness authority is required",
			nil,
		)
		return nil, settleRunningFailure("capability readiness authority is unavailable", cause)
	}
	readiness, agentVersion, readinessErr := s.capabilityReadiness.ResolveForTurn(
		ctx,
		config.ActorID,
		config.AgentID,
		config.ClientCapabilitySessionID,
		runtimeSnapshot,
	)
	if readinessErr != nil {
		return nil, settleRunningFailure("capability readiness rejected", readinessErr)
	}
	if persistErr := s.persistRuntimeAuthority(
		ctx,
		config,
		runtimeSnapshot,
		readiness,
		agentVersion,
	); persistErr != nil {
		return nil, settleRunningFailure("failed to persist runtime authority", persistErr)
	}
	if incompatibilityErr := runtimeCapabilityReadinessError(readiness); incompatibilityErr != nil {
		return nil, settleRunningFailure(
			"runtime capability rejected before execution",
			incompatibilityErr,
		)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, settleRunningFailure("failed to open authorized capability store", err)
	}
	if err := s.applyPinnedRuntimeExecutionPolicy(ctx, db, config); err != nil {
		return nil, settleRunningFailure("failed to apply pinned runtime execution policy", err)
	}
	config.AuthorizedCapabilities, err = LoadAuthorizedCapabilitySet(ctx, db, config)
	if err != nil {
		return nil, settleRunningFailure("failed to load authorized capability set", err)
	}
	config.AvailableTools = restrictAuthorizedToolNames(
		config.AuthorizedCapabilities.ToolNames(),
		config.RestrictedTools,
	)
	if err := validateAuthorizedRuntimeCapabilities(
		config.AvailableTools,
		runtimeSnapshot.Capabilities,
	); err != nil {
		return nil, settleRunningFailure(
			"runtime tool capability rejected before execution",
			err,
		)
	}
	trace.CapabilitySnapshotID = config.AuthorizedCapabilities.SnapshotID

	logger.Infof(ctx, "turn started: turn_id=%s agent_id=%s conversation_id=%s provider=%s",
		turnID, config.AgentID, config.ConversationID, config.Provider)
	if err := s.emitTurnEvent(ctx, config, turnID, TurnEvent{
		Type:  "progress",
		Stage: "turn_started",
	}); err != nil {
		return nil, settleRunningFailure("failed to persist turn start event", err)
	}
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
		if err := s.persistMessageWithAttachments(
			ctx,
			config.ConversationID,
			turnID,
			string(domain.MessageRoleUser),
			userInput,
			config.Model,
			config.Attachments,
		); err != nil {
			return nil, settleRunningFailure("failed to persist user message", err)
		}
	}

	// Step 5 — Load conversation messages.
	messages, err := s.loadMessages(ctx, config.ConversationID)
	if err != nil {
		return nil, settleRunningFailure("failed to load conversation messages", err)
	}
	if config.ContextBranchHeadID != "" {
		messages = projectMessageBranch(messages, config.ContextBranchHeadID)
	}

	processedInput := userInput
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

	assemblyResult, err := s.promptAssembly.AssembleTurnContext(
		ctx,
		config.AgentID,
		config.Identity,
		config.AgentConfigPrompt,
		config.AvailableTools,
		processedInput,
		db,
		config.AuthorizedCapabilities,
		config.MemoryDisabled,
		PromptAssemblyContext{
			TurnID:             turnID,
			ConversationID:     config.ConversationID,
			Messages:           messages,
			WorkspaceReference: config.WorkspaceReference,
		},
	)
	if err != nil {
		assemblyErr := errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"prompt assembly failed",
			err,
		)
		return nil, settleRunningFailure("prompt assembly failed", assemblyErr)
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
		if err := s.emitTurnEvent(ctx, config, turnID, TurnEvent{
			Type:      "progress",
			Stage:     "knowledge_retrieved",
			Iteration: len(trace.KnowledgeChunks),
			Result:    string(knowledgeChunkPayload),
		}); err != nil {
			return nil, settleRunningFailure("failed to persist knowledge retrieval event", err)
		}
	}

	toolDefinitions := s.toolDefinitions(config.AvailableTools)
	toolSchemaSegment, toolDefinitionTokens, err := toolSchemaContextSegment(
		config.AuthorizedCapabilities,
		toolDefinitions,
	)
	if err != nil {
		schemaErr := errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"build authorized Tool schema context",
			err,
		)
		return nil, settleRunningFailure("failed to build authorized Tool schema context", schemaErr)
	}
	trace.ToolDefinitionTokens = toolDefinitionTokens

	// Step 6 — Check / run compression.
	estimatedTokens := s.compression.EstimateTokens(messages) +
		assemblyResult.InjectedTokens +
		int(toolDefinitionTokens)
	shouldCompress := s.compression.ShouldCompress(estimatedTokens, config.ContextWindowSize)

	logger.Infof(ctx, "compression check: turn_id=%s tokens=%d window=%d should_compress=%v",
		turnID, estimatedTokens, config.ContextWindowSize, shouldCompress)

	if shouldCompress {
		var summaryCall *domain.ProviderCallRecord
		messages, summaryCall, err = s.runCompression(
			ctx,
			config,
			turnID,
			trace,
			assemblyResult,
			messages,
			processedInput,
		)
		if summaryCall != nil {
			trace.ProviderCalls = append(trace.ProviderCalls, *summaryCall)
		}
		if err != nil {
			terminalCtx := context.WithoutCancel(ctx)
			if usageErr := s.persistAttemptUsage(
				terminalCtx,
				turnID,
				config.AttemptID,
				trace,
			); usageErr != nil {
				err = errors.Join(err, fmt.Errorf(
					"persist compression-attempt usage: %w",
					usageErr,
				))
			}
			if traceErr := s.saveTurnTrace(terminalCtx, trace); traceErr != nil {
				err = errors.Join(err, fmt.Errorf(
					"persist compression-attempt trace: %w",
					traceErr,
				))
			}
			return nil, settleRunningFailure("context compression failed", err)
		}
	}
	estimatedTokens = s.compression.EstimateTokens(messages) +
		assemblyResult.InjectedTokens +
		int(toolDefinitionTokens)
	if maxInputTokens := config.RuntimeBudget.GetMaxInputTokens(); maxInputTokens > 0 &&
		uint64(estimatedTokens) > maxInputTokens {
		budgetErr := runtimeBudgetExhaustedWithDetails(
			maxInputTokensExhaustedReason,
			fmt.Sprintf("%d", maxInputTokens),
			fmt.Sprintf("%d", estimatedTokens),
		)
		return nil, settleRunningFailure(maxInputTokensExhaustedReason, budgetErr)
	}
	if toolSchemaSegment != nil {
		assemblyResult.Segments = append(
			assemblyResult.Segments,
			*toolSchemaSegment,
		)
	}
	attachmentSegments := attachmentContextSegments(config.AdmittedAttachments)
	if len(attachmentSegments) > 0 {
		assemblyResult.Segments = append(assemblyResult.Segments, attachmentSegments...)
		for _, segment := range attachmentSegments {
			if err := s.emitTurnEvent(ctx, config, turnID, TurnEvent{
				Type:   "progress",
				Stage:  "attachment_omitted",
				Source: segment.SourceRefs[0],
				Result: segment.DecisionReason,
			}); err != nil {
				return nil, settleRunningFailure("failed to persist attachment omission event", err)
			}
		}
	}
	sortContextSegments(assemblyResult.Segments)

	// Persist ContextLedger to TurnAttempt (MCA-D04).
	if config.AttemptID != "" {
		contextLedger, ledgerBuildErr := buildContextLedger(
			config,
			turnID,
			assemblyResult,
			uint64(max(estimatedTokens, 0)),
		)
		if ledgerBuildErr != nil {
			return nil, settleRunningFailure(
				"failed to build turn attempt context ledger",
				ledgerBuildErr,
			)
		}
		if ledgerErr := s.persistContextLedger(
			ctx,
			contextLedger,
		); ledgerErr != nil {
			return nil, settleRunningFailure(
				"failed to persist turn attempt context ledger",
				ledgerErr,
			)
		}
	}
	config.promptAssembly = assemblyResult
	config.currentInput = processedInput
	// Attachment bytes are admission-only transient data until a provider
	// adapter has an explicit native image/file mapping. Never persist them.
	config.AdmittedAttachments = nil

	// A provider call is an external side effect. Persist the trace authority
	// before starting it so abrupt process loss cannot leave a durable Turn
	// without its corresponding trace.
	if err := s.saveTurnTrace(ctx, trace); err != nil {
		return nil, settleRunningFailure("failed to checkpoint turn trace before provider call", err)
	}
	if err := s.validatePinnedRuntimeAuthority(ctx, config); err != nil {
		return nil, settleRunningFailure("runtime capability provenance is stale", err)
	}

	// Step 7 — Credential lease + provider call with error recovery loop.
	if err := s.emitTurnEvent(ctx, config, turnID, TurnEvent{
		Type:  "progress",
		Stage: "provider_call_started",
	}); err != nil {
		return nil, settleRunningFailure("failed to persist provider start event", err)
	}
	assistantResponse, providerToolCalls, providerCalls, streamed, err := s.providerCallWithRetry(
		ctx, config, turnID, trace, assemblyResult.SystemPrompt, messages,
	)
	trace.ProviderCalls = append(trace.ProviderCalls, providerCalls...)
	if err != nil {
		terminalCtx := context.WithoutCancel(ctx)
		if usageErr := s.persistAttemptUsage(terminalCtx, turnID, config.AttemptID, trace); usageErr != nil {
			return nil, settleRunningFailure(
				"failed to persist failed-attempt usage",
				errors.Join(err, fmt.Errorf("persist failed-attempt usage: %w", usageErr)),
			)
		}
		if traceErr := s.saveTurnTrace(terminalCtx, trace); traceErr != nil {
			return nil, settleRunningFailure(
				"failed to persist failed-attempt trace",
				errors.Join(err, fmt.Errorf("persist failed-attempt trace: %w", traceErr)),
			)
		}
		if errors.Is(err, errExplicitUserCancellation) {
			return nil, settleRunningFailure("provider call cancelled", err)
		}
		if errors.Is(err, context.Canceled) {
			return nil, settleRunningFailure("provider call interrupted", err)
		}
		if reason, exhausted := runtimeBudgetExhaustionReason(err); exhausted {
			return nil, settleRunningFailure(reason, err)
		}
		return nil, settleRunningFailure(fmt.Sprintf("provider call failed after retries: %v", err), err)
	}
	if !streamed {
		if err := s.emitTurnEvent(ctx, config, turnID, TurnEvent{
			Type:  "text",
			Text:  assistantResponse,
			Stage: "provider_call_completed",
		}); err != nil {
			return nil, settleRunningFailure("failed to persist provider response event", err)
		}
	}

	// Step 8 — Tool call iteration loop.
	if len(providerToolCalls) > 0 {
		if err := s.validatePinnedRuntimeAuthority(ctx, config); err != nil {
			return nil, settleRunningFailure(
				"runtime capability provenance changed before tool dispatch",
				err,
			)
		}
	}
	toolIterations, paused, err := s.processToolCalls(
		ctx,
		config,
		turnID,
		trace,
		assemblyResult.SystemPrompt,
		messages,
		&assistantResponse,
		providerToolCalls,
		0,
	)
	if usageErr := s.persistAttemptUsage(ctx, turnID, config.AttemptID, trace); usageErr != nil {
		return nil, settleRunningFailure("failed to persist turn usage", usageErr)
	}
	if err != nil {
		terminalReason := fmt.Sprintf("tool call processing failed: %v", err)
		if reason, exhausted := runtimeBudgetExhaustionReason(err); exhausted {
			terminalReason = reason
		}
		return nil, settleRunningFailure(terminalReason, err)
	}
	if paused {
		if err := s.markTurnWaitingForLocalTool(ctx, turnID, config.AttemptID, toolIterations); err != nil {
			return nil, settleRunningFailure("failed to persist local tool wait state", err)
		}
		if s.chatTaskService != nil && config.StepID != "" {
			if err := s.chatTaskService.BindChatStepToTurn(
				ctx,
				config.TaskID,
				config.StepID,
				turnID,
			); err != nil {
				return nil, settleRunningFailure("failed to bind local tool wait step", err)
			}
		}
		if err := s.saveTurnTrace(ctx, trace); err != nil {
			logger.Errorf(ctx, "failed to save paused turn trace: turn_id=%s err=%v", turnID, err)
		}
		if err := s.emitTurnEvent(ctx, config, turnID, TurnEvent{
			Type:      "progress",
			Stage:     "waiting_local_tool",
			Iteration: toolIterations,
		}); err != nil {
			return nil, settleRunningFailure("failed to persist local tool wait event", err)
		}
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

	assistantResponse = strings.TrimSpace(assistantResponse)
	turn, err := s.finishTurnExecution(
		ctx,
		config,
		turnRecord,
		trace,
		messages,
		userInput,
		assistantResponse,
		toolIterations,
	)
	if err != nil {
		return nil, settleRunningFailure("failed to complete turn", err)
	}
	return turn, nil
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

	// Step 10 — Persist the assistant message, terminal state, step, and
	// replayable terminal events in one transaction.
	if err := s.completeTurn(ctx, config, turnID, assistantResponse, toolIterations); err != nil {
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
	currentInput string,
) ([]domain.Message, *domain.ProviderCallRecord, error) {

	trace.CompressionTriggered = true

	if err := s.validatePinnedRuntimeAuthority(ctx, config); err != nil {
		return nil, nil, fmt.Errorf("validate runtime before pre-compression hook: %w", err)
	}

	// MemoryProvider hook: on_pre_compress — let external backend archive before eviction.
	if mp := s.memoryProvider(); mp != nil {
		if notifyErr := mp.OnPreCompress(messages); notifyErr != nil {
			logger.Warnf(ctx, "compression: MemoryProvider.OnPreCompress failed (non-fatal): turn_id=%s err=%v", turnID, notifyErr)
		}
	}

	// Step 1 — Execute compression (prune + split + build summary prompt).
	compResult, compErr := s.compression.Compress(ctx, messages, config.ContextWindowSize)
	if compErr != nil {
		logger.Errorf(ctx, "compression failed: turn_id=%s err=%v", turnID, compErr)
		return nil, nil, errcode.New(
			errcode.AgentCompressionFailed,
			http.StatusInternalServerError,
			"context compression failed",
			compErr,
		)
	}

	trace.CompressionBefore = compResult.TokensBefore
	trace.CompressionAfter = compResult.TokensAfter

	// Step 2 — Execute LLM summary call if summary prompt was generated.
	var summaryCall *domain.ProviderCallRecord
	if compResult.Summary != "" {
		summaryText, callRecord, summaryErr := s.executeSummaryLLM(
			ctx,
			config,
			compResult.Summary,
		)
		summaryCall = callRecord
		if summaryErr != nil {
			return nil, summaryCall, fmt.Errorf(
				"compression summary provider call failed: %w",
				summaryErr,
			)
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
	db, dbErr := s.getDB(ctx)
	if dbErr != nil {
		return nil, summaryCall, fmt.Errorf(
			"open post-compression prompt store: %w",
			dbErr,
		)
	}
	if len(messages) == 0 {
		return nil, summaryCall, errcode.New(
			errcode.AgentCompressionFailed,
			http.StatusInternalServerError,
			"context compression produced no messages",
			nil,
		)
	}
	freshAssembly, freshErr := s.promptAssembly.AssembleTurnContext(
		ctx,
		config.AgentID,
		config.Identity,
		config.AgentConfigPrompt,
		config.AvailableTools,
		currentInput,
		db,
		config.AuthorizedCapabilities,
		config.MemoryDisabled,
		PromptAssemblyContext{
			TurnID:             turnID,
			ConversationID:     config.ConversationID,
			Messages:           messages,
			WorkspaceReference: config.WorkspaceReference,
		},
	)
	if freshErr != nil {
		return nil, summaryCall, fmt.Errorf(
			"reassemble governed context after compression: %w",
			freshErr,
		)
	}
	freshAssembly.Segments = append(
		freshAssembly.Segments,
		contextSegmentsNotRebuiltByPromptAssembly(assemblyResult.Segments)...,
	)
	sortContextSegments(freshAssembly.Segments)
	*assemblyResult = *freshAssembly
	trace.MemorySnapshotHash = freshAssembly.MemorySnapshotHash
	trace.SkillIndexHash = freshAssembly.SkillIndexHash
	trace.KnowledgeChunks = freshAssembly.KnowledgeChunks

	return messages, summaryCall, nil
}

func contextSegmentsNotRebuiltByPromptAssembly(
	segments []ContextSegment,
) []ContextSegment {
	var preserved []ContextSegment
	for _, segment := range segments {
		switch segment.Type {
		case model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_TOOL_SCHEMA,
			model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_ATTACHMENT:
			preserved = append(preserved, segment)
		}
	}
	return preserved
}

func contextSegmentForSkillBody(skill *domain.SkillManifest) ContextSegment {
	if skill == nil {
		return ContextSegment{
			Type:           model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_SKILL_BODY,
			Decision:       model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_REJECTED,
			DecisionReason: "skill_body_unavailable",
		}
	}
	content := strings.TrimSpace(skill.Content)
	decision := model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_INCLUDED
	decisionReason := ""
	if content == "" {
		decision = model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_REJECTED
		decisionReason = "skill_body_empty"
	}

	return ContextSegment{
		Type:    model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_SKILL_BODY,
		Content: content,
		SourceRefs: []string{fmt.Sprintf(
			"skill:%s:version=%d",
			skill.SkillID,
			skill.Version,
		)},
		ContentHash:     sha256Hex(content),
		EstimatedTokens: estimateTokens(content),
		Decision:        decision,
		DecisionReason:  decisionReason,
	}
}

func sortContextSegments(segments []ContextSegment) {
	sort.SliceStable(segments, func(left, right int) bool {
		return segments[left].Type < segments[right].Type
	})
}

func redactedContextSegments(segments []ContextSegment) []ContextSegment {
	redacted := make([]ContextSegment, len(segments))
	for index := range segments {
		redacted[index] = segments[index]
		redacted[index].Content = ""
		redacted[index].KnowledgeChunks = nil
		redacted[index].IncludeInSystemPrompt = false
	}

	return redacted
}

const contextLedgerPromptVersion = "v1"

func buildContextLedger(
	config *TurnConfig,
	turnID string,
	assembly *PromptAssemblyResult,
	estimatedInputTokens uint64,
) (*model.ContextLedger, error) {
	if config == nil || assembly == nil || strings.TrimSpace(config.AttemptID) == "" {
		return nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"context ledger requires turn configuration and prompt assembly",
			nil,
		)
	}
	ledgerID := "context:" + config.AttemptID
	segments := contextLedgerSegments(ledgerID, assembly.Segments)
	var reservedOutputTokens uint64
	if config.RuntimeBudget != nil {
		reservedOutputTokens = config.RuntimeBudget.GetMaxOutputTokens()
	}
	var modelContextWindow uint64
	if config.RuntimeCapabilities != nil && config.RuntimeCapabilities.GetLimits() != nil {
		modelContextWindow = config.RuntimeCapabilities.GetLimits().GetContextTokens()
	}
	if modelContextWindow == 0 && config.ContextWindowSize > 0 {
		modelContextWindow = uint64(config.ContextWindowSize)
	}
	ledger := &model.ContextLedger{
		ContextLedgerId:      ledgerID,
		TurnId:               turnID,
		AttemptId:            config.AttemptID,
		Segments:             segments,
		EstimatedInputTokens: estimatedInputTokens,
		ReservedOutputTokens: reservedOutputTokens,
		ModelContextWindow:   modelContextWindow,
		PromptHash:           "",
		PromptVersion:        contextLedgerPromptVersion,
	}
	promptHash, err := contextLedgerHash(ledger)
	if err != nil {
		return nil, err
	}
	ledger.PromptHash = promptHash
	return ledger, nil
}

func contextLedgerSegments(
	ledgerID string,
	segments []ContextSegment,
) []*model.ContextSegment {
	ordered := append([]ContextSegment(nil), segments...)
	sortContextSegments(ordered)
	redacted := redactedContextSegments(ordered)
	result := make([]*model.ContextSegment, 0, len(redacted))
	for index, segment := range redacted {
		result = append(result, contextLedgerSegment(ledgerID, index, segment))
	}
	return result
}

func contextLedgerSegment(
	ledgerID string,
	index int,
	segment ContextSegment,
) *model.ContextSegment {
	return &model.ContextSegment{
		SegmentId:       fmt.Sprintf("%s:%d", ledgerID, index+1),
		Type:            segment.Type,
		SourceRefs:      redactDiagnosticRefs(segment.SourceRefs),
		ContentHash:     segment.ContentHash,
		EstimatedTokens: uint64(max(segment.EstimatedTokens, 0)),
		Decision:        segment.Decision,
		DecisionReason:  redactDiagnosticText(segment.DecisionReason),
	}
}

func contextLedgerHash(ledger *model.ContextLedger) (string, error) {
	canonical := proto.Clone(ledger).(*model.ContextLedger)
	canonical.PromptHash = ""
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(canonical)
	if err != nil {
		return "", errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"encode canonical context ledger",
			err,
		)
	}
	return sha256Hex(string(encoded)), nil
}

func (s *TurnService) persistContextLedger(
	ctx context.Context,
	ledger *model.ContextLedger,
) error {
	if ledger == nil || strings.TrimSpace(ledger.GetAttemptId()) == "" {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"context ledger requires an attempt ID",
			nil,
		)
	}
	ledgerJSON, err := protojson.MarshalOptions{UseProtoNames: true}.Marshal(ledger)
	if err != nil {
		return errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"encode turn attempt context ledger",
			err,
		)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	result := db.WithContext(ctx).
		Model(&persistence.TurnAttempt{}).
		Where("id = ?", ledger.GetAttemptId()).
		Update("context_ledger", string(ledgerJSON))
	if result.Error != nil {
		return errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"persist turn attempt context ledger",
			result.Error,
		)
	}
	if result.RowsAffected != 1 {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"context ledger attempt is unavailable",
			nil,
		)
	}

	return nil
}

func (s *TurnService) upsertContextLedgerSegment(
	ctx context.Context,
	attemptID string,
	segment ContextSegment,
) error {
	if strings.TrimSpace(attemptID) == "" {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"context ledger segment requires an attempt ID",
			nil,
		)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var attempt persistence.TurnAttempt
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Select("id", "context_ledger").
			First(&attempt, "id = ?", attemptID).Error; err != nil {
			return errcode.New(
				errcode.AgentInvalidSourceState,
				http.StatusConflict,
				"load context ledger attempt",
				err,
			)
		}
		if strings.TrimSpace(attempt.ContextLedger) == "" {
			return errcode.New(
				errcode.AgentInvalidSourceState,
				http.StatusConflict,
				"context ledger envelope is unavailable",
				nil,
			)
		}
		var ledger model.ContextLedger
		if err := protojson.Unmarshal([]byte(attempt.ContextLedger), &ledger); err != nil {
			return errcode.New(
				errcode.AgentInvalidSourceState,
				http.StatusConflict,
				"decode persisted context ledger",
				err,
			)
		}
		candidate := contextLedgerSegment(
			ledger.GetContextLedgerId(),
			len(ledger.GetSegments()),
			segment,
		)
		replaced := false
		for index := range ledger.Segments {
			if ledger.Segments[index].GetType() == candidate.GetType() &&
				protoContextSegmentSourceKey(ledger.Segments[index]) ==
					protoContextSegmentSourceKey(candidate) {
				candidate.SegmentId = ledger.Segments[index].GetSegmentId()
				ledger.Segments[index] = candidate
				replaced = true
				break
			}
		}
		if !replaced {
			ledger.Segments = append(ledger.Segments, candidate)
		}
		sort.SliceStable(ledger.Segments, func(left, right int) bool {
			return ledger.Segments[left].GetType() < ledger.Segments[right].GetType()
		})
		for index := range ledger.Segments {
			ledger.Segments[index].SegmentId = fmt.Sprintf(
				"%s:%d",
				ledger.GetContextLedgerId(),
				index+1,
			)
		}
		ledger.EstimatedInputTokens = contextLedgerEstimatedInputTokens(
			ledger.GetSegments(),
		)
		promptHash, err := contextLedgerHash(&ledger)
		if err != nil {
			return err
		}
		ledger.PromptHash = promptHash
		encoded, err := protojson.MarshalOptions{UseProtoNames: true}.Marshal(&ledger)
		if err != nil {
			return errcode.New(
				errcode.AgentInternal,
				http.StatusInternalServerError,
				"encode updated context ledger",
				err,
			)
		}
		if err := tx.Model(&persistence.TurnAttempt{}).
			Where("id = ?", attemptID).
			Update("context_ledger", string(encoded)).Error; err != nil {
			return errcode.New(
				errcode.AgentInternal,
				http.StatusInternalServerError,
				"update context ledger segment",
				err,
			)
		}

		return nil
	})
}

func protoContextSegmentSourceKey(segment *model.ContextSegment) string {
	if segment == nil || len(segment.GetSourceRefs()) == 0 {
		return ""
	}

	return segment.GetSourceRefs()[0]
}

func contextLedgerEstimatedInputTokens(segments []*model.ContextSegment) uint64 {
	var total uint64
	for _, segment := range segments {
		if segment != nil &&
			segment.GetDecision() != model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_REJECTED {
			total += segment.GetEstimatedTokens()
		}
	}
	return total
}

// ---------------------------------------------------------------------------
// executeSummaryLLM — produce actual summary text from a summary prompt
// ---------------------------------------------------------------------------

// executeSummaryLLM leases a credential and calls the LLM to generate a
// concise summary from the given summary prompt. The summary prompt is
// produced by CompressionService.Compress and contains the conversation
// text to summarize along with formatting instructions.
func (s *TurnService) executeSummaryLLM(
	ctx context.Context,
	config *TurnConfig,
	summaryPrompt string,
) (string, *domain.ProviderCallRecord, error) {
	if err := s.validatePinnedRuntimeAuthority(ctx, config); err != nil {
		return "", nil, err
	}
	credential, err := s.credentialPool.Lease(ctx, config.ActorID, config.Provider, domain.RotationRoundRobin)
	if err != nil {
		return "", nil, fmt.Errorf("no credential for summary: %w", err)
	}
	defer s.credentialPool.Release(ctx, credential.CredentialID)

	callStart := time.Now()
	resp, err := s.callProviderWithRuntimeAuthority(ctx, config, &ProviderCallRequest{
		ProviderID:   credential.CredentialID,
		Model:        config.Model,
		SystemPrompt: "You are a summarization assistant. Produce a concise structured summary.",
		Messages: []domain.Message{{
			Role:    domain.MessageRoleUser,
			Content: summaryPrompt,
		}},
		ProviderType:    config.Provider,
		Effort:          config.Effort,
		ThinkingMode:    config.ThinkingMode,
		MaxOutputTokens: int(config.RuntimeBudget.GetMaxOutputTokens()),
	})
	callRecord := &domain.ProviderCallRecord{
		Provider:     config.Provider,
		Model:        config.Model,
		Latency:      time.Since(callStart),
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
	if err != nil {
		return "", callRecord, err
	}

	return resp.Content, callRecord, nil
}

func (s *TurnService) callProviderWithRuntimeAuthority(
	ctx context.Context,
	config *TurnConfig,
	request *ProviderCallRequest,
) (*ProviderCallResponse, error) {
	if err := s.validatePinnedRuntimeAuthority(ctx, config); err != nil {
		return nil, err
	}
	if request == nil {
		return nil, errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"provider call request is required",
			nil,
		)
	}
	if s.providerCall == nil && s.providerService == nil {
		return nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"provider execution service is unavailable",
			nil,
		)
	}
	if err := validateProviderRequestInputBudget(
		s.compression,
		config.RuntimeBudget,
		request,
	); err != nil {
		return nil, err
	}
	if config.RuntimeBudget == nil || config.RuntimeBudget.MaxCost != nil {
		return nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"provider cost budget is unsupported without an authoritative pricing source",
			nil,
		)
	}
	request.UserID = config.ActorID
	request.ExpectedProviderConfigVersion = config.ProviderConfigVersion
	request.ExpectedCapabilitySourceVersion = config.CapabilitySourceVersion
	request.BeforeDispatch = func(dispatchCtx context.Context) error {
		return s.reserveProviderAttempt(dispatchCtx, config)
	}
	if len(request.Tools) > 0 && config.Provider == "ark" {
		agentic := config.RuntimeCapabilities.GetAgentic()
		// #region debug-point C-D:foundation-f04-runtime-authority
		reportFoundationF04DuplicateToolCallsDebug(
			"C-D",
			"runtime-tool-authority",
			map[string]any{
				"nativeTools":   agentic.GetNativeTools(),
				"parallelTools": agentic.GetParallelTools(),
				"toolCount":     len(request.Tools),
			},
		)
		// #endregion
	}
	var response *ProviderCallResponse
	var err error
	if s.providerCall != nil {
		response, err = s.providerCall(ctx, request)
	} else {
		response, err = s.providerService.Call(ctx, request)
	}
	if err != nil {
		return nil, err
	}
	if response != nil &&
		response.OutputTokens > int(config.RuntimeBudget.GetMaxOutputTokens()) {
		return response, runtimeBudgetExhaustedWithDetails(
			maxOutputTokensExhaustedReason,
			fmt.Sprintf("%d", config.RuntimeBudget.GetMaxOutputTokens()),
			fmt.Sprintf("%d", response.OutputTokens),
		)
	}
	return response, nil
}

func (s *TurnService) reserveProviderAttempt(
	ctx context.Context,
	config *TurnConfig,
) error {
	if config == nil || config.RuntimeBudget == nil ||
		strings.TrimSpace(config.TurnID) == "" {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"provider attempt requires a turn-scoped runtime budget",
			nil,
		)
	}
	maxAttempts := config.RuntimeBudget.GetMaxAttempts()
	if maxAttempts == 0 {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"provider attempt budget is unavailable",
			nil,
		)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	result := db.WithContext(ctx).
		Model(&persistence.AgentTurn{}).
		Where(
			"id = ? AND provider_attempt_count < ?",
			config.TurnID,
			maxAttempts,
		).
		UpdateColumn(
			"provider_attempt_count",
			gorm.Expr("provider_attempt_count + 1"),
		)
	if result.Error != nil {
		return errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"reserve provider attempt",
			result.Error,
		)
	}
	if result.RowsAffected == 1 {
		return nil
	}

	var turn persistence.AgentTurn
	if err := db.WithContext(ctx).
		Select("id", "provider_attempt_count").
		First(&turn, "id = ?", config.TurnID).Error; err != nil {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"provider attempt turn is unavailable",
			err,
		)
	}
	return runtimeBudgetExhausted(
		maxAttemptsExhaustedReason,
		maxAttempts,
		turn.ProviderAttemptCount,
	)
}

// ---------------------------------------------------------------------------
// memoryProvider — accessor for the external MemoryProvider (may be nil)
// ---------------------------------------------------------------------------

// memoryProvider returns the external MemoryProvider if one is attached, or nil.
func (s *TurnService) memoryProvider() domain.MemoryProvider {
	return s.memoryService.GetMemoryProvider()
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
) (string, []ProviderToolCall, []domain.ProviderCallRecord, bool, error) {

	maxRetries := config.MaxRetries
	if maxRetries <= 0 {
		maxRetries = 3
	}
	if maxAttempts := int(config.RuntimeBudget.GetMaxAttempts()); maxAttempts > 0 &&
		maxRetries+1 > maxAttempts {
		maxRetries = maxAttempts - 1
	}

	var providerCalls []domain.ProviderCallRecord
	var toolDefinitions []*domain.ToolDefinition
	if s.toolRegistry != nil {
		toolDefinitions = s.toolRegistry.Definitions(config.AvailableTools)
	}
	if trace.ToolDefinitionTokens == 0 {
		trace.ToolDefinitionTokens = estimateToolDefinitionTokens(toolDefinitions)
	}

	// Recover any cooled-down credentials before starting the retry loop.
	if recovered, _ := s.credentialPool.RecoverCooledDown(ctx); recovered > 0 {
		logger.Infof(ctx, "credential recovery: %d credentials restored before provider call", recovered)
	}

	strategy := config.RotationStrategy
	if strategy == "" {
		strategy = domain.RotationRoundRobin
	}

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if err := executionContextError(ctx); err != nil {
			return "", nil, providerCalls, false, err
		}

		providerID := strings.TrimSpace(config.Provider)
		if providerID == "" {
			return "", nil, providerCalls, false, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
				"provider is required in turn config", nil)
		}
		if err := s.validatePinnedRuntimeAuthority(ctx, config); err != nil {
			return "", nil, providerCalls, false, err
		}

		// Lease a credential for the provider.
		credential, leaseErr := s.credentialPool.Lease(ctx, config.ActorID, providerID, strategy)
		if leaseErr != nil {
			logger.Errorf(ctx, "credential lease failed: turn_id=%s attempt=%d err=%v",
				turnID, attempt, leaseErr)

			// If no credential is available on a retry, it's fatal.
			if attempt > 0 {
				return "", nil, providerCalls, false, errcode.New(errcode.AgentCredentialFailed,
					http.StatusServiceUnavailable, "no credentials available after rotation", leaseErr)
			}
			return "", nil, providerCalls, false, leaseErr
		}

		logger.Infof(ctx, "credential leased: turn_id=%s attempt=%d credential_id=%s",
			turnID, attempt, credential.CredentialID)

		callStart := time.Now()

		resp, callErr := s.callProviderWithRuntimeAuthority(ctx, config, &ProviderCallRequest{
			ProviderID:      credential.CredentialID,
			Model:           config.Model,
			SystemPrompt:    systemPrompt,
			Messages:        messages,
			Tools:           toolDefinitions,
			ProviderType:    config.Provider,
			Effort:          config.Effort,
			ThinkingMode:    config.ThinkingMode,
			MaxOutputTokens: int(config.RuntimeBudget.GetMaxOutputTokens()),
			DeltaSink: func(deltaCtx context.Context, delta ProviderDelta) error {
				return s.emitTurnEvent(deltaCtx, config, turnID, TurnEvent{
					Type:  delta.Type,
					Text:  delta.Content,
					Stage: "provider_delta",
				})
			},
		})

		callDuration := time.Since(callStart)

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
		_ = s.credentialPool.Release(context.WithoutCancel(ctx), credential.CredentialID)

		if err := executionContextError(ctx); err != nil {
			return "", nil, providerCalls, false, err
		}

		if errors.Is(callErr, errTurnEventPersistence) {
			return "", nil, providerCalls, false, callErr
		}
		if _, exhausted := runtimeBudgetExhaustionReason(callErr); exhausted {
			return "", nil, providerCalls, false, callErr
		}

		// Success path.
		if callErr == nil && resp != nil {
			logger.Infof(ctx, "provider call success: turn_id=%s attempt=%d model=%s input=%d output=%d latency=%s",
				turnID, attempt, resp.Model, resp.InputTokens, resp.OutputTokens, callDuration)
			return resp.Content, resp.ToolCalls, providerCalls, resp.Streamed, nil
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
			if config.promptAssembly == nil {
				return "", nil, providerCalls, false, errcode.New(
					errcode.AgentInvalidSourceState,
					http.StatusConflict,
					"context overflow recovery requires the governed prompt assembly",
					callErr,
				)
			}
			compressedMessages, summaryCall, compErr := s.runCompression(
				ctx,
				config,
				turnID,
				trace,
				config.promptAssembly,
				messages,
				config.currentInput,
			)
			if summaryCall != nil {
				providerCalls = append(providerCalls, *summaryCall)
			}
			if compErr != nil {
				return "", nil, providerCalls, false, fmt.Errorf(
					"governed context overflow recovery failed: %w",
					compErr,
				)
			}
			messages = compressedMessages
			systemPrompt = config.promptAssembly.SystemPrompt
			estimatedInputTokens := s.compression.EstimateTokens(messages) +
				config.promptAssembly.InjectedTokens +
				int(trace.ToolDefinitionTokens)
			ledger, ledgerErr := buildContextLedger(
				config,
				turnID,
				config.promptAssembly,
				uint64(max(estimatedInputTokens, 0)),
			)
			if ledgerErr != nil {
				return "", nil, providerCalls, false, fmt.Errorf(
					"rebuild compressed ContextLedger: %w",
					ledgerErr,
				)
			}
			if ledgerErr := s.persistContextLedger(ctx, ledger); ledgerErr != nil {
				return "", nil, providerCalls, false, fmt.Errorf(
					"persist compressed ContextLedger: %w",
					ledgerErr,
				)
			}
		}

		// A fallback model is a different runtime tuple and must be admitted as
		// a new attempt instead of mutating the pinned authority in place.
		if classified.ShouldFallback && config.FallbackModel != "" && config.Model != config.FallbackModel {
			return "", nil, providerCalls, false, errcode.New(
				errcode.AgentVersionConflict,
				http.StatusConflict,
				"provider fallback requires a new runtime admission",
				callErr,
			)
		}

		// Non-retryable errors terminate the loop immediately.
		if !classified.Retryable && !classified.ShouldCompress && !classified.ShouldRotateCredential && !classified.ShouldFallback {
			return "", nil, providerCalls, false, errcode.New(errcode.AgentProviderFailed, http.StatusBadGateway,
				fmt.Sprintf("non-retryable provider error: %s", classified.Reason.String()), callErr)
		}
	}

	return "", nil, providerCalls, false, errcode.New(errcode.AgentProviderFailed, http.StatusBadGateway,
		fmt.Sprintf("provider call exhausted %d retries", maxRetries), nil)
}

func estimateToolDefinitionTokens(definitions []*domain.ToolDefinition) uint64 {
	var bytes int
	for _, definition := range definitions {
		if definition == nil {
			continue
		}
		bytes += len(definition.Name)
		bytes += len(definition.Description)
		bytes += len(definition.JSONSchema)
	}
	if bytes == 0 {
		return 0
	}
	return uint64((bytes + 3) / 4)
}

func (s *TurnService) toolDefinitions(names []string) []*domain.ToolDefinition {
	if s.toolRegistry == nil {
		return nil
	}
	return s.toolRegistry.Definitions(names)
}

func toolSchemaContextSegment(
	authorized *AuthorizedCapabilitySet,
	definitions []*domain.ToolDefinition,
) (*ContextSegment, uint64, error) {
	tools, err := toOpenAITools(definitions)
	if err != nil {
		return nil, 0, err
	}
	if len(tools) == 0 {
		return nil, 0, nil
	}
	if authorized == nil {
		return nil, 0, fmt.Errorf("authorized capability set is required")
	}
	encoded, err := json.Marshal(tools)
	if err != nil {
		return nil, 0, fmt.Errorf("encode Tool schemas: %w", err)
	}
	sourceRefs := make([]string, 0, len(definitions))
	for _, definition := range definitions {
		capability, ok := authorized.Tool(definition.Name)
		if !ok {
			return nil, 0, fmt.Errorf(
				"Tool schema %q is not authorized by the pinned snapshot",
				definition.Name,
			)
		}
		sourceRefs = append(
			sourceRefs,
			fmt.Sprintf(
				"capability:%s@%s",
				capability.Manifest.GetCapabilityId(),
				capability.Manifest.GetVersion(),
			),
		)
	}
	tokens := uint64((len(encoded) + 3) / 4)
	return &ContextSegment{
		Type:            model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_TOOL_SCHEMA,
		Content:         string(encoded),
		SourceRefs:      sourceRefs,
		ContentHash:     sha256Hex(string(encoded)),
		EstimatedTokens: int(tokens),
		Decision:        model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_INCLUDED,
	}, tokens, nil
}

// ---------------------------------------------------------------------------
// processToolCalls — tool call iteration loop
// ---------------------------------------------------------------------------

const (
	localToolTimeout = 120 * time.Second

	toolContinuationPollInterval      = 250 * time.Millisecond
	toolContinuationLeaseTTL          = 2 * time.Minute
	preparedTakeoverReconcileInterval = 5 * time.Second
)

func validateTurnRuntimeCapabilities(
	config *TurnConfig,
	snapshot *model.RuntimeCapabilitySnapshot,
) error {
	if snapshot == nil ||
		snapshot.GetInput() == nil ||
		snapshot.GetOutput() == nil ||
		snapshot.GetRuntime() == nil ||
		!snapshot.GetInput().GetText() ||
		!snapshot.GetOutput().GetText() ||
		!snapshot.GetRuntime().GetStreaming() {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"selected runtime does not declare required chat capabilities",
			nil,
		)
	}
	if config != nil &&
		config.ThinkingMode == domain.ThinkingModeEnabled &&
		!snapshot.GetRuntime().GetReasoning() {
		return errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"selected runtime does not support explicit thinking mode",
			nil,
		)
	}
	return nil
}

func validateAuthorizedRuntimeCapabilities(
	availableTools []string,
	snapshot *model.RuntimeCapabilitySnapshot,
) error {
	if len(availableTools) == 0 {
		return nil
	}
	if snapshot == nil ||
		snapshot.GetAgentic() == nil ||
		!snapshot.GetAgentic().GetNativeTools() {
		return errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"selected runtime does not support authorized tools",
			nil,
		)
	}
	return nil
}

func validateInputBudgetBeforePersistence(
	compression *CompressionService,
	budget *model.RuntimeBudget,
	userInput string,
) error {
	limitTokens, actualTokens, err := inputBudgetUsage(
		compression,
		budget,
		userInput,
	)
	if err != nil {
		return err
	}
	if actualTokens <= limitTokens {
		return nil
	}
	return errcode.NewContextOverflow(limitTokens, actualTokens)
}

func validateAdmittedInputBudget(
	compression *CompressionService,
	budget *model.RuntimeBudget,
	userInput string,
) error {
	limitTokens, actualTokens, err := inputBudgetUsage(
		compression,
		budget,
		userInput,
	)
	if err != nil {
		return err
	}
	if actualTokens <= limitTokens {
		return nil
	}
	return runtimeBudgetExhaustedWithDetails(
		maxInputTokensExhaustedReason,
		fmt.Sprintf("%d", limitTokens),
		fmt.Sprintf("%d", actualTokens),
	)
}

func inputBudgetUsage(
	compression *CompressionService,
	budget *model.RuntimeBudget,
	userInput string,
) (uint64, uint64, error) {
	if budget == nil || budget.GetMaxInputTokens() == 0 {
		return 0, 0, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"runtime input budget is unavailable",
			nil,
		)
	}
	message := domain.Message{
		Role:    domain.MessageRoleUser,
		Content: userInput,
	}
	actualTokens := len(userInput)/4 + 10
	if compression != nil {
		actualTokens = compression.EstimateTokens([]domain.Message{message})
	}
	return budget.GetMaxInputTokens(), uint64(actualTokens), nil
}

func validateProviderRequestInputBudget(
	compression *CompressionService,
	budget *model.RuntimeBudget,
	request *ProviderCallRequest,
) error {
	if request == nil {
		return errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"provider call request is required",
			nil,
		)
	}
	if budget == nil || budget.GetMaxInputTokens() == 0 {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"runtime input budget is unavailable",
			nil,
		)
	}
	messages := make([]domain.Message, 0, len(request.Messages)+1)
	if request.SystemPrompt != "" {
		messages = append(messages, domain.Message{
			Role:    domain.MessageRoleSystem,
			Content: request.SystemPrompt,
		})
	}
	messages = append(messages, request.Messages...)
	actualTokens := 0
	if compression != nil {
		actualTokens = compression.EstimateTokens(messages)
	} else {
		for _, message := range messages {
			actualTokens += len(message.Content)/4 + 10
		}
	}
	actualTokens += int(estimateToolDefinitionTokens(request.Tools))
	if uint64(actualTokens) <= budget.GetMaxInputTokens() {
		return nil
	}
	return runtimeBudgetExhaustedWithDetails(
		maxInputTokensExhaustedReason,
		fmt.Sprintf("%d", budget.GetMaxInputTokens()),
		fmt.Sprintf("%d", actualTokens),
	)
}

func validateProviderToolCallsBeforePersistence(
	config *TurnConfig,
	toolCalls []toolCallEntry,
) error {
	if len(toolCalls) == 0 {
		return nil
	}
	if config == nil {
		return capabilityStateError(
			"provider returned ToolCalls without an admitted turn",
			nil,
		)
	}
	for _, toolCall := range toolCalls {
		if len(config.RestrictedTools) > 0 &&
			!containsStr(config.RestrictedTools, toolCall.ToolName) {
			return capabilityStateError(
				"provider returned a ToolCall outside the delegated tool set",
				nil,
			)
		}
	}
	if config.RuntimeCapabilities == nil ||
		config.RuntimeCapabilities.GetAgentic() == nil ||
		!config.RuntimeCapabilities.GetAgentic().GetNativeTools() {
		return errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"provider returned ToolCalls for a runtime without native Tool support",
			nil,
		)
	}
	for _, toolCall := range toolCalls {
		if config.AuthorizedCapabilities == nil {
			return capabilityStateError(
				"provider returned a ToolCall without an admitted capability set",
				nil,
			)
		}
		if _, ok := config.AuthorizedCapabilities.Tool(toolCall.ToolName); !ok {
			return capabilityStateError(
				"tool is not authorized by the admitted capability set",
				nil,
			)
		}
	}
	return nil
}

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
	providerToolCalls []ProviderToolCall,
	startingIterations int,
) (int, bool, error) {
	iterations := startingIterations
	budget := config.RuntimeBudget
	if budget == nil {
		budget = defaultRuntimeBudget(int32(config.ContextWindowSize))
	}
	budgetState, err := s.loadToolLoopBudgetState(ctx, turnID)
	if err != nil {
		return iterations, false, err
	}

	for {
		toolCalls := make([]toolCallEntry, 0, len(providerToolCalls))
		for _, call := range providerToolCalls {
			toolCalls = append(toolCalls, toolCallEntry{
				ProviderCallID: call.ID,
				ToolName:       call.Name,
				Arguments:      call.Arguments,
			})
		}
		if len(toolCalls) == 0 {
			break
		}
		if maxSteps := budget.GetMaxAgentSteps(); maxSteps > 0 &&
			uint32(iterations) >= maxSteps {
			return iterations, false, runtimeBudgetExhausted(
				maxAgentStepsExhaustedReason,
				maxSteps,
				uint32(iterations),
			)
		}
		if exhaustion := budgetState.admit(budget, toolCalls); exhaustion != nil {
			return iterations, false, exhaustion
		}
		if err := validateProviderToolCallsBeforePersistence(config, toolCalls); err != nil {
			return iterations, false, err
		}

		iterations++
		logger.Infof(ctx, "tool iteration %d: turn_id=%s tool_count=%d", iterations, turnID, len(toolCalls))

		toolBatchID := stableToolBatchID(turnID, config.AttemptID, iterations)
		for index := range toolCalls {
			toolCalls[index].ProviderCallID = stableToolCallID(
				toolBatchID,
				index,
				toolCalls[index],
			)
		}
		toolCallsJSON, err := marshalProviderToolCalls(toolCalls)
		if err != nil {
			return iterations, false, fmt.Errorf("encode assistant ToolCalls: %w", err)
		}
		if err := s.persistMessageRecord(
			ctx,
			config.ConversationID,
			turnID,
			string(domain.MessageRoleAssistant),
			*responsePtr,
			config.Model,
			toolCallsJSON,
			nil,
			nil,
			"",
			"",
			"",
		); err != nil {
			return iterations, false, fmt.Errorf("persist assistant tool-call message: %w", err)
		}
		messages = append(messages, domain.Message{
			MessageID:      generateID("msg"),
			ConversationID: config.ConversationID,
			TurnID:         turnID,
			Role:           domain.MessageRoleAssistant,
			Content:        *responsePtr,
			ToolCallsJSON:  toolCallsJSON,
			CreatedAt:      time.Now(),
			UpdatedAt:      time.Now(),
		})

		proposals := make([]AuthorizedToolProposal, 0, len(toolCalls))

		for index, tc := range toolCalls {
			callID := stableToolCallID(toolBatchID, index, tc)
			if err := s.emitTurnEvent(ctx, config, turnID, TurnEvent{
				Type:       "tool_call",
				ToolCallID: callID,
				ToolName:   tc.ToolName,
				Arguments:  tc.Arguments,
				Iteration:  iterations,
			}); err != nil {
				return iterations, false, err
			}

			authorized, ok := config.AuthorizedCapabilities.Tool(tc.ToolName)
			if !ok {
				return iterations, false, capabilityStateError(
					"tool is not authorized by the admitted capability set",
					nil,
				)
			}
			proposals = append(proposals, AuthorizedToolProposal{
				ToolCallID:      callID,
				ToolName:        tc.ToolName,
				CapabilityID:    authorized.Manifest.GetCapabilityId(),
				SchemaVersion:   authorized.Manifest.GetVersion(),
				BindingID:       authorized.Binding.GetBindingId(),
				BindingRevision: authorized.Binding.GetRevision(),
				ExecutionOwner:  authorized.Manifest.GetExecutionOwner(),
				Arguments:       []byte(tc.Arguments),
			})
		}

		if s.toolDispatch == nil {
			return iterations, false, fmt.Errorf("tool dispatch not configured")
		}
		decisions, err := s.toolDispatch.ProposeAuthorizedBatch(ctx, ToolBatchProposal{
			ActorID:                   config.ActorID,
			TurnID:                    turnID,
			AttemptID:                 config.AttemptID,
			ToolBatchID:               toolBatchID,
			ConversationID:            config.ConversationID,
			AgentID:                   config.AgentID,
			Provider:                  config.Provider,
			Model:                     config.Model,
			Effort:                    config.Effort,
			ThinkingMode:              string(config.ThinkingMode),
			SystemPrompt:              systemPrompt,
			Iteration:                 uint32(iterations),
			MaxRetries:                uint32(config.MaxRetries),
			ContextWindowSize:         uint32(config.ContextWindowSize),
			DelegationDepth:           uint32(config.Depth),
			RestrictedTools:           append([]string(nil), config.RestrictedTools...),
			TaskID:                    config.TaskID,
			StepID:                    config.StepID,
			ClientCapabilitySessionID: config.ClientCapabilitySessionID,
			ReadinessSnapshotID:       config.AuthorizedCapabilities.SnapshotID,
			Deadline:                  time.Now().UTC().Add(localToolTimeout),
			Calls:                     proposals,
		})
		if err != nil {
			return iterations, false, err
		}
		for _, decision := range decisions {
			if err := s.emitTurnEvent(ctx, config, turnID, toolDecisionTurnEvent(decision, iterations)); err != nil {
				return iterations, false, err
			}
		}
		return iterations, true, nil
	}

	return iterations, false, nil
}

const (
	maxAttemptsExhaustedReason           = "max_attempts_exhausted"
	maxToolCallsExhaustedReason          = "max_tool_calls_exhausted"
	maxIdenticalToolCallsExhaustedReason = "max_identical_tool_calls_exhausted"
	maxAgentStepsExhaustedReason         = "max_agent_steps_exhausted"
	maxDelegationDepthExhaustedReason    = "max_delegation_depth_exhausted"
	maxInputTokensExhaustedReason        = "max_input_tokens_exhausted"
	maxOutputTokensExhaustedReason       = "max_output_tokens_exhausted"
	wallTimeExhaustedReason              = "wall_time_exhausted"
)

type toolLoopBudgetState struct {
	total     uint32
	identical map[string]uint32
}

func (s *TurnService) loadToolLoopBudgetState(
	ctx context.Context,
	turnID string,
) (*toolLoopBudgetState, error) {
	state := &toolLoopBudgetState{identical: map[string]uint32{}}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var calls []persistence.ToolCall
	if err := db.WithContext(ctx).
		Select("tool_name", "arguments_hash").
		Where("turn_id = ?", turnID).
		Find(&calls).Error; err != nil {
		return nil, errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"load persisted tool calls for runtime budget",
			err,
		)
	}
	state.total = uint32(len(calls))
	for i := range calls {
		state.identical[toolCallBudgetKey(calls[i].ToolName, calls[i].ArgumentsHash)]++
	}
	return state, nil
}

func (s *toolLoopBudgetState) admit(
	budget *model.RuntimeBudget,
	calls []toolCallEntry,
) error {
	if s == nil || budget == nil || len(calls) == 0 {
		return nil
	}
	callCount := uint32(len(calls))
	if limit := budget.GetMaxToolCalls(); limit > 0 && s.total+callCount > limit {
		return runtimeBudgetExhausted(
			maxToolCallsExhaustedReason,
			limit,
			s.total,
		)
	}
	nextIdentical := make(map[string]uint32, len(s.identical)+len(calls))
	for key, count := range s.identical {
		nextIdentical[key] = count
	}
	for i := range calls {
		key := toolCallBudgetKey(calls[i].ToolName, hashBytes([]byte(calls[i].Arguments)))
		nextIdentical[key]++
		if limit := budget.GetMaxIdenticalToolCalls(); limit > 0 && nextIdentical[key] > limit {
			return runtimeBudgetExhausted(
				maxIdenticalToolCallsExhaustedReason,
				limit,
				nextIdentical[key]-1,
			)
		}
	}
	s.total += callCount
	s.identical = nextIdentical
	return nil
}

func (s *toolLoopBudgetState) exhaustionBeforeContinuation(
	budget *model.RuntimeBudget,
) error {
	if s == nil || budget == nil {
		return nil
	}
	if limit := budget.GetMaxToolCalls(); limit > 0 && s.total >= limit {
		return runtimeBudgetExhausted(maxToolCallsExhaustedReason, limit, s.total)
	}
	if limit := budget.GetMaxIdenticalToolCalls(); limit > 0 {
		for _, count := range s.identical {
			if count >= limit {
				return runtimeBudgetExhausted(
					maxIdenticalToolCallsExhaustedReason,
					limit,
					count,
				)
			}
		}
	}
	return nil
}

func toolCallBudgetKey(toolName string, argumentsHash string) string {
	return strings.TrimSpace(toolName) + "\x00" + strings.TrimSpace(argumentsHash)
}

func runtimeBudgetExhausted(reason string, limit uint32, consumed uint32) error {
	return runtimeBudgetExhaustedWithDetails(
		reason,
		fmt.Sprintf("%d", limit),
		fmt.Sprintf("%d", consumed),
	)
}

func runtimeBudgetExhaustedWithDetails(reason string, limit string, consumed string) error {
	return &errcode.BizError{
		Code:       errcode.AgentToolBudgetExhausted,
		HTTPStatus: http.StatusUnprocessableEntity,
		Message:    reason,
		Payload: &model.ErrorPayload{
			Error:     errcode.AgentToolBudgetExhaustedLocaleKey,
			ErrorType: string(errcode.AgentToolBudgetExhausted),
			LocaleKey: errcode.AgentToolBudgetExhaustedLocaleKey,
			Retryable: false,
			Terminal:  true,
			Details: map[string]string{
				"reason":   reason,
				"limit":    limit,
				"consumed": consumed,
			},
		},
	}
}

func wallTimeBudgetExhausted(limitMillis uint64) error {
	return runtimeBudgetExhaustedWithDetails(
		wallTimeExhaustedReason,
		fmt.Sprintf("%d", limitMillis),
		fmt.Sprintf("%d", limitMillis),
	)
}

func runtimeBudgetExhaustionReason(err error) (string, bool) {
	var budgetErr *errcode.BizError
	if !errors.As(err, &budgetErr) || budgetErr.Code != errcode.AgentToolBudgetExhausted {
		return "", false
	}
	return budgetErr.Message, true
}

func effectiveRuntimeBudget(
	policy *model.RuntimeBudget,
	requestedJSON json.RawMessage,
) (*model.RuntimeBudget, error) {
	effective := cloneRuntimeBudget(policy)
	if effective == nil {
		effective = defaultRuntimeBudget(128000)
	}
	if len(requestedJSON) == 0 || string(requestedJSON) == "null" || string(requestedJSON) == "{}" {
		return effective, nil
	}
	if err := validateExplicitRuntimeBudgetValues(requestedJSON); err != nil {
		return nil, err
	}
	var requested model.RuntimeBudget
	if err := protojson.Unmarshal(requestedJSON, &requested); err != nil {
		return nil, errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"requested runtime budget is invalid",
			err,
		)
	}
	if effective.MaxCost != nil || requested.MaxCost != nil {
		return nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"runtime cost budget is unsupported without an authoritative pricing source",
			nil,
		)
	}
	effective.MaxAttempts = lowerPositiveLimit(effective.MaxAttempts, requested.MaxAttempts)
	effective.MaxAgentSteps = lowerPositiveLimit(effective.MaxAgentSteps, requested.MaxAgentSteps)
	effective.MaxToolCalls = lowerPositiveLimit(effective.MaxToolCalls, requested.MaxToolCalls)
	effective.MaxIdenticalToolCalls = lowerPositiveLimit(
		effective.MaxIdenticalToolCalls,
		requested.MaxIdenticalToolCalls,
	)
	effective.MaxDelegationDepth = lowerPositiveLimit(
		effective.MaxDelegationDepth,
		requested.MaxDelegationDepth,
	)
	effective.WallTimeMs = lowerPositiveLimit64(effective.WallTimeMs, requested.WallTimeMs)
	effective.MaxInputTokens = lowerPositiveLimit64(effective.MaxInputTokens, requested.MaxInputTokens)
	effective.MaxOutputTokens = lowerPositiveLimit64(effective.MaxOutputTokens, requested.MaxOutputTokens)
	effective.MaxAttachmentBytes = lowerPositiveLimit64(
		effective.MaxAttachmentBytes,
		requested.MaxAttachmentBytes,
	)
	return effective, nil
}

func validateExplicitRuntimeBudgetValues(requestedJSON json.RawMessage) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(requestedJSON, &fields); err != nil || fields == nil {
		return errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"requested runtime budget must be a JSON object",
			err,
		)
	}
	for _, aliases := range [][]string{
		{"maxAttempts", "max_attempts"},
		{"maxAgentSteps", "max_agent_steps"},
		{"maxToolCalls", "max_tool_calls"},
		{"maxIdenticalToolCalls", "max_identical_tool_calls"},
		{"maxDelegationDepth", "max_delegation_depth"},
		{"wallTimeMs", "wall_time_ms"},
		{"maxInputTokens", "max_input_tokens"},
		{"maxOutputTokens", "max_output_tokens"},
		{"maxAttachmentBytes", "max_attachment_bytes"},
		{"maxCost", "max_cost"},
	} {
		for _, name := range aliases {
			raw, exists := fields[name]
			if !exists || string(raw) == "null" {
				continue
			}
			number, err := strconv.ParseFloat(
				strings.Trim(string(raw), `"`),
				64,
			)
			if err == nil && number <= 0 {
				return errcode.New(
					errcode.AgentInvalidRequest,
					http.StatusBadRequest,
					fmt.Sprintf("requested runtime budget %s must be greater than zero", name),
					nil,
				)
			}
		}
	}
	return nil
}

func marshalRequestedRuntimeBudget(
	requested *model.RuntimeBudget,
) (json.RawMessage, error) {
	if requested == nil {
		return nil, nil
	}
	encoded, err := protojson.Marshal(requested)
	if err != nil {
		return nil, errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"encode requested runtime budget",
			err,
		)
	}
	return encoded, nil
}

func cloneRuntimeBudget(source *model.RuntimeBudget) *model.RuntimeBudget {
	if source == nil {
		return nil
	}
	return proto.Clone(source).(*model.RuntimeBudget)
}

func lowerPositiveLimit(policy uint32, requested uint32) uint32 {
	if requested > 0 && (policy == 0 || requested < policy) {
		return requested
	}
	return policy
}

func lowerPositiveLimit64(policy uint64, requested uint64) uint64 {
	if requested > 0 && (policy == 0 || requested < policy) {
		return requested
	}
	return policy
}

func withRuntimeBudgetDeadline(
	ctx context.Context,
	budget *model.RuntimeBudget,
	startedAt time.Time,
) (context.Context, context.CancelFunc) {
	if budget == nil || budget.GetWallTimeMs() == 0 {
		return context.WithCancel(ctx)
	}
	wallTime := budget.GetWallTimeMs()
	maxDurationMillis := uint64((time.Duration(1<<63 - 1)) / time.Millisecond)
	if wallTime > maxDurationMillis {
		wallTime = maxDurationMillis
	}
	if startedAt.IsZero() {
		startedAt = time.Now()
	}
	return context.WithDeadlineCause(
		ctx,
		startedAt.Add(time.Duration(wallTime)*time.Millisecond),
		wallTimeBudgetExhausted(wallTime),
	)
}

func executionContextError(ctx context.Context) error {
	if ctx == nil || ctx.Err() == nil {
		return nil
	}
	if cause := context.Cause(ctx); cause != nil {
		return cause
	}
	return ctx.Err()
}

func isStationLifecycleCancellation(ctx context.Context, err error) bool {
	if ctx == nil || ctx.Err() == nil || !errors.Is(err, context.Canceled) {
		return false
	}
	cause := context.Cause(ctx)
	return errors.Is(cause, context.Canceled) &&
		!errors.Is(cause, errExplicitUserCancellation)
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
			ExpiresAt:        canonicalToolDeadline(decision.ExpiresAt).Format(time.RFC3339Nano),
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
		if err := s.executeReadyStationTools(ctx); err != nil {
			logger.Errorf(ctx, "Station tool execution failed: %v", err)
		} else if _, err := s.toolDispatch.SettleExpiredToolCalls(ctx); err != nil {
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

func (s *TurnService) executeReadyStationTools(ctx context.Context) error {
	if s.toolDispatch == nil || s.toolRegistry == nil {
		return nil
	}
	for {
		claim, err := s.toolDispatch.ClaimReadyStationTool(ctx)
		if err != nil {
			return err
		}
		if claim == nil {
			return nil
		}

		db, err := s.getDB(ctx)
		if err != nil {
			return err
		}
		var batch persistence.ToolBatch
		if err := db.WithContext(ctx).
			Where("id = ? AND actor_id = ?", claim.ToolBatchID, claim.ActorID).
			First(&batch).Error; err != nil {
			return fmt.Errorf("load Station tool batch %s: %w", claim.ToolBatchID, err)
		}
		config, attemptStartedAt, err := s.loadToolBatchRuntimeConfig(
			ctx,
			db,
			&batch,
		)
		if err != nil {
			if _, completeErr := s.toolDispatch.CompleteStationToolExecution(
				ctx,
				claim,
				"",
				err,
			); completeErr != nil {
				return errors.Join(err, completeErr)
			}
			return err
		}
		toolCtx, cancelRuntimeBudget := withRuntimeBudgetDeadline(
			ctx,
			config.RuntimeBudget,
			attemptStartedAt,
		)
		if err := executionContextError(toolCtx); err != nil {
			cancelRuntimeBudget()
			if _, completeErr := s.toolDispatch.CompleteStationToolExecution(
				context.WithoutCancel(ctx),
				claim,
				"",
				err,
			); completeErr != nil {
				return errors.Join(err, completeErr)
			}
			return err
		}
		if err := s.validatePinnedRuntimeAuthority(toolCtx, config); err != nil {
			cancelRuntimeBudget()
			if _, completeErr := s.toolDispatch.CompleteStationToolExecution(
				context.WithoutCancel(ctx),
				claim,
				"",
				err,
			); completeErr != nil {
				return errors.Join(err, completeErr)
			}
			return err
		}
		if err := validateAuthorizedRuntimeCapabilities(
			config.AvailableTools,
			config.RuntimeCapabilities,
		); err != nil {
			cancelRuntimeBudget()
			if _, completeErr := s.toolDispatch.CompleteStationToolExecution(
				context.WithoutCancel(ctx),
				claim,
				"",
				err,
			); completeErr != nil {
				return errors.Join(err, completeErr)
			}
			return err
		}
		call := toolCallEntry{
			ToolName:  claim.ToolName,
			Arguments: string(claim.BoundedArguments),
		}
		var output string
		executionErr := validateStationToolBudgetBeforeExecution(config, call)
		if executionErr == nil {
			switch call.ToolName {
			case "station_human_decision_resume":
				output, executionErr = s.executeStationHumanDecisionResumeTool(
					toolCtx,
					config,
					claim.TurnID,
					call,
				)
			case "delegate_task":
				output, executionErr = s.executeDelegation(
					toolCtx,
					claim.TurnID,
					call,
					config,
				)
			default:
				result := s.toolRegistry.Dispatch(
					toolCtx,
					&domain.ToolCallMeta{
						AgentID:        batch.AgentID,
						ConversationID: batch.ConversationID,
						TurnID:         claim.TurnID,
					},
					call.ToolName,
					call.Arguments,
				)
				output = result.Content
				if result.IsError {
					executionErr = errors.New(result.Content)
				}
			}
		}
		cancelRuntimeBudget()
		if _, err := s.toolDispatch.CompleteStationToolExecution(
			ctx,
			claim,
			output,
			executionErr,
		); err != nil {
			return err
		}
	}
}

func (s *TurnService) loadToolBatchRuntimeConfig(
	ctx context.Context,
	db *gorm.DB,
	batch *persistence.ToolBatch,
) (*TurnConfig, time.Time, error) {
	if db == nil || batch == nil {
		return nil, time.Time{}, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"Station tool execution requires a persisted tool batch",
			nil,
		)
	}
	var attempt persistence.TurnAttempt
	if err := db.WithContext(ctx).
		Where("id = ? AND turn_id = ?", batch.AttemptID, batch.TurnID).
		First(&attempt).Error; err != nil {
		return nil, time.Time{}, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"Station tool execution requires a persisted runtime attempt",
			err,
		)
	}
	pinned, err := persistence.UnmarshalRuntimeSnapshot(attempt.RuntimeSnapshot)
	if err != nil || pinned == nil {
		return nil, time.Time{}, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"Station tool execution runtime snapshot is invalid",
			err,
		)
	}
	if pinned.GetProviderId() != batch.Provider ||
		pinned.GetModelId() != batch.Model ||
		pinned.GetThinkingMode() != batch.ThinkingMode {
		return nil, time.Time{}, errcode.New(
			errcode.AgentVersionConflict,
			http.StatusConflict,
			"Station tool batch runtime tuple differs from its pinned attempt",
			nil,
		)
	}
	contextTokens := pinned.GetCapabilities().GetLimits().GetContextTokens()
	if contextTokens == 0 || contextTokens > math.MaxInt32 {
		return nil, time.Time{}, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"Station tool execution has an invalid pinned context limit",
			nil,
		)
	}
	config := &TurnConfig{
		TurnID:                    batch.TurnID,
		AttemptID:                 batch.AttemptID,
		ActorID:                   batch.ActorID,
		AgentID:                   batch.AgentID,
		ConversationID:            batch.ConversationID,
		TaskID:                    batch.TaskID,
		StepID:                    batch.StepID,
		Provider:                  pinned.GetProviderId(),
		Model:                     pinned.GetModelId(),
		ThinkingMode:              domain.ThinkingMode(pinned.GetThinkingMode()),
		Effort:                    batch.Effort,
		MaxRetries:                int(batch.MaxRetries),
		ContextWindowSize:         int(contextTokens),
		ClientCapabilitySessionID: batch.CapabilitySessionID,
		RuntimeBudget:             cloneRuntimeBudget(pinned.GetBudget()),
		Depth:                     int(batch.DelegationDepth),
	}
	if len(batch.RestrictedToolsJSON) > 0 {
		if err := json.Unmarshal(
			batch.RestrictedToolsJSON,
			&config.RestrictedTools,
		); err != nil {
			return nil, time.Time{}, errcode.New(
				errcode.AgentInvalidSourceState,
				http.StatusConflict,
				"Station tool batch restricted tool set is invalid",
				err,
			)
		}
	}
	if pinned.GetCapabilities() != nil {
		config.RuntimeCapabilities = proto.Clone(
			pinned.GetCapabilities(),
		).(*model.RuntimeCapabilitySnapshot)
	}
	config.AuthorizedCapabilities, err = LoadAuthorizedCapabilitySet(ctx, db, config)
	if err != nil {
		return nil, time.Time{}, err
	}
	config.AvailableTools = restrictAuthorizedToolNames(
		config.AuthorizedCapabilities.ToolNames(),
		config.RestrictedTools,
	)
	return config, attempt.StartedAt, nil
}

func validateStationToolBudgetBeforeExecution(
	config *TurnConfig,
	call toolCallEntry,
) error {
	if config == nil || config.RuntimeBudget == nil {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"Station tool execution requires a persisted runtime budget",
			nil,
		)
	}
	if call.ToolName != "delegate_task" {
		return nil
	}
	nextDepth := uint32(config.Depth + 1)
	maxDepth := config.RuntimeBudget.GetMaxDelegationDepth()
	if maxDepth > 0 && nextDepth > maxDepth {
		return runtimeBudgetExhausted(
			maxDelegationDepthExhaustedReason,
			maxDepth,
			nextDepth,
		)
	}
	return nil
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
		Joins("JOIN agent_turn_attempts AS attempt ON attempt.id = batch.attempt_id AND attempt.turn_id = batch.turn_id").
		Where(
			"batch.status = ? AND turn_record.status = ? AND attempt.status = ? AND attempt.ended_at IS NULL AND attempt.attempt_index = (SELECT MAX(latest_attempt.attempt_index) FROM agent_turn_attempts AS latest_attempt WHERE latest_attempt.turn_id = batch.turn_id)",
			persistence.ToolBatchStatusBlocked,
			string(domain.TurnStatusWaitingLocalTool),
			string(domain.TurnStatusWaitingLocalTool),
		).
		Scan(&rows).Error; err != nil {
		return fmt.Errorf("load blocked tool batches: %w", err)
	}
	for _, row := range rows {
		if err := s.interruptTurn(
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
		Joins("JOIN agent_turn_attempts AS attempt ON attempt.id = continuation.attempt_id AND attempt.id = batch.attempt_id AND attempt.turn_id = batch.turn_id").
		Where(
			"continuation.status = ? AND turn_record.status = ? AND attempt.status = ? AND attempt.ended_at IS NULL AND attempt.attempt_index = (SELECT MAX(latest_attempt.attempt_index) FROM agent_turn_attempts AS latest_attempt WHERE latest_attempt.turn_id = batch.turn_id)",
			persistence.ToolContinuationStatusReconciliationRequired,
			string(domain.TurnStatusWaitingLocalTool),
			string(domain.TurnStatusWaitingLocalTool),
		).
		Scan(&rows).Error; err != nil {
		return fmt.Errorf("load reconciliation-required turns: %w", err)
	}
	for _, row := range rows {
		if err := s.interruptTurn(
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
	}
	return nil
}

func (s *TurnService) interruptTurn(
	ctx context.Context,
	agentID string,
	turnID string,
	conversationID string,
	taskID string,
	stepID string,
	reasonCode string,
) error {
	_, err := s.interruptTurnWithEvent(ctx, agentID, turnID, conversationID, taskID, stepID, reasonCode)
	return err
}

func (s *TurnService) interruptTurnWithEvent(
	ctx context.Context,
	agentID string,
	turnID string,
	conversationID string,
	taskID string,
	stepID string,
	reasonCode string,
) (TurnEvent, error) {
	ownershipCtx := ctx
	ctx = context.WithoutCancel(ctx)
	db, err := s.getDB(ctx)
	if err != nil {
		return TurnEvent{}, turnTerminalPersistenceError("open interruption database", err)
	}
	now := time.Now()
	var committedEvent TurnEvent
	transactionErr := func() error {
		unlockOwnership, err := s.lockTurnExecutionOwnership(ownershipCtx, turnID)
		if err != nil {
			return err
		}
		defer unlockOwnership()

		return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var turn persistence.AgentTurn
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("id = ?", turnID).
				First(&turn).Error; err != nil {
				return err
			}
			if turn.Status == string(domain.TurnStatusInterrupted) {
				return nil
			}
			if turn.Status != string(domain.TurnStatusRunning) &&
				turn.Status != string(domain.TurnStatusWaitingLocalTool) {
				return nil
			}
			attemptID, err := currentTurnAttemptIDTx(tx, turnID)
			if err != nil {
				return err
			}
			outcomeErrorJSON, err := (protojson.MarshalOptions{
				UseProtoNames:   true,
				EmitUnpopulated: true,
			}).Marshal(errcode.NewLifecycleInterruptedPayload(turnID, reasonCode))
			if err != nil {
				return err
			}
			conversationID = turn.ConversationID
			if err := tx.Model(&turn).
				Updates(map[string]interface{}{
					"status":          string(domain.TurnStatusInterrupted),
					"final_response":  reasonCode,
					"terminal_reason": reasonCode,
					"ended_at":        now,
				}).Error; err != nil {
				return err
			}
			if err := tx.Model(&persistence.TurnAttempt{}).
				Where("turn_id = ? AND ended_at IS NULL", turnID).
				Updates(map[string]interface{}{
					"status":     string(domain.TurnStatusInterrupted),
					"error_code": reasonCode,
					"ended_at":   now,
				}).Error; err != nil {
				return err
			}
			if err := tx.Model(&persistence.AgentMessage{}).
				Where("turn_id = ? AND role = ? AND status = ?", turnID, string(domain.MessageRoleAssistant), "pending").
				Updates(map[string]interface{}{
					"status":     string(domain.TurnStatusInterrupted),
					"error_json": outcomeErrorJSON,
					"updated_at": now,
				}).Error; err != nil {
				return err
			}
			if strings.TrimSpace(stepID) != "" {
				if err := tx.Model(&persistence.ExecutionStep{}).
					Where("task_id = ? AND step_id = ? AND status = ?", taskID, stepID, int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING)).
					Updates(map[string]interface{}{
						"status":         int32(model.TaskNodeStatus_TASK_NODE_STATUS_FAILED),
						"result_summary": reasonCode,
						"ended_at":       now,
					}).Error; err != nil {
					return err
				}
				if err := tx.Model(&persistence.ExecutorLease{}).
					Where("step_id = ? AND status = ?", stepID, chatLeaseStatusActive).
					Updates(map[string]interface{}{
						"status":       chatLeaseStatusReleased,
						"heartbeat_at": now,
						"expires_at":   now,
					}).Error; err != nil {
					return err
				}
			}
			event := TurnEvent{
				Type:           "error",
				TurnID:         turnID,
				AttemptID:      attemptID,
				ConversationID: conversationID,
				AgentID:        agentID,
				Stage:          reasonCode,
				Error:          reasonCode,
				OutcomeError:   outcomeErrorJSON,
			}
			payload, err := json.Marshal(event)
			if err != nil {
				return err
			}
			event.Seq, err = (&ConversationService{}).persistTurnEventTx(
				tx,
				conversationID,
				turnID,
				attemptID,
				"error",
				payload,
				now,
			)
			if err != nil {
				return err
			}
			committedEvent = event
			if strings.TrimSpace(taskID) != "" && strings.TrimSpace(stepID) != "" {
				writer := s.eventWriter
				if writer == nil {
					writer = NewTaskEventWriter(nil)
				}
				_, err = writer.appendTx(
					ctx,
					tx,
					"",
					taskID,
					stepID,
					turnID,
					string(domain.EventTypeCollaborationNodeFailed),
					map[string]interface{}{
						"task_id": taskID,
						"step_id": stepID,
						"turn_id": turnID,
						"reason":  reasonCode,
					},
				)
				return err
			}
			return nil
		})
	}()
	if transactionErr != nil {
		if errors.Is(transactionErr, errTurnExecutionSuperseded) {
			return TurnEvent{}, transactionErr
		}
		return TurnEvent{}, turnTerminalPersistenceError("interrupt turn", transactionErr)
	}
	if s.convService != nil && committedEvent.Seq > 0 {
		s.convService.notifyTurnEvent(conversationID, turnID)
	}
	return committedEvent, nil
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

	config, attemptStartedAt, err := s.loadToolBatchRuntimeConfig(
		ctx,
		db,
		&batch,
	)
	if err != nil {
		return true, err
	}
	ctx, cancelRuntimeBudget := withRuntimeBudgetDeadline(
		ctx,
		config.RuntimeBudget,
		attemptStartedAt,
	)
	defer cancelRuntimeBudget()
	settleExpiredContinuation := func(operationErr error) (bool, error) {
		deadlineErr := executionContextError(ctx)
		reason, exhausted := runtimeBudgetExhaustionReason(deadlineErr)
		if !exhausted {
			return false, nil
		}
		settlementCtx := context.WithoutCancel(ctx)
		var settlementErrors []error
		if operationErr != nil {
			settlementErrors = append(settlementErrors, operationErr)
		}
		settlementErrors = append(settlementErrors, deadlineErr)
		if completeErr := s.toolDispatch.CompleteContinuation(
			settlementCtx,
			continuation.ID,
			continuation.LeaseID,
			continuation.FencingToken,
			nil,
		); completeErr != nil {
			settlementErrors = append(settlementErrors, completeErr)
		}
		if settleErr := s.failTurn(
			settlementCtx,
			batch.AgentID,
			batch.TurnID,
			batch.TaskID,
			batch.StepID,
			reason,
		); settleErr != nil {
			settlementErrors = append(settlementErrors, settleErr)
		}
		return true, errors.Join(settlementErrors...)
	}
	if settled, settleErr := settleExpiredContinuation(nil); settled {
		return true, settleErr
	}
	trace, err := s.loadTurnTraceForResume(ctx, batch.TurnID)
	if err != nil {
		if settled, settleErr := settleExpiredContinuation(err); settled {
			return true, settleErr
		}
		return true, err
	}
	messages, err := s.loadMessages(ctx, batch.ConversationID)
	if err != nil {
		if settled, settleErr := settleExpiredContinuation(err); settled {
			return true, settleErr
		}
		return true, err
	}
	if err := s.appendClientToolResultsToTrace(ctx, trace, batch.ID); err != nil {
		if settled, settleErr := settleExpiredContinuation(err); settled {
			return true, settleErr
		}
		return true, err
	}
	if err := s.toolDispatch.MarkContinuationEmitted(
		ctx,
		continuation.ID,
		continuation.LeaseID,
		continuation.FencingToken,
		false,
	); err != nil {
		if settled, settleErr := settleExpiredContinuation(err); settled {
			return true, settleErr
		}
		return true, err
	}
	budgetState, err := s.loadToolLoopBudgetState(ctx, batch.TurnID)
	if err != nil {
		if settled, settleErr := settleExpiredContinuation(err); settled {
			return true, settleErr
		}
		return true, err
	}
	if exhaustion := budgetState.exhaustionBeforeContinuation(config.RuntimeBudget); exhaustion != nil {
		reason, _ := runtimeBudgetExhaustionReason(exhaustion)
		_ = s.saveTurnTrace(ctx, trace)
		_ = s.toolDispatch.CompleteContinuation(
			ctx,
			continuation.ID,
			continuation.LeaseID,
			continuation.FencingToken,
			nil,
		)
		if settleErr := s.failTurn(ctx, batch.AgentID, batch.TurnID, batch.TaskID, batch.StepID, reason); settleErr != nil {
			return true, errors.Join(exhaustion, settleErr)
		}
		return true, exhaustion
	}
	if err := s.validatePinnedRuntimeAuthority(ctx, config); err != nil {
		return true, err
	}

	providerCall := s.resumeProviderCall
	if providerCall == nil {
		providerCall = s.providerCallWithRetry
	} else if err := s.reserveProviderAttempt(ctx, config); err != nil {
		return true, err
	}
	nextResponse, providerToolCalls, providerCalls, _, callErr := providerCall(
		ctx,
		config,
		batch.TurnID,
		trace,
		batch.SystemPrompt,
		messages,
	)
	trace.ProviderCalls = append(trace.ProviderCalls, providerCalls...)
	if callErr != nil {
		if isStationLifecycleCancellation(ctx, callErr) {
			return true, fmt.Errorf("Station lifecycle interrupted provider continuation: %w", callErr)
		}
		settlementCtx := context.WithoutCancel(ctx)
		if usageErr := s.persistAttemptUsage(settlementCtx, batch.TurnID, batch.AttemptID, trace); usageErr != nil {
			return true, fmt.Errorf("persist continuation usage: %w", usageErr)
		}
		_ = s.saveTurnTrace(settlementCtx, trace)
		if completeErr := s.toolDispatch.CompleteContinuation(
			settlementCtx,
			continuation.ID,
			continuation.LeaseID,
			continuation.FencingToken,
			nil,
		); completeErr != nil {
			return true, errors.Join(callErr, completeErr)
		}
		terminalReason := "provider continuation failed"
		if reason, exhausted := runtimeBudgetExhaustionReason(callErr); exhausted {
			terminalReason = reason
		}
		if settleErr := s.failTurn(
			settlementCtx,
			batch.AgentID,
			batch.TurnID,
			batch.TaskID,
			batch.StepID,
			terminalReason,
		); settleErr != nil {
			return true, errors.Join(callErr, settleErr)
		}
		return true, fmt.Errorf("continue provider after tool batch: %w", callErr)
	}
	if len(providerToolCalls) > 0 {
		if err := s.validatePinnedRuntimeAuthority(ctx, config); err != nil {
			return true, err
		}
	}

	toolIterations, paused, processErr := s.processToolCalls(
		ctx,
		config,
		batch.TurnID,
		trace,
		batch.SystemPrompt,
		messages,
		&nextResponse,
		providerToolCalls,
		int(batch.Iteration),
	)
	if processErr != nil && isStationLifecycleCancellation(ctx, processErr) {
		return true, fmt.Errorf("Station lifecycle interrupted tool continuation processing: %w", processErr)
	}
	if usageErr := s.persistAttemptUsage(ctx, batch.TurnID, batch.AttemptID, trace); usageErr != nil {
		if settled, settleErr := settleExpiredContinuation(usageErr); settled {
			return true, settleErr
		}
		return true, fmt.Errorf("persist continuation usage: %w", usageErr)
	}
	if processErr != nil {
		settlementCtx := context.WithoutCancel(ctx)
		terminalReason := "tool continuation processing failed"
		if reason, exhausted := runtimeBudgetExhaustionReason(processErr); exhausted {
			terminalReason = reason
		}
		_ = s.saveTurnTrace(settlementCtx, trace)
		if completeErr := s.toolDispatch.CompleteContinuation(
			settlementCtx,
			continuation.ID,
			continuation.LeaseID,
			continuation.FencingToken,
			[]byte(nextResponse),
		); completeErr != nil {
			return true, errors.Join(processErr, completeErr)
		}
		if settleErr := s.failTurn(
			settlementCtx,
			batch.AgentID,
			batch.TurnID,
			batch.TaskID,
			batch.StepID,
			terminalReason,
		); settleErr != nil {
			return true, errors.Join(processErr, settleErr)
		}
		return true, processErr
	}

	if paused {
		if err := s.markTurnWaitingForLocalTool(ctx, batch.TurnID, batch.AttemptID, toolIterations); err != nil {
			if settled, settleErr := settleExpiredContinuation(err); settled {
				return true, settleErr
			}
			return true, err
		}
		if err := s.saveTurnTrace(ctx, trace); err != nil {
			logger.Errorf(ctx, "failed to save resumed turn trace: turn_id=%s err=%v", batch.TurnID, err)
		}
		if err := s.emitTurnEvent(ctx, config, batch.TurnID, TurnEvent{
			Type:      "progress",
			Stage:     "waiting_local_tool",
			Iteration: toolIterations,
		}); err != nil {
			if settled, settleErr := settleExpiredContinuation(err); settled {
				return true, settleErr
			}
			return true, err
		}
	} else {
		nextResponse = strings.TrimSpace(nextResponse)
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
			if settled, settleErr := settleExpiredContinuation(err); settled {
				return true, settleErr
			}
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
				if settled, settleErr := settleExpiredContinuation(err); settled {
					return true, settleErr
				}
				return true, err
			}
		}
	}

	if err := s.toolDispatch.CompleteContinuation(
		context.WithoutCancel(ctx),
		continuation.ID,
		continuation.LeaseID,
		continuation.FencingToken,
		[]byte(nextResponse),
	); err != nil {
		return true, err
	}
	return true, nil
}

func (s *TurnService) loadPinnedRuntimeBudget(
	ctx context.Context,
	db *gorm.DB,
	attemptID string,
) (*model.RuntimeBudget, error) {
	snapshot, err := s.loadPinnedRuntimeSnapshot(ctx, db, attemptID)
	if err != nil {
		return nil, err
	}
	if snapshot.GetBudget() == nil {
		return nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"persisted runtime snapshot has no runtime budget",
			nil,
		)
	}
	return cloneRuntimeBudget(snapshot.GetBudget()), nil
}

func (s *TurnService) loadPinnedRuntimeSnapshot(
	ctx context.Context,
	db *gorm.DB,
	attemptID string,
) (*model.RuntimeSnapshot, error) {
	var attempt persistence.TurnAttempt
	if err := db.WithContext(ctx).
		Select("runtime_snapshot").
		Where("id = ?", strings.TrimSpace(attemptID)).
		First(&attempt).Error; err != nil {
		return nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"load persisted runtime snapshot for tool continuation",
			err,
		)
	}
	snapshot, err := persistence.UnmarshalRuntimeSnapshot(attempt.RuntimeSnapshot)
	if err != nil {
		return nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"decode persisted runtime snapshot for tool continuation",
			err,
		)
	}
	if snapshot == nil {
		return nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"persisted runtime snapshot is unavailable",
			nil,
		)
	}
	return snapshot, nil
}

func (s *TurnService) applyPinnedRuntimeExecutionPolicy(
	ctx context.Context,
	db *gorm.DB,
	config *TurnConfig,
) error {
	if db == nil || config == nil || strings.TrimSpace(config.AttemptID) == "" {
		return errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"pinned runtime execution policy requires database, turn config, and attempt",
			nil,
		)
	}

	var attempt persistence.TurnAttempt
	if err := db.WithContext(ctx).
		Select("runtime_snapshot").
		Where("id = ?", strings.TrimSpace(config.AttemptID)).
		First(&attempt).Error; err != nil {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"load persisted runtime snapshot for execution policy",
			err,
		)
	}
	snapshot, err := persistence.UnmarshalRuntimeSnapshot(attempt.RuntimeSnapshot)
	if err != nil {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"decode persisted runtime snapshot for execution policy",
			err,
		)
	}
	contextTokens := snapshot.GetCapabilities().GetLimits().GetContextTokens()
	if contextTokens == 0 || contextTokens > math.MaxInt32 {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"persisted runtime snapshot has an invalid context token limit",
			nil,
		)
	}

	config.ContextWindowSize = int(contextTokens)
	return nil
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
	if err := s.emitTurnEvent(ctx, config, turnID, event); err != nil {
		return err
	}

	if tc.ToolName == "skill_view" && toolErr == nil {
		var viewArgs struct {
			Name string `json:"name"`
		}
		if json.Unmarshal([]byte(tc.Arguments), &viewArgs) == nil && viewArgs.Name != "" {
			if s.skillService == nil {
				return errcode.New(
					errcode.AgentInvalidSourceState,
					http.StatusConflict,
					"skill_view completed without a Station Skill service",
					nil,
				)
			}
			manifest, err := s.skillService.GetSkill(ctx, config.AgentID, viewArgs.Name)
			if err != nil {
				return fmt.Errorf("load activated Skill body for ContextLedger: %w", err)
			}
			if err := s.upsertContextLedgerSegment(
				ctx,
				config.AttemptID,
				contextSegmentForSkillBody(manifest),
			); err != nil {
				return fmt.Errorf("persist activated Skill body in ContextLedger: %w", err)
			}
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
	toolCallID := strings.TrimSpace(tc.ProviderCallID)
	if toolCallID == "" {
		toolCallID = callID
	}
	metadataJSON, err := json.Marshal(map[string]string{
		"tool_call_id": toolCallID,
	})
	if err != nil {
		return fmt.Errorf("encode tool result metadata: %w", err)
	}
	if persist {
		if err := s.persistMessageRecord(
			ctx,
			config.ConversationID,
			turnID,
			string(domain.MessageRoleTool),
			toolMessage,
			config.Model,
			nil,
			metadataJSON,
			nil,
			"",
			"",
			"",
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
		MetadataJSON:   metadataJSON,
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
		childConversationID, err := s.createDelegatedConversation(
			execCtx,
			config,
		)
		if err != nil {
			return nil, err
		}
		childConfig, err := delegatedTurnConfig(
			config,
			t,
			toolset,
			childConversationID,
		)
		if err != nil {
			return nil, err
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

func delegatedTurnConfig(
	parent *TurnConfig,
	task *domain.DelegationTask,
	toolset []string,
	childConversationID string,
) (*TurnConfig, error) {
	if parent == nil ||
		task == nil ||
		parent.RuntimeBudget == nil ||
		strings.TrimSpace(childConversationID) == "" {
		return nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"delegation requires parent authority and a persisted child conversation",
			nil,
		)
	}
	inheritedBudget, err := marshalRequestedRuntimeBudget(parent.RuntimeBudget)
	if err != nil {
		return nil, fmt.Errorf("encode inherited delegation budget: %w", err)
	}
	return &TurnConfig{
		ActorID:             parent.ActorID,
		AgentID:             parent.AgentID,
		ConversationID:      childConversationID,
		Identity:            parent.Identity,
		AgentConfigPrompt:   parent.AgentConfigPrompt,
		AvailableTools:      append([]string(nil), toolset...),
		RestrictedTools:     append([]string(nil), toolset...),
		ContextWindowSize:   parent.ContextWindowSize,
		MaxRetries:          parent.MaxRetries,
		Provider:            parent.Provider,
		Model:               parent.Model,
		Effort:              parent.Effort,
		ThinkingMode:        parent.ThinkingMode,
		FallbackModel:       parent.FallbackModel,
		RotationStrategy:    parent.RotationStrategy,
		RequestedBudgetJSON: inheritedBudget,
		Depth:               task.Depth,
	}, nil
}

func restrictAuthorizedToolNames(
	authorized []string,
	restricted []string,
) []string {
	if len(restricted) == 0 {
		return append([]string(nil), authorized...)
	}
	allowed := make(map[string]struct{}, len(restricted))
	for _, name := range restricted {
		if normalized := strings.TrimSpace(name); normalized != "" {
			allowed[normalized] = struct{}{}
		}
	}
	result := make([]string, 0, len(authorized))
	for _, name := range authorized {
		if _, ok := allowed[name]; ok {
			result = append(result, name)
		}
	}
	return result
}

func (s *TurnService) createDelegatedConversation(
	ctx context.Context,
	parentConfig *TurnConfig,
) (string, error) {
	if parentConfig == nil ||
		strings.TrimSpace(parentConfig.ActorID) == "" ||
		strings.TrimSpace(parentConfig.AgentID) == "" ||
		strings.TrimSpace(parentConfig.ConversationID) == "" {
		return "", errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"delegation requires an actor-owned parent conversation",
			nil,
		)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return "", err
	}
	var parent persistence.Conversation
	if err := db.WithContext(ctx).
		Where(
			"id = ? AND actor_ptid = ? AND agent_id = ?",
			parentConfig.ConversationID,
			parentConfig.ActorID,
			parentConfig.AgentID,
		).
		First(&parent).Error; err != nil {
		return "", errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"delegation parent conversation is unavailable",
			err,
		)
	}
	childID := generateID("conv")
	parentID := parent.ID
	child := &persistence.Conversation{
		ID:          childID,
		AgentID:     parent.AgentID,
		ActorPTID:   parent.ActorPTID,
		Title:       parent.Title,
		Description: parent.Description,
		ProviderID:  parent.ProviderID,
		ModelName:   parent.ModelName,
		Status:      "active",
		ParentID:    &parentID,
		ConfigJSON:  append(json.RawMessage(nil), parent.ConfigJSON...),
		Meta:        append(json.RawMessage(nil), parent.Meta...),
		Version:     1,
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
	if err := db.WithContext(ctx).Create(child).Error; err != nil {
		return "", fmt.Errorf("persist delegated child conversation: %w", err)
	}
	return childID, nil
}

// ---------------------------------------------------------------------------
// toolCallEntry / parseToolCalls — extract tool calls from assistant response
// ---------------------------------------------------------------------------

type toolCallEntry struct {
	ProviderCallID string
	ToolName       string
	Arguments      string
}

func marshalProviderToolCalls(calls []toolCallEntry) (json.RawMessage, error) {
	encoded := make([]openAIToolCall, 0, len(calls))
	for _, call := range calls {
		if strings.TrimSpace(call.ProviderCallID) == "" ||
			strings.TrimSpace(call.ToolName) == "" {
			return nil, fmt.Errorf("provider ToolCall requires id and name")
		}
		arguments := strings.TrimSpace(call.Arguments)
		if arguments == "" {
			arguments = "{}"
		}
		if !json.Valid([]byte(arguments)) {
			return nil, fmt.Errorf("provider ToolCall %q has invalid arguments", call.ToolName)
		}
		encoded = append(encoded, openAIToolCall{
			ID:   call.ProviderCallID,
			Type: "function",
			Function: openAIFunctionCall{
				Name:      call.ToolName,
				Arguments: arguments,
			},
		})
	}
	return json.Marshal(encoded)
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
		attemptID := strings.TrimSpace(config.AttemptID)
		if attemptID == "" {
			return nil, errcode.New(
				errcode.AgentInvalidRequest,
				http.StatusConflict,
				"retry attempt admission is required",
				nil,
			)
		}
		var record persistence.AgentTurn
		if err := db.WithContext(ctx).
			Where(
				"id = ? AND conversation_id = ? AND status = ?",
				existingTurnID,
				config.ConversationID,
				string(domain.TurnStatusRunning),
			).
			First(&record).Error; err != nil {
			return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusConflict,
				"retry turn admission is unavailable", err)
		}
		var attempt persistence.TurnAttempt
		if err := db.WithContext(ctx).
			Where(
				"id = ? AND turn_id = ? AND status = ? AND ended_at IS NULL",
				attemptID,
				existingTurnID,
				string(domain.TurnStatusRunning),
			).
			First(&attempt).Error; err != nil {
			return nil, errcode.New(
				errcode.AgentInvalidRequest,
				http.StatusConflict,
				"retry attempt admission is unavailable",
				err,
			)
		}
		currentAttemptID, err := currentTurnAttemptIDTx(db.WithContext(ctx), existingTurnID)
		if err != nil {
			return nil, errcode.New(
				errcode.AgentInternal,
				http.StatusInternalServerError,
				"failed to verify retry attempt admission",
				err,
			)
		}
		if currentAttemptID != attemptID {
			return nil, errcode.New(
				errcode.AgentVersionConflict,
				http.StatusConflict,
				"retry attempt admission was superseded",
				nil,
			)
		}
		config.TurnID = record.ID
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

func (s *TurnService) persistMessageWithAttachments(
	ctx context.Context,
	conversationID string,
	turnID string,
	role string,
	content string,
	modelName string,
	attachments []*model.AgentAttachmentRef,
) error {
	attachmentsJSON, err := json.Marshal(attachments)
	if err != nil {
		return errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"encode message attachments",
			err,
		)
	}
	return s.persistMessageRecord(
		ctx,
		conversationID,
		turnID,
		role,
		content,
		modelName,
		nil,
		nil,
		attachmentsJSON,
		"",
		"",
		"",
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
	return s.persistMessageRecord(
		ctx,
		conversationID,
		turnID,
		role,
		content,
		modelName,
		nil,
		nil,
		nil,
		branchID,
		parentMessageID,
		replacesMessageID,
	)
}

func (s *TurnService) persistMessageRecord(
	ctx context.Context,
	conversationID string,
	turnID string,
	role string,
	content string,
	modelName string,
	toolCallsJSON json.RawMessage,
	metadataJSON json.RawMessage,
	attachmentsJSON json.RawMessage,
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
	if len(toolCallsJSON) > 0 {
		msg.ToolCallsJSON = append(json.RawMessage(nil), toolCallsJSON...)
	}
	if len(metadataJSON) > 0 {
		msg.MetadataJSON = append(json.RawMessage(nil), metadataJSON...)
	}
	if len(attachmentsJSON) > 0 {
		msg.AttachmentsJSON = append(json.RawMessage(nil), attachmentsJSON...)
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
		TurnID:               turnID,
		AttemptID:            attemptID,
		ToolDefinitionTokens: trace.ToolDefinitionTokens,
		ToolCallCount:        uint32(len(trace.ToolCalls)),
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
	attemptUpdate := db.WithContext(ctx).
		Model(&persistence.TurnAttempt{}).
		Where("id = ? AND turn_id = ?", attemptID, turnID)
	unlockOwnership := func() {}
	if _, executionOwned := ctx.Value(turnExecutionOwnershipContextKey{}).(turnExecutionOwnership); executionOwned {
		unlockOwnership, err = s.lockTurnExecutionOwnership(ctx, turnID)
		if err != nil {
			return err
		}
		attemptUpdate = attemptUpdate.Where(
			"ended_at IS NULL OR (status = ? AND ended_at IS NOT NULL)",
			string(domain.TurnStatusCancelled),
		)
	} else {
		attemptUpdate = attemptUpdate.Where("ended_at IS NULL")
	}
	defer unlockOwnership()

	result := attemptUpdate.Update("usage_json", encoded)
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
		Where("agent_turns.agent_id = ? AND agent_conversations.actor_ptid = ?", options.AgentID, options.Ptid)
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
		Where("agent_conversations.actor_ptid = ?", ptid)
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

func (s *TurnService) completeTurn(
	ctx context.Context,
	config *TurnConfig,
	turnID string,
	finalResponse string,
	toolIterations int,
) error {
	if err := executionContextError(ctx); err != nil {
		return err
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return turnTerminalPersistenceError("open completion database", err)
	}

	now := time.Now()
	var committedEvent TurnEvent
	transactionErr := func() error {
		unlockOwnership, err := s.lockTurnExecutionOwnership(ctx, turnID)
		if err != nil {
			return err
		}
		defer unlockOwnership()

		return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var turn persistence.AgentTurn
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("id = ?", turnID).
				First(&turn).Error; err != nil {
				return err
			}
			if turn.Status == string(domain.TurnStatusCompleted) {
				return nil
			}
			if turn.Status != string(domain.TurnStatusRunning) &&
				turn.Status != string(domain.TurnStatusWaitingLocalTool) {
				return errcode.New(
					errcode.AgentVersionConflict,
					http.StatusConflict,
					"turn is already terminal",
					nil,
				)
			}
			if err := s.completeAssistantMessageTx(tx, config, turnID, finalResponse, now); err != nil {
				return err
			}
			if err := tx.Model(&turn).
				Where("status IN ?", []string{
					string(domain.TurnStatusRunning),
					string(domain.TurnStatusWaitingLocalTool),
				}).
				Updates(map[string]interface{}{
					"status":          string(domain.TurnStatusCompleted),
					"final_response":  finalResponse,
					"tool_iterations": toolIterations,
					"terminal_reason": "completed",
					"ended_at":        now,
				}).Error; err != nil {
				return err
			}
			if err := tx.Model(&persistence.TurnAttempt{}).
				Where("turn_id = ? AND ended_at IS NULL", turnID).
				Updates(map[string]interface{}{
					"status":   string(domain.TurnStatusCompleted),
					"ended_at": now,
				}).Error; err != nil {
				return err
			}
			if strings.TrimSpace(config.StepID) != "" {
				if err := tx.Model(&persistence.ExecutionStep{}).
					Where(
						"task_id = ? AND step_id = ? AND status = ?",
						config.TaskID,
						config.StepID,
						int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
					).
					Updates(map[string]interface{}{
						"status":         int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
						"turn_id":        turnID,
						"result_summary": finalResponse,
						"ended_at":       now,
					}).Error; err != nil {
					return err
				}
				if err := tx.Model(&persistence.ExecutorLease{}).
					Where("step_id = ? AND status = ?", config.StepID, chatLeaseStatusActive).
					Updates(map[string]interface{}{
						"status":       chatLeaseStatusReleased,
						"heartbeat_at": now,
						"expires_at":   now,
					}).Error; err != nil {
					return err
				}
			}
			event := TurnEvent{
				Type:           "done",
				TurnID:         turnID,
				AttemptID:      config.AttemptID,
				ConversationID: turn.ConversationID,
				AgentID:        turn.AgentID,
				Stage:          "turn_completed",
				Iteration:      toolIterations,
			}
			payload, err := json.Marshal(event)
			if err != nil {
				return err
			}
			event.Seq, err = (&ConversationService{}).persistTurnEventTx(
				tx,
				turn.ConversationID,
				turnID,
				config.AttemptID,
				"done",
				payload,
				now,
			)
			if err != nil {
				return err
			}
			committedEvent = event
			if strings.TrimSpace(config.TaskID) != "" && strings.TrimSpace(config.StepID) != "" {
				writer := s.eventWriter
				if writer == nil {
					writer = NewTaskEventWriter(nil)
				}
				taskEvent, err := writer.appendTx(
					ctx,
					tx,
					"",
					config.TaskID,
					config.StepID,
					turnID,
					string(domain.EventTypeCollaborationNodeCompleted),
					map[string]interface{}{
						"task_id":        config.TaskID,
						"step_id":        config.StepID,
						"turn_id":        turnID,
						"result_summary": finalResponse,
					},
				)
				if err != nil {
					return err
				}
				checkpoint := persistence.TaskCheckpoint{
					CheckpointID: generateID("ckpt"),
					TaskID:       config.TaskID,
					EventSeq:     taskEvent.EventSeq,
					CreatedAt:    now,
				}
				checkpoint.StateJSON, err = buildChatTaskCheckpointStateJSONTx(
					tx,
					config.TaskID,
					taskEvent.EventSeq,
				)
				if err != nil {
					return err
				}
				if err := tx.Create(&checkpoint).Error; err != nil {
					return err
				}
				if err := tx.Model(&persistence.TaskRun{}).
					Where("task_id = ?", config.TaskID).
					Updates(map[string]interface{}{
						"root_turn_id":          turnID,
						"current_checkpoint_id": checkpoint.CheckpointID,
						"updated_at":            now,
					}).Error; err != nil {
					return err
				}
			}
			return nil
		})
	}()
	if transactionErr != nil {
		if errors.Is(transactionErr, errTurnExecutionSuperseded) {
			return transactionErr
		}
		logger.Errorf(ctx, "failed to complete turn: turn_id=%s err=%v", turnID, transactionErr)
		return turnTerminalPersistenceError("complete turn", transactionErr)
	}
	if s.convService != nil && committedEvent.Seq > 0 {
		s.convService.notifyTurnEvent(config.ConversationID, turnID)
	}
	if committedEvent.Seq > 0 {
		emitLiveTurnEvent(context.WithoutCancel(ctx), config, turnID, committedEvent)
	}
	return nil
}

func (s *TurnService) completeAssistantMessageTx(
	tx *gorm.DB,
	config *TurnConfig,
	turnID string,
	content string,
	now time.Time,
) error {
	if strings.TrimSpace(config.AssistantMessageID) != "" {
		result := tx.Model(&persistence.AgentMessage{}).
			Where(
				"id = ? AND conversation_id = ? AND turn_id = ? AND status = ?",
				config.AssistantMessageID,
				config.ConversationID,
				turnID,
				"pending",
			).
			Updates(map[string]interface{}{
				"content":    content,
				"model_name": config.Model,
				"status":     "completed",
				"updated_at": now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errcode.New(errcode.AgentVersionConflict, http.StatusConflict, "pending assistant message changed", nil)
		}
		return nil
	}

	var conversation persistence.Conversation
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ?", config.ConversationID).
		First(&conversation).Error; err != nil {
		return err
	}
	var maxSeq struct{ MaxSeq int64 }
	if err := tx.Model(&persistence.AgentMessage{}).
		Where("conversation_id = ?", config.ConversationID).
		Select("COALESCE(MAX(seq), 0) AS max_seq").
		Scan(&maxSeq).Error; err != nil {
		return err
	}
	messageID := generateID("msg")
	message := persistence.AgentMessage{
		ID:                messageID,
		ConversationID:    config.ConversationID,
		TurnID:            &turnID,
		ModelName:         optionalString(config.Model),
		Role:              string(domain.MessageRoleAssistant),
		Status:            "completed",
		Content:           &content,
		Seq:               maxSeq.MaxSeq + 1,
		BranchID:          optionalString(config.AssistantBranchID),
		ParentMessageID:   optionalString(config.AssistantParentID),
		ReplacesMessageID: optionalString(config.AssistantReplacesID),
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	if message.ParentMessageID == nil {
		message.ParentMessageID = optionalString(conversation.ActiveBranchMessageID)
	}
	if err := tx.Create(&message).Error; err != nil {
		return err
	}
	return tx.Model(&conversation).Updates(map[string]interface{}{
		"active_branch_message_id": messageID,
		"updated_at":               now,
		"version":                  gorm.Expr("version + 1"),
	}).Error
}

// ---------------------------------------------------------------------------
// Helper: failTurn
// ---------------------------------------------------------------------------

func (s *TurnService) failTurn(ctx context.Context, agentID, turnID, taskID, stepID, reason string) error {
	_, err := s.failTurnWithEvent(ctx, agentID, turnID, taskID, stepID, reason, nil)
	return err
}

func applyTypedTurnError(event *TurnEvent, cause error) {
	if event == nil || cause == nil {
		return
	}
	var biz *errcode.BizError
	if !errors.As(cause, &biz) || biz.Payload == nil {
		return
	}
	retryable := biz.Payload.GetRetryable()
	terminal := biz.Payload.GetTerminal()
	details := make(map[string]string, len(biz.Payload.GetDetails()))
	for key, value := range biz.Payload.GetDetails() {
		details[key] = value
	}
	event.Error = biz.Payload.GetError()
	event.ErrorType = biz.Payload.GetErrorType()
	event.LocaleKey = biz.Payload.GetLocaleKey()
	event.Retryable = &retryable
	event.Terminal = &terminal
	event.Details = details
}

func (s *TurnService) failTurnWithEvent(
	ctx context.Context,
	agentID string,
	turnID string,
	taskID string,
	stepID string,
	reason string,
	cause error,
) (TurnEvent, error) {
	ownershipCtx := ctx
	ctx = context.WithoutCancel(ctx)
	db, err := s.getDB(ctx)
	if err != nil {
		return TurnEvent{}, turnTerminalPersistenceError("open failure database", err)
	}

	now := time.Now()
	boundedReason := truncateRunes(reason, 100)
	conversationID := ""
	var committedEvent TurnEvent
	transactionErr := func() error {
		unlockOwnership, err := s.lockTurnExecutionOwnership(ownershipCtx, turnID)
		if err != nil {
			return err
		}
		defer unlockOwnership()

		return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var turn persistence.AgentTurn
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("id = ?", turnID).
				First(&turn).Error; err != nil {
				return err
			}
			if turn.Status == string(domain.TurnStatusFailed) {
				return nil
			}
			if turn.Status != string(domain.TurnStatusRunning) &&
				turn.Status != string(domain.TurnStatusWaitingLocalTool) {
				return nil
			}
			attemptID, err := currentTurnAttemptIDTx(tx, turnID)
			if err != nil {
				return err
			}
			conversationID = turn.ConversationID
			if err := tx.Model(&turn).
				Updates(map[string]interface{}{
					"status":          string(domain.TurnStatusFailed),
					"final_response":  reason,
					"terminal_reason": boundedReason,
					"ended_at":        now,
				}).Error; err != nil {
				return err
			}
			if err := tx.Model(&persistence.TurnAttempt{}).
				Where("turn_id = ? AND ended_at IS NULL", turnID).
				Updates(map[string]interface{}{
					"status":     string(domain.TurnStatusFailed),
					"error_code": boundedReason,
					"ended_at":   now,
				}).Error; err != nil {
				return err
			}
			if err := tx.Model(&persistence.AgentMessage{}).
				Where("turn_id = ? AND role = ? AND status = ?", turnID, string(domain.MessageRoleAssistant), "pending").
				Updates(map[string]interface{}{
					"status":     string(domain.TurnStatusFailed),
					"updated_at": now,
				}).Error; err != nil {
				return err
			}
			var boundStep persistence.ExecutionStep
			if strings.TrimSpace(stepID) == "" {
				_ = tx.Where(
					"turn_id = ? AND status = ?",
					turnID,
					int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
				).First(&boundStep).Error
				taskID = boundStep.TaskID
				stepID = boundStep.StepID
			}
			if strings.TrimSpace(stepID) != "" {
				if err := tx.Model(&persistence.ExecutionStep{}).
					Where("task_id = ? AND step_id = ? AND status = ?", taskID, stepID, int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING)).
					Updates(map[string]interface{}{
						"status":         int32(model.TaskNodeStatus_TASK_NODE_STATUS_FAILED),
						"result_summary": boundedReason,
						"ended_at":       now,
					}).Error; err != nil {
					return err
				}
				if err := tx.Model(&persistence.ExecutorLease{}).
					Where("step_id = ? AND status = ?", stepID, chatLeaseStatusActive).
					Updates(map[string]interface{}{
						"status":       chatLeaseStatusReleased,
						"heartbeat_at": now,
						"expires_at":   now,
					}).Error; err != nil {
					return err
				}
			}
			event := TurnEvent{
				Type:           "error",
				TurnID:         turnID,
				AttemptID:      attemptID,
				ConversationID: turn.ConversationID,
				AgentID:        turn.AgentID,
				Stage:          boundedReason,
				Error:          reason,
			}
			applyTypedTurnError(&event, cause)
			payload, err := json.Marshal(event)
			if err != nil {
				return err
			}
			event.Seq, err = (&ConversationService{}).persistTurnEventTx(
				tx,
				turn.ConversationID,
				turnID,
				attemptID,
				"error",
				payload,
				now,
			)
			if err != nil {
				return err
			}
			committedEvent = event
			if strings.TrimSpace(taskID) != "" && strings.TrimSpace(stepID) != "" {
				writer := s.eventWriter
				if writer == nil {
					writer = NewTaskEventWriter(nil)
				}
				if _, err := writer.appendTx(
					ctx,
					tx,
					"",
					taskID,
					stepID,
					turnID,
					string(domain.EventTypeCollaborationNodeFailed),
					map[string]interface{}{
						"task_id": taskID,
						"step_id": stepID,
						"turn_id": turnID,
						"reason":  boundedReason,
					},
				); err != nil {
					return err
				}
			}
			return nil
		})
	}()
	if transactionErr != nil {
		if errors.Is(transactionErr, errTurnExecutionSuperseded) {
			return TurnEvent{}, transactionErr
		}
		logger.Errorf(ctx, "failed to mark turn as failed: turn_id=%s err=%v", turnID, transactionErr)
		return TurnEvent{}, turnTerminalPersistenceError("fail turn", transactionErr)
	}
	if s.convService != nil && conversationID != "" && committedEvent.Seq > 0 {
		s.convService.notifyTurnEvent(conversationID, turnID)
	}
	if committedEvent.Seq == 0 {
		return committedEvent, nil
	}

	logger.Warnf(ctx, "turn failed: turn_id=%s reason=%s", turnID, reason)

	s.publishDomainEvent(ctx, agentID, turnID, taskID, stepID, string(domain.EventTypeAgentTurnFailed), map[string]interface{}{
		"turn_id": turnID,
		"reason":  reason,
	})

	if s.growthMetrics != nil {
		s.growthMetrics.RecordEvent(ctx, agentID, EventTurnFailed, CategoryTurn, turnID, reason, "failure")
	}

	return committedEvent, nil
}

func truncateRunes(value string, limit int) string {
	if limit <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func (s *TurnService) cancelTurn(ctx context.Context, agentID, turnID, taskID, stepID string) error {
	_, err := s.cancelTurnWithResult(ctx, agentID, turnID, taskID, stepID, "")
	return err
}

func (s *TurnService) cancelTurnWithEvent(
	ctx context.Context,
	agentID string,
	turnID string,
	taskID string,
	stepID string,
) (TurnEvent, error) {
	result, err := s.cancelTurnWithResult(ctx, agentID, turnID, taskID, stepID, "")
	return result.Event, err
}

func (s *TurnService) cancelTurnWithResult(
	ctx context.Context,
	agentID string,
	turnID string,
	taskID string,
	stepID string,
	expectedPtid string,
) (turnCancellationResult, error) {
	ownershipCtx := ctx
	ctx = context.WithoutCancel(ctx)
	db, err := s.getDB(ctx)
	if err != nil {
		return turnCancellationResult{}, turnTerminalPersistenceError("open cancellation database", err)
	}
	now := time.Now()
	conversationID := ""
	var committedEvent TurnEvent
	result := turnCancellationResult{}
	transactionErr := func() error {
		unlockOwnership, err := s.lockTurnExecutionOwnership(ownershipCtx, turnID)
		if err != nil {
			return err
		}
		defer unlockOwnership()

		return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var turn persistence.AgentTurn
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("id = ?", turnID).
				First(&turn).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return errcode.New(
						errcode.AgentNotFound,
						http.StatusNotFound,
						"turn not found",
						err,
					)
				}
				return err
			}
			if expectedPtid != "" {
				var ownerCount int64
				if err := tx.Model(&persistence.Conversation{}).
					Where("id = ? AND actor_ptid = ?", turn.ConversationID, expectedPtid).
					Count(&ownerCount).Error; err != nil {
					return err
				}
				if ownerCount != 1 {
					return errcode.New(errcode.AgentNotFound, http.StatusNotFound, "turn not found", nil)
				}
			}
			result.Status = turn.Status
			if turn.Status != string(domain.TurnStatusRunning) &&
				turn.Status != string(domain.TurnStatusWaitingLocalTool) {
				return nil
			}
			if agentID == "" {
				agentID = turn.AgentID
			}
			attemptID, err := currentTurnAttemptIDTx(tx, turnID)
			if err != nil {
				return err
			}
			outcomeError := errcode.NewLifecycleCancelledPayload("turn", turnID)
			outcomeErrorJSON, err := (protojson.MarshalOptions{
				UseProtoNames:   true,
				EmitUnpopulated: true,
			}).Marshal(outcomeError)
			if err != nil {
				return err
			}
			conversationID = turn.ConversationID
			if err := tx.Model(&turn).
				Where("status IN ?", []string{
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
			if err := tx.Model(&persistence.AgentMessage{}).
				Where("turn_id = ? AND role = ? AND status = ?", turnID, string(domain.MessageRoleAssistant), "pending").
				Updates(map[string]interface{}{
					"status":     string(domain.TurnStatusCancelled),
					"error_json": outcomeErrorJSON,
					"updated_at": now,
				}).Error; err != nil {
				return err
			}
			var boundStep persistence.ExecutionStep
			if strings.TrimSpace(stepID) == "" {
				_ = tx.Where(
					"turn_id = ? AND status = ?",
					turnID,
					int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
				).First(&boundStep).Error
				taskID = boundStep.TaskID
				stepID = boundStep.StepID
			}
			if strings.TrimSpace(stepID) != "" {
				if err := tx.Model(&persistence.ExecutionStep{}).
					Where("task_id = ? AND step_id = ? AND status = ?", taskID, stepID, int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING)).
					Updates(map[string]interface{}{
						"status":         int32(model.TaskNodeStatus_TASK_NODE_STATUS_FAILED),
						"result_summary": "cancelled_by_user",
						"ended_at":       now,
					}).Error; err != nil {
					return err
				}
				if err := tx.Model(&persistence.ExecutorLease{}).
					Where("step_id = ? AND status = ?", stepID, chatLeaseStatusActive).
					Updates(map[string]interface{}{
						"status":       chatLeaseStatusReleased,
						"heartbeat_at": now,
						"expires_at":   now,
					}).Error; err != nil {
					return err
				}
			}
			var batchIDs []string
			if err := tx.Model(&persistence.ToolBatch{}).
				Where("turn_id = ? AND status = ?", turnID, persistence.ToolBatchStatusOpen).
				Pluck("id", &batchIDs).Error; err != nil {
				return err
			}
			if len(batchIDs) > 0 {
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
				if err := tx.Model(&persistence.ToolBatch{}).
					Where("id IN ? AND status = ?", batchIDs, persistence.ToolBatchStatusOpen).
					Updates(map[string]interface{}{
						"status":     persistence.ToolBatchStatusBlocked,
						"settled_at": now,
						"updated_at": now,
					}).Error; err != nil {
					return err
				}
			}

			event := TurnEvent{
				Type:           "cancelled",
				TurnID:         turnID,
				AttemptID:      attemptID,
				ConversationID: turn.ConversationID,
				AgentID:        turn.AgentID,
				Stage:          "turn_cancelled",
				Error:          "cancelled_by_user",
				OutcomeError:   outcomeErrorJSON,
			}
			payload, err := json.Marshal(event)
			if err != nil {
				return err
			}
			event.Seq, err = (&ConversationService{}).persistTurnEventTx(
				tx,
				turn.ConversationID,
				turnID,
				attemptID,
				event.Type,
				payload,
				now,
			)
			if err != nil {
				return err
			}
			committedEvent = event
			result.Event = event
			result.Status = string(domain.TurnStatusCancelled)
			result.Cancelled = true
			if strings.TrimSpace(taskID) != "" && strings.TrimSpace(stepID) != "" {
				writer := s.eventWriter
				if writer == nil {
					writer = NewTaskEventWriter(nil)
				}
				if _, err := writer.appendTx(
					ctx,
					tx,
					"",
					taskID,
					stepID,
					turnID,
					string(domain.EventTypeCollaborationNodeFailed),
					map[string]interface{}{
						"task_id": taskID,
						"step_id": stepID,
						"turn_id": turnID,
						"reason":  "cancelled_by_user",
					},
				); err != nil {
					return err
				}
			}
			return nil
		})
	}()
	if transactionErr != nil {
		if errors.Is(transactionErr, errTurnExecutionSuperseded) {
			return turnCancellationResult{}, transactionErr
		}
		var bizErr *errcode.BizError
		if errors.As(transactionErr, &bizErr) {
			return turnCancellationResult{}, transactionErr
		}
		return turnCancellationResult{}, turnTerminalPersistenceError("cancel turn", transactionErr)
	}
	if !result.Cancelled {
		return result, nil
	}
	if s.convService != nil && conversationID != "" && committedEvent.Seq > 0 {
		s.convService.notifyTurnEvent(conversationID, turnID)
	}
	s.publishDomainEvent(ctx, agentID, turnID, taskID, stepID, string(domain.EventTypeAgentTurnCancelled), map[string]interface{}{
		"turn_id": turnID,
		"reason":  "cancelled by user",
	})
	return result, nil
}

func currentTurnAttemptIDTx(tx *gorm.DB, turnID string) (string, error) {
	var attempt persistence.TurnAttempt
	if err := tx.
		Select("id").
		Where("turn_id = ?", turnID).
		Order("attempt_index DESC").
		First(&attempt).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return "", nil
		}
		return "", err
	}
	return attempt.ID, nil
}

func turnTerminalPersistenceError(operation string, cause error) error {
	return errcode.New(
		errcode.AgentInternal,
		http.StatusInternalServerError,
		"failed to persist terminal turn state",
		fmt.Errorf("%w: %s: %w", errTurnEventPersistence, operation, cause),
	)
}

// ---------------------------------------------------------------------------
// Internal: getDB
// ---------------------------------------------------------------------------

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
	if config.Provider == "" {
		config.Provider = strings.TrimSpace(agent.ProviderID)
	}
	if config.Model == "" {
		config.Model = strings.TrimSpace(agent.ModelName)
	}
	if config.Effort == "" {
		config.Effort = strings.TrimSpace(agent.Effort)
	}
	if config.ThinkingMode == "" {
		config.ThinkingMode = domain.ThinkingMode(agent.ThinkingMode)
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
