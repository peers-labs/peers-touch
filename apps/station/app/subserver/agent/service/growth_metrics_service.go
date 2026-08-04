// Changelog:
// 2026-04-11 — Initial implementation: GrowthMetricsService for the Growth
//   Dashboard. Provides aggregate snapshot, paginated audit log, and feedback
//   recording backed by the agent database.
// 2026-04-11 — Major rework: replaced basic counter-only snapshot with the
//   full Growth Metrics and Quality Signals system. Now tracks operation
//   counters, usage signals, quality metrics (feedback ratio, error rate,
//   retry rate, review success rate), week-over-week growth trends, and a
//   composite growth score (-1 to 1). Added fire-and-forget RecordEvent,
//   enriched RecordFeedback with dual-write (UserFeedback + GrowthEvent),
//   GetFeedbackHistory, and time-windowed growth scoring.

package service

// GrowthMetricsService tracks, evaluates, and reports on the agent's
// self-improvement trajectory. It provides:
//
// 1. Operation Counters — how many memories/skills/reviews were created/modified/deleted
// 2. Usage Tracking — which memories/skills are actually used by the LLM in turns
// 3. Quality Signals — user feedback, retry rate, error rate, review success rate
// 4. Growth Score — composite metric indicating positive/negative growth trend
//
// Design rationale:
// - All writes are fire-and-forget (never fail the parent operation)
// - All reads query the DB aggregates directly (no in-memory cache)
// - The growth score uses a simple time-windowed approach comparing
//   the last 7 days vs the previous 7 days

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math"
	"time"

	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

// ---------------------------------------------------------------------------
// Event Type Constants
// ---------------------------------------------------------------------------

const (
	EventMemoryCreated    = "memory_created"
	EventMemoryReplaced   = "memory_replaced"
	EventMemoryRemoved    = "memory_removed"
	EventMemoryUsed       = "memory_used" // memory appeared in system prompt
	EventSkillCreated     = "skill_created"
	EventSkillPatched     = "skill_patched"
	EventSkillDeleted     = "skill_deleted"
	EventSkillUsed        = "skill_used" // skill was referenced by LLM
	EventReviewTriggered  = "review_triggered"
	EventReviewCompleted  = "review_completed"
	EventReviewFailed     = "review_failed"
	EventFeedbackPositive = "feedback_positive"
	EventFeedbackNegative = "feedback_negative"
	EventTurnCompleted    = "turn_completed"
	EventTurnFailed       = "turn_failed"
	EventTurnRetried      = "turn_retried"
)

// Category constants for GrowthEvent.Category field.
const (
	CategoryMemory   = "memory"
	CategorySkill    = "skill"
	CategoryReview   = "review"
	CategoryFeedback = "feedback"
	CategoryTurn     = "turn"
)

// growthWindowDays is the duration in days for each comparison window.
const growthWindowDays = 7

// ---------------------------------------------------------------------------
// GrowthSnapshot — read-only aggregate view of agent growth state
// ---------------------------------------------------------------------------

// GrowthSnapshot holds the current growth state for an agent, combining
// counts, quality signals from the last 7 days, growth trend comparisons
// against the previous 7 days, and a composite score.
type GrowthSnapshot struct {
	AgentID string `json:"agent_id"`

	// Counts — all-time totals
	TotalMemories int `json:"total_memories"`
	TotalSkills   int `json:"total_skills"`
	TotalReviews  int `json:"total_reviews"`
	TotalTurns    int `json:"total_turns"`

	// Quality (last 7 days)
	PositiveFeedback  int     `json:"positive_feedback"`
	NegativeFeedback  int     `json:"negative_feedback"`
	FeedbackRatio     float64 `json:"feedback_ratio"`      // positive / total, 0.0-1.0
	ErrorRate         float64 `json:"error_rate"`          // failed turns / total turns
	RetryRate         float64 `json:"retry_rate"`          // retried turns / total turns
	ReviewSuccessRate float64 `json:"review_success_rate"` // completed / triggered

	// Growth Trend (comparing this week vs last week)
	MemoryGrowthRate float64 `json:"memory_growth_rate"` // delta / prev, can be negative
	SkillGrowthRate  float64 `json:"skill_growth_rate"`
	QualityTrend     float64 `json:"quality_trend"` // delta feedback_ratio

	// Composite Score
	GrowthScore   float64 `json:"growth_score"`   // -1.0 (declining) to 1.0 (improving)
	GrowthVerdict string  `json:"growth_verdict"` // "improving", "stable", "declining"

	// Window
	WindowStart time.Time `json:"window_start"`
	WindowEnd   time.Time `json:"window_end"`
}

