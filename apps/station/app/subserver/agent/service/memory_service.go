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
	"math"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
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

const (
	defaultMemorySearchLimit = 10
	maxMemorySearchLimit     = 50
)

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
	memoryProvider     domain.MemoryProvider
	embeddingProvider  MemoryEmbeddingProvider
	growthMetrics      *GrowthMetricsService
	searchInfraOnce    sync.Once
	searchInfraErr     error
	searchInfraEnabled bool
}

type MemoryServiceOption func(*MemoryService)

func WithMemoryEmbeddingProvider(provider MemoryEmbeddingProvider) MemoryServiceOption {
	return func(s *MemoryService) {
		s.SetMemoryEmbeddingProvider(provider)
	}
}

func NewMemoryService(growthMetrics *GrowthMetricsService, opts ...MemoryServiceOption) *MemoryService {
	svc := &MemoryService{
		growthMetrics:     growthMetrics,
		embeddingProvider: NewHashMemoryEmbeddingProvider(defaultMemoryEmbeddingDims),
	}
	for _, opt := range opts {
		opt(svc)
	}
	return svc
}

// SetMemoryProvider attaches an external memory provider. Pass nil to detach.
func (s *MemoryService) SetMemoryProvider(provider domain.MemoryProvider) {
	s.memoryProvider = provider
}

// GetMemoryProvider returns the currently attached external memory provider, or nil.
func (s *MemoryService) GetMemoryProvider() domain.MemoryProvider {
	return s.memoryProvider
}

func (s *MemoryService) SetMemoryEmbeddingProvider(provider MemoryEmbeddingProvider) {
	if provider == nil {
		provider = NewHashMemoryEmbeddingProvider(defaultMemoryEmbeddingDims)
	}
	s.embeddingProvider = provider
	s.searchInfraOnce = sync.Once{}
	s.searchInfraErr = nil
	s.searchInfraEnabled = false
}

func (s *MemoryService) MemoryEmbeddingProvider() MemoryEmbeddingProvider {
	if s.embeddingProvider == nil {
		s.SetMemoryEmbeddingProvider(nil)
	}
	return s.embeddingProvider
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

func (s *MemoryService) ensureSearchInfrastructure(ctx context.Context, db *gorm.DB) bool {
	if db == nil || db.Dialector.Name() != "postgres" {
		return false
	}
	dimensions := s.MemoryEmbeddingProvider().Dimensions()
	if dimensions <= 0 {
		logger.Warnf(ctx, "memory search infrastructure unavailable: embedding provider returned invalid dimensions")
		return false
	}
	s.searchInfraOnce.Do(func() {
		statements := []string{
			`CREATE EXTENSION IF NOT EXISTS vector`,
			fmt.Sprintf(`ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS embedding vector(%d)`, dimensions),
			`CREATE INDEX IF NOT EXISTS idx_agent_memories_fts ON agent_memories USING GIN (to_tsvector('simple', coalesce(summary, '') || ' ' || coalesce(content, '')))`,
			`CREATE INDEX IF NOT EXISTS idx_agent_memories_embedding ON agent_memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`,
		}
		for _, stmt := range statements {
			if err := db.Exec(stmt).Error; err != nil {
				s.searchInfraErr = err
				logger.Warnf(ctx, "memory search infrastructure unavailable: %v", err)
				return
			}
		}
		s.searchInfraEnabled = true
	})
	return s.searchInfraEnabled && s.searchInfraErr == nil
}

func (s *MemoryService) memoryEmbeddingLiteral(ctx context.Context, text string) (string, bool) {
	provider := s.MemoryEmbeddingProvider()
	vector, err := provider.Embed(ctx, text)
	if err != nil {
		logger.Warnf(ctx, "memory embedding provider failed: provider=%s model=%s err=%v", provider.Name(), provider.Model(), err)
		return "", false
	}
	if len(vector) != provider.Dimensions() {
		logger.Warnf(ctx, "memory embedding dimension mismatch: provider=%s model=%s got=%d want=%d",
			provider.Name(), provider.Model(), len(vector), provider.Dimensions())
		return "", false
	}
	return embeddingVectorLiteral(vector), true
}

func (s *MemoryService) updateMemoryEmbedding(ctx context.Context, db *gorm.DB, memoryID, summary, content string) {
	if !s.ensureSearchInfrastructure(ctx, db) {
		return
	}
	text := strings.TrimSpace(summary + " " + content)
	if text == "" {
		return
	}
	vector, ok := s.memoryEmbeddingLiteral(ctx, text)
	if !ok {
		return
	}
	if err := db.Exec(`UPDATE agent_memories SET embedding = ?::vector WHERE id = ?`, vector, memoryID).Error; err != nil {
		logger.Warnf(ctx, "memory embedding update failed: memory=%s err=%v", memoryID, err)
	}
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

func validateOptionalTarget(target string) error {
	if target == "" {
		return nil
	}
	return validateTarget(target)
}

func normalizeMemoryLayer(layer domain.MemoryLayer, target, content string) domain.MemoryLayer {
	switch layer {
	case domain.MemoryLayerIdentity,
		domain.MemoryLayerContext,
		domain.MemoryLayerExperience,
		domain.MemoryLayerPreference,
		domain.MemoryLayerActivity:
		return layer
	}
	return inferMemoryLayer(target, content)
}

func inferMemoryLayer(target, content string) domain.MemoryLayer {
	lower := strings.ToLower(content)
	if target == domain.MemoryTargetUser {
		if strings.Contains(lower, "prefer") ||
			strings.Contains(lower, "like") ||
			strings.Contains(lower, "style") ||
			strings.Contains(lower, "偏好") ||
			strings.Contains(lower, "喜欢") {
			return domain.MemoryLayerPreference
		}
		return domain.MemoryLayerIdentity
	}
	if strings.Contains(lower, "project") ||
		strings.Contains(lower, "task") ||
		strings.Contains(lower, "正在") ||
		strings.Contains(lower, "当前") {
		return domain.MemoryLayerContext
	}
	if strings.Contains(lower, "learned") ||
		strings.Contains(lower, "lesson") ||
		strings.Contains(lower, "worked") ||
		strings.Contains(lower, "经验") {
		return domain.MemoryLayerExperience
	}
	if strings.Contains(lower, "today") ||
		strings.Contains(lower, "now") ||
		strings.Contains(lower, "just") ||
		strings.Contains(lower, "刚刚") {
		return domain.MemoryLayerActivity
	}
	return domain.MemoryLayerPreference
}

func targetForLayer(layer domain.MemoryLayer) string {
	switch layer {
	case domain.MemoryLayerIdentity, domain.MemoryLayerPreference, domain.MemoryLayerActivity:
		return domain.MemoryTargetUser
	default:
		return domain.MemoryTargetMemory
	}
}

func summarizeMemoryContent(content string) string {
	trimmed := strings.TrimSpace(strings.ReplaceAll(content, "\n", " "))
	if len([]rune(trimmed)) <= 180 {
		return trimmed
	}
	runes := []rune(trimmed)
	return string(runes[:180]) + "..."
}

func parseMemoryTime(value string) (*time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	layouts := []string{time.RFC3339, "2006-01-02", "2006-01-02 15:04:05"}
	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, value); err == nil {
			return &parsed, nil
		}
	}
	return nil, fmt.Errorf("invalid time %q", value)
}

