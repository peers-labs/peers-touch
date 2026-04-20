// Changelog:
// 2026-04-11 — Initial implementation: GrowthDiagnosticService for feedback
//   attribution analysis, suspected item tracking, and diagnostic report
//   generation. Connects the growth metrics layer (detection) to the recovery
//   layer (user-driven rollback/freeze/toggle) via attribution + notification.

package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const (
	// suspectedThreshold is the minimum number of negative feedback
	// attributions before an item is promoted from "watching" to "suspected".
	suspectedThreshold = 3

	// diagnosticCooldown prevents generating diagnostic reports too
	// frequently. At most one report per agent per cooldown window.
	diagnosticCooldown = 6 * time.Hour
)

// Suspected item statuses.
const (
	SuspectedStatusWatching  = "watching"
	SuspectedStatusSuspected = "suspected"
	SuspectedStatusCleared   = "cleared"
)

// Recommended actions for suspected items in diagnostic reports.
const (
	ActionRollbackMemory = "rollback_memory"
	ActionFreezeMemory   = "freeze_memory"
	ActionDeleteMemory   = "delete_memory"
	ActionRollbackSkill  = "rollback_skill"
	ActionDisableSkill   = "disable_skill"
)

// ---------------------------------------------------------------------------
// DiagnosticSuspect — output structure for diagnostic reports
// ---------------------------------------------------------------------------

// DiagnosticSuspect describes a single suspected item in a diagnostic report,
// including the recommended action for user review.
type DiagnosticSuspect struct {
	ItemType          string `json:"item_type"`
	ItemID            string `json:"item_id"`
	ItemContent       string `json:"item_content"`
	NegativeCount     int    `json:"negative_count"`
	RecommendedAction string `json:"recommended_action"`
	Reason            string `json:"reason"`
}

// DiagnosticResult is the full diagnostic report returned to the handler.
type DiagnosticResult struct {
	ReportID      string              `json:"report_id"`
	AgentID       string              `json:"agent_id"`
	GrowthScore   float64             `json:"growth_score"`
	GrowthVerdict string              `json:"growth_verdict"`
	Suspects      []DiagnosticSuspect `json:"suspects"`
	Summary       string              `json:"summary"`
	CreatedAt     time.Time           `json:"created_at"`
}

// ---------------------------------------------------------------------------
// GrowthDiagnosticService
// ---------------------------------------------------------------------------

// GrowthDiagnosticService connects the growth metrics layer (detection of
// quality degradation) to the recovery layer (user-driven rollback/freeze/
// toggle) via a two-stage pipeline:
//
//  1. Attribution — when negative feedback arrives, identify which memories
//     and skills were active during that turn and record attributions.
//  2. Diagnosis — when GrowthScore enters "declining", collect all suspected
//     items and generate a report with recommended actions for the user.
//
// The service never takes automatic recovery actions. All actions are
// recommendations surfaced through the diagnostic REST endpoint for user
// decision.
type GrowthDiagnosticService struct{}

func NewGrowthDiagnosticService() *GrowthDiagnosticService {
	return &GrowthDiagnosticService{}
}

// ---------------------------------------------------------------------------
// AttributeNegativeFeedback — stage 1: feedback → attribution
// ---------------------------------------------------------------------------

