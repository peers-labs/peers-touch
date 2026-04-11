// Change-log:
// 2026-04-11 — Initial implementation of MemoryService: bounded memory store with
//   security scanning (prompt injection, exfiltration, invisible unicode), CRUD
//   operations (Add/Replace/Remove/List), and snapshot building for system prompt.
// 2026-04-11 — MemoryWriteEvent moved to domain package for interface use.
//   Added optional MemoryProvider field with SetMemoryProvider and notifyProvider:
//   after every successful Add/Replace/Remove the external provider is notified
//   asynchronously (panic-safe, never fails the parent operation).
// 2026-04-11 — Added FlushMemories(): Knowledge Salvage step that sends a
//   restricted LLM call (max 4 iterations, memory tool only) to review the
//   conversation and save high-value context before context compression.
// 2026-04-11 — Added GetMemoryProvider(): exposes the currently attached
//   external MemoryProvider so TurnService can invoke lifecycle hooks.
// 2026-04-11 — Memory Rollback & Freeze: added TakeSnapshot, ListSnapshots,
//   RollbackToSnapshot, DeleteMemoryByID, FreezeMemory for "dumbed-down agent"
//   recovery. Added frozen-entry guards in Replace and Remove. Added automatic
//   snapshot-taking before each mutation (Add/Replace/Remove) and before flush.
// 2026-04-11 — Growth Metrics Integration: injected GrowthMetricsService dependency,
//   emit RecordEvent on Add (memory_created), Replace (memory_replaced), Remove (memory_removed).

package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

const agentDBName = "agent"

// ---------------------------------------------------------------------------
// Security scanning — compiled at package init, zero per-call allocation.
// ---------------------------------------------------------------------------

var promptInjectionPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)ignore\s+(all\s+)?previous\s+instructions`),
	regexp.MustCompile(`(?i)ignore\s+(all\s+)?prior\s+instructions`),
	regexp.MustCompile(`(?i)disregard\s+(all\s+)?previous`),
	regexp.MustCompile(`(?i)forget\s+(all\s+)?previous`),
	regexp.MustCompile(`(?i)system\s*prompt\s*override`),
	regexp.MustCompile(`(?i)you\s+are\s+now\s+`),
	regexp.MustCompile(`(?i)new\s+instructions?\s*:`),
	regexp.MustCompile(`(?i)override\s+(system|safety|instructions)`),
	regexp.MustCompile(`(?i)pretend\s+you\s+are`),
	regexp.MustCompile(`(?i)act\s+as\s+if\s+your\s+instructions`),
	regexp.MustCompile(`(?i)from\s+now\s+on\s+you\s+(will|must|should)`),
	regexp.MustCompile(`(?i)ignore\s+everything\s+above`),
	regexp.MustCompile(`(?i)do\s+not\s+follow\s+any\s+previous`),
}

var exfiltrationPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)curl\b.*\$[A-Z_]+`),
	regexp.MustCompile(`(?i)wget\b.*\$[A-Z_]+`),
	regexp.MustCompile(`(?i)cat\s+[~.]?/?\.env`),
	regexp.MustCompile(`(?i)cat\s+[~.]?/?\.ssh/`),
	regexp.MustCompile(`(?i)cat\s+[~.]?/?\.aws/`),
	regexp.MustCompile(`https?://[^\s]*\$\{?[A-Z_]+\}?`),
	regexp.MustCompile(`(?i)echo\s+\$[A-Z_]+.*\|\s*(curl|nc|wget)`),
	regexp.MustCompile(`(?i)base64.*\$[A-Z_]+`),
	regexp.MustCompile(`(?i)printenv|export\s+-p`),
}

var invisibleUnicodeChars = []rune{
	'\u200B', '\u200C', '\u200D', '\u200E', '\u200F',
	'\u202A', '\u202B', '\u202C', '\u202D', '\u202E',
	'\u2060', '\u2061', '\u2062', '\u2063', '\u2064',
	'\uFEFF', '\u00AD',
}

