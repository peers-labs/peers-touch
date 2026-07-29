// Changelog:
// 2026-04-11 — Growth Metrics Integration: injected GrowthMetricsService dependency,
//   emit RecordEvent on review triggered, completed, and failed.
// 2026-04-11 — Initial implementation of ReviewService: background review agent
//   that runs asynchronously after turn completion. Checks nudge counters
//   (memory / skill), spawns a background goroutine, executes an LLM review
//   call with restricted tools (memory + skill_manage only), and persists
//   ReviewResult to agent_reviews table.

package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const (
	// reviewMaxIterations is the upper bound on tool-call rounds the review
	// agent is allowed to execute. Keeps background cost bounded.
	reviewMaxIterations = 8

	// reviewTimeout is the hard deadline for the entire background review
	// goroutine, covering credential lease + LLM call + tool dispatch loops.
	reviewTimeout = 120 * time.Second
)

// ---------------------------------------------------------------------------
// Review prompts — extracted from hermes review agent spec
// ---------------------------------------------------------------------------

const memoryReviewPrompt = `Review the conversation above. Has the user revealed things about themselves ` +
	`— name, preferences, workflows, environment, facts about their life or work — that are worth ` +
	`remembering? Also consider: Has the assistant learned anything important that should be retained ` +
	`across sessions — approaches that worked, mistakes to avoid, project-specific context? ` +
	`Use the memory tool to save the important points.`

const skillReviewPrompt = `Review the conversation above. Was a non-trivial approach used that could be ` +
	`generalized into a reusable skill? Look for: multi-step procedures, specific tool configurations, ` +
	`workarounds, debugging techniques. If you find something worth saving as a skill, use ` +
	`skill_manage(action='create') to save it. If an existing skill was used but had issues, use ` +
	`skill_manage(action='patch') to fix it.`

const combinedReviewPrompt = memoryReviewPrompt + "\n\n" + skillReviewPrompt

// reviewIdentity is the system prompt identity injected for the review agent.
const reviewIdentity = "You are a review agent. Your only job is to analyze the conversation " +
	"and extract valuable information using the tools provided."

// reviewAllowedTools is the restricted set of tools the review agent may invoke.
var reviewAllowedTools = map[string]bool{
	"memory":       true,
	"skill_manage": true,
}

// ---------------------------------------------------------------------------
// ReviewService
// ---------------------------------------------------------------------------

// ReviewService handles background review after turn completion. It checks
// nudge counters, spawns a background goroutine, executes an LLM review call
// with restricted tools (memory + skill_manage only), and persists ReviewResult
// to the agent_reviews table.
type ReviewService struct {
	credentialPool  *CredentialPoolService
	errorClassifier *ErrorClassifierService
	providerService *ProviderService
	memoryService   *MemoryService
	skillService    *SkillService
	toolRegistry    *ToolRegistryService
	growthMetrics   *GrowthMetricsService
}

// NewReviewService creates a ReviewService with all required domain
// service dependencies injected.
func NewReviewService(
	credentialPool *CredentialPoolService,
	errorClassifier *ErrorClassifierService,
	providerService *ProviderService,
	memoryService *MemoryService,
	skillService *SkillService,
	toolRegistry *ToolRegistryService,
	growthMetrics *GrowthMetricsService,
) *ReviewService {
	return &ReviewService{
		credentialPool:  credentialPool,
		errorClassifier: errorClassifier,
		providerService: providerService,
		memoryService:   memoryService,
		skillService:    skillService,
		toolRegistry:    toolRegistry,
		growthMetrics:   growthMetrics,
	}
}

// ---------------------------------------------------------------------------
// CheckAndTriggerReview — public entry point (fire-and-forget)
// ---------------------------------------------------------------------------