// AttributeNegativeFeedback is called when a user gives negative feedback
// on a turn. It queries the TurnTrace to find which memories and skills
// were active during the turn, then upserts SuspectedItem records for
// each one, incrementing their negative counters.
//
// This is fire-and-forget: all errors are logged but never surfaced.
func (s *GrowthDiagnosticService) AttributeNegativeFeedback(
	ctx context.Context,
	agentID, turnID string,
) {
	db, err := s.getDB(ctx)
	if err != nil {
		logger.Warnf(ctx, "diagnostic: db access failed for attribution: err=%v", err)
		return
	}

	// Step 1: Load the turn trace to find which memories/skills were used.
	var trace persistence.TurnTrace
	if traceErr := db.WithContext(ctx).
		Where("turn_id = ?", turnID).
		First(&trace).Error; traceErr != nil {
		logger.Warnf(ctx, "diagnostic: turn trace not found for attribution: turn_id=%s err=%v", turnID, traceErr)
		return
	}

	// Step 2: Find the memory snapshot used during this turn via the snapshot hash.
	// Look for a snapshot taken close to the turn's creation time for this agent.
	var turn persistence.AgentTurn
	if turnErr := db.WithContext(ctx).
		Where("id = ?", turnID).
		First(&turn).Error; turnErr != nil {
		logger.Warnf(ctx, "diagnostic: turn not found for attribution: turn_id=%s err=%v", turnID, turnErr)
		return
	}

	memoryCount := 0

	if trace.MemorySnapshotHash != nil && *trace.MemorySnapshotHash != "" {
		// Find the snapshot closest to this turn's start time.
		var snapshot persistence.MemorySnapshot
		snapshotErr := db.WithContext(ctx).
			Where("agent_id = ? AND created_at <= ?", agentID, turn.StartedAt).
			Order("created_at DESC").
			First(&snapshot).Error

		if snapshotErr == nil && snapshot.Content != "" {
			// Parse the snapshot to find specific memory IDs that were active.
			var snapshotItems []struct {
				ID      string `json:"id"`
				Content string `json:"content"`
			}
			if jsonErr := json.Unmarshal([]byte(snapshot.Content), &snapshotItems); jsonErr == nil {
				for _, item := range snapshotItems {
					s.upsertSuspectedItem(ctx, db, agentID, "memory", item.ID, item.Content, turnID)
					s.adjustMemoryTrustScore(ctx, db, item.ID, -1)
					memoryCount++
				}
			}
		}
	}

	// Fallback: if no snapshot found, attribute to current memories.
	if memoryCount == 0 {
		var memories []persistence.Memory
		db.WithContext(ctx).
			Where("agent_id = ?", agentID).
			Find(&memories)
		for _, mem := range memories {
			s.upsertSuspectedItem(ctx, db, agentID, "memory", mem.ID, mem.Content, turnID)
			s.adjustMemoryTrustScore(ctx, db, mem.ID, -1)
			memoryCount++
		}
	}

	// Step 3: Attribute to skills loaded during this turn (from TurnTrace.SkillsLoaded).
	skillCount := 0
	if len(trace.SkillsLoaded) > 0 {
		var skillNames []string
		if jsonErr := json.Unmarshal(trace.SkillsLoaded, &skillNames); jsonErr == nil {
			for _, name := range skillNames {
				var skill persistence.Skill
				if skillErr := db.WithContext(ctx).
					Where("agent_id = ? AND name = ?", agentID, name).
					First(&skill).Error; skillErr == nil {
					s.upsertSuspectedItem(ctx, db, agentID, "skill", skill.ID, skill.Name, turnID)
					skillCount++
				}
			}
		}
	}

	logger.Infof(ctx, "diagnostic: negative feedback attributed: agent_id=%s turn_id=%s memories=%d skills=%d",
		agentID, turnID, memoryCount, skillCount)
}

