package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

// ProjectStateMachine advances Station-owned Project/Milestone state snapshots
// from durable task evidence. Atelier applets only read the resulting
// projection; they do not own these transitions.
type ProjectStateMachine struct{}

type projectStateMachineSnapshot struct {
	task                      persistence.CollaborationTask
	nodes                     []persistence.CollaborationTaskNode
	blockers                  []persistence.ProjectBlocker
	risks                     []persistence.ProjectResidualRisk
	predicates                []persistence.AcceptancePredicate
	gates                     []persistence.TaskGateResult
	artifacts                 []persistence.TaskArtifact
	meta                      map[string]string
	noOpenBlockers            bool
	automatedAcceptancePassed bool
	l2HumanSignoffComplete    bool
	hasL2Predicate            bool
	residualRisksLogged       bool
	memoryCandidatesGenerated bool
	allNodesDone              bool
}

func NewProjectStateMachine() *ProjectStateMachine {
	return &ProjectStateMachine{}
}

func (m *ProjectStateMachine) AdvanceTask(ctx context.Context, taskID string, source *persistence.TaskEvent) error {
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return err
	}
	return m.AdvanceTaskTx(ctx, db, taskID, source)
}

func (m *ProjectStateMachine) AdvanceTaskTx(ctx context.Context, db *gorm.DB, taskID string, source *persistence.TaskEvent) error {
	if m == nil {
		m = NewProjectStateMachine()
	}
	taskID = strings.TrimSpace(taskID)
	if taskID == "" || db == nil {
		return nil
	}
	snapshot, ok, err := m.loadSnapshot(ctx, db, taskID)
	if err != nil || !ok {
		return err
	}
	projectState := m.deriveProjectState(snapshot)
	milestoneState := m.deriveMilestoneState(snapshot, projectState)
	now := time.Now().UTC()
	sourceEventID := ""
	sourceEventSeq := int64(0)
	payloadJSON := ""
	if source != nil {
		sourceEventID = source.ID
		sourceEventSeq = source.EventSeq
		payloadJSON = source.Payload
		if !source.CreatedAt.IsZero() {
			now = source.CreatedAt
		}
	}
	record := persistence.ProjectState{
		ProjectID:      taskID,
		TaskID:         taskID,
		ProjectState:   projectState,
		MilestoneState: milestoneState,
		SourceEventID:  sourceEventID,
		SourceEventSeq: sourceEventSeq,
		PayloadJSON:    payloadJSON,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := upsertProjectStateTx(ctx, db, record); err != nil {
		return err
	}
	if err := materializeAtelierProjectStructureTx(ctx, db, snapshot, projectState, milestoneState, source); err != nil {
		return err
	}
	return materializeAtelierPolicyDefectTx(ctx, db, snapshot, source)
}

func (m *ProjectStateMachine) loadSnapshot(ctx context.Context, db *gorm.DB, taskID string) (projectStateMachineSnapshot, bool, error) {
	var snapshot projectStateMachineSnapshot
	err := db.WithContext(ctx).Where("id = ?", taskID).First(&snapshot.task).Error
	if err == gorm.ErrRecordNotFound {
		return snapshot, false, nil
	}
	if err != nil {
		return snapshot, false, err
	}
	snapshot.meta = projectStateMachineMeta(snapshot.task.MetaJSON)
	if err := db.WithContext(ctx).Where("task_id = ?", taskID).Order("started_at ASC, id ASC").Find(&snapshot.nodes).Error; err != nil {
		return snapshot, false, err
	}
	if err := db.WithContext(ctx).Where("task_id = ?", taskID).Find(&snapshot.blockers).Error; err != nil {
		return snapshot, false, err
	}
	if err := db.WithContext(ctx).Where("task_id = ?", taskID).Find(&snapshot.risks).Error; err != nil {
		return snapshot, false, err
	}
	if err := db.WithContext(ctx).Where("task_id = ?", taskID).Find(&snapshot.predicates).Error; err != nil {
		return snapshot, false, err
	}
	if err := db.WithContext(ctx).Where("task_id = ?", taskID).Order("event_seq ASC, created_at ASC").Find(&snapshot.gates).Error; err != nil {
		return snapshot, false, err
	}
	if err := db.WithContext(ctx).Where("task_id = ?", taskID).Order("event_seq ASC, created_at ASC").Find(&snapshot.artifacts).Error; err != nil {
		return snapshot, false, err
	}
	snapshot.noOpenBlockers = projectStateMachineNoOpenBlockers(snapshot.blockers)
	snapshot.automatedAcceptancePassed = projectStateMachineAutomatedAcceptancePassed(snapshot.predicates, snapshot.gates, snapshot.meta)
	snapshot.l2HumanSignoffComplete, snapshot.hasL2Predicate = projectStateMachineL2HumanSignoff(snapshot.predicates, snapshot.meta)
	snapshot.residualRisksLogged = projectStateMachineResidualRisksLogged(snapshot.risks)
	snapshot.memoryCandidatesGenerated = projectStateMachineMemoryCandidatesGenerated(ctx, db, taskID, snapshot.meta)
	snapshot.allNodesDone = projectStateMachineAllNodesDone(snapshot.nodes, model.CollaborationTaskStatus(snapshot.task.Status))
	return snapshot, true, nil
}

func (m *ProjectStateMachine) deriveProjectState(snapshot projectStateMachineSnapshot) string {
	if !snapshot.noOpenBlockers {
		return "blocked"
	}
	switch model.CollaborationTaskStatus(snapshot.task.Status) {
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PENDING:
		if projectStateMachineMetaBool(snapshot.meta, "goal_owner_signoff", "owner_signoff") {
			return "contracted"
		}
		return "draft"
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING:
		if snapshot.automatedAcceptancePassed {
			return "verifying"
		}
		return "executing"
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED:
		if snapshot.automatedAcceptancePassed &&
			snapshot.l2HumanSignoffComplete &&
			snapshot.residualRisksLogged &&
			snapshot.memoryCandidatesGenerated {
			return "accepted"
		}
		if snapshot.automatedAcceptancePassed &&
			(snapshot.hasL2Predicate || projectStateMachineMetaBool(snapshot.meta, "requires_owner_signoff")) &&
			!snapshot.l2HumanSignoffComplete {
			return "awaiting_owner_signoff"
		}
		return "verifying"
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED:
		return "blocked"
	case model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_FAILED,
		model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_CANCELLED:
		return "escalated"
	default:
		if projectStateMachineMetaBool(snapshot.meta, "goal_owner_signoff", "owner_signoff") {
			return "executing"
		}
		return "draft"
	}
}

func (m *ProjectStateMachine) deriveMilestoneState(snapshot projectStateMachineSnapshot, projectState string) string {
	if projectState == "accepted" || (snapshot.noOpenBlockers && snapshot.automatedAcceptancePassed && snapshot.allNodesDone) {
		return "accepted"
	}
	if !snapshot.noOpenBlockers || projectState == "blocked" || projectState == "escalated" {
		return "blocked"
	}
	if model.CollaborationTaskStatus(snapshot.task.Status) == model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_CANCELLED {
		return "abandoned"
	}
	if projectState == "draft" || projectState == "contracted" {
		return "planned"
	}
	return "active"
}

func upsertProjectStateTx(ctx context.Context, tx *gorm.DB, record persistence.ProjectState) error {
	if strings.TrimSpace(record.ProjectID) == "" {
		record.ProjectID = record.TaskID
	}
	if record.CreatedAt.IsZero() {
		record.CreatedAt = time.Now().UTC()
	}
	if record.UpdatedAt.IsZero() {
		record.UpdatedAt = record.CreatedAt
	}
	var existing persistence.ProjectState
	err := tx.WithContext(ctx).Where("project_id = ?", record.ProjectID).First(&existing).Error
	if err == gorm.ErrRecordNotFound {
		return tx.WithContext(ctx).Create(&record).Error
	}
	if err != nil {
		return err
	}
	return tx.WithContext(ctx).Model(&persistence.ProjectState{}).
		Where("project_id = ?", record.ProjectID).
		Updates(map[string]interface{}{
			"task_id":          record.TaskID,
			"project_state":    record.ProjectState,
			"milestone_state":  record.MilestoneState,
			"source_event_id":  record.SourceEventID,
			"source_event_seq": record.SourceEventSeq,
			"payload_json":     record.PayloadJSON,
			"updated_at":       record.UpdatedAt,
		}).Error
}

func projectStateMachineMeta(metaJSON string) map[string]string {
	meta := map[string]string{}
	if strings.TrimSpace(metaJSON) == "" {
		return meta
	}
	raw := map[string]interface{}{}
	if err := json.Unmarshal([]byte(metaJSON), &raw); err != nil {
		return meta
	}
	for key, value := range raw {
		switch typed := value.(type) {
		case string:
			meta[key] = typed
		case bool:
			if typed {
				meta[key] = "true"
			} else {
				meta[key] = "false"
			}
		}
	}
	return meta
}

func projectStateMachineMetaBool(meta map[string]string, keys ...string) bool {
	for _, key := range keys {
		if strings.EqualFold(strings.TrimSpace(meta[key]), "true") {
			return true
		}
	}
	return false
}

func projectStateMachineNoOpenBlockers(blockers []persistence.ProjectBlocker) bool {
	for _, blocker := range blockers {
		switch strings.ToLower(strings.TrimSpace(blocker.State)) {
		case "resolved", "waived":
		default:
			return false
		}
	}
	return true
}

func projectStateMachineAutomatedAcceptancePassed(predicates []persistence.AcceptancePredicate, gates []persistence.TaskGateResult, meta map[string]string) bool {
	if projectStateMachineMetaBool(meta, "l0_l1_acceptance_passed") {
		return true
	}
	foundPredicate := false
	for _, predicate := range predicates {
		if predicate.Level != "L0" && predicate.Level != "L1" {
			continue
		}
		foundPredicate = true
		if predicate.LastEval == nil || !*predicate.LastEval {
			return false
		}
	}
	if foundPredicate {
		return true
	}
	latestGatePassed := map[string]bool{}
	gateOrder := []string{}
	for _, gate := range gates {
		gateID := strings.TrimSpace(firstNonEmptyString(gate.GateID, gate.GatePlanID, gate.Name, gate.GateResultID))
		if gateID == "" {
			continue
		}
		if _, seen := latestGatePassed[gateID]; !seen {
			gateOrder = append(gateOrder, gateID)
		}
		latestGatePassed[gateID] = strings.EqualFold(strings.TrimSpace(gate.Status), "passed")
	}
	if len(gateOrder) == 0 {
		return false
	}
	for _, gateID := range gateOrder {
		if !latestGatePassed[gateID] {
			return false
		}
	}
	return true
}

func projectStateMachineL2HumanSignoff(predicates []persistence.AcceptancePredicate, meta map[string]string) (bool, bool) {
	if projectStateMachineMetaBool(meta, "goal_owner_signoff", "l2_human_signoff_complete") {
		return true, false
	}
	found := false
	for _, predicate := range predicates {
		if predicate.Level != "L2" {
			continue
		}
		found = true
		if !predicate.HumanSignoff {
			return false, true
		}
	}
	if found {
		return true, true
	}
	return false, false
}

func projectStateMachineResidualRisksLogged(risks []persistence.ProjectResidualRisk) bool {
	for _, risk := range risks {
		switch strings.ToLower(strings.TrimSpace(risk.State)) {
		case "logged", "downgraded", "follow_up":
		default:
			return false
		}
	}
	return true
}

func projectStateMachineMemoryCandidatesGenerated(ctx context.Context, db *gorm.DB, taskID string, meta map[string]string) bool {
	if projectStateMachineMetaBool(meta, "memory_candidates_generated") {
		return true
	}
	var count int64
	if err := db.WithContext(ctx).Model(&persistence.TaskEvent{}).
		Where("task_id = ? AND payload LIKE ?", taskID, "%memory_candidate%").
		Count(&count).Error; err != nil {
		return false
	}
	return count > 0
}

func projectStateMachineAllNodesDone(nodes []persistence.CollaborationTaskNode, taskStatus model.CollaborationTaskStatus) bool {
	if len(nodes) == 0 {
		return taskStatus == model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED
	}
	for _, node := range nodes {
		switch model.TaskNodeStatus(node.Status) {
		case model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED,
			model.TaskNodeStatus_TASK_NODE_STATUS_SKIPPED:
		default:
			return false
		}
	}
	return true
}

func materializeAtelierProjectStructureTx(ctx context.Context, tx *gorm.DB, snapshot projectStateMachineSnapshot, projectState string, milestoneState string, source *persistence.TaskEvent) error {
	taskID := strings.TrimSpace(snapshot.task.ID)
	if taskID == "" {
		return nil
	}
	milestoneID := taskID + "-milestone-root"
	sourceEventID := ""
	sourceEventSeq := int64(0)
	payloadJSON := ""
	now := time.Now().UTC()
	if source != nil {
		sourceEventID = source.ID
		sourceEventSeq = source.EventSeq
		payloadJSON = source.Payload
		if !source.CreatedAt.IsZero() {
			now = source.CreatedAt
		}
	}
	if err := tx.WithContext(ctx).Where("task_id = ?", taskID).Delete(&persistence.AtelierTaskGraphEdge{}).Error; err != nil {
		return err
	}
	if err := tx.WithContext(ctx).Where("task_id = ?", taskID).Delete(&persistence.AtelierTaskGraphNode{}).Error; err != nil {
		return err
	}
	artifactIDsByNode := map[string][]string{}
	for _, artifact := range snapshot.artifacts {
		stepID := strings.TrimSpace(artifact.StepID)
		if stepID == "" {
			continue
		}
		artifactIDsByNode[stepID] = appendProjectStateMachineUniqueString(artifactIDsByNode[stepID], artifact.ArtifactID)
	}
	gateIDsByNode := map[string][]string{}
	for _, gate := range snapshot.gates {
		stepID := strings.TrimSpace(gate.StepID)
		if stepID == "" {
			continue
		}
		gateIDsByNode[stepID] = appendProjectStateMachineUniqueString(gateIDsByNode[stepID], firstNonEmptyString(gate.GateID, gate.GatePlanID, gate.GateResultID))
	}
	taskIDs := make([]string, 0, len(snapshot.nodes))
	acceptancePredicateIDs := make([]string, 0, len(snapshot.predicates))
	for _, predicate := range snapshot.predicates {
		acceptancePredicateIDs = appendProjectStateMachineUniqueString(acceptancePredicateIDs, predicate.PredicateID)
	}
	for _, node := range snapshot.nodes {
		nodeID := strings.TrimSpace(node.ID)
		if nodeID == "" {
			continue
		}
		taskIDs = appendProjectStateMachineUniqueString(taskIDs, nodeID)
		record := persistence.AtelierTaskGraphNode{
			NodeID:          nodeID,
			TaskID:          taskID,
			MilestoneID:     milestoneID,
			Title:           firstNonEmptyString(strings.TrimSpace(node.Description), nodeID),
			State:           todoStatusForNode(model.TaskNodeStatus(node.Status)),
			AgentRole:       strings.ToLower(strings.TrimSpace(node.Role)),
			ArtifactIDsJSON: projectStateMachineStringListJSON(artifactIDsByNode[nodeID]),
			GateIDsJSON:     projectStateMachineStringListJSON(gateIDsByNode[nodeID]),
			SourceEventID:   sourceEventID,
			SourceEventSeq:  sourceEventSeq,
			PayloadJSON:     payloadJSON,
			CreatedAt:       now,
			UpdatedAt:       now,
		}
		if err := tx.WithContext(ctx).Create(&record).Error; err != nil {
			return err
		}
		for _, prerequisiteID := range projectStateMachineStringListFromCSV(node.PrerequisiteNodeIDs) {
			edge := persistence.AtelierTaskGraphEdge{
				EdgeID:         projectStateMachineEdgeID(taskID, prerequisiteID, nodeID, "blocks"),
				TaskID:         taskID,
				FromID:         prerequisiteID,
				ToID:           nodeID,
				Type:           "blocks",
				SourceEventID:  sourceEventID,
				SourceEventSeq: sourceEventSeq,
				PayloadJSON:    payloadJSON,
				CreatedAt:      now,
				UpdatedAt:      now,
			}
			if err := tx.WithContext(ctx).Create(&edge).Error; err != nil {
				return err
			}
		}
	}
	if len(taskIDs) == 0 {
		taskIDs = append(taskIDs, taskID)
	}
	milestone := persistence.AtelierMilestone{
		MilestoneID:                milestoneID,
		TaskID:                     taskID,
		Title:                      firstNonEmptyString(strings.TrimSpace(snapshot.task.Title), "Root milestone"),
		State:                      milestoneState,
		TaskIDsJSON:                projectStateMachineStringListJSON(taskIDs),
		AcceptancePredicateIDsJSON: projectStateMachineStringListJSON(acceptancePredicateIDs),
		DependsOnJSON:              "[]",
		SourceEventID:              sourceEventID,
		SourceEventSeq:             sourceEventSeq,
		PayloadJSON:                payloadJSON,
		CreatedAt:                  now,
		UpdatedAt:                  now,
	}
	var existing persistence.AtelierMilestone
	err := tx.WithContext(ctx).Where("milestone_id = ?", milestone.MilestoneID).First(&existing).Error
	if err == gorm.ErrRecordNotFound {
		return tx.WithContext(ctx).Create(&milestone).Error
	}
	if err != nil {
		return err
	}
	return tx.WithContext(ctx).Model(&persistence.AtelierMilestone{}).
		Where("milestone_id = ?", milestone.MilestoneID).
		Updates(map[string]interface{}{
			"task_id":                       milestone.TaskID,
			"parent_id":                     milestone.ParentID,
			"title":                         milestone.Title,
			"state":                         milestone.State,
			"task_ids_json":                 milestone.TaskIDsJSON,
			"acceptance_predicate_ids_json": milestone.AcceptancePredicateIDsJSON,
			"depends_on_json":               milestone.DependsOnJSON,
			"source_event_id":               milestone.SourceEventID,
			"source_event_seq":              milestone.SourceEventSeq,
			"payload_json":                  milestone.PayloadJSON,
			"updated_at":                    milestone.UpdatedAt,
		}).Error
}

func projectStateMachineStringListJSON(values []string) string {
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		normalized = appendProjectStateMachineUniqueString(normalized, value)
	}
	encoded, err := json.Marshal(normalized)
	if err != nil {
		return "[]"
	}
	return string(encoded)
}

