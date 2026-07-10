package service

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

// AcceptancePredicateEvaluator evaluates Station-owned deterministic predicates.
type AcceptancePredicateEvaluator struct{}

func NewAcceptancePredicateEvaluator() *AcceptancePredicateEvaluator {
	return &AcceptancePredicateEvaluator{}
}

func (e *AcceptancePredicateEvaluator) EvaluateTask(ctx context.Context, taskID string) error {
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return err
	}
	return e.EvaluateTaskTx(ctx, db, taskID)
}

func (e *AcceptancePredicateEvaluator) EvaluateTaskTx(ctx context.Context, db *gorm.DB, taskID string) error {
	if e == nil {
		e = NewAcceptancePredicateEvaluator()
	}
	taskID = strings.TrimSpace(taskID)
	var taskCount int64
	if err := db.WithContext(ctx).Model(&persistence.CollaborationTask{}).Where("id = ?", taskID).Count(&taskCount).Error; err != nil {
		return err
	}
	if taskCount == 0 {
		return nil
	}
	var predicates []persistence.AcceptancePredicate
	if err := db.WithContext(ctx).
		Where("task_id = ?", taskID).
		Order("source_event_seq ASC, created_at ASC").
		Find(&predicates).Error; err != nil {
		return err
	}
	for i := range predicates {
		predicate := predicates[i]
		if predicate.Level == "L2" {
			continue
		}
		passed := e.evaluatePredicate(ctx, db, predicate)
		if err := db.WithContext(ctx).Model(&persistence.AcceptancePredicate{}).
			Where("predicate_id = ?", predicate.PredicateID).
			Updates(map[string]interface{}{
				"last_eval":  passed,
				"updated_at": time.Now().UTC(),
			}).Error; err != nil {
			return err
		}
	}
	return nil
}

func (e *AcceptancePredicateEvaluator) evaluatePredicate(ctx context.Context, db *gorm.DB, predicate persistence.AcceptancePredicate) bool {
	normalized := normalizeAcceptancePredicateExpr(predicate.Expr)
	switch normalized {
	case "no_open_blockers(project)", "no_open_blockers(milestone)", "no_open_blockers(scope)", "no_open_blockers":
		return e.noOpenBlockers(ctx, db, predicate.TaskID)
	case "all(binproject.open_blockers:b.statein{resolved,waived})",
		"all(binmilestone.open_blockers:b.statein{resolved,waived})",
		"all(binscope.open_blockers:b.statein{resolved,waived})",
		"all(binopen_blockers:b.statein{resolved,waived})":
		return e.noOpenBlockers(ctx, db, predicate.TaskID)
	case "all_milestones.state==accepted", "all_milestones.status==accepted",
		"all(minmilestones:m.state==accepted)", "all(minmilestones:m.status==accepted)",
		"all(tintasks:t.state==accepted)", "all(tintasks:t.status==accepted)":
		return e.rootMilestoneAccepted(ctx, db, predicate.TaskID)
	case "all_residual_risks.statein{logged,downgraded,follow_up}", "all(rinresidual_risks:r.statein{logged,downgraded,follow_up})":
		return e.residualRisksLogged(ctx, db, predicate.TaskID)
	case "goal_owner_signoff==true":
		return e.goalOwnerSignoff(ctx, db, predicate.TaskID)
	case "memory_candidates.generated==true":
		return e.memoryCandidatesGenerated(ctx, db, predicate.TaskID)
	case "all(p incontract.acceptancewherep.levelin{l0,l1}:p.eval()==true)",
		"all(pincontract.acceptancewherep.levelin{l0,l1}:p.eval()==true)",
		"all(pinmilestone.acceptancewherelevelin{l0,l1}:p.eval()==true)",
		"all(pinmilestone.acceptancewherep.levelin{l0,l1}:p.eval()==true)":
		return e.automatedPredicatesPassed(ctx, db, predicate.TaskID, predicate.PredicateID)
	case "all(pincontract.acceptancewherep.level==l2:p.human_signoff==true)",
		"all(pinmilestone.acceptancewherelevel==l2:p.human_signoff==true)",
		"all(pinmilestone.acceptancewherep.level==l2:p.human_signoff==true)":
		return e.humanPredicatesSigned(ctx, db, predicate.TaskID)
	case "all(gingate_planwhereg.blocking_level==block:gate_result(g).passed)",
		"all(gingateswhereg.blocking_level==block:gate_result(g).passed)",
		"all_blocking_gates.passed":
		return e.blockingGatesPassed(ctx, db, predicate.TaskID)
	default:
		return e.gatePassed(ctx, db, predicate.TaskID, normalized)
	}
}

