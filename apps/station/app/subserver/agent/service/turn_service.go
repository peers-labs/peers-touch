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
	"fmt"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service/cli"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

// ---------------------------------------------------------------------------
// TurnConfig
// ---------------------------------------------------------------------------

// TurnConfig holds per-execution configuration for a single turn.
type TurnConfig struct {
	AgentID            string
	ActorID            string
	ConversationID     string
	Identity           string
	AgentConfigPrompt  string
	Platform           string
	AvailableTools     []string
	ContextWindowSize  int
	MaxRetries         int
	Provider           string
	Model              string
	Effort             string // reasoning effort: "low" | "medium" | "high"
	FallbackModel      string // Alternate model for billing/model_not_found fallback recovery.
	WorkspaceRoot      string
	KnowledgeResources []domain.KnowledgeResource
	RotationStrategy   domain.RotationStrategy
	Depth              int // Current delegation depth (0 = top-level).
	EventSink          TurnEventSink
	// TaskID/StepID bind this turn to a Station-owned task step. When TaskID is
	// set, turn lifecycle events are written to the durable outbox (replayable
	// source of truth) in addition to the realtime event bus.
	TaskID string
	StepID string

	// CLI execution fields — when CliCommand is non-empty, the turn is routed
	// to the CliExecutor instead of the standard LLM provider call path.
	CliCommand     string   // Full CLI command (e.g. "trae", "codex", "claude")
	RuntimeBackend string   // Backend identifier for the CLI runtime
	AllowedRoots   []string // Filesystem roots the CLI process may access

	MemoryDisabled bool // When true, L3 memory snapshot is skipped in prompt assembly.
}

type TurnEventSink func(ctx context.Context, event TurnEvent)

type TurnEvent struct {
	Type           string `json:"type"`
	TurnID         string `json:"turnId,omitempty"`
	ConversationID string `json:"conversationId,omitempty"`
	AgentID        string `json:"agentId,omitempty"`
	Stage          string `json:"stage,omitempty"`
	Text           string `json:"text,omitempty"`
	ToolCallID     string `json:"toolCallId,omitempty"`
	ToolName       string `json:"toolName,omitempty"`
	Arguments      string `json:"arguments,omitempty"`
	Source         string `json:"source,omitempty"`
	ServerName     string `json:"serverName,omitempty"`
	WorkspaceRoot  string `json:"workspaceRoot,omitempty"`
	Result         string `json:"result,omitempty"`
	Error          string `json:"error,omitempty"`
	Iteration      int    `json:"iteration,omitempty"`
}

// ---------------------------------------------------------------------------
// TurnService
// ---------------------------------------------------------------------------

// TurnService orchestrates the full lifecycle of a single agent turn:
// context reference preprocessing → prompt assembly → compression check →
// credential lease → provider call → error recovery → tool dispatch →
// nudge evaluation → persistence.
type TurnService struct {
	errorClassifier  *ErrorClassifierService
	memoryService    *MemoryService
	skillService     *SkillService
	promptAssembly   *PromptAssemblyService
	compression      *CompressionService
	providerService  *ProviderService
	credentialPool   *CredentialPoolService
	contextReference *ContextReferenceService
	delegation       *DelegationService
	toolRegistry     *ToolRegistryService
	reviewService    *ReviewService
	growthMetrics    *GrowthMetricsService
	convService      *ConversationService
	cliExecutor      *cli.CliExecutor
	nudgeState       *domain.NudgeState
	localToolBroker  *LocalToolBroker
	liveResumeBroker *LiveResumeBroker
	eventBus         domain.EventBus
	eventWriter      *TaskEventWriter
}

func NewTurnService(
	errorClassifier *ErrorClassifierService,
	memoryService *MemoryService,
	skillService *SkillService,
	promptAssembly *PromptAssemblyService,
	compression *CompressionService,
	providerService *ProviderService,
	credentialPool *CredentialPoolService,
	contextReference *ContextReferenceService,
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
		contextReference: contextReference,
		delegation:       delegation,
		toolRegistry:     toolRegistry,
		reviewService:    reviewService,
		growthMetrics:    growthMetrics,
		convService:      convService,
		nudgeState:       domain.NewNudgeState(),
		localToolBroker:  NewLocalToolBroker(),
		liveResumeBroker: NewLiveResumeBroker(),
	}
}