func resolveMemoryPeriod(period string) (*time.Time, error) {
	switch strings.TrimSpace(period) {
	case "":
		return nil, nil
	case "24h":
		t := time.Now().Add(-24 * time.Hour)
		return &t, nil
	case "7d":
		t := time.Now().AddDate(0, 0, -7)
		return &t, nil
	case "30d":
		t := time.Now().AddDate(0, 0, -30)
		return &t, nil
	case "90d":
		t := time.Now().AddDate(0, 0, -90)
		return &t, nil
	default:
		return nil, fmt.Errorf("invalid period %q", period)
	}
}

func clampMemoryLimit(limit int) int {
	if limit <= 0 {
		return defaultMemorySearchLimit
	}
	if limit > maxMemorySearchLimit {
		return maxMemorySearchLimit
	}
	return limit
}

func memoryRowToDomain(r persistence.Memory) domain.MemoryItem {
	turnID := ""
	if r.SourceTurnID != nil {
		turnID = *r.SourceTurnID
	}
	return domain.MemoryItem{
		MemoryID:       r.ID,
		AgentID:        r.AgentID,
		Target:         r.Target,
		Layer:          domain.MemoryLayer(r.Layer),
		SessionID:      r.SessionID,
		Content:        r.Content,
		SourceTurnID:   turnID,
		Source:         r.Source,
		Summary:        r.Summary,
		Relevance:      r.Relevance,
		IsFrozen:       r.IsFrozen,
		TrustScore:     r.TrustScore,
		RetrievalCount: r.RetrievalCount,
		LastAccessedAt: r.LastAccessedAt,
		HelpfulCount:   r.HelpfulCount,
		HarmfulCount:   r.HarmfulCount,
		CreatedAt:      r.CreatedAt,
		UpdatedAt:      r.UpdatedAt,
	}
}

func applyMemoryFilters(query *gorm.DB, opts domain.MemoryListOptions) *gorm.DB {
	if opts.AgentID != "" {
		query = query.Where("agent_id = ?", opts.AgentID)
	}
	if opts.Target != "" {
		query = query.Where("target = ?", opts.Target)
	}
	if opts.Layer != "" {
		query = query.Where("layer = ?", string(opts.Layer))
	}
	if opts.Since != nil {
		query = query.Where("created_at >= ?", *opts.Since)
	}
	if opts.Until != nil {
		query = query.Where("created_at <= ?", *opts.Until)
	}
	return query
}

func orderByMemory(orderBy string) string {
	switch orderBy {
	case "relevance":
		return "relevance DESC, updated_at DESC"
	case "last_accessed_at":
		return "last_accessed_at DESC, updated_at DESC"
	case "created_at":
		return "created_at DESC"
	default:
		return "created_at ASC"
	}
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
	_, err := s.AddMemory(ctx, domain.MemoryItem{
		AgentID:      agentID,
		Target:       target,
		Content:      content,
		SourceTurnID: turnID,
		Source:       domain.MemorySourceTurn,
	})
	return err
}