// windowMetrics holds aggregated metrics for a single time window,
// used internally to compare two consecutive periods.
type windowMetrics struct {
	memoriesCreated  int
	skillsCreated    int
	reviewsTriggered int
	reviewsCompleted int
	totalTurns       int
	turnsFailed      int
	turnsRetried     int
	positiveFeedback int
	negativeFeedback int
	totalFeedback    int
	feedbackRatio    float64
}

// ---------------------------------------------------------------------------
// GrowthMetricsService
// ---------------------------------------------------------------------------

// GrowthMetricsService is a stateless domain service that reads/writes
// growth events and feedback to the agent database. It has no in-memory
// state — every method resolves the DB handle via store.GetRDS.
type GrowthMetricsService struct {
	diagnosticService *GrowthDiagnosticService
}

func NewGrowthMetricsService() *GrowthMetricsService {
	return &GrowthMetricsService{}
}

// SetDiagnosticService injects the diagnostic service after construction
// (avoids circular dependency since both are created in agent.go).
func (s *GrowthMetricsService) SetDiagnosticService(diag *GrowthDiagnosticService) {
	s.diagnosticService = diag
}

// ---------------------------------------------------------------------------
// RecordEvent — fire-and-forget DB insert (never returns error)
// ---------------------------------------------------------------------------

// RecordEvent inserts a GrowthEvent into the agent_growth_events table.
// All errors are logged as warnings and silently swallowed so that the
// calling operation (e.g. memory create, turn complete) is never failed
// by metrics bookkeeping.
func (s *GrowthMetricsService) RecordEvent(
	ctx context.Context,
	agentID, eventType, category, target, details, outcome string,
) {
	db, err := s.getDB(ctx)
	if err != nil {
		logger.Warnf(ctx, "growth_metrics: failed to get db for RecordEvent: err=%v", err)
		return
	}

	record := &persistence.GrowthEvent{
		ID:        generateGrowthID("ge"),
		AgentID:   agentID,
		EventType: eventType,
		Category:  category,
		Target:    target,
		Details:   details,
		Outcome:   outcome,
		CreatedAt: time.Now(),
	}

	if createErr := db.WithContext(ctx).Create(record).Error; createErr != nil {
		logger.Warnf(ctx, "growth_metrics: failed to record event: agent_id=%s type=%s err=%v",
			agentID, eventType, createErr)
	}
}

// ---------------------------------------------------------------------------
// RecordFeedback — insert UserFeedback record + emit growth event
// ---------------------------------------------------------------------------

// RecordFeedback persists explicit user feedback (thumbs up/down) on an
// agent response. Like RecordEvent, errors are logged but never surfaced.
// A corresponding GrowthEvent is also emitted so the feedback signal
// appears in the unified event stream and contributes to window-based
// aggregations.
func (s *GrowthMetricsService) RecordFeedback(
	ctx context.Context,
	agentID, turnID, conversationID, signal string,
	comment *string,
) {
	db, err := s.getDB(ctx)
	if err != nil {
		logger.Warnf(ctx, "growth_metrics: failed to get db for RecordFeedback: err=%v", err)
		return
	}

	record := &persistence.UserFeedback{
		ID:             generateGrowthID("fb"),
		AgentID:        agentID,
		TurnID:         turnID,
		ConversationID: conversationID,
		Signal:         signal,
		Comment:        comment,
		CreatedAt:      time.Now(),
	}

	if createErr := db.WithContext(ctx).Create(record).Error; createErr != nil {
		logger.Warnf(ctx, "growth_metrics: failed to record feedback: agent_id=%s turn_id=%s err=%v",
			agentID, turnID, createErr)
	}

	// Also emit a growth event for the feedback signal so it appears in the
	// unified event stream and contributes to window-based aggregations.
	eventType := EventFeedbackPositive
	if signal == "negative" {
		eventType = EventFeedbackNegative
	}

	detailsMap := map[string]string{
		"turn_id":         turnID,
		"conversation_id": conversationID,
		"signal":          signal,
	}
	detailsJSON, _ := json.Marshal(detailsMap)

	s.RecordEvent(ctx, agentID, eventType, CategoryFeedback, turnID, string(detailsJSON), "success")

	// Trigger trust score adjustment and attribution analysis.
	if s.diagnosticService != nil {
		bgCtx := context.WithoutCancel(ctx)
		if signal == "negative" {
			go s.diagnosticService.AttributeNegativeFeedback(bgCtx, agentID, turnID)
		} else if signal == "positive" {
			go s.diagnosticService.AdjustMemoryTrustPositive(bgCtx, agentID, turnID)
		}
	}
}