// CheckAndTriggerReview inspects the nudge state and, if either counter has
// tripped its threshold, spawns a background goroutine to run the review
// agent. The method is fire-and-forget: all errors are logged internally and
// never surface to the caller.
//
// Parameters:
//   - ctx: caller context (used only for logging before the goroutine starts)
//   - nudgeState: current nudge counters
//   - turnID, conversationID, agentID: identifiers for tracing and persistence
//   - provider, model: LLM configuration for the review call
//   - messages: conversation history (deep-copied before entering goroutine)
//   - isDelegationChild: if true the review is skipped entirely because child
//     agents must not trigger independent reviews
func (s *ReviewService) CheckAndTriggerReview(
	ctx context.Context,
	nudgeState *domain.NudgeState,
	turnID, conversationID, agentID string,
	provider, model string,
	messages []domain.Message,
	isDelegationChild bool,
) {
	// Child agents never trigger review.
	if isDelegationChild {
		return
	}

	if nudgeState == nil {
		return
	}

	// Determine which reviews to trigger.
	triggerMemory := nudgeState.ShouldTriggerMemoryReview()
	triggerSkill := nudgeState.ShouldTriggerSkillReview()

	if !triggerMemory && !triggerSkill {
		return
	}

	// Resolve review type.
	reviewType := s.resolveReviewType(triggerMemory, triggerSkill)

	logger.Infof(ctx, "review triggered: turn_id=%s type=%s memory=%v skill=%v",
		turnID, reviewType, triggerMemory, triggerSkill)

	if s.growthMetrics != nil {
		s.growthMetrics.RecordEvent(ctx, agentID, EventReviewTriggered, CategoryReview, turnID, string(reviewType), "success")
	}

	// Deep copy messages before entering the goroutine to prevent data races
	// with the caller's slice.
	msgCopy := deepCopyMessages(messages)

	// Fire background goroutine — completely detached from the caller's ctx.
	go s.runReview(
		turnID, conversationID, agentID,
		provider, model,
		reviewType,
		msgCopy,
		nudgeState,
		triggerMemory, triggerSkill,
	)
}

// ---------------------------------------------------------------------------
// runReview — background goroutine body
// ---------------------------------------------------------------------------