func (s *MemoryService) AddMemory(ctx context.Context, item domain.MemoryItem) (*domain.MemoryItem, error) {
	agentID := strings.TrimSpace(item.AgentID)
	if agentID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "agent_id is required", nil)
	}
	target := strings.TrimSpace(item.Target)
	if target == "" {
		target = targetForLayer(item.Layer)
	}
	if err := validateTarget(target); err != nil {
		return nil, err
	}

	content := strings.TrimSpace(item.Content)
	if content == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "content is required", nil)
	}
	if err := scanContent(content); err != nil {
		logger.Warnf(ctx, "memory add rejected for agent %s: %v", item.AgentID, err)
		return nil, err
	}

	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	// Take a snapshot of current state before mutation (fire-and-forget).
	s.takeSnapshotQuiet(ctx, agentID, "mutation", nil)

	var existing []persistence.Memory
	if err := db.Where("agent_id = ? AND target = ?", agentID, target).
		Order("created_at asc").Find(&existing).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
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
		return nil, errcode.New(
			errcode.AgentInvalidRequest, http.StatusBadRequest,
			fmt.Sprintf("char limit exceeded for target %q: used %d + new %d (+sep %d) > limit %d",
				target, used, newChars, sepCost, limit),
			nil,
		)
	}

	now := time.Now()
	source := strings.TrimSpace(item.Source)
	if source == "" {
		source = domain.MemorySourceTurn
	}
	summary := strings.TrimSpace(item.Summary)
	if summary == "" {
		summary = summarizeMemoryContent(content)
	}
	record := persistence.Memory{
		ID:         generateID("mem"),
		AgentID:    agentID,
		Target:     target,
		Layer:      string(normalizeMemoryLayer(item.Layer, target, content)),
		SessionID:  strings.TrimSpace(item.SessionID),
		Content:    content,
		Summary:    summary,
		Relevance:  item.Relevance,
		Source:     source,
		TrustScore: domain.MemoryDefaultTrustScore,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if item.TrustScore > 0 {
		record.TrustScore = item.TrustScore
	}
	if item.SourceTurnID != "" {
		turnID := item.SourceTurnID
		record.SourceTurnID = &turnID
	}

	if err := db.Create(&record).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to create memory entry", err)
	}
	s.updateMemoryEmbedding(ctx, db, record.ID, record.Summary, record.Content)

	logger.Infof(ctx, "memory added for agent %s target %s, id=%s, chars=%d",
		agentID, target, record.ID, newChars)

	s.notifyProvider(ctx, domain.MemoryWriteEvent{
		Action:  domain.MemoryActionAdd,
		Target:  target,
		Content: content,
	})

	s.recordGrowthEvent(ctx, agentID, EventMemoryCreated, target, record.ID)
	s.emitMemoryEvent(ctx, domain.MemoryEvent{
		Type:     domain.MemoryEventExtraction,
		MemoryID: record.ID,
		AgentID:  agentID,
		Layer:    domain.MemoryLayer(record.Layer),
		Detail:   fmt.Sprintf(`{"source":%q}`, record.Source),
	})

	out := memoryRowToDomain(record)
	return &out, nil
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
		"summary":    summarizeMemoryContent(newContent),
		"updated_at": now,
	}).Error; err != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to update memory entry", err)
	}
	s.updateMemoryEmbedding(ctx, db, matched.ID, summarizeMemoryContent(newContent), newContent)

	logger.Infof(ctx, "memory replaced for agent %s target %s, id=%s",
		agentID, target, matched.ID)

	s.notifyProvider(ctx, domain.MemoryWriteEvent{
		Action:  domain.MemoryActionReplace,
		Target:  target,
		Content: newContent,
		OldText: oldText,
	})

	s.recordGrowthEvent(ctx, agentID, EventMemoryReplaced, target, matched.ID)
	s.emitMemoryEvent(ctx, domain.MemoryEvent{
		Type:     domain.MemoryEventExtraction,
		MemoryID: matched.ID,
		AgentID:  agentID,
		Layer:    domain.MemoryLayer(matched.Layer),
		Detail:   `{"action":"replace"}`,
	})

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
	s.emitMemoryEvent(ctx, domain.MemoryEvent{
		Type:     domain.MemoryEventDeletion,
		MemoryID: matched.ID,
		AgentID:  agentID,
		Layer:    domain.MemoryLayer(matched.Layer),
		Detail:   `{"action":"remove"}`,
	})

	return nil
}

// ---------------------------------------------------------------------------
// List — return all memory entries for a given agent and target.
// ---------------------------------------------------------------------------

func (s *MemoryService) List(ctx context.Context, agentID, target string) ([]domain.MemoryItem, error) {
	items, _, err := s.ListWithOptions(ctx, domain.MemoryListOptions{
		AgentID: agentID,
		Target:  target,
	})
	return items, err
}

func (s *MemoryService) ListWithOptions(ctx context.Context, opts domain.MemoryListOptions) ([]domain.MemoryItem, int, error) {
	if err := validateOptionalTarget(opts.Target); err != nil {
		return nil, 0, err
	}

	db, err := s.getDB(ctx)
	if err != nil {
		return nil, 0, err
	}

	base := applyMemoryFilters(db.Model(&persistence.Memory{}), opts)
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to count memories", err)
	}

	pageSize := opts.PageSize
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	page := opts.Page
	if page <= 1 {
		page = 1
	}
	offset := (page - 1) * pageSize

	var rows []persistence.Memory
	if err := applyMemoryFilters(db.Model(&persistence.Memory{}), opts).
		Order(orderByMemory(opts.OrderBy)).
		Limit(pageSize).
		Offset(offset).
		Find(&rows).Error; err != nil {
		return nil, 0, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to list memories", err)
	}

	items := make([]domain.MemoryItem, 0, len(rows))
	for _, r := range rows {
		items = append(items, memoryRowToDomain(r))
	}

	return items, int(total), nil
}