// scanContent checks content against all security patterns and returns an error
// describing the rejection reason when a match is found.
func scanContent(content string) error {
	for _, p := range promptInjectionPatterns {
		if p.MatchString(content) {
			return errcode.New(
				errcode.AgentInvalidRequest, http.StatusBadRequest,
				fmt.Sprintf("content rejected: prompt injection pattern detected [%s]", p.String()),
				nil,
			)
		}
	}

	for _, p := range exfiltrationPatterns {
		if p.MatchString(content) {
			return errcode.New(
				errcode.AgentInvalidRequest, http.StatusBadRequest,
				fmt.Sprintf("content rejected: exfiltration pattern detected [%s]", p.String()),
				nil,
			)
		}
	}

	for _, r := range invisibleUnicodeChars {
		if strings.ContainsRune(content, r) {
			return errcode.New(
				errcode.AgentInvalidRequest, http.StatusBadRequest,
				fmt.Sprintf("content rejected: invisible unicode character U+%04X detected", r),
				nil,
			)
		}
	}

	return nil
}

// ---------------------------------------------------------------------------
// MemoryService
// ---------------------------------------------------------------------------

type MemoryService struct {
	// Optional external memory provider for lifecycle hook notifications.
	// At most one provider may be active at a time; nil means no provider.
	memoryProvider domain.MemoryProvider
	growthMetrics  *GrowthMetricsService
}

func NewMemoryService(growthMetrics *GrowthMetricsService) *MemoryService {
	return &MemoryService{growthMetrics: growthMetrics}
}

// SetMemoryProvider attaches an external memory provider. Pass nil to detach.
func (s *MemoryService) SetMemoryProvider(provider domain.MemoryProvider) {
	s.memoryProvider = provider
}

// GetMemoryProvider returns the currently attached external memory provider, or nil.
func (s *MemoryService) GetMemoryProvider() domain.MemoryProvider {
	return s.memoryProvider
}

// notifyProvider delivers a MemoryWriteEvent to the attached provider.
// Panics are caught and logged — the parent mutation is never failed.
func (s *MemoryService) notifyProvider(ctx context.Context, event domain.MemoryWriteEvent) {
	if s.memoryProvider == nil {
		return
	}

	defer func() {
		if r := recover(); r != nil {
			logger.Warnf(ctx, "memory provider OnMemoryWrite panicked: %v", r)
		}
	}()

	if err := s.memoryProvider.OnMemoryWrite(event); err != nil {
		logger.Warnf(ctx, "memory provider OnMemoryWrite failed: action=%s target=%s err=%v",
			event.Action, event.Target, err)
	}
}

// recordGrowthEvent emits a growth-metrics event scoped to the memory category.
// When growthMetrics is nil the call is a no-op.
func (s *MemoryService) recordGrowthEvent(ctx context.Context, agentID, eventType, target, details string) {
	if s.growthMetrics == nil {
		return
	}
	s.growthMetrics.RecordEvent(ctx, agentID, eventType, CategoryMemory, target, details, "success")
}

// getDB returns the GORM handle for the agent database.
// Fix: 2026-04-11 — return type corrected from *store.RDS to *gorm.DB to match store.GetRDS signature.
func (s *MemoryService) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName(agentDBName))
	if err != nil {
		return nil, errcode.New(
			errcode.AgentInternal, http.StatusInternalServerError,
			"failed to open agent db", err,
		)
	}
	return db, nil
}

// charLimitForTarget returns the maximum character budget for the given target.
func charLimitForTarget(target string) int {
	switch target {
	case domain.MemoryTargetMemory:
		return domain.MemoryCharLimitMemory
	case domain.MemoryTargetUser:
		return domain.MemoryCharLimitUser
	default:
		return 0
	}
}

// validateTarget ensures the target is one of the allowed values.
func validateTarget(target string) error {
	if target != domain.MemoryTargetMemory && target != domain.MemoryTargetUser {
		return errcode.New(
			errcode.AgentInvalidRequest, http.StatusBadRequest,
			fmt.Sprintf("invalid memory target %q, must be %q or %q",
				target, domain.MemoryTargetMemory, domain.MemoryTargetUser),
			nil,
		)
	}
	return nil
}

// currentUsage calculates the total character count of existing entries joined
// by the domain separator.
func currentUsage(entries []persistence.Memory) int {
	if len(entries) == 0 {
		return 0
	}
	total := 0
	for i, e := range entries {
		total += utf8.RuneCountInString(e.Content)
		if i > 0 {
			total += utf8.RuneCountInString(domain.MemorySeparator)
		}
	}
	return total
}