// runReview executes the full review pipeline inside a detached goroutine:
//
//  1. Create a scoped context with timeout
//  2. Lease a credential
//  3. Build the review LLM request
//  4. Call the provider
//  5. Parse and dispatch tool calls (loop up to reviewMaxIterations)
//  6. Persist the ReviewResult record
//  7. Reset nudge counters
func (s *ReviewService) runReview(
	turnID, conversationID, agentID string,
	provider, model string,
	reviewType domain.ReviewType,
	messages []domain.Message,
	nudgeState *domain.NudgeState,
	resetMemory, resetSkill bool,
) {
	// Background context — not tied to any HTTP request.
	ctx, cancel := context.WithTimeout(context.Background(), reviewTimeout)
	defer cancel()

	triggeredAt := time.Now()
	reviewID := generateID("review")
	var actionsTaken []string
	var errorReason string
	var retryAttempted bool
	var usedCredentialID string

	logger.Infof(ctx, "review goroutine started: turn_id=%s type=%s", turnID, reviewType)

	// --- Step 1: Lease credential ----------------------------------------
	credential, leaseErr := s.credentialPool.Lease(ctx, agentID, provider, domain.RotationRoundRobin)
	if leaseErr != nil {
		errorReason = fmt.Sprintf("credential lease failed: %v", leaseErr)
		logger.Warnf(ctx, "review aborted (credential): turn_id=%s err=%v", turnID, leaseErr)
		s.persistReview(ctx, reviewID, turnID, conversationID, agentID, reviewType,
			actionsTaken, errorReason, retryAttempted, usedCredentialID, triggeredAt)
		return
	}
	usedCredentialID = credential.CredentialID

	// --- Step 2: Build review request ------------------------------------
	reviewPrompt := s.selectPrompt(reviewType)

	// The review request comprises:
	//   system = reviewIdentity
	//   messages = conversation history + a final user message containing the review prompt
	reviewMessages := append(messages, domain.Message{
		MessageID:      generateID("review_prompt"),
		ConversationID: conversationID,
		TurnID:         turnID,
		Role:           domain.MessageRoleUser,
		Content:        reviewPrompt,
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	})

	// --- Step 3: Provider call with single retry on retryable errors -----
	assistantResponse, callErr := s.callProvider(ctx, credential.CredentialID, model, provider, reviewMessages)
	if callErr != nil {
		classified := s.errorClassifier.Classify(callErr, provider, model, 0, 0)

		if classified.Retryable || classified.ShouldRotateCredential {
			retryAttempted = true
			logger.Warnf(ctx, "review LLM call failed (retrying): turn_id=%s reason=%s",
				turnID, classified.Reason.String())

			// Rotate credential if advised.
			if classified.ShouldRotateCredential {
				if classified.Reason == domain.FailoverReasonAuth || classified.Reason == domain.FailoverReasonBilling {
					_ = s.credentialPool.MarkExhausted(ctx, credential.CredentialID, classified.HTTPStatus)
				} else {
					_ = s.credentialPool.MarkError(ctx, credential.CredentialID)
				}

				retryCred, retryLeaseErr := s.credentialPool.Lease(ctx, agentID, provider, domain.RotationRoundRobin)
				if retryLeaseErr != nil {
					errorReason = fmt.Sprintf("retry credential lease failed: %v", retryLeaseErr)
					logger.Warnf(ctx, "review retry aborted (credential): turn_id=%s err=%v", turnID, retryLeaseErr)
					s.persistReview(ctx, reviewID, turnID, conversationID, agentID, reviewType,
						actionsTaken, errorReason, retryAttempted, usedCredentialID, triggeredAt)
					return
				}
				usedCredentialID = retryCred.CredentialID
				credential = retryCred
			}

			// Retry the LLM call once.
			assistantResponse, callErr = s.callProvider(ctx, credential.CredentialID, model, provider, reviewMessages)
		}

		if callErr != nil {
			errorReason = fmt.Sprintf("review LLM call failed: %v", callErr)
			logger.Warnf(ctx, "review LLM call exhausted: turn_id=%s err=%v", turnID, callErr)
			_ = s.credentialPool.Release(ctx, credential.CredentialID)
			s.persistReview(ctx, reviewID, turnID, conversationID, agentID, reviewType,
				actionsTaken, errorReason, retryAttempted, usedCredentialID, triggeredAt)
			return
		}
	}

	_ = s.credentialPool.Release(ctx, credential.CredentialID)

	// --- Step 4: Tool call iteration loop --------------------------------
	meta := &domain.ToolCallMeta{
		AgentID:        agentID,
		ConversationID: conversationID,
		TurnID:         turnID,
	}

	for iteration := 0; iteration < reviewMaxIterations; iteration++ {
		toolCalls := parseReviewToolCalls(assistantResponse)
		if len(toolCalls) == 0 {
			break
		}

		logger.Infof(ctx, "review tool iteration %d: turn_id=%s tool_count=%d",
			iteration+1, turnID, len(toolCalls))

		for _, tc := range toolCalls {
			// Only allow the restricted tool set.
			if !reviewAllowedTools[tc.ToolName] {
				logger.Warnf(ctx, "review agent attempted disallowed tool: turn_id=%s tool=%s",
					turnID, tc.ToolName)
				continue
			}

			result := s.toolRegistry.Dispatch(ctx, meta, tc.ToolName, tc.Arguments)

			action := fmt.Sprintf("%s(%s)", tc.ToolName, truncateArgs(tc.Arguments, 120))
			if result.IsError {
				action += " [error]"
				logger.Warnf(ctx, "review tool call failed: turn_id=%s tool=%s result=%s",
					turnID, tc.ToolName, result.Content)
			}
			actionsTaken = append(actionsTaken, action)

			// Append tool result to messages for the next LLM round.
			reviewMessages = append(reviewMessages, domain.Message{
				MessageID:      generateID("review_tool"),
				ConversationID: conversationID,
				TurnID:         turnID,
				Role:           domain.MessageRoleTool,
				Content:        fmt.Sprintf("[%s] %s", tc.ToolName, result.Content),
				CreatedAt:      time.Now(),
				UpdatedAt:      time.Now(),
			})
		}

		// Re-invoke the provider to let the review agent continue or stop.
		nextResponse, nextErr := s.callProvider(ctx, credential.CredentialID, model, provider, reviewMessages)
		if nextErr != nil {
			logger.Warnf(ctx, "review re-call failed at iteration %d: turn_id=%s err=%v",
				iteration+1, turnID, nextErr)
			errorReason = fmt.Sprintf("review re-call failed at iteration %d: %v", iteration+1, nextErr)
			break
		}

		assistantResponse = nextResponse
	}

	// Mark memories created during this review with source="review" and lower trust.
	if len(actionsTaken) > 0 {
		s.markReviewCreatedMemories(ctx, agentID, turnID, reviewID, triggeredAt)
	}

	// Track review effectiveness: a review that produced actions is potentially effective.
	effective := len(actionsTaken) > 0 && errorReason == ""
	nudgeState.RecordReviewOutcome(effective)

	if s.growthMetrics != nil {
		eventType := EventReviewCompleted
		outcome := "success"
		if errorReason != "" {
			eventType = EventReviewFailed
			outcome = "failure"
		}
		s.growthMetrics.RecordEvent(ctx, agentID, eventType, CategoryReview, turnID, fmt.Sprintf("actions=%d", len(actionsTaken)), outcome)
	}

	// --- Step 5: Persist review result -----------------------------------
	s.persistReview(ctx, reviewID, turnID, conversationID, agentID, reviewType,
		actionsTaken, errorReason, retryAttempted, usedCredentialID, triggeredAt)

	// --- Step 6: Reset nudge counters ------------------------------------
	if resetMemory {
		nudgeState.ResetMemoryCounter()
	}
	if resetSkill {
		nudgeState.ResetSkillCounter()
	}

	logger.Infof(ctx, "review goroutine completed: turn_id=%s type=%s actions=%d error=%q",
		turnID, reviewType, len(actionsTaken), errorReason)
}