func (s *MemoryService) GetMemory(ctx context.Context, id string) (*domain.MemoryItem, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var row persistence.Memory
	if err := db.Where("id = ?", id).First(&row).Error; err != nil {
		return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound,
			fmt.Sprintf("memory not found: %s", id), err)
	}
	item := memoryRowToDomain(row)
	return &item, nil
}

func (s *MemoryService) Search(ctx context.Context, opts domain.MemorySearchOptions) ([]domain.ScoredMemory, error) {
	start := time.Now()
	query := strings.TrimSpace(opts.Query)
	if query == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "query is required", nil)
	}

	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	if s.ensureSearchInfrastructure(ctx, db) {
		if results, searchErr := s.searchPostgresHybrid(ctx, db, opts, query, start); searchErr == nil {
			return results, nil
		} else {
			logger.Warnf(ctx, "memory postgres hybrid search failed, falling back to in-process search: %v", searchErr)
		}
	}

	listOpts := domain.MemoryListOptions{
		AgentID: opts.AgentID,
		Since:   opts.Since,
		Until:   opts.Until,
	}
	dbQuery := applyMemoryFilters(db.Model(&persistence.Memory{}), listOpts)
	if len(opts.Layers) > 0 {
		layers := make([]string, 0, len(opts.Layers))
		for _, layer := range opts.Layers {
			if layer != "" {
				layers = append(layers, string(layer))
			}
		}
		if len(layers) > 0 {
			dbQuery = dbQuery.Where("layer IN ?", layers)
		}
	}

	var rows []persistence.Memory
	if err := dbQuery.Order("updated_at DESC").Limit(500).Find(&rows).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to search memories", err)
	}

	terms := strings.Fields(strings.ToLower(query))
	results := make([]domain.ScoredMemory, 0, len(rows))
	now := time.Now()
	for _, row := range rows {
		keywordScore := keywordMemoryScore(row, terms)
		if keywordScore <= 0 {
			continue
		}
		decay := memoryDecayFactor(row, now)
		trust := row.TrustScore
		if trust <= 0 {
			trust = domain.MemoryDefaultTrustScore
		}
		trustFactor := 0.5 + trust*0.5
		weighted := keywordScore
		afterDecay := weighted * decay
		final := afterDecay * trustFactor
		item := memoryRowToDomain(row)
		results = append(results, domain.ScoredMemory{
			Memory: item,
			Score:  final,
			Explain: domain.MemoryScoreExplain{
				KeywordScore:  keywordScore,
				WeightedScore: weighted,
				DecayFactor:   decay,
				AfterDecay:    afterDecay,
				AfterRerank:   afterDecay,
				FinalScore:    final,
				TrustFactor:   trustFactor,
			},
		})
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].Score > results[j].Score
	})
	results = governMemoryResults(results, opts.Effort, clampMemoryLimit(opts.Limit))
	s.recordMemoryAccess(ctx, results)
	s.emitMemoryEvent(ctx, domain.MemoryEvent{
		Type:      domain.MemoryEventRetrieval,
		AgentID:   opts.AgentID,
		Detail:    fmt.Sprintf(`{"query":%q,"result_count":%d}`, query, len(results)),
		LatencyMs: time.Since(start).Milliseconds(),
	})
	return results, nil
}

type memoryHybridHit struct {
	ID           string
	KeywordScore float64
	VectorScore  float64
}