// upsertSuspectedItem creates or updates a SuspectedItem record.
// If the item already exists, increment its negative count and append the turn ID.
// If negative count reaches the threshold, promote status to "suspected".
func (s *GrowthDiagnosticService) upsertSuspectedItem(
	ctx context.Context,
	db *gorm.DB,
	agentID, itemType, itemID, itemContent, turnID string,
) {
	var existing persistence.SuspectedItem
	err := db.WithContext(ctx).
		Where("agent_id = ? AND item_type = ? AND item_id = ?", agentID, itemType, itemID).
		First(&existing).Error

	now := time.Now()

	if err == nil {
		// Existing record — increment and possibly promote.
		newCount := existing.NegativeCount + 1

		var turnIDs []string
		_ = json.Unmarshal([]byte(existing.AttributedTurnIDs), &turnIDs)
		turnIDs = append(turnIDs, turnID)
		turnIDsJSON, _ := json.Marshal(turnIDs)

		newStatus := existing.Status
		if newCount >= suspectedThreshold && existing.Status == SuspectedStatusWatching {
			newStatus = SuspectedStatusSuspected
			logger.Infof(ctx, "diagnostic: item promoted to suspected: agent_id=%s type=%s id=%s count=%d",
				agentID, itemType, itemID, newCount)
		}

		db.WithContext(ctx).
			Model(&persistence.SuspectedItem{}).
			Where("id = ?", existing.ID).
			Updates(map[string]interface{}{
				"negative_count":      newCount,
				"attributed_turn_ids": string(turnIDsJSON),
				"status":              newStatus,
				"last_attributed_at":  now,
				"updated_at":          now,
			})

		return
	}

	// New record — create with initial count = 1.
	turnIDsJSON, _ := json.Marshal([]string{turnID})
	record := persistence.SuspectedItem{
		ID:                generateID("si"),
		AgentID:           agentID,
		ItemType:          itemType,
		ItemID:            itemID,
		ItemContent:       itemContent,
		NegativeCount:     1,
		AttributedTurnIDs: string(turnIDsJSON),
		Status:            SuspectedStatusWatching,
		FirstAttributedAt: now,
		LastAttributedAt:  now,
		CreatedAt:         now,
		UpdatedAt:         now,
	}

	if createErr := db.WithContext(ctx).Create(&record).Error; createErr != nil {
		logger.Warnf(ctx, "diagnostic: failed to create suspected item: type=%s id=%s err=%v",
			itemType, itemID, createErr)
	}
}

// adjustMemoryTrustScore adjusts the TrustScore of a memory item.
// direction: -1 for negative feedback, +1 for positive feedback.
// Uses asymmetric decay: +0.05 for positive, -0.10 for negative.
func (s *GrowthDiagnosticService) adjustMemoryTrustScore(
	ctx context.Context,
	db *gorm.DB,
	memoryID string,
	direction int,
) {
	var mem persistence.Memory
	if err := db.WithContext(ctx).Where("id = ?", memoryID).First(&mem).Error; err != nil {
		return
	}

	delta := domain.TrustScorePositiveDelta
	countField := "helpful_count"
	if direction < 0 {
		delta = -domain.TrustScoreNegativeDelta
		countField = "harmful_count"
	}

	newScore := mem.TrustScore + delta
	if newScore > 1.0 {
		newScore = 1.0
	}
	if newScore < 0.0 {
		newScore = 0.0
	}

	db.WithContext(ctx).
		Model(&persistence.Memory{}).
		Where("id = ?", memoryID).
		Updates(map[string]interface{}{
			"trust_score": newScore,
			countField:    gorm.Expr(countField + " + 1"),
			"updated_at":  time.Now(),
		})
}

// AdjustMemoryTrustPositive applies positive trust adjustment to memories
// used during a turn that received positive feedback.
func (s *GrowthDiagnosticService) AdjustMemoryTrustPositive(
	ctx context.Context,
	agentID, turnID string,
) {
	db, err := s.getDB(ctx)
	if err != nil {
		return
	}

	var trace persistence.TurnTrace
	if traceErr := db.WithContext(ctx).
		Where("turn_id = ?", turnID).
		First(&trace).Error; traceErr != nil {
		return
	}

	var turn persistence.AgentTurn
	if turnErr := db.WithContext(ctx).
		Where("id = ?", turnID).
		First(&turn).Error; turnErr != nil {
		return
	}

	if trace.MemorySnapshotHash != nil && *trace.MemorySnapshotHash != "" {
		var snapshot persistence.MemorySnapshot
		snapshotErr := db.WithContext(ctx).
			Where("agent_id = ? AND created_at <= ?", agentID, turn.StartedAt).
			Order("created_at DESC").
			First(&snapshot).Error

		if snapshotErr == nil && snapshot.Content != "" {
			var items []struct {
				ID string `json:"id"`
			}
			if jsonErr := json.Unmarshal([]byte(snapshot.Content), &items); jsonErr == nil {
				for _, item := range items {
					s.adjustMemoryTrustScore(ctx, db, item.ID, +1)
				}
			}
		}
	}
}

// ---------------------------------------------------------------------------
// GenerateDiagnosticReport — stage 2: suspected items → report
// ---------------------------------------------------------------------------