// ---------------------------------------------------------------------------
// callProvider — thin wrapper around ProviderService.Call
// ---------------------------------------------------------------------------

func (s *ReviewService) callProvider(
	ctx context.Context,
	credentialID, model, providerType string,
	messages []domain.Message,
) (string, error) {

	resp, err := s.providerService.Call(ctx, &ProviderCallRequest{
		ProviderID:   credentialID,
		Model:        model,
		SystemPrompt: reviewIdentity,
		Messages:     messages,
		ProviderType: providerType,
	})

	if err != nil {
		return "", err
	}

	if resp == nil || resp.Content == "" {
		return "", errcode.New(errcode.AgentProviderFailed, http.StatusBadGateway,
			"empty review LLM response", nil)
	}

	return resp.Content, nil
}

// ---------------------------------------------------------------------------
// persistReview — write the ReviewResult to agent_reviews table
// ---------------------------------------------------------------------------

func (s *ReviewService) persistReview(
	ctx context.Context,
	reviewID string,
	turnID, conversationID, agentID string,
	reviewType domain.ReviewType,
	actionsTaken []string,
	errorReason string,
	retryAttempted bool,
	credentialID string,
	triggeredAt time.Time,
) {
	db, dbErr := s.getDB(ctx)
	if dbErr != nil {
		logger.Warnf(ctx, "review persist skipped (db unavailable): turn_id=%s err=%v", turnID, dbErr)
		return
	}

	actionsJSON, _ := json.Marshal(actionsTaken)

	now := time.Now()
	record := &persistence.Review{
		ID:             reviewID,
		TurnID:         turnID,
		ConversationID: conversationID,
		AgentID:        agentID,
		ReviewType:     string(reviewType),
		ActionsTaken:   actionsJSON,
		RetryAttempted: retryAttempted,
		TriggeredAt:    triggeredAt,
		CompletedAt:    &now,
	}

	if errorReason != "" {
		record.ErrorReason = &errorReason
	}

	if credentialID != "" {
		record.CredentialID = &credentialID
	}

	if err := db.WithContext(ctx).Create(record).Error; err != nil {
		logger.Warnf(ctx, "review persist failed: turn_id=%s err=%v", turnID, err)
	} else {
		logger.Infof(ctx, "review persisted: id=%s turn_id=%s type=%s actions=%d",
			record.ID, turnID, reviewType, len(actionsTaken))
	}
}