// ---------------------------------------------------------------------------
// GetGrowthSnapshot — aggregate metrics into a single view
// ---------------------------------------------------------------------------

// GetGrowthSnapshot queries the database and returns a comprehensive snapshot
// of the agent's growth state, including all-time totals, recent quality
// signals, week-over-week trends, and a composite growth score.
func (s *GrowthMetricsService) GetGrowthSnapshot(ctx context.Context, agentID string) (*GrowthSnapshot, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	windowEnd := now
	windowStart := now.AddDate(0, 0, -growthWindowDays)
	prevWindowStart := now.AddDate(0, 0, -growthWindowDays*2)

	snap := &GrowthSnapshot{
		AgentID:     agentID,
		WindowStart: windowStart,
		WindowEnd:   windowEnd,
	}

	// --- All-time counts ---------------------------------------------------

	var memoryCount int64
	if countErr := db.WithContext(ctx).Model(&persistence.Memory{}).
		Where("agent_id = ?", agentID).
		Count(&memoryCount).Error; countErr != nil {
		logger.Warnf(ctx, "growth_metrics: count memories failed: agent_id=%s err=%v", agentID, countErr)
	}
	snap.TotalMemories = int(memoryCount)

	var skillCount int64
	if countErr := db.WithContext(ctx).Model(&persistence.Skill{}).
		Where("agent_id = ?", agentID).
		Count(&skillCount).Error; countErr != nil {
		logger.Warnf(ctx, "growth_metrics: count skills failed: agent_id=%s err=%v", agentID, countErr)
	}
	snap.TotalSkills = int(skillCount)

	var reviewCount int64
	if countErr := db.WithContext(ctx).Model(&persistence.Review{}).
		Where("agent_id = ?", agentID).
		Count(&reviewCount).Error; countErr != nil {
		logger.Warnf(ctx, "growth_metrics: count reviews failed: agent_id=%s err=%v", agentID, countErr)
	}
	snap.TotalReviews = int(reviewCount)

	var turnCount int64
	if countErr := db.WithContext(ctx).Model(&persistence.AgentTurn{}).
		Where("agent_id = ?", agentID).
		Count(&turnCount).Error; countErr != nil {
		logger.Warnf(ctx, "growth_metrics: count turns failed: agent_id=%s err=%v", agentID, countErr)
	}
	snap.TotalTurns = int(turnCount)

	// --- Feedback quality (last 7 days) ------------------------------------

	var posCount, negCount int64

	db.WithContext(ctx).Model(&persistence.UserFeedback{}).
		Where("agent_id = ? AND signal = ? AND created_at >= ?", agentID, "positive", windowStart).
		Count(&posCount)

	db.WithContext(ctx).Model(&persistence.UserFeedback{}).
		Where("agent_id = ? AND signal = ? AND created_at >= ?", agentID, "negative", windowStart).
		Count(&negCount)

	snap.PositiveFeedback = int(posCount)
	snap.NegativeFeedback = int(negCount)

	totalFeedback := posCount + negCount
	if totalFeedback > 0 {
		snap.FeedbackRatio = float64(posCount) / float64(totalFeedback)
	}

	// --- Window metrics (current 7 days + previous 7 days) -----------------

	currentWindow := s.queryWindowMetrics(ctx, db, agentID, windowStart, windowEnd)
	previousWindow := s.queryWindowMetrics(ctx, db, agentID, prevWindowStart, windowStart)

	// Error rate / retry rate from current window
	if currentWindow.totalTurns > 0 {
		snap.ErrorRate = float64(currentWindow.turnsFailed) / float64(currentWindow.totalTurns)
		snap.RetryRate = float64(currentWindow.turnsRetried) / float64(currentWindow.totalTurns)
	}

	// Review success rate from current window
	if currentWindow.reviewsTriggered > 0 {
		snap.ReviewSuccessRate = float64(currentWindow.reviewsCompleted) / float64(currentWindow.reviewsTriggered)
	}

	// --- Growth trends (week-over-week) ------------------------------------

	snap.MemoryGrowthRate = growthRate(currentWindow.memoriesCreated, previousWindow.memoriesCreated)
	snap.SkillGrowthRate = growthRate(currentWindow.skillsCreated, previousWindow.skillsCreated)
	snap.QualityTrend = currentWindow.feedbackRatio - previousWindow.feedbackRatio

	// --- Memory trust health -----------------------------------------------

	memoryTrustHealth := s.computeMemoryTrustHealth(ctx, db, agentID)

	// --- Composite growth score --------------------------------------------

	snap.GrowthScore = computeGrowthScore(currentWindow, previousWindow, memoryTrustHealth)
	snap.GrowthVerdict = verdictFromScore(snap.GrowthScore)

	logger.Infof(ctx, "growth_metrics: snapshot built for agent_id=%s score=%.3f verdict=%s",
		agentID, snap.GrowthScore, snap.GrowthVerdict)

	// Trigger diagnostic report generation when growth is declining.
	// Use context.WithoutCancel so the background goroutine survives
	// after the HTTP request returns and its context is cancelled.
	if snap.GrowthVerdict == "declining" && s.diagnosticService != nil {
		bgCtx := context.WithoutCancel(ctx)
		go s.diagnosticService.GenerateDiagnosticReport(bgCtx, agentID, snap.GrowthScore, snap.GrowthVerdict)
	}

	return snap, nil
}