func (s *MemoryService) searchPostgresHybrid(ctx context.Context, db *gorm.DB, opts domain.MemorySearchOptions, query string, start time.Time) ([]domain.ScoredMemory, error) {
	vector, ok := s.memoryEmbeddingLiteral(ctx, query)
	if !ok {
		return nil, fmt.Errorf("embedding provider unavailable")
	}
	whereParts := []string{"1=1"}
	args := []any{}
	if opts.AgentID != "" {
		whereParts = append(whereParts, "agent_id = ?")
		args = append(args, opts.AgentID)
	}
	if opts.Since != nil {
		whereParts = append(whereParts, "created_at >= ?")
		args = append(args, *opts.Since)
	}
	if opts.Until != nil {
		whereParts = append(whereParts, "created_at <= ?")
		args = append(args, *opts.Until)
	}
	if len(opts.Layers) > 0 {
		layers := make([]string, 0, len(opts.Layers))
		for _, layer := range opts.Layers {
			if layer != "" {
				layers = append(layers, string(layer))
			}
		}
		if len(layers) > 0 {
			whereParts = append(whereParts, "layer IN ?")
			args = append(args, layers)
		}
	}
	like := "%" + query + "%"
	args = append([]any{query, vector}, append(args, query, like, like)...)
	raw := fmt.Sprintf(`
		SELECT id,
			ts_rank_cd(to_tsvector('simple', coalesce(summary, '') || ' ' || coalesce(content, '')), plainto_tsquery('simple', ?)) AS keyword_score,
			CASE WHEN embedding IS NULL THEN 0 ELSE GREATEST(0, 1 - (embedding <=> ?::vector)) END AS vector_score
		FROM agent_memories
		WHERE %s
			AND (
				to_tsvector('simple', coalesce(summary, '') || ' ' || coalesce(content, '')) @@ plainto_tsquery('simple', ?)
				OR summary ILIKE ?
				OR content ILIKE ?
				OR embedding IS NOT NULL
			)
		ORDER BY (
			0.45 * ts_rank_cd(to_tsvector('simple', coalesce(summary, '') || ' ' || coalesce(content, '')), plainto_tsquery('simple', ?))
			+ 0.55 * CASE WHEN embedding IS NULL THEN 0 ELSE GREATEST(0, 1 - (embedding <=> ?::vector)) END
		) DESC
		LIMIT 500
	`, strings.Join(whereParts, " AND "))
	args = append(args, query, vector)

	var hits []memoryHybridHit
	if err := db.Raw(raw, args...).Scan(&hits).Error; err != nil {
		return nil, err
	}
	if len(hits) == 0 {
		return nil, nil
	}

	ids := make([]string, 0, len(hits))
	scoreByID := make(map[string]memoryHybridHit, len(hits))
	for _, hit := range hits {
		ids = append(ids, hit.ID)
		scoreByID[hit.ID] = hit
	}
	var rows []persistence.Memory
	if err := db.Where("id IN ?", ids).Find(&rows).Error; err != nil {
		return nil, err
	}
	rowByID := make(map[string]persistence.Memory, len(rows))
	for _, row := range rows {
		rowByID[row.ID] = row
	}

	now := time.Now()
	results := make([]domain.ScoredMemory, 0, len(hits))
	for _, id := range ids {
		row, ok := rowByID[id]
		if !ok {
			continue
		}
		hit := scoreByID[id]
		weighted := 0.45*hit.KeywordScore + 0.55*hit.VectorScore
		if weighted <= 0 {
			continue
		}
		decay := memoryDecayFactor(row, now)
		trust := row.TrustScore
		if trust <= 0 {
			trust = domain.MemoryDefaultTrustScore
		}
		trustFactor := 0.5 + trust*0.5
		afterDecay := weighted * decay
		final := afterDecay * trustFactor
		results = append(results, domain.ScoredMemory{
			Memory: memoryRowToDomain(row),
			Score:  final,
			Explain: domain.MemoryScoreExplain{
				VectorScore:   hit.VectorScore,
				KeywordScore:  hit.KeywordScore,
				WeightedScore: weighted,
				DecayFactor:   decay,
				AfterDecay:    afterDecay,
				AfterRerank:   afterDecay,
				FinalScore:    final,
				TrustFactor:   trustFactor,
			},
		})
	}
	sort.Slice(results, func(i, j int) bool {
		return results[i].Score > results[j].Score
	})
	results = governMemoryResults(results, opts.Effort, clampMemoryLimit(opts.Limit))
	s.recordMemoryAccess(ctx, results)
	s.emitMemoryEvent(ctx, domain.MemoryEvent{
		Type:      domain.MemoryEventRetrieval,
		AgentID:   opts.AgentID,
		Detail:    fmt.Sprintf(`{"query":%q,"mode":"postgres_hybrid","result_count":%d}`, query, len(results)),
		LatencyMs: time.Since(start).Milliseconds(),
	})
	return results, nil
}

func keywordMemoryScore(row persistence.Memory, terms []string) float64 {
	haystack := strings.ToLower(strings.Join([]string{
		row.Summary,
		row.Content,
		row.Layer,
		row.Target,
	}, " "))
	if len(terms) == 0 {
		return 0
	}
	matches := 0
	for _, term := range terms {
		if strings.Contains(haystack, term) {
			matches++
		}
	}
	if matches == 0 {
		return 0
	}
	score := float64(matches) / float64(len(terms))
	if strings.Contains(strings.ToLower(row.Summary), strings.Join(terms, " ")) {
		score += 0.25
	}
	if score > 1 {
		score = 1
	}
	return score
}

func memoryDecayFactor(row persistence.Memory, now time.Time) float64 {
	effective := row.CreatedAt
	if row.LastAccessedAt != nil && row.LastAccessedAt.After(effective) {
		effective = *row.LastAccessedAt
	}
	ageDays := now.Sub(effective).Hours() / 24
	lambda := 0.01
	switch domain.MemoryLayer(row.Layer) {
	case domain.MemoryLayerIdentity, domain.MemoryLayerPreference:
		lambda = 0.001
	case domain.MemoryLayerContext:
		lambda = 0.006
	case domain.MemoryLayerExperience:
		lambda = 0.004
	case domain.MemoryLayerActivity:
		lambda = 0.02
	}
	accessBoost := 1 + math.Log2(1+float64(row.RetrievalCount))
	score := math.Exp(-(lambda / accessBoost) * ageDays)
	if score < 0.05 {
		return 0.05
	}
	if score > 1 {
		return 1
	}
	return score
}