// ---------------------------------------------------------------------------
// Add — create a new memory entry after validation and security scan.
// ---------------------------------------------------------------------------

func (s *MemoryService) Add(ctx context.Context, agentID, target, content, turnID string) error {
	if err := validateTarget(target); err != nil {
		return err
	}

	if err := scanContent(content); err != nil {
		logger.Warnf(ctx, "memory add rejected for agent %s: %v", agentID, err)
		return err
	}

	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	// Take a snapshot of current state before mutation (fire-and-forget).
	s.takeSnapshotQuiet(ctx, agentID, "mutation", nil)

	var existing []persistence.Memory
	if err := db.Where("agent_id = ? AND target = ?", agentID, target).
		Order("created_at asc").Find(&existing).Error; err != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to query existing memories", err)
	}

	used := currentUsage(existing)
	newChars := utf8.RuneCountInString(content)
	limit := charLimitForTarget(target)

	sepCost := 0
	if len(existing) > 0 {
		sepCost = utf8.RuneCountInString(domain.MemorySeparator)
	}

	if used+sepCost+newChars > limit {
		return errcode.New(
			errcode.AgentInvalidRequest, http.StatusBadRequest,
			fmt.Sprintf("char limit exceeded for target %q: used %d + new %d (+sep %d) > limit %d",
				target, used, newChars, sepCost, limit),
			nil,
		)
	}

	now := time.Now()
	record := persistence.Memory{
		ID:         generateID("mem"),
		AgentID:    agentID,
		Target:     target,
		Content:    content,
		Source:     domain.MemorySourceTurn,
		TrustScore: domain.MemoryDefaultTrustScore,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if turnID != "" {
		record.SourceTurnID = &turnID
	}

	if err := db.Create(&record).Error; err != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to create memory entry", err)
	}

	logger.Infof(ctx, "memory added for agent %s target %s, id=%s, chars=%d",
		agentID, target, record.ID, newChars)

	s.notifyProvider(ctx, domain.MemoryWriteEvent{
		Action:  domain.MemoryActionAdd,
		Target:  target,
		Content: content,
	})

	s.recordGrowthEvent(ctx, agentID, EventMemoryCreated, target, record.ID)

	return nil
}

// ---------------------------------------------------------------------------
// Replace — fuzzy-match an existing entry by oldText and update its content.
// ---------------------------------------------------------------------------

func (s *MemoryService) Replace(ctx context.Context, agentID, target, oldText, newContent string) error {
	if err := validateTarget(target); err != nil {
		return err
	}

	if err := scanContent(newContent); err != nil {
		logger.Warnf(ctx, "memory replace rejected for agent %s: %v", agentID, err)
		return err
	}

	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	var entries []persistence.Memory
	if err := db.Where("agent_id = ? AND target = ?", agentID, target).
		Order("created_at asc").Find(&entries).Error; err != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to query memories for replace", err)
	}

	var matched *persistence.Memory
	for i := range entries {
		if strings.Contains(entries[i].Content, oldText) {
			matched = &entries[i]
			break
		}
	}
	if matched == nil {
		return errcode.New(errcode.AgentNotFound, http.StatusNotFound,
			fmt.Sprintf("no memory entry containing %q found for agent %s target %s",
				oldText, agentID, target),
			nil,
		)
	}

	// Reject mutation on frozen memories.
	if matched.IsFrozen {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusForbidden,
			fmt.Sprintf("memory %s is frozen and cannot be replaced", matched.ID), nil)
	}

	// Take a snapshot of current state before mutation (fire-and-forget).
	s.takeSnapshotQuiet(ctx, agentID, "mutation", nil)

	oldChars := utf8.RuneCountInString(matched.Content)
	newChars := utf8.RuneCountInString(newContent)
	used := currentUsage(entries)
	limit := charLimitForTarget(target)

	if used-oldChars+newChars > limit {
		return errcode.New(
			errcode.AgentInvalidRequest, http.StatusBadRequest,
			fmt.Sprintf("char limit exceeded after replace for target %q: used %d - old %d + new %d > limit %d",
				target, used, oldChars, newChars, limit),
			nil,
		)
	}

	now := time.Now()
	if err := db.Model(matched).Updates(map[string]interface{}{
		"content":    newContent,
		"updated_at": now,
	}).Error; err != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to update memory entry", err)
	}

	logger.Infof(ctx, "memory replaced for agent %s target %s, id=%s",
		agentID, target, matched.ID)

	s.notifyProvider(ctx, domain.MemoryWriteEvent{
		Action:  domain.MemoryActionReplace,
		Target:  target,
		Content: newContent,
		OldText: oldText,
	})

	s.recordGrowthEvent(ctx, agentID, EventMemoryReplaced, target, matched.ID)

	return nil
}