// ---------------------------------------------------------------------------
// GetAuditLog — paginated event history
// ---------------------------------------------------------------------------

// GetAuditLog returns a paginated list of GrowthEvent records for the given
// agent, ordered by created_at descending (most recent first). The second
// return value is the total count of events for pagination.
func (s *GrowthMetricsService) GetAuditLog(
	ctx context.Context,
	agentID string,
	limit, offset int,
) ([]persistence.GrowthEvent, int64, error) {

	db, err := s.getDB(ctx)
	if err != nil {
		return nil, 0, err
	}

	var total int64
	if countErr := db.WithContext(ctx).Model(&persistence.GrowthEvent{}).
		Where("agent_id = ?", agentID).
		Count(&total).Error; countErr != nil {
		return nil, 0, fmt.Errorf("growth_metrics: count audit log failed: %w", countErr)
	}

	var events []persistence.GrowthEvent
	if queryErr := db.WithContext(ctx).
		Where("agent_id = ?", agentID).
		Order("created_at DESC").
		Limit(limit).
		Offset(offset).
		Find(&events).Error; queryErr != nil {
		return nil, 0, fmt.Errorf("growth_metrics: query audit log failed: %w", queryErr)
	}

	return events, total, nil
}

// ---------------------------------------------------------------------------
// GetFeedbackHistory — paginated feedback history
// ---------------------------------------------------------------------------

// GetFeedbackHistory returns a paginated list of UserFeedback records for the
// given agent, ordered by created_at descending. The second return value is
// the total count for pagination.
func (s *GrowthMetricsService) GetFeedbackHistory(
	ctx context.Context,
	agentID string,
	limit, offset int,
) ([]persistence.UserFeedback, int64, error) {

	db, err := s.getDB(ctx)
	if err != nil {
		return nil, 0, err
	}

	var total int64
	if countErr := db.WithContext(ctx).Model(&persistence.UserFeedback{}).
		Where("agent_id = ?", agentID).
		Count(&total).Error; countErr != nil {
		return nil, 0, fmt.Errorf("growth_metrics: count feedback history failed: %w", countErr)
	}

	var records []persistence.UserFeedback
	if queryErr := db.WithContext(ctx).
		Where("agent_id = ?", agentID).
		Order("created_at DESC").
		Limit(limit).
		Offset(offset).
		Find(&records).Error; queryErr != nil {
		return nil, 0, fmt.Errorf("growth_metrics: query feedback history failed: %w", queryErr)
	}

	return records, total, nil
}

// ---------------------------------------------------------------------------
// queryWindowMetrics — aggregate growth events within a time window
// ---------------------------------------------------------------------------

// queryWindowMetrics counts growth events by type within [start, end) for
// the given agent and returns a windowMetrics struct.
func (s *GrowthMetricsService) queryWindowMetrics(
	ctx context.Context,
	db *gorm.DB,
	agentID string,
	start, end time.Time,
) *windowMetrics {

	wm := &windowMetrics{}

	// Helper: count events matching a specific event_type within the window.
	countByType := func(eventType string) int {
		var c int64
		db.WithContext(ctx).Model(&persistence.GrowthEvent{}).
			Where("agent_id = ? AND event_type = ? AND created_at >= ? AND created_at < ?",
				agentID, eventType, start, end).
			Count(&c)
		return int(c)
	}

	wm.memoriesCreated = countByType(EventMemoryCreated)
	wm.skillsCreated = countByType(EventSkillCreated)
	wm.reviewsTriggered = countByType(EventReviewTriggered)
	wm.reviewsCompleted = countByType(EventReviewCompleted)
	wm.totalTurns = countByType(EventTurnCompleted) + countByType(EventTurnFailed)
	wm.turnsFailed = countByType(EventTurnFailed)
	wm.turnsRetried = countByType(EventTurnRetried)
	wm.positiveFeedback = countByType(EventFeedbackPositive)
	wm.negativeFeedback = countByType(EventFeedbackNegative)

	wm.totalFeedback = wm.positiveFeedback + wm.negativeFeedback
	if wm.totalFeedback > 0 {
		wm.feedbackRatio = float64(wm.positiveFeedback) / float64(wm.totalFeedback)
	}

	return wm
}