func normalizeAcceptancePredicateExpr(expr string) string {
	normalized := strings.ToLower(strings.TrimSpace(expr))
	normalized = strings.ReplaceAll(normalized, " ", "")
	normalized = strings.ReplaceAll(normalized, "\t", "")
	normalized = strings.ReplaceAll(normalized, "\n", "")
	return normalized
}

func (e *AcceptancePredicateEvaluator) noOpenBlockers(ctx context.Context, db *gorm.DB, taskID string) bool {
	var blockers []persistence.ProjectBlocker
	if err := db.WithContext(ctx).Where("task_id = ?", taskID).Find(&blockers).Error; err != nil {
		return false
	}
	for _, blocker := range blockers {
		state := strings.ToLower(strings.TrimSpace(blocker.State))
		if state != "resolved" && state != "waived" {
			return false
		}
	}
	return true
}

func (e *AcceptancePredicateEvaluator) rootMilestoneAccepted(ctx context.Context, db *gorm.DB, taskID string) bool {
	var task persistence.CollaborationTask
	if err := db.WithContext(ctx).Where("id = ?", taskID).First(&task).Error; err != nil {
		return false
	}
	var blockers []persistence.ProjectBlocker
	if err := db.WithContext(ctx).Where("task_id = ?", taskID).Find(&blockers).Error; err != nil {
		return false
	}
	if !projectStateMachineNoOpenBlockers(blockers) {
		return false
	}
	var nodes []persistence.CollaborationTaskNode
	if err := db.WithContext(ctx).Where("task_id = ?", taskID).Find(&nodes).Error; err != nil {
		return false
	}
	return projectStateMachineAllNodesDone(nodes, model.CollaborationTaskStatus(task.Status))
}

func (e *AcceptancePredicateEvaluator) residualRisksLogged(ctx context.Context, db *gorm.DB, taskID string) bool {
	var risks []persistence.ProjectResidualRisk
	if err := db.WithContext(ctx).Where("task_id = ?", taskID).Find(&risks).Error; err != nil {
		return false
	}
	for _, risk := range risks {
		switch strings.ToLower(strings.TrimSpace(risk.State)) {
		case "logged", "downgraded", "follow_up":
		default:
			return false
		}
	}
	return true
}

func (e *AcceptancePredicateEvaluator) goalOwnerSignoff(ctx context.Context, db *gorm.DB, taskID string) bool {
	var task persistence.CollaborationTask
	if err := db.WithContext(ctx).Where("id = ?", taskID).First(&task).Error; err != nil {
		return false
	}
	meta := map[string]string{}
	_ = json.Unmarshal([]byte(task.MetaJSON), &meta)
	return strings.EqualFold(strings.TrimSpace(meta["goal_owner_signoff"]), "true")
}

func (e *AcceptancePredicateEvaluator) memoryCandidatesGenerated(ctx context.Context, db *gorm.DB, taskID string) bool {
	var count int64
	if err := db.WithContext(ctx).Model(&persistence.TaskEvent{}).
		Where("task_id = ? AND payload LIKE ?", taskID, "%memory_candidate%").
		Count(&count).Error; err != nil {
		return false
	}
	if count > 0 {
		return true
	}
	var task persistence.CollaborationTask
	if err := db.WithContext(ctx).Where("id = ?", taskID).First(&task).Error; err != nil {
		return false
	}
	meta := map[string]string{}
	_ = json.Unmarshal([]byte(task.MetaJSON), &meta)
	return strings.EqualFold(strings.TrimSpace(meta["memory_candidates_generated"]), "true")
}