func projectStateMachineStringListFromCSV(raw string) []string {
	parts := strings.Split(raw, ",")
	values := make([]string, 0, len(parts))
	for _, part := range parts {
		values = appendProjectStateMachineUniqueString(values, part)
	}
	return values
}

func appendProjectStateMachineUniqueString(values []string, value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return values
	}
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

func projectStateMachineEdgeID(taskID string, fromID string, toID string, edgeType string) string {
	return strings.Join([]string{strings.TrimSpace(taskID), strings.TrimSpace(fromID), strings.TrimSpace(toID), strings.TrimSpace(edgeType)}, ":")
}

func projectStateMachinePolicyProjectionID(taskID string, policyID string) string {
	return strings.Join([]string{strings.TrimSpace(taskID), strings.TrimSpace(policyID)}, ":")
}

func materializeAtelierPolicyDefectTx(ctx context.Context, tx *gorm.DB, snapshot projectStateMachineSnapshot, source *persistence.TaskEvent) error {
	taskID := strings.TrimSpace(snapshot.task.ID)
	if taskID == "" {
		return nil
	}
	sourceEventID, sourceEventSeq, payloadJSON, now := projectStateMachineSource(source)
	policyID := strings.TrimSpace(snapshot.meta["policy_id"])
	if policyID != "" {
		policy := persistence.AtelierPolicy{
			PolicyProjectionID: projectStateMachinePolicyProjectionID(taskID, policyID),
			PolicyID:           policyID,
			TaskID:             taskID,
			HardDeny:           projectStateMachineMetaBool(snapshot.meta, "policy_hard_deny"),
			SourceEventID:      sourceEventID,
			SourceEventSeq:     sourceEventSeq,
			PayloadJSON:        payloadJSON,
			CreatedAt:          now,
			UpdatedAt:          now,
		}
		if err := upsertAtelierPolicyTx(ctx, tx, policy); err != nil {
			return err
		}
		if err := materializeAtelierPolicyRuleTx(ctx, tx, snapshot, policyID, sourceEventID, sourceEventSeq, payloadJSON, now); err != nil {
			return err
		}
	}
	if err := tx.WithContext(ctx).Where("task_id = ?", taskID).Delete(&persistence.AtelierDefect{}).Error; err != nil {
		return err
	}
	for _, gate := range snapshot.gates {
		status := strings.ToLower(strings.TrimSpace(gate.Status))
		if status == "" || status == "passed" || status == "success" {
			continue
		}
		payload := map[string]interface{}{}
		if strings.TrimSpace(gate.PayloadJSON) != "" {
			_ = json.Unmarshal([]byte(gate.PayloadJSON), &payload)
		}
		defectID := firstNonEmptyString(firstPayloadString(payload, "defect_id", "defectId"), gate.GateResultID, gate.EventID)
		record := persistence.AtelierDefect{
			DefectID:       defectID,
			TaskID:         taskID,
			Source:         firstNonEmptyString(firstPayloadString(payload, "source"), gate.ProducedBy, "gate"),
			State:          firstNonEmptyString(firstPayloadString(payload, "defect_state", "defectState"), "proposed"),
			EvidenceRef:    firstNonEmptyString(firstPayloadString(payload, "artifact_id", "artifactId"), firstProjectStateMachineJSONListValue(gate.ArtifactIDsJSON)),
			Summary:        firstNonEmptyString(firstPayloadString(payload, "summary"), gate.Summary, "gate reported a defect"),
			ExpectedChange: firstPayloadString(payload, "expected_change", "expectedChange"),
			TargetRefsJSON: projectStateMachinePayloadStringListJSON(payload, "target_refs", "targetRefs"),
			SourceEventID:  firstNonEmptyString(gate.EventID, sourceEventID),
			SourceEventSeq: gate.EventSeq,
			PayloadJSON:    firstNonEmptyString(gate.PayloadJSON, payloadJSON),
			CreatedAt:      now,
			UpdatedAt:      now,
		}
		if strings.TrimSpace(record.Source) == "" {
			record.Source = "gate"
		}
		if strings.TrimSpace(record.DefectID) == "" {
			continue
		}
		if err := tx.WithContext(ctx).Create(&record).Error; err != nil {
			return err
		}
	}
	return nil
}