func governMemoryResults(results []domain.ScoredMemory, effort string, limit int) []domain.ScoredMemory {
	layerLimits := map[domain.MemoryLayer]int{
		domain.MemoryLayerIdentity:   2,
		domain.MemoryLayerContext:    1,
		domain.MemoryLayerExperience: 1,
		domain.MemoryLayerPreference: 3,
		domain.MemoryLayerActivity:   3,
	}
	switch effort {
	case "low":
		layerLimits = map[domain.MemoryLayer]int{
			domain.MemoryLayerIdentity:   1,
			domain.MemoryLayerPreference: 2,
			domain.MemoryLayerActivity:   2,
		}
	case "high":
		layerLimits = map[domain.MemoryLayer]int{
			domain.MemoryLayerIdentity:   3,
			domain.MemoryLayerContext:    3,
			domain.MemoryLayerExperience: 3,
			domain.MemoryLayerPreference: 5,
			domain.MemoryLayerActivity:   6,
		}
	}
	counts := make(map[domain.MemoryLayer]int)
	out := make([]domain.ScoredMemory, 0, len(results))
	for _, result := range results {
		layer := result.Memory.Layer
		layerLimit := layerLimits[layer]
		if layerLimit <= 0 {
			continue
		}
		if counts[layer] >= layerLimit {
			continue
		}
		out = append(out, result)
		counts[layer]++
		if len(out) >= limit {
			break
		}
	}
	return out
}

func (s *MemoryService) recordMemoryAccess(ctx context.Context, results []domain.ScoredMemory) {
	if len(results) == 0 {
		return
	}
	ids := make([]string, 0, len(results))
	for _, result := range results {
		if result.Memory.MemoryID != "" {
			ids = append(ids, result.Memory.MemoryID)
		}
	}
	if len(ids) == 0 {
		return
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return
	}
	now := time.Now()
	if err := db.Model(&persistence.Memory{}).
		Where("id IN ?", ids).
		Updates(map[string]interface{}{
			"retrieval_count":  gorm.Expr("retrieval_count + ?", 1),
			"last_accessed_at": now,
		}).Error; err != nil {
		logger.Warnf(ctx, "memory access update failed: %v", err)
		return
	}
	s.emitMemoryEvent(ctx, domain.MemoryEvent{
		Type:   domain.MemoryEventAccess,
		Detail: fmt.Sprintf(`{"count":%d}`, len(ids)),
	})
}

func (s *MemoryService) Stats(ctx context.Context, agentID string) (*domain.MemoryStats, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	query := db.Model(&persistence.Memory{})
	if agentID != "" {
		query = query.Where("agent_id = ?", agentID)
	}
	var rows []persistence.Memory
	if err := query.Find(&rows).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to load memory stats", err)
	}
	stats := &domain.MemoryStats{ByLayer: make(map[domain.MemoryLayer]int)}
	for _, row := range rows {
		stats.Total++
		stats.ByLayer[domain.MemoryLayer(row.Layer)]++
		stats.StorageBytes += int64(len(row.Content) + len(row.Summary))
	}
	return stats, nil
}

func (s *MemoryService) GetPersona(ctx context.Context, agentID string) (*domain.MemoryPersona, error) {
	items, _, err := s.ListWithOptions(ctx, domain.MemoryListOptions{
		AgentID:  agentID,
		PageSize: 100,
		OrderBy:  "created_at",
	})
	if err != nil {
		return nil, err
	}
	return buildMemoryPersona(items), nil
}

func buildMemoryPersona(items []domain.MemoryItem) *domain.MemoryPersona {
	var identities, preferences, activities []string
	updatedAt := time.Time{}
	for _, item := range items {
		summary := strings.TrimSpace(item.Summary)
		if summary == "" {
			summary = summarizeMemoryContent(item.Content)
		}
		if summary == "" {
			continue
		}
		switch item.Layer {
		case domain.MemoryLayerIdentity:
			identities = append(identities, summary)
		case domain.MemoryLayerPreference:
			preferences = append(preferences, summary)
		case domain.MemoryLayerActivity:
			activities = append(activities, summary)
		}
		if item.UpdatedAt.After(updatedAt) {
			updatedAt = item.UpdatedAt
		}
	}
	if updatedAt.IsZero() {
		updatedAt = time.Now()
	}
	tagline := "No durable persona yet"
	if len(identities) > 0 {
		tagline = identities[0]
	} else if len(preferences) > 0 {
		tagline = preferences[0]
	}
	sections := make([]string, 0, 3)
	if len(identities) > 0 {
		sections = append(sections, "Identity: "+strings.Join(identities, "; "))
	}
	if len(preferences) > 0 {
		sections = append(sections, "Preferences: "+strings.Join(preferences, "; "))
	}
	if len(activities) > 0 {
		sections = append(sections, "Recent activity: "+strings.Join(activities, "; "))
	}
	narrative := strings.Join(sections, "\n")
	return &domain.MemoryPersona{Tagline: tagline, Narrative: narrative, UpdatedAt: updatedAt}
}