func (e *AcceptancePredicateEvaluator) automatedPredicatesPassed(ctx context.Context, db *gorm.DB, taskID, excludePredicateID string) bool {
	var predicates []persistence.AcceptancePredicate
	if err := db.WithContext(ctx).
		Where("task_id = ? AND level IN ?", taskID, []string{"L0", "L1"}).
		Order("source_event_seq ASC, created_at ASC").
		Find(&predicates).Error; err != nil {
		return false
	}
	found := false
	for _, predicate := range predicates {
		if predicate.PredicateID == excludePredicateID {
			continue
		}
		found = true
		if predicate.LastEval == nil || !*predicate.LastEval {
			return false
		}
	}
	return found
}

func (e *AcceptancePredicateEvaluator) humanPredicatesSigned(ctx context.Context, db *gorm.DB, taskID string) bool {
	var predicates []persistence.AcceptancePredicate
	if err := db.WithContext(ctx).Where("task_id = ? AND level = ?", taskID, "L2").Find(&predicates).Error; err != nil {
		return false
	}
	found := false
	for _, predicate := range predicates {
		found = true
		if !predicate.HumanSignoff {
			return false
		}
	}
	return found
}

func (e *AcceptancePredicateEvaluator) gatePassed(ctx context.Context, db *gorm.DB, taskID, normalizedExpr string) bool {
	if strings.HasPrefix(normalizedExpr, "gate_result(") && strings.HasSuffix(normalizedExpr, ").passed") {
		gateKey := strings.TrimSuffix(strings.TrimPrefix(normalizedExpr, "gate_result("), ").passed")
		return e.gateKeyPassed(ctx, db, taskID, gateKey, false)
	}
	if !strings.HasSuffix(normalizedExpr, ".passed") {
		return false
	}
	gateKey := strings.TrimSuffix(normalizedExpr, ".passed")
	gateKey = strings.ReplaceAll(gateKey, "_", "-")
	return e.gateKeyPassed(ctx, db, taskID, gateKey, false)
}

func (e *AcceptancePredicateEvaluator) blockingGatesPassed(ctx context.Context, db *gorm.DB, taskID string) bool {
	var gates []persistence.TaskGateResult
	if err := db.WithContext(ctx).
		Where("task_id = ? AND blocking = ?", taskID, true).
		Order("event_seq ASC, created_at ASC").
		Find(&gates).Error; err != nil {
		return false
	}
	if len(gates) == 0 {
		return false
	}
	latestPassedByGate := map[string]bool{}
	gateOrder := []string{}
	for _, gate := range gates {
		gateKey := normalizedGatePredicateKey(firstNonEmptyString(gate.GateID, gate.GatePlanID, gate.Name, gate.GateResultID))
		if gateKey == "" {
			continue
		}
		if _, seen := latestPassedByGate[gateKey]; !seen {
			gateOrder = append(gateOrder, gateKey)
		}
		latestPassedByGate[gateKey] = strings.EqualFold(strings.TrimSpace(gate.Status), "passed")
	}
	if len(gateOrder) == 0 {
		return false
	}
	for _, gateKey := range gateOrder {
		if !latestPassedByGate[gateKey] {
			return false
		}
	}
	return true
}

func (e *AcceptancePredicateEvaluator) gateKeyPassed(ctx context.Context, db *gorm.DB, taskID, gateKey string, blockingOnly bool) bool {
	gateKey = normalizedGatePredicateKey(gateKey)
	var gates []persistence.TaskGateResult
	query := db.WithContext(ctx).Where("task_id = ?", taskID)
	if blockingOnly {
		query = query.Where("blocking = ?", true)
	}
	if err := query.Order("event_seq ASC, created_at ASC").Find(&gates).Error; err != nil {
		return false
	}
	found := false
	passed := false
	for _, gate := range gates {
		if !gateMatchesPredicateKey(gate, gateKey) {
			continue
		}
		found = true
		passed = strings.EqualFold(strings.TrimSpace(gate.Status), "passed")
	}
	return found && passed
}

func gateMatchesPredicateKey(gate persistence.TaskGateResult, gateKey string) bool {
	candidates := []string{gate.GateID, gate.GatePlanID, gate.Name}
	for _, candidate := range candidates {
		if normalizedGatePredicateKey(candidate) == gateKey {
			return true
		}
	}
	return false
}

func normalizedGatePredicateKey(value string) string {
	normalized := strings.ReplaceAll(strings.ToLower(strings.TrimSpace(value)), "_", "-")
	normalized = strings.ReplaceAll(normalized, " ", "-")
	return normalized
}