// ---------------------------------------------------------------------------
// Remove — fuzzy-match an existing entry by oldText and delete it.
// ---------------------------------------------------------------------------

func (s *MemoryService) Remove(ctx context.Context, agentID, target, oldText string) error {
	if err := validateTarget(target); err != nil {
		return err
	}

	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	var entries []persistence.Memory
	if err := db.Where("agent_id = ? AND target = ?", agentID, target).
		Order("created_at asc").Find(&entries).Error; err != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to query memories for remove", err)
	}

	var matched *persistence.Memory
	for i := range entries {
		if strings.Contains(entries[i].Content, oldText) {
			matched = &entries[i]
			break
		}
	}
	if matched == nil {
		return errcode.New(errcode.AgentNotFound, http.StatusNotFound,
			fmt.Sprintf("no memory entry containing %q found for agent %s target %s",
				oldText, agentID, target),
			nil,
		)
	}

	// Reject mutation on frozen memories.
	if matched.IsFrozen {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusForbidden,
			fmt.Sprintf("memory %s is frozen and cannot be removed", matched.ID), nil)
	}

	// Take a snapshot of current state before mutation (fire-and-forget).
	s.takeSnapshotQuiet(ctx, agentID, "mutation", nil)

	if err := db.Delete(matched).Error; err != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to delete memory entry", err)
	}

	logger.Infof(ctx, "memory removed for agent %s target %s, id=%s",
		agentID, target, matched.ID)

	s.notifyProvider(ctx, domain.MemoryWriteEvent{
		Action:  domain.MemoryActionRemove,
		Target:  target,
		OldText: oldText,
	})

	s.recordGrowthEvent(ctx, agentID, EventMemoryRemoved, target, matched.ID)

	return nil
}

// ---------------------------------------------------------------------------
// List — return all memory entries for a given agent and target.
// ---------------------------------------------------------------------------

func (s *MemoryService) List(ctx context.Context, agentID, target string) ([]domain.MemoryItem, error) {
	if err := validateTarget(target); err != nil {
		return nil, err
	}

	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var rows []persistence.Memory
	if err := db.Where("agent_id = ? AND target = ?", agentID, target).
		Order("created_at asc").Find(&rows).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to list memories", err)
	}

	items := make([]domain.MemoryItem, 0, len(rows))
	for _, r := range rows {
		turnID := ""
		if r.SourceTurnID != nil {
			turnID = *r.SourceTurnID
		}
		items = append(items, domain.MemoryItem{
			MemoryID:     r.ID,
			AgentID:      r.AgentID,
			Target:       r.Target,
			Content:      r.Content,
			SourceTurnID: turnID,
			IsFrozen:     r.IsFrozen,
			CreatedAt:    r.CreatedAt,
			UpdatedAt:    r.UpdatedAt,
		})
	}

	return items, nil
}

// ---------------------------------------------------------------------------
// BuildSnapshot — build a frozen snapshot with section headers and usage stats.
// ---------------------------------------------------------------------------

func (s *MemoryService) BuildSnapshot(ctx context.Context, agentID string) (*domain.MemorySnapshot, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	buildSection := func(target, header string, limit int) (string, error) {
		var rows []persistence.Memory
		if err := db.Where("agent_id = ? AND target = ?", agentID, target).
			Order("created_at asc").Find(&rows).Error; err != nil {
			return "", errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				fmt.Sprintf("failed to query %s memories for snapshot", target), err)
		}

		parts := make([]string, 0, len(rows))
		for _, r := range rows {
			parts = append(parts, r.Content)
		}
		body := strings.Join(parts, domain.MemorySeparator)

		charCount := utf8.RuneCountInString(body)
		pct := 0
		if limit > 0 {
			pct = charCount * 100 / limit
		}

		return fmt.Sprintf("%s [%d%% \u2014 %d/%d chars]\n===\n%s",
			header, pct, charCount, limit, body), nil
	}

	memoryContent, err := buildSection(
		domain.MemoryTargetMemory,
		"MEMORY (your personal notes)",
		domain.MemoryCharLimitMemory,
	)
	if err != nil {
		return nil, err
	}

	userContent, err := buildSection(
		domain.MemoryTargetUser,
		"USER PROFILE (who the user is)",
		domain.MemoryCharLimitUser,
	)
	if err != nil {
		return nil, err
	}

	snapshot := &domain.MemorySnapshot{
		AgentID:       agentID,
		MemoryContent: memoryContent,
		UserContent:   userContent,
		CapturedAt:    time.Now(),
	}

	logger.Infof(ctx, "memory snapshot built for agent %s", agentID)
	return snapshot, nil
}