func (s *MemoryService) BuildRelevantSnapshot(ctx context.Context, agentID, query string) (*domain.MemorySnapshot, error) {
	searchResults, err := s.Search(ctx, domain.MemorySearchOptions{
		AgentID: agentID,
		Query:   query,
		Limit:   10,
		Effort:  "medium",
	})
	if err != nil {
		return s.BuildSnapshot(ctx, agentID)
	}
	persona, _ := s.GetPersona(ctx, agentID)
	relevant := make([]domain.MemoryItem, 0, len(searchResults))
	memoryParts := make([]string, 0)
	userParts := make([]string, 0)
	for _, result := range searchResults {
		item := result.Memory
		relevant = append(relevant, item)
		line := fmt.Sprintf("- [%s] %s", item.Layer, firstNonEmpty(item.Summary, item.Content))
		if item.Target == domain.MemoryTargetUser {
			userParts = append(userParts, line)
		} else {
			memoryParts = append(memoryParts, line)
		}
	}
	personaContent := ""
	if persona != nil && persona.Narrative != "" {
		personaContent = persona.Narrative
	}
	return &domain.MemorySnapshot{
		AgentID:        agentID,
		MemoryContent:  strings.Join(memoryParts, "\n"),
		UserContent:    strings.Join(userParts, "\n"),
		PersonaContent: personaContent,
		RelevantItems:  relevant,
		CapturedAt:     time.Now(),
	}, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func (s *MemoryService) emitMemoryEvent(ctx context.Context, event domain.MemoryEvent) {
	db, err := s.getDB(ctx)
	if err != nil {
		logger.Warnf(ctx, "memory event skipped: %v", err)
		return
	}
	if event.ID == "" {
		event.ID = generateID("mev")
	}
	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now()
	}
	row := persistence.MemoryEvent{
		ID:        event.ID,
		Type:      string(event.Type),
		MemoryID:  event.MemoryID,
		SessionID: event.SessionID,
		AgentID:   event.AgentID,
		Layer:     string(event.Layer),
		Detail:    event.Detail,
		LatencyMs: event.LatencyMs,
		CreatedAt: event.Timestamp,
	}
	if err := db.Create(&row).Error; err != nil {
		logger.Warnf(ctx, "memory event write failed: %v", err)
	}
}

func (s *MemoryService) QueryEvents(ctx context.Context, opts domain.MemoryEventQueryOptions) ([]domain.MemoryEvent, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	query := db.Model(&persistence.MemoryEvent{})
	if opts.Type != "" {
		query = query.Where("type = ?", string(opts.Type))
	}
	if opts.AgentID != "" {
		query = query.Where("agent_id = ?", opts.AgentID)
	}
	if opts.Since != nil {
		query = query.Where("created_at >= ?", *opts.Since)
	}
	if opts.Until != nil {
		query = query.Where("created_at <= ?", *opts.Until)
	}
	limit := opts.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	var rows []persistence.MemoryEvent
	if err := query.Order("created_at DESC").Limit(limit).Offset(opts.Offset).Find(&rows).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to query memory events", err)
	}
	events := make([]domain.MemoryEvent, 0, len(rows))
	for _, row := range rows {
		events = append(events, domain.MemoryEvent{
			ID:        row.ID,
			Type:      domain.MemoryEventType(row.Type),
			MemoryID:  row.MemoryID,
			SessionID: row.SessionID,
			AgentID:   row.AgentID,
			Layer:     domain.MemoryLayer(row.Layer),
			Detail:    row.Detail,
			LatencyMs: row.LatencyMs,
			Timestamp: row.CreatedAt,
		})
	}
	return events, nil
}

func (s *MemoryService) Export(ctx context.Context, agentID string, layer domain.MemoryLayer) ([]domain.MemoryItem, *domain.MemoryPersona, error) {
	items, _, err := s.ListWithOptions(ctx, domain.MemoryListOptions{
		AgentID:  agentID,
		Layer:    layer,
		PageSize: 100,
		OrderBy:  "created_at",
	})
	if err != nil {
		return nil, nil, err
	}
	persona, _ := s.GetPersona(ctx, agentID)
	return items, persona, nil
}

func (s *MemoryService) Import(ctx context.Context, items []domain.MemoryItem, skipDuplicates bool) (imported, skipped, failed int) {
	for _, item := range items {
		if skipDuplicates && s.hasDuplicateMemory(ctx, item.AgentID, item.Layer, item.Summary, item.Content) {
			skipped++
			continue
		}
		if _, err := s.AddMemory(ctx, item); err != nil {
			failed++
			continue
		}
		imported++
	}
	return imported, skipped, failed
}

func (s *MemoryService) hasDuplicateMemory(ctx context.Context, agentID string, layer domain.MemoryLayer, summary, content string) bool {
	db, err := s.getDB(ctx)
	if err != nil {
		return false
	}
	query := db.Model(&persistence.Memory{}).Where("agent_id = ? AND layer = ?", agentID, string(layer))
	if strings.TrimSpace(summary) != "" {
		query = query.Where("summary = ?", summary)
	} else {
		query = query.Where("content = ?", content)
	}
	var count int64
	_ = query.Count(&count).Error
	return count > 0
}

func (s *MemoryService) RecordFeedback(ctx context.Context, memoryID string, helpful bool, reason string) (*domain.MemoryItem, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var row persistence.Memory
	if err := db.Where("id = ?", memoryID).First(&row).Error; err != nil {
		return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "memory not found", err)
	}
	trust := row.TrustScore
	if helpful {
		trust += domain.TrustScorePositiveDelta
		row.HelpfulCount++
	} else {
		trust -= domain.TrustScoreNegativeDelta
		row.HarmfulCount++
	}
	if trust > 1 {
		trust = 1
	}
	if trust < 0.01 {
		trust = 0.01
	}
	row.TrustScore = trust
	row.UpdatedAt = time.Now()
	if err := db.Save(&row).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to save memory feedback", err)
	}
	s.emitMemoryEvent(ctx, domain.MemoryEvent{
		Type:     domain.MemoryEventFeedback,
		MemoryID: row.ID,
		AgentID:  row.AgentID,
		Layer:    domain.MemoryLayer(row.Layer),
		Detail:   fmt.Sprintf(`{"helpful":%t,"reason":%q}`, helpful, reason),
	})
	item := memoryRowToDomain(row)
	return &item, nil
}