// GenerateDiagnosticReport collects all items with status "suspected" for
// the given agent and generates a diagnostic report with recommended
// actions. Returns nil if no suspected items exist or if a report was
// generated within the cooldown window.
func (s *GrowthDiagnosticService) GenerateDiagnosticReport(
	ctx context.Context,
	agentID string,
	growthScore float64,
	growthVerdict string,
) *DiagnosticResult {

	db, err := s.getDB(ctx)
	if err != nil {
		logger.Warnf(ctx, "diagnostic: db access failed for report generation: err=%v", err)
		return nil
	}

	// Check cooldown — prevent report generation spam.
	var lastReport persistence.DiagnosticReport
	cooldownCutoff := time.Now().Add(-diagnosticCooldown)
	if dbErr := db.WithContext(ctx).
		Where("agent_id = ? AND created_at > ?", agentID, cooldownCutoff).
		Order("created_at DESC").
		First(&lastReport).Error; dbErr == nil {
		logger.Infof(ctx, "diagnostic: report skipped (cooldown active): agent_id=%s last_report=%s",
			agentID, lastReport.CreatedAt.Format(time.RFC3339))
		return nil
	}

	// Collect all items that are "suspected" or "watching" with high counts.
	var suspects []persistence.SuspectedItem
	db.WithContext(ctx).
		Where("agent_id = ? AND status IN ?", agentID, []string{SuspectedStatusSuspected, SuspectedStatusWatching}).
		Where("negative_count >= ?", 2).
		Order("negative_count DESC").
		Limit(20).
		Find(&suspects)

	if len(suspects) == 0 {
		logger.Infof(ctx, "diagnostic: no suspected items found: agent_id=%s", agentID)
		return nil
	}

	// Build diagnostic suspects with recommended actions.
	diagnosticSuspects := make([]DiagnosticSuspect, 0, len(suspects))
	for _, item := range suspects {
		action, reason := s.recommendAction(item)
		diagnosticSuspects = append(diagnosticSuspects, DiagnosticSuspect{
			ItemType:          item.ItemType,
			ItemID:            item.ItemID,
			ItemContent:       truncateDiagContent(item.ItemContent, 200),
			NegativeCount:     item.NegativeCount,
			RecommendedAction: action,
			Reason:            reason,
		})
	}

	// Build summary.
	memCount, skillCount := 0, 0
	for _, s := range diagnosticSuspects {
		if s.ItemType == "memory" {
			memCount++
		} else {
			skillCount++
		}
	}
	summary := fmt.Sprintf(
		"Growth score %.2f (%s). Found %d suspected items (%d memories, %d skills) "+
			"associated with negative user feedback. Review and take action via the Growth Dashboard.",
		growthScore, growthVerdict, len(diagnosticSuspects), memCount, skillCount,
	)

	// Persist report.
	suspectsJSON, _ := json.Marshal(diagnosticSuspects)
	now := time.Now()
	reportID := generateID("diag")

	report := persistence.DiagnosticReport{
		ID:            reportID,
		AgentID:       agentID,
		GrowthScore:   growthScore,
		GrowthVerdict: growthVerdict,
		SuspectedJSON: string(suspectsJSON),
		Summary:       summary,
		CreatedAt:     now,
	}

	if createErr := db.WithContext(ctx).Create(&report).Error; createErr != nil {
		logger.Warnf(ctx, "diagnostic: failed to persist report: agent_id=%s err=%v", agentID, createErr)
	} else {
		logger.Infof(ctx, "diagnostic: report generated: id=%s agent_id=%s suspects=%d score=%.2f",
			reportID, agentID, len(diagnosticSuspects), growthScore)
	}

	return &DiagnosticResult{
		ReportID:      reportID,
		AgentID:       agentID,
		GrowthScore:   growthScore,
		GrowthVerdict: growthVerdict,
		Suspects:      diagnosticSuspects,
		Summary:       summary,
		CreatedAt:     now,
	}
}

// ---------------------------------------------------------------------------
// GetLatestDiagnostic — read the most recent report for an agent
// ---------------------------------------------------------------------------