func (s *TurnService) SetLiveResumeBroker(broker *LiveResumeBroker) {
	s.liveResumeBroker = broker
}

func (s *TurnService) SetCliExecutor(executor *cli.CliExecutor) {
	s.cliExecutor = executor
}

func (s *TurnService) SetEventBus(eventBus domain.EventBus) {
	s.eventBus = eventBus
	s.eventWriter = NewTaskEventWriter(eventBus)
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

func (s *TurnService) SubmitLocalToolResult(result LocalToolResult) error {
	return s.localToolBroker.Submit(result)
}

func (s *TurnService) AwaitLiveResume(ctx context.Context, taskID, stepID, turnID, interruptID string) (LiveResumeDecision, error) {
	broker := s.liveResumeBroker
	if broker == nil {
		return LiveResumeDecision{}, fmt.Errorf("live resume broker is not configured")
	}
	return broker.Await(ctx, taskID, stepID, turnID, interruptID)
}

func (s *TurnService) emitTurnEvent(ctx context.Context, config *TurnConfig, turnID string, event TurnEvent) {
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
	config.EventSink(ctx, event)
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

	// Step 1 — Create turn record (status=running).
	turnRecord, err := s.createTurnRecord(ctx, config, userInput)
	if err != nil {
		return nil, err
	}
	turnID := turnRecord.ID

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

	// Persist user message.
	if err := s.persistMessage(ctx, config.ConversationID, turnID, string(domain.MessageRoleUser), userInput); err != nil {
		_ = s.failTurn(ctx, config.AgentID, turnID, config.TaskID, config.StepID, "failed to persist user message")
		return nil, err
	}

	// CLI routing: when CliCommand is set or provider is trae-cli, delegate
	// to the CLI executor which spawns a local CLI process.
	if config.CliCommand != "" || config.Provider == "trae-cli" {
		if config.CliCommand == "" {
			config.CliCommand = "traecli"
		}
		return s.executeCLITurn(ctx, config, turnID, userInput)
	}

	// Preprocess context references (@file, @folder, @url, …).
	processedInput := userInput
	if config.WorkspaceRoot != "" {
		refResult, refErr := s.contextReference.Process(ctx, userInput, config.WorkspaceRoot, config.ContextWindowSize)
		if refErr != nil {
			logger.Warnf(ctx, "context reference processing failed (non-fatal): turn_id=%s err=%v", turnID, refErr)
		} else if refResult != nil && refResult.Message != refResult.OriginalMessage {
			processedInput = refResult.Message
			logger.Infof(ctx, "context references expanded: turn_id=%s expanded=%d blocked=%d injected_tokens=%d",
				turnID, len(refResult.Expanded), len(refResult.Blocked), refResult.InjectedTokens)
		}
	}
	assemblyResult, err := s.promptAssembly.Assemble(
		ctx,
		config.AgentID,
		config.Identity,
		config.AgentConfigPrompt,
		config.Platform,
		config.AvailableTools,
		config.WorkspaceRoot,
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

	// Step 7 — Credential lease + provider call with error recovery loop.
	s.emitTurnEvent(ctx, config, turnID, TurnEvent{
		Type:  "progress",
		Stage: "provider_call_started",
	})
	assistantResponse, providerCalls, streamed, err := s.providerCallWithRetry(
		ctx, config, turnID, trace, assemblyResult.SystemPrompt, messages,
	)
	if err != nil {
		_ = s.failTurn(ctx, config.AgentID, turnID, config.TaskID, config.StepID, fmt.Sprintf("provider call failed after retries: %v", err))
		s.emitTurnEvent(ctx, config, turnID, TurnEvent{
			Type:  "error",
			Error: err.Error(),
		})
		return nil, err
	}
	trace.ProviderCalls = providerCalls
	if !streamed {
		s.emitTurnEvent(ctx, config, turnID, TurnEvent{
			Type:  "text",
			Text:  assistantResponse,
			Stage: "provider_call_completed",
		})
	}

	// Step 8 — Tool call iteration loop.
	toolIterations, err := s.processToolCalls(
		ctx, config, turnID, trace, assemblyResult.SystemPrompt, messages, &assistantResponse,
	)
	if err != nil {
		_ = s.failTurn(ctx, config.AgentID, turnID, config.TaskID, config.StepID, fmt.Sprintf("tool call processing failed: %v", err))
		s.emitTurnEvent(ctx, config, turnID, TurnEvent{
			Type:  "error",
			Error: err.Error(),
		})
		return nil, err
	}

	assistantResponse = stripToolCallMarkup(assistantResponse)

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
	if err := s.persistMessage(ctx, config.ConversationID, turnID, string(domain.MessageRoleAssistant), assistantResponse); err != nil {
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

	go s.memoryService.ExtractFromTurn(context.Background(), config.AgentID, config.ConversationID, turnID, userInput, assistantResponse)

	// Update skill usage stats for skills loaded during this turn.
	if len(trace.SkillsLoaded) > 0 && s.skillService != nil {
		s.skillService.RecordSkillUsage(ctx, config.AgentID, trace.SkillsLoaded, true)
	}

	return turn, nil
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
		config.Platform,
		config.AvailableTools,
		config.WorkspaceRoot,
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
		UserID:     "",
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
) (int, error) {

	iterations := 0

	for iterations < maxToolIterations {

		// Parse tool calls from the current assistant response.
		toolCalls := s.parseToolCalls(*responsePtr)
		if len(toolCalls) == 0 {
			break
		}

		iterations++
		logger.Infof(ctx, "tool iteration %d: turn_id=%s tool_count=%d", iterations, turnID, len(toolCalls))

		messages = append(messages, domain.Message{
			MessageID:      generateID("msg"),
			ConversationID: config.ConversationID,
			TurnID:         turnID,
			Role:           domain.MessageRoleAssistant,
			Content:        *responsePtr,
			CreatedAt:      time.Now(),
			UpdatedAt:      time.Now(),
		})

		for _, tc := range toolCalls {
			callStart := time.Now()
			callID := generateID("toolcall")
			s.emitTurnEvent(ctx, config, turnID, TurnEvent{
				Type:       "tool_call",
				ToolCallID: callID,
				ToolName:   tc.ToolName,
				Arguments:  tc.Arguments,
				Iteration:  iterations,
			})

			var toolResult string
			var toolErr error

			// Build per-call metadata for tool handlers.
			meta := &domain.ToolCallMeta{
				AgentID:        config.AgentID,
				ConversationID: config.ConversationID,
				TurnID:         turnID,
				Platform:       config.Platform,
				WorkspaceRoot:  config.WorkspaceRoot,
			}

			// Delegation: handle delegate_task via DelegationService with
			// recursive mini turn-loop executor.
			if tc.ToolName == "station_human_decision_resume" {
				toolResult, toolErr = s.executeStationHumanDecisionResumeTool(ctx, config, turnID, tc)
			} else if tc.ToolName == "local_mcp" {
				toolResult, toolErr = s.executeLocalMCPTool(ctx, config, turnID, callID, tc)
			} else if isDesktopLocalBuiltinTool(tc.ToolName) {
				toolResult, toolErr = s.executeDesktopLocalBuiltinTool(ctx, config, turnID, callID, tc)
			} else if tc.ToolName == "delegate_task" {
				toolResult, toolErr = s.executeDelegation(ctx, turnID, tc, config)
			} else {
				// Central dispatch via ToolRegistryService.
				result := s.toolRegistry.Dispatch(ctx, meta, tc.ToolName, tc.Arguments)
				toolResult = result.Content
				if result.IsError {
					toolErr = fmt.Errorf("%s", result.Content)
				}
			}

			callDuration := time.Since(callStart)

			resultContent := toolResult
			if toolErr != nil {
				resultContent = fmt.Sprintf("[tool_error] %s: %v", tc.ToolName, toolErr)
				logger.Warnf(ctx, "tool call failed: turn_id=%s tool=%s err=%v", turnID, tc.ToolName, toolErr)
			}
			toolEvent := TurnEvent{
				Type:       "tool_result",
				ToolCallID: callID,
				ToolName:   tc.ToolName,
				Result:     resultContent,
				Iteration:  iterations,
			}
			if toolErr != nil {
				toolEvent.Error = toolErr.Error()
			}
			s.emitTurnEvent(ctx, config, turnID, toolEvent)

			// Track skills loaded for growth attribution.
			if tc.ToolName == "skill_view" && toolErr == nil {
				var viewArgs struct {
					Name string `json:"name"`
				}
				if json.Unmarshal([]byte(tc.Arguments), &viewArgs) == nil && viewArgs.Name != "" {
					alreadyTracked := false
					for _, s := range trace.SkillsLoaded {
						if s == viewArgs.Name {
							alreadyTracked = true
							break
						}
					}
					if !alreadyTracked {
						trace.SkillsLoaded = append(trace.SkillsLoaded, viewArgs.Name)
					}
				}
			}

			// Record the tool call in trace.
			trace.ToolCalls = append(trace.ToolCalls, domain.ToolCallRecord{
				ToolName:  tc.ToolName,
				Arguments: tc.Arguments,
				Result:    resultContent,
				Duration:  callDuration,
			})

			// Persist tool result as a tool-role message.
			toolMsg := fmt.Sprintf("[%s] %s", tc.ToolName, resultContent)
			if persistErr := s.persistMessage(ctx, config.ConversationID, turnID, string(domain.MessageRoleTool), toolMsg); persistErr != nil {
				logger.Errorf(ctx, "failed to persist tool message: turn_id=%s tool=%s err=%v", turnID, tc.ToolName, persistErr)
			}

			// Append to in-memory message list for the next provider call.
			messages = append(messages, domain.Message{
				MessageID:      generateID("msg"),
				ConversationID: config.ConversationID,
				TurnID:         turnID,
				Role:           domain.MessageRoleTool,
				Content:        toolMsg,
				CreatedAt:      time.Now(),
				UpdatedAt:      time.Now(),
			})
		}

		// Re-invoke the provider with tool results appended.
		nextResponse, _, _, reCallErr := s.providerCallWithRetry(
			ctx, config, turnID, trace, systemPrompt, messages,
		)
		if reCallErr != nil {
			logger.Warnf(ctx, "provider re-call failed after tool iteration %d (non-fatal): turn_id=%s err=%v",
				iterations, turnID, reCallErr)
			*responsePtr = stripToolCallMarkup(*responsePtr)
			if strings.TrimSpace(*responsePtr) == "" {
				*responsePtr = "I've noted that information."
			}
			return iterations, nil
		}

		*responsePtr = nextResponse
	}

	if iterations >= maxToolIterations {
		logger.Warnf(ctx, "tool iteration hard limit reached: turn_id=%s iterations=%d", turnID, iterations)
		*responsePtr = stripToolCallMarkup(*responsePtr)
	}

	return iterations, nil
}

func isDesktopLocalBuiltinTool(toolName string) bool {
	switch toolName {
	case "local_file_read",
		"local_workspace_list",
		"local_clipboard_read",
		"local_clipboard_write",
		"local_shell_safe",
		"oauth_connector_call":
		return true
	default:
		return false
	}
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

func (s *TurnService) executeLocalMCPTool(
	ctx context.Context,
	config *TurnConfig,
	turnID string,
	callID string,
	tc toolCallEntry,
) (string, error) {
	var args struct {
		ServerName      string          `json:"server_name"`
		ServerNameCamel string          `json:"serverName"`
		ToolName        string          `json:"tool_name"`
		ToolNameCamel   string          `json:"toolName"`
		Arguments       json.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal([]byte(tc.Arguments), &args); err != nil {
		return "", fmt.Errorf("invalid local_mcp arguments: %w", err)
	}

	serverName := strings.TrimSpace(args.ServerName)
	if serverName == "" {
		serverName = strings.TrimSpace(args.ServerNameCamel)
	}
	toolName := strings.TrimSpace(args.ToolName)
	if toolName == "" {
		toolName = strings.TrimSpace(args.ToolNameCamel)
	}
	if serverName == "" || toolName == "" {
		return "", fmt.Errorf("local_mcp requires server_name and tool_name")
	}

	toolArgs := strings.TrimSpace(string(args.Arguments))
	if toolArgs == "" {
		toolArgs = "{}"
	}

	resultCh, cleanup, err := s.localToolBroker.Register(turnID, callID)
	if err != nil {
		return "", err
	}
	defer cleanup()

	s.emitTurnEvent(ctx, config, turnID, TurnEvent{
		Type:       "local_tool_request",
		Source:     "mcp",
		ServerName: serverName,
		ToolCallID: callID,
		ToolName:   toolName,
		Arguments:  toolArgs,
	})

	waitCtx, cancel := context.WithTimeout(ctx, localToolTimeout)
	defer cancel()
	select {
	case result := <-resultCh:
		if result.IsError {
			return result.Content, fmt.Errorf("%s", result.Content)
		}
		return result.Content, nil
	case <-waitCtx.Done():
		return "", fmt.Errorf("local_mcp result wait failed: %w", waitCtx.Err())
	}
}

func (s *TurnService) executeDesktopLocalBuiltinTool(
	ctx context.Context,
	config *TurnConfig,
	turnID string,
	callID string,
	tc toolCallEntry,
) (string, error) {
	toolArgs := strings.TrimSpace(tc.Arguments)
	if toolArgs == "" {
		toolArgs = "{}"
	}
	if !json.Valid([]byte(toolArgs)) {
		return "", fmt.Errorf("%s arguments must be valid JSON", tc.ToolName)
	}

	resultCh, cleanup, err := s.localToolBroker.Register(turnID, callID)
	if err != nil {
		return "", err
	}
	defer cleanup()

	s.emitTurnEvent(ctx, config, turnID, TurnEvent{
		Type:          "local_tool_request",
		Source:        "builtin",
		ToolCallID:    callID,
		ToolName:      tc.ToolName,
		Arguments:     toolArgs,
		WorkspaceRoot: config.WorkspaceRoot,
	})

	waitCtx, cancel := context.WithTimeout(ctx, localToolTimeout)
	defer cancel()
	select {
	case result := <-resultCh:
		if result.IsError {
			return result.Content, fmt.Errorf("%s", result.Content)
		}
		return result.Content, nil
	case <-waitCtx.Done():
		return "", fmt.Errorf("%s result wait failed: %w", tc.ToolName, waitCtx.Err())
	}
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
			Platform:          config.Platform,
			AvailableTools:    toolset,
			ContextWindowSize: config.ContextWindowSize,
			MaxRetries:        config.MaxRetries,
			Provider:          config.Provider,
			Model:             config.Model,
			Effort:            config.Effort,
			FallbackModel:     config.FallbackModel,
			WorkspaceRoot:     config.WorkspaceRoot,
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

func (s *TurnService) createTurnRecord(ctx context.Context, config *TurnConfig, userInput string) (*persistence.AgentTurn, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	record := &persistence.AgentTurn{
		ID:             generateID("turn"),
		ConversationID: config.ConversationID,
		AgentID:        config.AgentID,
		UserInput:      &userInput,
		ToolIterations: 0,
		Status:         string(domain.TurnStatusRunning),
		StartedAt:      now,
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

func (s *TurnService) persistMessage(ctx context.Context, conversationID, turnID, role, content string) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	var seq int64
	if s.convService != nil {
		seq, err = s.convService.NextSeq(ctx, conversationID)
		if err != nil {
			logger.Errorf(ctx, "NextSeq failed, computing fallback: conversation_id=%s err=%v", conversationID, err)
		}
	}
	if seq <= 0 {
		var maxSeq struct{ MaxSeq int64 }
		db.WithContext(ctx).Model(&persistence.AgentMessage{}).
			Where("conversation_id = ?", conversationID).
			Select("COALESCE(MAX(seq), 0) as max_seq").
			Scan(&maxSeq)
		seq = maxSeq.MaxSeq + 1
	}

	now := time.Now()
	msg := &persistence.AgentMessage{
		ID:             generateID("msg"),
		ConversationID: conversationID,
		TurnID:         &turnID,
		Role:           role,
		Content:        &content,
		Seq:            seq,
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	if err := db.WithContext(ctx).Create(msg).Error; err != nil {
		logger.Errorf(ctx, "failed to persist message: conversation_id=%s role=%s seq=%d err=%v",
			conversationID, role, seq, err)
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to persist message", err)
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
		Where("conversation_id = ?", conversationID).
		Order("created_at ASC").
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

		messages = append(messages, m)
	}

	return messages, nil
}

// ---------------------------------------------------------------------------
// Helper: saveTurnTrace
// ---------------------------------------------------------------------------

func (s *TurnService) ListTurnTraces(ctx context.Context, options domain.TurnTraceListOptions) ([]domain.TurnTraceEntry, int64, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, 0, err
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
		Where("agent_turns.agent_id = ?", options.AgentID)
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

func (s *TurnService) GetTurnTrace(ctx context.Context, traceID, turnID string) (*domain.TurnTraceEntry, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	traceID = strings.TrimSpace(traceID)
	turnID = strings.TrimSpace(turnID)
	if traceID == "" && turnID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			"trace_id or turn_id is required", nil)
	}

	query := db.WithContext(ctx).Preload("Turn")
	if traceID != "" {
		query = query.Where("id = ?", traceID)
	}
	if turnID != "" {
		query = query.Where("turn_id = ?", turnID)
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

	if err := db.WithContext(ctx).Create(record).Error; err != nil {
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
	if err := json.Unmarshal(record.ProviderCalls, &trace.ProviderCalls); err != nil && len(record.ProviderCalls) > 0 {
		return domain.TurnTraceEntry{}, err
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
	result := db.WithContext(ctx).
		Model(&persistence.AgentTurn{}).
		Where("id = ?", turnID).
		Updates(map[string]interface{}{
			"status":          string(domain.TurnStatusCompleted),
			"final_response":  finalResponse,
			"tool_iterations": toolIterations,
			"ended_at":        now,
		})

	if result.Error != nil {
		logger.Errorf(ctx, "failed to complete turn: turn_id=%s err=%v", turnID, result.Error)
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to update turn status", result.Error)
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
	result := db.WithContext(ctx).
		Model(&persistence.AgentTurn{}).
		Where("id = ?", turnID).
		Updates(map[string]interface{}{
			"status":         string(domain.TurnStatusFailed),
			"final_response": reason,
			"ended_at":       now,
		})

	if result.Error != nil {
		logger.Errorf(ctx, "failed to mark turn as failed: turn_id=%s err=%v", turnID, result.Error)
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to mark turn as failed", result.Error)
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

// ---------------------------------------------------------------------------
// executeCLITurn — route the turn through the CLI executor instead of LLM
// ---------------------------------------------------------------------------

// executeCLITurn handles turns where the client specifies a CLI command (e.g.
// "codex", "trae", "claude"). Instead of the standard LLM call path, the turn
// delegates execution to a local CLI process via CliExecutor.
func (s *TurnService) executeCLITurn(ctx context.Context, config *TurnConfig, turnID, userInput string) (*domain.Turn, error) {
	if s.cliExecutor == nil {
		_ = s.failTurn(ctx, config.AgentID, turnID, config.TaskID, config.StepID, "CLI executor not configured")
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"CLI executor is not configured on this Station", nil)
	}

	logger.Infof(ctx, "CLI turn started: turn_id=%s agent_id=%s cli_command=%s",
		turnID, config.AgentID, config.CliCommand)
	s.emitTurnEvent(ctx, config, turnID, TurnEvent{
		Type:  "progress",
		Stage: "cli_turn_started",
	})
	s.publishDomainEvent(ctx, config.AgentID, turnID, config.TaskID, config.StepID, string(domain.EventTypeAgentTurnStarted), map[string]interface{}{
		"turn_id":         turnID,
		"conversation_id": config.ConversationID,
		"cli_command":     config.CliCommand,
	})

	// Build the CliTurnRequest from TurnConfig.
	cliReq := &cli.CliTurnRequest{
		ConversationID:    config.ConversationID,
		AgentID:           config.AgentID,
		UserInput:         userInput,
		CliCommand:        config.CliCommand,
		Identity:          config.Identity,
		AgentConfigPrompt: config.AgentConfigPrompt,
		Provider:          config.Provider,
		Model:             config.Model,
		Effort:            config.Effort,
		RuntimeBackend:    config.RuntimeBackend,
		AllowedRoots:      config.AllowedRoots,
	}

	// Collect streamed output through the event sink adapter.
	var responseBuilder strings.Builder
	cliSink := func(eventType string, data map[string]any) {
		turnEvent := TurnEvent{
			Type:  eventType,
			Stage: "cli_execution",
		}
		if text, ok := data["content"].(string); ok {
			turnEvent.Text = text
			if eventType == "text" {
				responseBuilder.WriteString(text)
			}
		}
		s.emitTurnEvent(ctx, config, turnID, turnEvent)
	}

	// Derive actorID from context subject for workspace scoping.
	actorID := config.ActorID
	if actorID == "" {
		actorID = config.AgentID
	}

	cliErr := s.cliExecutor.Execute(ctx, cliReq, actorID, cliSink)
	if cliErr != nil {
		_ = s.failTurn(ctx, config.AgentID, turnID, config.TaskID, config.StepID,
			fmt.Sprintf("CLI execution failed: %v", cliErr))
		s.emitTurnEvent(ctx, config, turnID, TurnEvent{
			Type:  "error",
			Error: cliErr.Error(),
		})
		return nil, errcode.New(errcode.AgentProviderFailed, http.StatusBadGateway,
			fmt.Sprintf("CLI provider execution failed: %v", cliErr), cliErr)
	}

	finalResponse := responseBuilder.String()

	// Persist assistant response and complete the turn record.
	if err := s.persistMessage(ctx, config.ConversationID, turnID, string(domain.MessageRoleAssistant), finalResponse); err != nil {
		_ = s.failTurn(ctx, config.AgentID, turnID, config.TaskID, config.StepID, "failed to persist CLI assistant message")
		return nil, err
	}

	if err := s.completeTurn(ctx, turnID, finalResponse, 0); err != nil {
		return nil, err
	}

	now := time.Now()
	turn := &domain.Turn{
		TurnID:         turnID,
		ConversationID: config.ConversationID,
		AgentID:        config.AgentID,
		UserInput:      userInput,
		FinalResponse:  finalResponse,
		ToolIterations: 0,
		Status:         domain.TurnStatusCompleted,
		StartedAt:      now,
		EndedAt:        &now,
	}

	logger.Infof(ctx, "CLI turn completed: turn_id=%s", turnID)
	s.emitTurnEvent(ctx, config, turnID, TurnEvent{
		Type:  "progress",
		Stage: "turn_completed",
	})
	s.publishDomainEvent(ctx, config.AgentID, turnID, config.TaskID, config.StepID, string(domain.EventTypeAgentTurnCompleted), map[string]interface{}{
		"turn_id":         turnID,
		"conversation_id": config.ConversationID,
		"cli_command":     config.CliCommand,
	})

	if s.growthMetrics != nil {
		s.growthMetrics.RecordEvent(ctx, config.AgentID, EventTurnCompleted, CategoryTurn, turnID, "cli_turn", "success")
	}

	return turn, nil
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

// sha256Short returns the first 16 hex characters of the SHA-256 digest.
func sha256Short(data string) string {
	h := sha256.Sum256([]byte(data))
	return hex.EncodeToString(h[:8])
}