func (s *MemoryService) ExtractFromTurn(ctx context.Context, agentID, conversationID, turnID, userInput, assistantResponse string) {
	candidates := extractMemoryCandidates(userInput, assistantResponse)
	if len(candidates) == 0 {
		return
	}
	for _, candidate := range candidates {
		candidate.AgentID = agentID
		candidate.SessionID = conversationID
		candidate.SourceTurnID = turnID
		candidate.Source = domain.MemorySourceReview
		if s.hasDuplicateMemory(ctx, candidate.AgentID, candidate.Layer, candidate.Summary, candidate.Content) {
			s.emitMemoryEvent(ctx, domain.MemoryEvent{
				Type:    domain.MemoryEventDedupSkip,
				AgentID: agentID,
				Layer:   candidate.Layer,
				Detail:  fmt.Sprintf(`{"summary":%q}`, candidate.Summary),
			})
			continue
		}
		if _, err := s.AddMemory(ctx, candidate); err != nil {
			logger.Warnf(ctx, "memory extraction save failed: agent=%s err=%v", agentID, err)
		}
	}
}

func extractMemoryCandidates(userInput, assistantResponse string) []domain.MemoryItem {
	var out []domain.MemoryItem
	text := strings.TrimSpace(userInput)
	lower := strings.ToLower(text)
	if text == "" {
		return out
	}
	add := func(layer domain.MemoryLayer, target string, content string) {
		out = append(out, domain.MemoryItem{
			Target:  target,
			Layer:   layer,
			Content: content,
			Summary: summarizeMemoryContent(content),
		})
	}
	if strings.Contains(lower, "remember") || strings.Contains(lower, "记住") || strings.Contains(lower, "记得") {
		add(inferMemoryLayer(domain.MemoryTargetUser, text), domain.MemoryTargetUser, text)
	}
	if strings.Contains(lower, "i prefer") ||
		strings.Contains(lower, "please use") ||
		strings.Contains(lower, "以后") ||
		strings.Contains(lower, "偏好") ||
		strings.Contains(lower, "喜欢") {
		add(domain.MemoryLayerPreference, domain.MemoryTargetUser, text)
	}
	if strings.Contains(lower, "my name is") ||
		strings.Contains(lower, "i am ") ||
		strings.Contains(lower, "我是") {
		add(domain.MemoryLayerIdentity, domain.MemoryTargetUser, text)
	}
	if strings.Contains(lower, "project") ||
		strings.Contains(lower, "workspace") ||
		strings.Contains(lower, "项目") {
		add(domain.MemoryLayerContext, domain.MemoryTargetMemory, text)
	}
	if strings.Contains(strings.ToLower(assistantResponse), "lesson") {
		add(domain.MemoryLayerExperience, domain.MemoryTargetMemory, summarizeMemoryContent(assistantResponse))
	}
	return out
}

func (s *MemoryService) EmbeddingStatus(ctx context.Context) (provider, model string, dimensions, vectorCount int) {
	db, err := s.getDB(ctx)
	if err == nil && s.ensureSearchInfrastructure(ctx, db) {
		var count int64
		if countErr := db.Raw(`SELECT COUNT(*) FROM agent_memories WHERE embedding IS NOT NULL`).Scan(&count).Error; countErr == nil {
			provider := s.MemoryEmbeddingProvider()
			return provider.Name(), provider.Model(), provider.Dimensions(), int(count)
		}
	}
	stats, statErr := s.Stats(ctx, "")
	if statErr == nil && stats != nil {
		vectorCount = stats.Total
	}
	return "none", "fts-lite", 0, vectorCount
}

func (s *MemoryService) ReEmbed(ctx context.Context) (int, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return 0, err
	}
	var rows []persistence.Memory
	if err := db.Find(&rows).Error; err != nil {
		return 0, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to load memories for re-embed", err)
	}
	if !s.ensureSearchInfrastructure(ctx, db) {
		return len(rows), nil
	}
	count := 0
	for _, row := range rows {
		s.updateMemoryEmbedding(ctx, db, row.ID, row.Summary, row.Content)
		count++
	}
	return count, nil
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
	if persona, personaErr := s.GetPersona(ctx, agentID); personaErr == nil && persona != nil {
		snapshot.PersonaContent = persona.Narrative
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
//
//	"openai". This allows flush to work with any configured provider
//	(Anthropic, Ollama, etc.).
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
	credential, err := credentialPool.Lease(ctx, agentID, providerType, domain.RotationRoundRobin)
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

	var row persistence.Memory
	_ = db.Where("id = ? AND agent_id = ?", memoryID, agentID).First(&row).Error

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
	s.emitMemoryEvent(ctx, domain.MemoryEvent{
		Type:     domain.MemoryEventDeletion,
		MemoryID: memoryID,
		AgentID:  agentID,
		Layer:    domain.MemoryLayer(row.Layer),
		Detail:   `{"action":"manual_delete"}`,
	})
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