// markReviewCreatedMemories updates memories created after triggeredAt for
// the given agent/turn to set source="review", source_review_id, and lower
// initial trust score. This ensures review-created memories are traceable
// and start with a more conservative trust threshold.
func (s *ReviewService) markReviewCreatedMemories(
	ctx context.Context,
	agentID, turnID, reviewID string,
	triggeredAt time.Time,
) {
	db, dbErr := s.getDB(ctx)
	if dbErr != nil {
		return
	}

	db.WithContext(ctx).
		Model(&persistence.Memory{}).
		Where("agent_id = ? AND source_turn_id = ? AND created_at >= ?", agentID, turnID, triggeredAt).
		Updates(map[string]interface{}{
			"source":          "review",
			"source_review_id": reviewID,
			"trust_score":     0.4,
		})
}

// ---------------------------------------------------------------------------
// resolveReviewType — determine the review type from counter state
// ---------------------------------------------------------------------------

func (s *ReviewService) resolveReviewType(triggerMemory, triggerSkill bool) domain.ReviewType {
	if triggerMemory && triggerSkill {
		return domain.ReviewTypeCombined
	}
	if triggerMemory {
		return domain.ReviewTypeMemory
	}
	return domain.ReviewTypeSkill
}

// ---------------------------------------------------------------------------
// selectPrompt — pick the review prompt for the determined review type
// ---------------------------------------------------------------------------

func (s *ReviewService) selectPrompt(reviewType domain.ReviewType) string {
	switch reviewType {
	case domain.ReviewTypeMemory:
		return memoryReviewPrompt
	case domain.ReviewTypeSkill:
		return skillReviewPrompt
	default:
		return combinedReviewPrompt
	}
}

// ---------------------------------------------------------------------------
// parseReviewToolCalls — extract tool calls from the review agent response
// ---------------------------------------------------------------------------

// reviewToolCallEntry is a local mirror of TurnService's toolCallEntry for
// decoupled review parsing.
type reviewToolCallEntry struct {
	ToolName  string
	Arguments string
}

// parseReviewToolCalls parses <tool_call>...</tool_call> XML-delimited JSON
// from the review agent's response. The format matches the convention used
// by the main turn loop (see TurnService.parseToolCalls).
func parseReviewToolCalls(response string) []reviewToolCallEntry {
	var calls []reviewToolCallEntry

	const openTag = "<tool_call>"
	const closeTag = "</tool_call>"

	remaining := response

	for {
		openIdx := strings.Index(remaining, openTag)
		if openIdx < 0 {
			break
		}

		afterOpen := remaining[openIdx+len(openTag):]
		closeIdx := strings.Index(afterOpen, closeTag)
		if closeIdx < 0 {
			break
		}

		jsonStr := afterOpen[:closeIdx]

		var parsed struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}

		if err := json.Unmarshal([]byte(jsonStr), &parsed); err == nil && parsed.Name != "" {
			calls = append(calls, reviewToolCallEntry{
				ToolName:  parsed.Name,
				Arguments: string(parsed.Arguments),
			})
		}

		remaining = afterOpen[closeIdx+len(closeTag):]
	}

	return calls
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// deepCopyMessages creates an independent copy of the message slice so the
// background goroutine does not race with the caller.
func deepCopyMessages(src []domain.Message) []domain.Message {
	dst := make([]domain.Message, len(src))
	copy(dst, src)
	return dst
}

// truncateArgs shortens a JSON argument string for action logging.
func truncateArgs(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

// getDB returns the GORM handle for the agent database.
func (s *ReviewService) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to open agent db", err)
	}
	return db, nil
}