// GetLatestDiagnostic returns the most recent diagnostic report for the
// given agent. Returns nil if no report exists.
func (s *GrowthDiagnosticService) GetLatestDiagnostic(
	ctx context.Context,
	agentID string,
) (*DiagnosticResult, error) {

	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var report persistence.DiagnosticReport
	if dbErr := db.WithContext(ctx).
		Where("agent_id = ?", agentID).
		Order("created_at DESC").
		First(&report).Error; dbErr != nil {
		return nil, nil // no report found is not an error
	}

	var suspects []DiagnosticSuspect
	_ = json.Unmarshal([]byte(report.SuspectedJSON), &suspects)

	return &DiagnosticResult{
		ReportID:      report.ID,
		AgentID:       report.AgentID,
		GrowthScore:   report.GrowthScore,
		GrowthVerdict: report.GrowthVerdict,
		Suspects:      suspects,
		Summary:       report.Summary,
		CreatedAt:     report.CreatedAt,
	}, nil
}

// ---------------------------------------------------------------------------
// ListSuspectedItems — return all active suspected items for an agent
// ---------------------------------------------------------------------------

// ListSuspectedItems returns all SuspectedItem records that are not cleared
// for the given agent, ordered by negative_count descending.
func (s *GrowthDiagnosticService) ListSuspectedItems(
	ctx context.Context,
	agentID string,
) ([]persistence.SuspectedItem, error) {

	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var items []persistence.SuspectedItem
	if dbErr := db.WithContext(ctx).
		Where("agent_id = ? AND status != ?", agentID, SuspectedStatusCleared).
		Order("negative_count DESC").
		Find(&items).Error; dbErr != nil {
		return nil, fmt.Errorf("diagnostic: failed to list suspected items: %w", dbErr)
	}

	return items, nil
}

// ---------------------------------------------------------------------------
// ClearSuspectedItem — mark a suspected item as cleared after user action
// ---------------------------------------------------------------------------

// ClearSuspectedItem marks a SuspectedItem as "cleared" after the user has
// taken action (rollback, freeze, delete, disable, etc.). This removes it
// from future diagnostic reports.
func (s *GrowthDiagnosticService) ClearSuspectedItem(
	ctx context.Context,
	agentID, itemID string,
) error {

	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	result := db.WithContext(ctx).
		Model(&persistence.SuspectedItem{}).
		Where("agent_id = ? AND item_id = ?", agentID, itemID).
		Update("status", SuspectedStatusCleared)

	if result.Error != nil {
		return fmt.Errorf("diagnostic: failed to clear suspected item: %w", result.Error)
	}

	logger.Infof(ctx, "diagnostic: suspected item cleared: agent_id=%s item_id=%s", agentID, itemID)
	return nil
}

// ---------------------------------------------------------------------------
// recommendAction — determine what action to recommend for a suspected item
// ---------------------------------------------------------------------------

func (s *GrowthDiagnosticService) recommendAction(item persistence.SuspectedItem) (action, reason string) {
	switch item.ItemType {
	case "memory":
		if item.NegativeCount >= 5 {
			return ActionDeleteMemory, fmt.Sprintf(
				"Memory received %d negative attributions. Recommend deletion or rollback to a snapshot before it was created.",
				item.NegativeCount,
			)
		}
		if item.NegativeCount >= suspectedThreshold {
			return ActionFreezeMemory, fmt.Sprintf(
				"Memory received %d negative attributions. Recommend freezing to prevent further modifications while investigating.",
				item.NegativeCount,
			)
		}
		return ActionRollbackMemory, fmt.Sprintf(
			"Memory received %d negative attributions. Consider reviewing its content.",
			item.NegativeCount,
		)

	case "skill":
		if item.NegativeCount >= 5 {
			return ActionDisableSkill, fmt.Sprintf(
				"Skill received %d negative attributions. Recommend disabling until root cause is identified.",
				item.NegativeCount,
			)
		}
		return ActionRollbackSkill, fmt.Sprintf(
			"Skill received %d negative attributions. Consider rolling back to a previous version.",
			item.NegativeCount,
		)
	}

	return "", ""
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func truncateDiagContent(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

func (s *GrowthDiagnosticService) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName(agentDBName))
	if err != nil {
		return nil, fmt.Errorf("diagnostic: failed to open agent db: %w", err)
	}
	return db, nil
}