// ---------------------------------------------------------------------------
// computeGrowthScore — composite -1.0 to 1.0 score
// ---------------------------------------------------------------------------

// computeGrowthScore combines multiple signals into a single -1 to 1 score.
//
// Weights:
//   - feedback_ratio        40%
//   - review_success        20%
//   - error_rate_improvement 20%
//   - knowledge_growth      20%
//
// computeMemoryTrustHealth returns the average TrustScore of all memories
// for the given agent. Returns 0.5 (neutral) if no memories exist.
func (s *GrowthMetricsService) computeMemoryTrustHealth(
	ctx context.Context,
	db *gorm.DB,
	agentID string,
) float64 {
	var result struct {
		Avg   float64
		Count int64
	}
	db.WithContext(ctx).
		Model(&persistence.Memory{}).
		Where("agent_id = ?", agentID).
		Select("COALESCE(AVG(trust_score), 0.5) as avg, COUNT(*) as count").
		Scan(&result)

	if result.Count == 0 {
		return 0.5
	}
	return result.Avg
}

func computeGrowthScore(current, previous *windowMetrics, memoryTrustHealth float64) float64 {
	score := 0.0

	// Turn success rate delta (25%) — improvement in success rate week-over-week.
	if previous.totalTurns > 0 && current.totalTurns > 0 {
		prevSuccessRate := 1.0 - float64(previous.turnsFailed)/float64(previous.totalTurns)
		currSuccessRate := 1.0 - float64(current.turnsFailed)/float64(current.totalTurns)
		delta := currSuccessRate - prevSuccessRate
		score += 0.25 * math.Min(1, math.Max(-1, delta*5))
	}

	// Feedback ratio delta (30%) — improvement in positive feedback ratio.
	if current.totalFeedback > 0 || previous.totalFeedback > 0 {
		delta := current.feedbackRatio - previous.feedbackRatio
		score += 0.30 * math.Min(1, math.Max(-1, delta*3))
	}

	// Error rate reduction (20%) — lower error rate is better.
	if previous.totalTurns > 0 && current.totalTurns > 0 {
		prevErrRate := float64(previous.turnsFailed) / float64(previous.totalTurns)
		currErrRate := float64(current.turnsFailed) / float64(current.totalTurns)
		improvement := prevErrRate - currErrRate
		score += 0.20 * math.Min(1, math.Max(-1, improvement*10))
	}

	// Memory trust health (25%) — proportion of high-trust memories.
	// memoryTrustHealth is [0, 1]; map to [-1, 1] with 0.5 as neutral.
	score += 0.25 * (memoryTrustHealth - 0.5) * 2

	return math.Min(1, math.Max(-1, score))
}

// ---------------------------------------------------------------------------
// verdictFromScore — map numeric score to human-readable verdict
// ---------------------------------------------------------------------------

func verdictFromScore(score float64) string {
	switch {
	case score > 0.15:
		return "improving"
	case score < -0.15:
		return "declining"
	default:
		return "stable"
	}
}

// ---------------------------------------------------------------------------
// growthRate — safe division for week-over-week growth
// ---------------------------------------------------------------------------

func growthRate(current, previous int) float64 {
	if previous == 0 {
		if current > 0 {
			return 1.0 // went from nothing to something — treat as 100% growth
		}
		return 0.0
	}
	return float64(current-previous) / float64(previous)
}

// ---------------------------------------------------------------------------
// generateGrowthID — crypto/rand-based unique ID generator
// ---------------------------------------------------------------------------

// generateGrowthID creates a unique identifier with the given prefix
// (e.g. "ge", "fb"). Uses crypto/rand to avoid collisions under concurrent
// requests, matching the pattern used by turn_service.generateID.
func generateGrowthID(prefix string) string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%s_%x", prefix, b)
}

// ---------------------------------------------------------------------------
// getDB — resolve GORM handle for the agent database
// ---------------------------------------------------------------------------

func (s *GrowthMetricsService) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName(agentDBName))
	if err != nil {
		return nil, fmt.Errorf("growth_metrics: failed to open agent db: %w", err)
	}
	return db, nil
}