// ---------------------------------------------------------------------------
// FlushMemories — Knowledge Salvage before context compression
// ---------------------------------------------------------------------------
// Added: 2026-04-11 — Knowledge Salvage step: sends a restricted LLM call
//   (max 4 iterations, memory tool only) to review the conversation and save
//   high-value context to persistent memory before it gets compressed away.

const (
	flushMaxIterations = 4
	flushSystemPrompt  = "You are a memory flush agent. Your only job is to review the conversation and save important information using the memory tool."
	flushUserPrompt    = "Context compression is about to occur. The middle portion of this conversation will be summarized and individual messages will be dropped.\n\n" +
		"Review the conversation and save any important information that should be remembered long-term using the memory tool. Focus on:\n" +
		"- User preferences or requirements not yet saved\n" +
		"- Technical decisions or constraints discovered\n" +
		"- Project-specific patterns or conventions\n" +
		"- Any facts that would be costly to re-discover\n\n" +
		"Do NOT save information that is already in your memory.\n" +
		"Do NOT save transient/procedural details (e.g. \"user asked me to fix X\")."
)

// FlushMemories performs Knowledge Salvage before context compression.
// It sends a restricted LLM call (max 4 iterations, memory tool only) to
// review the conversation and save high-value context to persistent memory
// before it gets compressed away.
//
// All errors are logged but never fail the parent compression flow — the
// method returns nil after logging so that compression can proceed.
//
// 2026-04-11 — Fix: accept providerType parameter instead of hardcoding
//   "openai". This allows flush to work with any configured provider
//   (Anthropic, Ollama, etc.).
func (s *MemoryService) FlushMemories(
	ctx context.Context,
	agentID string,
	messages []domain.Message,
	providerService *ProviderService,
	credentialPool *CredentialPoolService,
	toolRegistry *ToolRegistryService,
	providerType string,
) error {

	// Take a pre-flush snapshot so memory state can be rolled back if the
	// flush introduces bad data.
	s.takeSnapshotQuiet(ctx, agentID, "flush", nil)

	// Lease a credential for the flush LLM call (use first available via round-robin).
	credential, err := credentialPool.Lease(ctx, providerType, domain.RotationRoundRobin)
	if err != nil {
		logger.Warnf(ctx, "flush_memories: credential lease failed, skipping: agent_id=%s err=%v", agentID, err)
		return nil
	}
	defer credentialPool.Release(ctx, credential.CredentialID)

	// Build the message list: conversation history + flush instruction as last user message.
	flushMessages := make([]domain.Message, 0, len(messages)+1)
	flushMessages = append(flushMessages, messages...)
	flushMessages = append(flushMessages, domain.Message{
		Role:    domain.MessageRoleUser,
		Content: flushUserPrompt,
	})

	// Iterative loop: up to flushMaxIterations rounds of tool calls.
	for iteration := 0; iteration < flushMaxIterations; iteration++ {

		resp, callErr := providerService.Call(ctx, &ProviderCallRequest{
			ProviderID:   credential.CredentialID,
			Model:        "", // use provider default
			SystemPrompt: flushSystemPrompt,
			Messages:     flushMessages,
			ProviderType: providerType,
		})
		if callErr != nil {
			logger.Warnf(ctx, "flush_memories: provider call failed at iteration %d, stopping: agent_id=%s err=%v",
				iteration, agentID, callErr)
			return nil
		}

		// Parse tool calls from the response (same <tool_call>...</tool_call> XML format).
		toolCalls := parseFlushToolCalls(resp.Content)
		if len(toolCalls) == 0 {
			logger.Infof(ctx, "flush_memories: no more tool calls at iteration %d, done: agent_id=%s", iteration, agentID)
			return nil
		}

		// Execute only "memory" tool calls; ignore all non-memory tools.
		meta := &domain.ToolCallMeta{AgentID: agentID}
		executedAny := false

		for _, tc := range toolCalls {
			if tc.name != "memory" {
				logger.Infof(ctx, "flush_memories: ignoring non-memory tool call %q: agent_id=%s", tc.name, agentID)
				continue
			}

			result := toolRegistry.Dispatch(ctx, meta, tc.name, tc.arguments)
			executedAny = true

			if result.IsError {
				logger.Warnf(ctx, "flush_memories: memory tool error: agent_id=%s err=%s", agentID, result.Content)
			} else {
				logger.Infof(ctx, "flush_memories: memory tool success: agent_id=%s result=%s", agentID, result.Content)
			}
		}

		if !executedAny {
			logger.Infof(ctx, "flush_memories: no memory tool calls at iteration %d, done: agent_id=%s", iteration, agentID)
			return nil
		}

		// Append assistant response and a synthetic tool result for the next iteration.
		flushMessages = append(flushMessages, domain.Message{
			Role:    domain.MessageRoleAssistant,
			Content: resp.Content,
		})
		flushMessages = append(flushMessages, domain.Message{
			Role:    domain.MessageRoleTool,
			Content: "[memory] Tool calls executed. Continue reviewing or stop if done.",
		})
	}

	logger.Infof(ctx, "flush_memories: reached max iterations (%d): agent_id=%s", flushMaxIterations, agentID)
	return nil
}