func upsertAtelierPolicyTx(ctx context.Context, tx *gorm.DB, record persistence.AtelierPolicy) error {
	var existing persistence.AtelierPolicy
	err := tx.WithContext(ctx).Where("policy_projection_id = ?", record.PolicyProjectionID).First(&existing).Error
	if err == gorm.ErrRecordNotFound {
		return tx.WithContext(ctx).Create(&record).Error
	}
	if err != nil {
		return err
	}
	return tx.WithContext(ctx).Model(&persistence.AtelierPolicy{}).
		Where("policy_projection_id = ?", record.PolicyProjectionID).
		Updates(map[string]interface{}{
			"policy_id":        record.PolicyID,
			"task_id":          record.TaskID,
			"hard_deny":        record.HardDeny,
			"source_event_id":  record.SourceEventID,
			"source_event_seq": record.SourceEventSeq,
			"payload_json":     record.PayloadJSON,
			"updated_at":       record.UpdatedAt,
		}).Error
}

func materializeAtelierPolicyRuleTx(ctx context.Context, tx *gorm.DB, snapshot projectStateMachineSnapshot, policyID string, sourceEventID string, sourceEventSeq int64, payloadJSON string, now time.Time) error {
	taskID := strings.TrimSpace(snapshot.task.ID)
	if err := tx.WithContext(ctx).Where("task_id = ? AND policy_id = ?", taskID, policyID).Delete(&persistence.AtelierPolicyRule{}).Error; err != nil {
		return err
	}
	ruleID := strings.TrimSpace(snapshot.meta["policy_rule_id"])
	expr := strings.TrimSpace(snapshot.meta["policy_rule_expr"])
	if ruleID == "" && expr == "" && !projectStateMachineMetaBool(snapshot.meta, "policy_hard_deny") {
		return nil
	}
	if ruleID == "" {
		ruleID = policyID + ":default"
	}
	if expr == "" && projectStateMachineMetaBool(snapshot.meta, "policy_hard_deny") {
		expr = "policy_hard_deny == true"
	}
	record := persistence.AtelierPolicyRule{
		RuleID:         ruleID,
		PolicyID:       policyID,
		TaskID:         taskID,
		Scope:          firstNonEmptyString(snapshot.meta["policy_rule_scope"], "project"),
		Expr:           expr,
		Severity:       firstNonEmptyString(snapshot.meta["policy_rule_severity"], "block"),
		SourceEventID:  sourceEventID,
		SourceEventSeq: sourceEventSeq,
		PayloadJSON:    payloadJSON,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	return tx.WithContext(ctx).Create(&record).Error
}

func projectStateMachineSource(source *persistence.TaskEvent) (string, int64, string, time.Time) {
	now := time.Now().UTC()
	if source == nil {
		return "", 0, "", now
	}
	if !source.CreatedAt.IsZero() {
		now = source.CreatedAt
	}
	return source.ID, source.EventSeq, source.Payload, now
}

func projectStateMachinePayloadStringListJSON(payload map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		value, ok := payload[key]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case []string:
			return projectStateMachineStringListJSON(typed)
		case []interface{}:
			values := make([]string, 0, len(typed))
			for _, item := range typed {
				values = appendProjectStateMachineUniqueString(values, fmt.Sprint(item))
			}
			return projectStateMachineStringListJSON(values)
		case string:
			return projectStateMachineStringListJSON(projectStateMachineStringListFromCSV(typed))
		}
	}
	return "[]"
}

func firstProjectStateMachineJSONListValue(raw string) string {
	var values []string
	if err := json.Unmarshal([]byte(raw), &values); err != nil || len(values) == 0 {
		return ""
	}
	return strings.TrimSpace(values[0])
}