// flushToolCall holds a parsed tool call from a flush LLM response.
type flushToolCall struct {
	name      string
	arguments string
}

// parseFlushToolCalls extracts <tool_call>...</tool_call> entries from an LLM
// response string. Mirrors the same XML-based format used in TurnService.
func parseFlushToolCalls(response string) []flushToolCall {
	var calls []flushToolCall

	const openTag = "<tool_call>"
	const closeTag = "</tool_call>"

	remaining := response
	for {
		openIdx := strings.Index(remaining, openTag)
		if openIdx < 0 {
			break
		}

		closeIdx := strings.Index(remaining[openIdx:], closeTag)
		if closeIdx < 0 {
			break
		}

		jsonStr := remaining[openIdx+len(openTag) : openIdx+closeIdx]

		var parsed struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal([]byte(jsonStr), &parsed); err == nil && parsed.Name != "" {
			calls = append(calls, flushToolCall{
				name:      parsed.Name,
				arguments: string(parsed.Arguments),
			})
		}

		remaining = remaining[openIdx+closeIdx+len(closeTag):]
	}

	return calls
}

// ---------------------------------------------------------------------------
// Memory Snapshot & Rollback — "dumbed-down agent" recovery path
// ---------------------------------------------------------------------------

// takeSnapshotQuiet is a fire-and-forget wrapper around TakeSnapshot.
// Errors are logged but never propagated so that the parent mutation is
// never failed by a snapshot failure.
func (s *MemoryService) takeSnapshotQuiet(ctx context.Context, agentID, trigger string, turnID *string) {
	if err := s.TakeSnapshot(ctx, agentID, trigger, turnID); err != nil {
		logger.Warnf(ctx, "memory snapshot failed (non-fatal): agent=%s trigger=%s err=%v",
			agentID, trigger, err)
	}
}

// TakeSnapshot records a point-in-time snapshot of all memories for the given agent.
// Called automatically before mutations and before compression flush.
func (s *MemoryService) TakeSnapshot(ctx context.Context, agentID, trigger string, turnID *string) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	// Query all current memories.
	var memories []persistence.Memory
	if err := db.Where("agent_id = ?", agentID).Find(&memories).Error; err != nil {
		return fmt.Errorf("failed to query memories for snapshot: %w", err)
	}

	// Serialize to JSON.
	content, err := json.Marshal(memories)
	if err != nil {
		return fmt.Errorf("failed to marshal memories for snapshot: %w", err)
	}

	snapshot := persistence.MemorySnapshot{
		ID:        generateID("snap"),
		AgentID:   agentID,
		TurnID:    turnID,
		Trigger:   trigger,
		Content:   string(content),
		CreatedAt: time.Now(),
	}

	return db.Create(&snapshot).Error
}

// ListSnapshots returns snapshot history for an agent, newest first.
func (s *MemoryService) ListSnapshots(ctx context.Context, agentID string, limit, offset int) ([]persistence.MemorySnapshot, int64, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, 0, err
	}

	var total int64
	db.Model(&persistence.MemorySnapshot{}).Where("agent_id = ?", agentID).Count(&total)

	var snapshots []persistence.MemorySnapshot
	err = db.Where("agent_id = ?", agentID).
		Order("created_at DESC").
		Limit(limit).Offset(offset).
		Find(&snapshots).Error

	return snapshots, total, err
}

// RollbackToSnapshot restores all memories to the state captured in the given snapshot.
// Takes a new "rollback" snapshot before restoring, so the rollback itself is reversible.
func (s *MemoryService) RollbackToSnapshot(ctx context.Context, agentID, snapshotID string) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	// Load the target snapshot.
	var snapshot persistence.MemorySnapshot
	if err := db.Where("id = ? AND agent_id = ?", snapshotID, agentID).First(&snapshot).Error; err != nil {
		return errcode.New(errcode.AgentNotFound, http.StatusNotFound,
			fmt.Sprintf("snapshot %s not found for agent %s", snapshotID, agentID), err)
	}

	// Take a "rollback" snapshot of current state before overwriting.
	if snapErr := s.TakeSnapshot(ctx, agentID, "rollback", nil); snapErr != nil {
		logger.Warnf(ctx, "memory rollback: failed to take pre-rollback snapshot: %v", snapErr)
	}

	// Deserialize the target snapshot.
	var targetMemories []persistence.Memory
	if err := json.Unmarshal([]byte(snapshot.Content), &targetMemories); err != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"invalid snapshot content", err)
	}

	// Delete all current memories for this agent.
	if err := db.Where("agent_id = ?", agentID).Delete(&persistence.Memory{}).Error; err != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to clear memories during rollback", err)
	}

	// Re-insert the snapshot memories.
	now := time.Now()
	restoredCount := 0
	for i := range targetMemories {
		targetMemories[i].UpdatedAt = now
		if err := db.Create(&targetMemories[i]).Error; err != nil {
			logger.Warnf(ctx, "memory rollback: failed to restore memory %s: %v",
				targetMemories[i].ID, err)
			continue
		}
		restoredCount++
	}

	logger.Infof(ctx, "memory rollback completed: agent=%s snapshot=%s restored=%d/%d memories",
		agentID, snapshotID, restoredCount, len(targetMemories))

	return nil
}

// DeleteMemoryByID allows manual deletion of a specific memory item (admin override).
// Takes a snapshot before deletion so the action is reversible.
func (s *MemoryService) DeleteMemoryByID(ctx context.Context, agentID, memoryID string) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	// Take snapshot before deletion.
	s.takeSnapshotQuiet(ctx, agentID, "manual_delete", nil)

	result := db.Where("id = ? AND agent_id = ?", memoryID, agentID).Delete(&persistence.Memory{})
	if result.Error != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to delete memory", result.Error)
	}
	if result.RowsAffected == 0 {
		return errcode.New(errcode.AgentNotFound, http.StatusNotFound,
			fmt.Sprintf("memory not found: %s", memoryID), nil)
	}

	logger.Infof(ctx, "memory deleted by admin: agent=%s memory=%s", agentID, memoryID)
	return nil
}

// FreezeMemory marks a specific memory as frozen (cannot be modified/deleted
// by the LLM). Only admin actions can unfreeze it.
func (s *MemoryService) FreezeMemory(ctx context.Context, agentID, memoryID string, frozen bool) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	result := db.Model(&persistence.Memory{}).
		Where("id = ? AND agent_id = ?", memoryID, agentID).
		Update("is_frozen", frozen)

	if result.Error != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to update freeze status", result.Error)
	}
	if result.RowsAffected == 0 {
		return errcode.New(errcode.AgentNotFound, http.StatusNotFound,
			fmt.Sprintf("memory not found: %s", memoryID), nil)
	}

	action := "frozen"
	if !frozen {
		action = "unfrozen"
	}
	logger.Infof(ctx, "memory %s: agent=%s memory=%s", action, agentID, memoryID)

	return nil
}
