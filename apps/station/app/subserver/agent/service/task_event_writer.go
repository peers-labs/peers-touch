// Change-log:
// 2026-06-30 — Extracted from OrchestrationService.appendTaskEvent/publishEvent.
//   TaskEventWriter is the single outbox-append + event-bus publish path shared
//   by OrchestrationService (Canvas DAG) and ChatTaskService (Chat root task).
//   The outbox table agent_task_events is the replayable source of truth; the
//   in-memory event bus only drives realtime projection. Every event gets a
//   monotonic per-task event_seq so subscribers can replay by cursor.

package service

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

// TaskEventWriter appends task events to the durable outbox with a monotonic
// per-task sequence and mirrors them onto the realtime event bus.
type TaskEventWriter struct {
	eventBus domain.EventBus
	mu       sync.Mutex
}

type artifactBodyEvidence struct {
	ArtifactID       string
	BodyKind         string
	BodyText         string
	BodyURI          string
	ContentHash      string
	ByteSize         int64
	RetentionPolicy  string
	RetentionStatus  string
	SanitizedPayload map[string]interface{}
}

// NewTaskEventWriter builds a writer bound to the given (optional) event bus.
func NewTaskEventWriter(eventBus domain.EventBus) *TaskEventWriter {
	return &TaskEventWriter{eventBus: eventBus}
}

func (w *TaskEventWriter) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to open agent db", err)
	}
	return db, nil
}

// Append writes a single task event into the outbox inside a transaction,
// assigning event_seq = max(event_seq)+1 for the task.
func (w *TaskEventWriter) Append(ctx context.Context, eventID, taskID, stepID, turnID, eventType string, payload interface{}) (*persistence.TaskEvent, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	db, err := w.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var record *persistence.TaskEvent
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		record, err = w.appendTx(ctx, tx, eventID, taskID, stepID, turnID, eventType, payload)
		return err
	}); err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to append task event", err)
	}
	return record, nil
}

func (w *TaskEventWriter) appendTx(ctx context.Context, tx *gorm.DB, eventID, taskID, stepID, turnID, eventType string, payload interface{}) (*persistence.TaskEvent, error) {
	resolvedEventType := taskEventTypeForDomainEvent(eventType)
	payloadForOutbox := payload
	artifactBody, err := artifactBodyEvidenceFromPayload(payload, resolvedEventType, strings.TrimSpace(taskID))
	if err != nil {
		return nil, err
	}
	if artifactBody != nil {
		payloadForOutbox = artifactBody.SanitizedPayload
	}
	payloadJSON, _ := json.Marshal(payloadForOutbox)
	record := persistence.TaskEvent{
		ID:        strings.TrimSpace(eventID),
		TaskID:    strings.TrimSpace(taskID),
		StepID:    strings.TrimSpace(stepID),
		TurnID:    strings.TrimSpace(turnID),
		EventType: int32(resolvedEventType),
		Payload:   string(payloadJSON),
		CreatedAt: time.Now(),
	}
	if record.ID == "" {
		record.ID = generateID("evt")
	}
	if record.TaskID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "task_id is required", nil)
	}
	var last persistence.TaskEvent
	if err := tx.WithContext(ctx).Where("task_id = ?", record.TaskID).Order("event_seq DESC").First(&last).Error; err != nil && err != gorm.ErrRecordNotFound {
		return nil, err
	}
	record.EventSeq = last.EventSeq + 1
	if err := tx.WithContext(ctx).Create(&record).Error; err != nil {
		return nil, err
	}
	if err := syncInterruptRequestForTaskEventTx(ctx, tx, &record); err != nil {
		return nil, err
	}
	if err := syncTaskArtifactForTaskEventTx(ctx, tx, &record); err != nil {
		return nil, err
	}
	if err := syncTaskArtifactBlobForTaskEventTx(ctx, tx, &record, artifactBody); err != nil {
		return nil, err
	}
	if err := syncTaskGateResultForTaskEventTx(ctx, tx, &record); err != nil {
		return nil, err
	}
	if err := syncProjectStateForTaskEventTx(ctx, tx, &record); err != nil {
		return nil, err
	}
	if err := syncAcceptancePredicateForTaskEventTx(ctx, tx, &record); err != nil {
		return nil, err
	}
	if err := syncProjectBlockerForTaskEventTx(ctx, tx, &record); err != nil {
		return nil, err
	}
	if err := syncProjectResidualRiskForTaskEventTx(ctx, tx, &record); err != nil {
		return nil, err
	}
	if err := NewAcceptancePredicateEvaluator().EvaluateTaskTx(ctx, tx, record.TaskID); err != nil {
		return nil, err
	}
	if err := NewProjectStateMachine().AdvanceTaskTx(ctx, tx, record.TaskID, &record); err != nil {
		return nil, err
	}
	return &record, nil
}

func syncInterruptRequestForTaskEventTx(ctx context.Context, tx *gorm.DB, event *persistence.TaskEvent) error {
	if event == nil {
		return nil
	}
	eventType := model.TaskEventType(event.EventType)
	if eventType != model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_REQUESTED &&
		eventType != model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_RESOLVED {
		return nil
	}
	payload := map[string]interface{}{}
	if strings.TrimSpace(event.Payload) != "" {
		_ = json.Unmarshal([]byte(event.Payload), &payload)
	}
	interruptID := firstPayloadString(payload, "interrupt_id", "block_id")
	if interruptID == "" {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "interrupt_id is required", nil)
	}
	interruptType := firstPayloadString(payload, "interrupt_type", "block_kind")
	if interruptType == "" {
		interruptType = "human_decision"
	}
	switch eventType {
	case model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_REQUESTED:
		return upsertPendingInterruptRequestTx(ctx, tx, event, interruptID, interruptType)
	case model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_RESOLVED:
		return resolveInterruptRequestTx(ctx, tx, event, interruptID, interruptType, firstPayloadString(payload, "resume_payload_json"))
	default:
		return nil
	}
}

func upsertPendingInterruptRequestTx(ctx context.Context, tx *gorm.DB, event *persistence.TaskEvent, interruptID string, interruptType string) error {
	record := persistence.InterruptRequest{
		InterruptID:   interruptID,
		TaskID:        event.TaskID,
		StepID:        event.StepID,
		TurnID:        event.TurnID,
		InterruptType: interruptType,
		Status:        int32(model.InterruptStatus_INTERRUPT_STATUS_PENDING),
		PayloadJSON:   event.Payload,
		CreatedAt:     event.CreatedAt,
	}
	var existing persistence.InterruptRequest
	err := tx.WithContext(ctx).Where("interrupt_id = ?", interruptID).First(&existing).Error
	if err == gorm.ErrRecordNotFound {
		return tx.WithContext(ctx).Create(&record).Error
	}
	if err != nil {
		return err
	}
	if existing.Status == int32(model.InterruptStatus_INTERRUPT_STATUS_RESOLVED) {
		return nil
	}
	return tx.WithContext(ctx).Model(&persistence.InterruptRequest{}).
		Where("interrupt_id = ?", interruptID).
		Updates(map[string]interface{}{
			"task_id":        record.TaskID,
			"step_id":        record.StepID,
			"turn_id":        record.TurnID,
			"interrupt_type": record.InterruptType,
			"status":         record.Status,
			"payload_json":   record.PayloadJSON,
		}).Error
}

func resolveInterruptRequestTx(ctx context.Context, tx *gorm.DB, event *persistence.TaskEvent, interruptID string, interruptType string, resumePayloadJSON string) error {
	now := event.CreatedAt
	if now.IsZero() {
		now = time.Now()
	}
	var existing persistence.InterruptRequest
	err := tx.WithContext(ctx).Where("interrupt_id = ?", interruptID).First(&existing).Error
	if err == gorm.ErrRecordNotFound {
		record := persistence.InterruptRequest{
			InterruptID:       interruptID,
			TaskID:            event.TaskID,
			StepID:            event.StepID,
			TurnID:            event.TurnID,
			InterruptType:     interruptType,
			Status:            int32(model.InterruptStatus_INTERRUPT_STATUS_RESOLVED),
			PayloadJSON:       event.Payload,
			ResumePayloadJSON: resumePayloadJSON,
			CreatedAt:         now,
			ResolvedAt:        &now,
		}
		return tx.WithContext(ctx).Create(&record).Error
	}
	if err != nil {
		return err
	}
	return tx.WithContext(ctx).Model(&persistence.InterruptRequest{}).
		Where("interrupt_id = ?", interruptID).
		Updates(map[string]interface{}{
			"status":              int32(model.InterruptStatus_INTERRUPT_STATUS_RESOLVED),
			"resume_payload_json": resumePayloadJSON,
			"resolved_at":         now,
		}).Error
}

func artifactBodyEvidenceFromPayload(payload interface{}, eventType model.TaskEventType, taskID string) (*artifactBodyEvidence, error) {
	payloadMap, ok := payloadMapCopy(payload)
	if !ok {
		return nil, nil
	}
	blockKind := firstPayloadString(payloadMap, "block_kind")
	if eventType != model.TaskEventType_TASK_EVENT_TYPE_ARTIFACT_CREATED && blockKind != "artifact" {
		return nil, nil
	}
	artifactID := firstPayloadString(payloadMap, "artifact_id", "artifactId", "id")
	bodyKind, bodyText, ok, err := artifactBodyText(payloadMap)
	if err != nil || !ok {
		return nil, err
	}
	for _, key := range artifactBodyPayloadKeys() {
		delete(payloadMap, key)
	}
	sum := sha256.Sum256([]byte(bodyText))
	contentHash := fmt.Sprintf("sha256:%x", sum[:])
	bodyURI := ""
	if strings.TrimSpace(taskID) != "" && strings.TrimSpace(artifactID) != "" {
		bodyURI = fmt.Sprintf("artifact://%s/%s/body", strings.TrimSpace(taskID), strings.TrimSpace(artifactID))
	}
	payloadMap["body_ref"] = bodyURI
	payloadMap["body_hash"] = contentHash
	payloadMap["body_size"] = len([]byte(bodyText))
	payloadMap["body_kind"] = bodyKind
	payloadMap["body_retention_policy"] = "task_lifetime"
	payloadMap["body_retention_status"] = "active"
	payloadMap["preview_target"] = artifactPreviewTargetMetadata(taskID, artifactID, bodyKind, bodyURI)
	if _, exists := payloadMap["preview_hint"]; !exists {
		payloadMap["preview_hint"] = "metadata_only"
	}
	return &artifactBodyEvidence{
		ArtifactID:       artifactID,
		BodyKind:         bodyKind,
		BodyText:         bodyText,
		BodyURI:          bodyURI,
		ContentHash:      contentHash,
		ByteSize:         int64(len([]byte(bodyText))),
		RetentionPolicy:  "task_lifetime",
		RetentionStatus:  "active",
		SanitizedPayload: payloadMap,
	}, nil
}

func payloadMapCopy(payload interface{}) (map[string]interface{}, bool) {
	switch typed := payload.(type) {
	case map[string]interface{}:
		copied := make(map[string]interface{}, len(typed))
		for key, value := range typed {
			copied[key] = value
		}
		return copied, true
	case map[string]string:
		copied := make(map[string]interface{}, len(typed))
		for key, value := range typed {
			copied[key] = value
		}
		return copied, true
	default:
		encoded, err := json.Marshal(payload)
		if err != nil {
			return nil, false
		}
		var decoded map[string]interface{}
		if err := json.Unmarshal(encoded, &decoded); err != nil {
			return nil, false
		}
		return decoded, true
	}
}

func artifactBodyPayloadKeys() []string {
	return []string{"markdown", "content", "body", "html", "diff", "patch"}
}

func artifactPreviewTargetMetadata(taskID, artifactID, bodyKind, bodyURI string) map[string]interface{} {
	trimmedTaskID := strings.TrimSpace(taskID)
	trimmedArtifactID := strings.TrimSpace(artifactID)
	trimmedBodyURI := strings.TrimSpace(bodyURI)
	if trimmedTaskID == "" || trimmedArtifactID == "" || trimmedBodyURI == "" {
		return nil
	}
	return map[string]interface{}{
		"kind":        artifactPreviewTargetKind(bodyKind),
		"mode":        "sandbox_manifest",
		"label":       "Host sandbox preview manifest",
		"sandbox_ref": fmt.Sprintf("atelier-sandbox://%s/%s/preview", trimmedTaskID, trimmedArtifactID),
		"body_ref":    trimmedBodyURI,
	}
}

func artifactPreviewTargetKind(bodyKind string) string {
	switch strings.TrimSpace(bodyKind) {
	case "markdown", "diff":
		return strings.TrimSpace(bodyKind)
	case "text", "json":
		return "metadata"
	default:
		return "metadata"
	}
}

func artifactBodyText(payload map[string]interface{}) (string, string, bool, error) {
	for _, key := range artifactBodyPayloadKeys() {
		value, ok := payload[key]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case string:
			if strings.TrimSpace(typed) == "" {
				continue
			}
			return key, typed, true, nil
		default:
			encoded, err := json.Marshal(typed)
			if err != nil {
				return "", "", false, err
			}
			if string(encoded) == "null" || strings.TrimSpace(string(encoded)) == "" {
				continue
			}
			return key, string(encoded), true, nil
		}
	}
	return "", "", false, nil
}

func syncTaskArtifactBlobForTaskEventTx(ctx context.Context, tx *gorm.DB, event *persistence.TaskEvent, body *artifactBodyEvidence) error {
	if event == nil || body == nil {
		return nil
	}
	artifactID := strings.TrimSpace(body.ArtifactID)
	if artifactID == "" {
		artifactID = firstPayloadString(body.SanitizedPayload, "artifact_id", "artifactId", "id")
	}
	if artifactID == "" {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "artifact_id is required", nil)
	}
	blobID := artifactID + ":" + body.BodyKind
	record := persistence.TaskArtifactBlob{
		BlobID:          blobID,
		ArtifactID:      artifactID,
		TaskID:          event.TaskID,
		StepID:          event.StepID,
		TurnID:          event.TurnID,
		EventID:         event.ID,
		EventSeq:        event.EventSeq,
		BodyKind:        body.BodyKind,
		BodyURI:         body.BodyURI,
		ContentHash:     body.ContentHash,
		ByteSize:        body.ByteSize,
		RetentionPolicy: body.RetentionPolicy,
		RetentionStatus: body.RetentionStatus,
		BodyText:        body.BodyText,
		CreatedAt:       event.CreatedAt,
	}
	var existing persistence.TaskArtifactBlob
	err := tx.WithContext(ctx).Where("blob_id = ?", record.BlobID).First(&existing).Error
	if err == gorm.ErrRecordNotFound {
		return tx.WithContext(ctx).Create(&record).Error
	}
	if err != nil {
		return err
	}
	return tx.WithContext(ctx).Model(&persistence.TaskArtifactBlob{}).
		Where("blob_id = ?", record.BlobID).
		Updates(map[string]interface{}{
			"artifact_id":      record.ArtifactID,
			"task_id":          record.TaskID,
			"step_id":          record.StepID,
			"turn_id":          record.TurnID,
			"event_id":         record.EventID,
			"event_seq":        record.EventSeq,
			"body_kind":        record.BodyKind,
			"body_uri":         record.BodyURI,
			"content_hash":     record.ContentHash,
			"byte_size":        record.ByteSize,
			"retention_policy": record.RetentionPolicy,
			"retention_status": record.RetentionStatus,
			"body_text":        record.BodyText,
			"created_at":       record.CreatedAt,
		}).Error
}

func syncTaskArtifactForTaskEventTx(ctx context.Context, tx *gorm.DB, event *persistence.TaskEvent) error {
	if event == nil {
		return nil
	}
	payload := map[string]interface{}{}
	if strings.TrimSpace(event.Payload) != "" {
		_ = json.Unmarshal([]byte(event.Payload), &payload)
	}
	eventType := model.TaskEventType(event.EventType)
	blockKind := firstPayloadString(payload, "block_kind")
	if eventType != model.TaskEventType_TASK_EVENT_TYPE_ARTIFACT_CREATED && blockKind != "artifact" {
		return nil
	}
	artifactID := firstPayloadString(payload, "artifact_id", "artifactId", "id")
	if artifactID == "" {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "artifact_id is required", nil)
	}
	if err := validateArtifactEvidencePolicy(payload, event.TaskID, "artifact"); err != nil {
		return err
	}
	refsJSON, err := payloadStringListJSON(payload, "refs", "artifact_refs", "artifactRefs")
	if err != nil {
		return err
	}
	artifact := persistence.TaskArtifact{
		ArtifactID:  artifactID,
		TaskID:      event.TaskID,
		StepID:      event.StepID,
		TurnID:      event.TurnID,
		EventID:     event.ID,
		EventSeq:    event.EventSeq,
		RunID:       firstPayloadString(payload, "run_id", "runId"),
		Kind:        firstPayloadString(payload, "kind", "file_kind", "fileKind", "type"),
		Name:        firstPayloadString(payload, "name", "title"),
		URI:         firstPayloadString(payload, "uri", "url", "src"),
		Checksum:    firstPayloadString(payload, "checksum", "sha256"),
		ProducedBy:  firstPayloadString(payload, "produced_by", "producedBy"),
		RefsJSON:    refsJSON,
		PayloadJSON: event.Payload,
		CreatedAt:   event.CreatedAt,
	}
	var existing persistence.TaskArtifact
	err = tx.WithContext(ctx).Where("artifact_id = ?", artifact.ArtifactID).First(&existing).Error
	if err == gorm.ErrRecordNotFound {
		return tx.WithContext(ctx).Create(&artifact).Error
	}
	if err != nil {
		return err
	}
	return tx.WithContext(ctx).Model(&persistence.TaskArtifact{}).
		Where("artifact_id = ?", artifact.ArtifactID).
		Updates(map[string]interface{}{
			"task_id":      artifact.TaskID,
			"step_id":      artifact.StepID,
			"turn_id":      artifact.TurnID,
			"event_id":     artifact.EventID,
			"event_seq":    artifact.EventSeq,
			"run_id":       artifact.RunID,
			"kind":         artifact.Kind,
			"name":         artifact.Name,
			"uri":          artifact.URI,
			"checksum":     artifact.Checksum,
			"produced_by":  artifact.ProducedBy,
			"refs_json":    artifact.RefsJSON,
			"payload_json": artifact.PayloadJSON,
			"created_at":   artifact.CreatedAt,
		}).Error
}

func syncTaskGateResultForTaskEventTx(ctx context.Context, tx *gorm.DB, event *persistence.TaskEvent) error {
	if event == nil {
		return nil
	}
	payload := map[string]interface{}{}
	if strings.TrimSpace(event.Payload) != "" {
		_ = json.Unmarshal([]byte(event.Payload), &payload)
	}
	eventType := model.TaskEventType(event.EventType)
	blockKind := firstPayloadString(payload, "block_kind")
	if eventType != model.TaskEventType_TASK_EVENT_TYPE_GATE_RESULT && blockKind != "gate_result" {
		return nil
	}
	gateID := firstPayloadString(payload, "gate_id", "gateId", "id")
	if gateID == "" {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "gate_id is required", nil)
	}
	artifactIDsJSON, err := payloadStringListJSON(payload, "artifact_ids", "artifactIds")
	if err != nil {
		return err
	}
	checksJSON, err := payloadJSONField(payload, "checks")
	if err != nil {
		return err
	}
	result := persistence.TaskGateResult{
		GateResultID:    event.ID,
		TaskID:          event.TaskID,
		StepID:          event.StepID,
		TurnID:          event.TurnID,
		EventID:         event.ID,
		EventSeq:        event.EventSeq,
		GateID:          gateID,
		GatePlanID:      firstPayloadString(payload, "gate_plan_id", "gatePlanId"),
		Name:            firstPayloadString(payload, "name", "title"),
		Status:          firstPayloadString(payload, "status"),
		Summary:         firstPayloadString(payload, "summary", "result_summary", "resultSummary"),
		Blocking:        payloadBool(payload, "blocking"),
		ArtifactIDsJSON: artifactIDsJSON,
		ChecksJSON:      checksJSON,
		ProducedBy:      firstPayloadString(payload, "produced_by", "producedBy", "source"),
		PayloadJSON:     event.Payload,
		CreatedAt:       event.CreatedAt,
	}
	var existing persistence.TaskGateResult
	err = tx.WithContext(ctx).Where("gate_result_id = ?", result.GateResultID).First(&existing).Error
	if err == gorm.ErrRecordNotFound {
		return tx.WithContext(ctx).Create(&result).Error
	}
	if err != nil {
		return err
	}
	return tx.WithContext(ctx).Model(&persistence.TaskGateResult{}).
		Where("gate_result_id = ?", result.GateResultID).
		Updates(map[string]interface{}{
			"task_id":           result.TaskID,
			"step_id":           result.StepID,
			"turn_id":           result.TurnID,
			"event_id":          result.EventID,
			"event_seq":         result.EventSeq,
			"gate_id":           result.GateID,
			"gate_plan_id":      result.GatePlanID,
			"name":              result.Name,
			"status":            result.Status,
			"summary":           result.Summary,
			"blocking":          result.Blocking,
			"artifact_ids_json": result.ArtifactIDsJSON,
			"checks_json":       result.ChecksJSON,
			"produced_by":       result.ProducedBy,
			"payload_json":      result.PayloadJSON,
			"created_at":        result.CreatedAt,
		}).Error
}

func syncProjectBlockerForTaskEventTx(ctx context.Context, tx *gorm.DB, event *persistence.TaskEvent) error {
	if event == nil {
		return nil
	}
	payload := map[string]interface{}{}
	if strings.TrimSpace(event.Payload) != "" {
		_ = json.Unmarshal([]byte(event.Payload), &payload)
	}
	eventType := model.TaskEventType(event.EventType)
	now := event.CreatedAt
	if now.IsZero() {
		now = time.Now()
	}
	switch eventType {
	case model.TaskEventType_TASK_EVENT_TYPE_GATE_RESULT:
		if !payloadBool(payload, "blocking", "is_blocking", "isBlocking") {
			return nil
		}
		blockerID := firstNonEmptyString(firstPayloadString(payload, "gate_id", "gateId", "id"), event.ID)
		record := persistence.ProjectBlocker{
			BlockerID:      blockerID,
			TaskID:         event.TaskID,
			Scope:          "project",
			Owner:          firstNonEmptyString(firstPayloadString(payload, "owner"), "verifier"),
			Severity:       "block",
			State:          projectBlockerStateFromGatePayload(payload),
			EvidenceRef:    firstPayloadString(payload, "artifact_id", "artifactId", "evidence_ref", "evidenceRef"),
			Reason:         firstNonEmptyString(firstPayloadString(payload, "summary", "reason"), "blocking gate failed"),
			SourceEventID:  event.ID,
			SourceEventSeq: event.EventSeq,
			PayloadJSON:    event.Payload,
			CreatedAt:      now,
			UpdatedAt:      now,
		}
		return upsertProjectBlockerTx(ctx, tx, record)
	case model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_RESOLVED:
		if !strings.EqualFold(firstPayloadString(payload, "human_decision_reason", "humanDecisionReason", "reason"), "gate_blocked") {
			return nil
		}
		blockerID := firstPayloadString(payload, "gate_id", "gateId", "gate_blocked_id", "gateBlockedId")
		if blockerID == "" {
			return nil
		}
		state := projectBlockerStateFromHumanDecisionAction(firstPayloadString(payload, "human_decision_action", "humanDecisionAction", "action"))
		if state == "" {
			return nil
		}
		record := persistence.ProjectBlocker{
			BlockerID:      blockerID,
			TaskID:         event.TaskID,
			Scope:          "project",
			Owner:          "verifier",
			Severity:       "block",
			State:          state,
			EvidenceRef:    firstPayloadString(payload, "artifact_id", "artifactId", "evidence_ref", "evidenceRef"),
			Reason:         firstNonEmptyString(firstPayloadString(payload, "summary", "reason"), "blocking gate human decision recorded"),
			SourceEventID:  event.ID,
			SourceEventSeq: event.EventSeq,
			PayloadJSON:    event.Payload,
			CreatedAt:      now,
			UpdatedAt:      now,
		}
		return upsertProjectBlockerTx(ctx, tx, record)
	default:
		return nil
	}
}

func syncProjectStateForTaskEventTx(ctx context.Context, tx *gorm.DB, event *persistence.TaskEvent) error {
	if event == nil {
		return nil
	}
	payload := map[string]interface{}{}
	if strings.TrimSpace(event.Payload) != "" {
		_ = json.Unmarshal([]byte(event.Payload), &payload)
	}
	projectState, projectStateOK := normalizeProjectStateForIndex(firstPayloadString(payload, "project_state", "projectState"))
	milestoneState, milestoneStateOK := normalizeMilestoneStateForIndex(firstPayloadString(payload, "milestone_state", "milestoneState"))
	if !projectStateOK && !milestoneStateOK {
		return nil
	}
	projectID := firstNonEmptyString(firstPayloadString(payload, "project_id", "projectId"), event.TaskID)
	now := event.CreatedAt
	if now.IsZero() {
		now = time.Now()
	}
	record := persistence.ProjectState{
		ProjectID:      projectID,
		TaskID:         event.TaskID,
		ProjectState:   projectState,
		MilestoneState: milestoneState,
		SourceEventID:  event.ID,
		SourceEventSeq: event.EventSeq,
		PayloadJSON:    event.Payload,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	var existing persistence.ProjectState
	err := tx.WithContext(ctx).Where("project_id = ?", record.ProjectID).First(&existing).Error
	if err == gorm.ErrRecordNotFound {
		return tx.WithContext(ctx).Create(&record).Error
	}
	if err != nil {
		return err
	}
	if record.ProjectState == "" {
		record.ProjectState = existing.ProjectState
	}
	if record.MilestoneState == "" {
		record.MilestoneState = existing.MilestoneState
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

func syncAcceptancePredicateForTaskEventTx(ctx context.Context, tx *gorm.DB, event *persistence.TaskEvent) error {
	if event == nil {
		return nil
	}
	payload := map[string]interface{}{}
	if strings.TrimSpace(event.Payload) != "" {
		_ = json.Unmarshal([]byte(event.Payload), &payload)
	}
	predicateID := firstPayloadString(payload, "acceptance_predicate_id", "acceptancePredicateId", "predicate_id", "predicateId", "criteria_id", "criteriaId")
	if predicateID == "" {
		return nil
	}
	var existing persistence.AcceptancePredicate
	err := tx.WithContext(ctx).Where("predicate_id = ?", predicateID).First(&existing).Error
	if err != nil && err != gorm.ErrRecordNotFound {
		return err
	}
	level, ok := normalizeAcceptanceLevelForIndex(firstPayloadString(payload, "acceptance_level", "acceptanceLevel", "level"))
	if !ok {
		if err == gorm.ErrRecordNotFound {
			return nil
		}
		level = existing.Level
	}
	lastEval, lastEvalSet := payloadOptionalBool(payload, "last_eval", "lastEval", "eval", "passed", "accepted")
	humanSignoff, humanSignoffSet := payloadOptionalBool(payload, "human_signoff", "humanSignoff", "owner_signoff", "ownerSignoff")
	now := event.CreatedAt
	if now.IsZero() {
		now = time.Now()
	}
	record := persistence.AcceptancePredicate{
		PredicateID:    predicateID,
		TaskID:         event.TaskID,
		Scope:          firstNonEmptyString(firstPayloadString(payload, "scope"), "project"),
		Level:          level,
		Evaluator:      firstNonEmptyString(firstPayloadString(payload, "evaluator", "evaluator_kind", "evaluatorKind"), "verifier"),
		Expr:           firstPayloadString(payload, "expr", "predicate"),
		SourceEventID:  event.ID,
		SourceEventSeq: event.EventSeq,
		PayloadJSON:    event.Payload,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if lastEvalSet {
		record.LastEval = &lastEval
	}
	if humanSignoffSet {
		record.HumanSignoff = humanSignoff
	}
	if err == gorm.ErrRecordNotFound {
		return tx.WithContext(ctx).Create(&record).Error
	}
	if record.Scope == "" {
		record.Scope = existing.Scope
	}
	if record.Evaluator == "" {
		record.Evaluator = existing.Evaluator
	}
	if record.Expr == "" {
		record.Expr = existing.Expr
	}
	if !lastEvalSet {
		record.LastEval = existing.LastEval
	}
	if !humanSignoffSet {
		record.HumanSignoff = existing.HumanSignoff
	}
	return tx.WithContext(ctx).Model(&persistence.AcceptancePredicate{}).
		Where("predicate_id = ?", record.PredicateID).
		Updates(map[string]interface{}{
			"task_id":          record.TaskID,
			"scope":            record.Scope,
			"level":            record.Level,
			"evaluator":        record.Evaluator,
			"expr":             record.Expr,
			"last_eval":        record.LastEval,
			"human_signoff":    record.HumanSignoff,
			"source_event_id":  record.SourceEventID,
			"source_event_seq": record.SourceEventSeq,
			"payload_json":     record.PayloadJSON,
			"updated_at":       record.UpdatedAt,
		}).Error
}

func upsertProjectBlockerTx(ctx context.Context, tx *gorm.DB, record persistence.ProjectBlocker) error {
	if strings.TrimSpace(record.BlockerID) == "" {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "blocker_id is required", nil)
	}
	var existing persistence.ProjectBlocker
	err := tx.WithContext(ctx).Where("blocker_id = ?", record.BlockerID).First(&existing).Error
	if err == gorm.ErrRecordNotFound {
		if strings.TrimSpace(record.EvidenceRef) == "" {
			record.EvidenceRef = strings.TrimSpace(record.SourceEventID)
		}
		return tx.WithContext(ctx).Create(&record).Error
	}
	if err != nil {
		return err
	}
	if strings.TrimSpace(record.EvidenceRef) == "" {
		record.EvidenceRef = strings.TrimSpace(existing.EvidenceRef)
	}
	if strings.TrimSpace(record.EvidenceRef) == "" {
		record.EvidenceRef = strings.TrimSpace(record.SourceEventID)
	}
	return tx.WithContext(ctx).Model(&persistence.ProjectBlocker{}).
		Where("blocker_id = ?", record.BlockerID).
		Updates(map[string]interface{}{
			"task_id":          record.TaskID,
			"scope":            record.Scope,
			"owner":            record.Owner,
			"severity":         record.Severity,
			"state":            record.State,
			"evidence_ref":     record.EvidenceRef,
			"reason":           record.Reason,
			"source_event_id":  record.SourceEventID,
			"source_event_seq": record.SourceEventSeq,
			"payload_json":     record.PayloadJSON,
			"updated_at":       record.UpdatedAt,
		}).Error
}

func syncProjectResidualRiskForTaskEventTx(ctx context.Context, tx *gorm.DB, event *persistence.TaskEvent) error {
	if event == nil || model.TaskEventType(event.EventType) != model.TaskEventType_TASK_EVENT_TYPE_FEEDBACK_RECORDED {
		return nil
	}
	payload := map[string]interface{}{}
	if strings.TrimSpace(event.Payload) != "" {
		_ = json.Unmarshal([]byte(event.Payload), &payload)
	}
	if !strings.EqualFold(firstPayloadString(payload, "signal"), "negative") {
		return nil
	}
	riskID := firstNonEmptyString(firstPayloadString(payload, "risk_id", "riskId", "feedback_id", "feedbackId"), event.ID)
	now := event.CreatedAt
	if now.IsZero() {
		now = time.Now()
	}
	record := persistence.ProjectResidualRisk{
		RiskID:         riskID,
		TaskID:         event.TaskID,
		Description:    firstNonEmptyString(firstPayloadString(payload, "description", "desc", "comment"), "negative feedback recorded"),
		State:          firstNonEmptyString(firstPayloadString(payload, "risk_state", "riskState", "state"), "logged"),
		EvidenceRef:    firstPayloadString(payload, "block_id", "blockId", "artifact_id", "artifactId", "evidence_ref", "evidenceRef"),
		Owner:          firstNonEmptyString(firstPayloadString(payload, "owner"), "risk"),
		SourceEventID:  event.ID,
		SourceEventSeq: event.EventSeq,
		PayloadJSON:    event.Payload,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	var existing persistence.ProjectResidualRisk
	err := tx.WithContext(ctx).Where("risk_id = ?", record.RiskID).First(&existing).Error
	if err == gorm.ErrRecordNotFound {
		return tx.WithContext(ctx).Create(&record).Error
	}
	if err != nil {
		return err
	}
	return tx.WithContext(ctx).Model(&persistence.ProjectResidualRisk{}).
		Where("risk_id = ?", record.RiskID).
		Updates(map[string]interface{}{
			"task_id":          record.TaskID,
			"description":      record.Description,
			"state":            record.State,
			"evidence_ref":     record.EvidenceRef,
			"owner":            record.Owner,
			"source_event_id":  record.SourceEventID,
			"source_event_seq": record.SourceEventSeq,
			"payload_json":     record.PayloadJSON,
			"updated_at":       record.UpdatedAt,
		}).Error
}

func projectBlockerStateFromGatePayload(payload map[string]interface{}) string {
	switch strings.ToLower(strings.TrimSpace(firstPayloadString(payload, "status"))) {
	case "passed", "success", "ok":
		return "resolved"
	default:
		return "open"
	}
}

func normalizeProjectStateForIndex(raw string) (string, bool) {
	state := strings.ReplaceAll(strings.ToLower(strings.TrimSpace(raw)), "-", "_")
	switch state {
	case "draft", "contracted", "executing", "verifying", "awaiting_owner_signoff", "accepted", "blocked", "escalated":
		return state, true
	default:
		return "", false
	}
}

func normalizeMilestoneStateForIndex(raw string) (string, bool) {
	state := strings.ReplaceAll(strings.ToLower(strings.TrimSpace(raw)), "-", "_")
	switch state {
	case "planned", "active", "blocked", "replanning", "accepted", "abandoned":
		return state, true
	default:
		return "", false
	}
}

func normalizeAcceptanceLevelForIndex(raw string) (string, bool) {
	level := strings.ToUpper(strings.TrimSpace(raw))
	switch level {
	case "L0", "L1", "L2":
		return level, true
	default:
		return "", false
	}
}

func projectBlockerStateFromHumanDecisionAction(action string) string {
	switch strings.ToLower(strings.TrimSpace(action)) {
	case "accept_risk":
		return "waived"
	case "continue", "rerun_failed_node":
		return "resolved"
	default:
		return ""
	}
}

func firstPayloadString(payload map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		value, ok := payload[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case string:
			if trimmed := strings.TrimSpace(typed); trimmed != "" {
				return trimmed
			}
		}
	}
	return ""
}

func payloadBool(payload map[string]interface{}, keys ...string) bool {
	for _, key := range keys {
		value, ok := payload[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case bool:
			return typed
		case string:
			switch strings.ToLower(strings.TrimSpace(typed)) {
			case "true", "1", "yes":
				return true
			}
		}
	}
	return false
}

func payloadOptionalBool(payload map[string]interface{}, keys ...string) (bool, bool) {
	for _, key := range keys {
		value, ok := payload[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case bool:
			return typed, true
		case string:
			switch strings.ToLower(strings.TrimSpace(typed)) {
			case "true", "1", "yes", "y", "passed", "accepted", "success", "ok":
				return true, true
			case "false", "0", "no", "n", "failed", "rejected":
				return false, true
			}
		}
	}
	return false, false
}

func payloadJSONField(payload map[string]interface{}, key string) (string, error) {
	value, ok := payload[key]
	if !ok || value == nil {
		return "", nil
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	if string(encoded) == "null" {
		return "", nil
	}
	return string(encoded), nil
}

func payloadStringListJSON(payload map[string]interface{}, keys ...string) (string, error) {
	for _, key := range keys {
		value, ok := payload[key]
		if !ok || value == nil {
			continue
		}
		var refs []string
		switch typed := value.(type) {
		case []string:
			for _, item := range typed {
				if trimmed := strings.TrimSpace(item); trimmed != "" {
					refs = append(refs, trimmed)
				}
			}
		case []interface{}:
			for _, item := range typed {
				text, ok := item.(string)
				if !ok {
					return "", errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, key+" must contain only strings", nil)
				}
				if trimmed := strings.TrimSpace(text); trimmed != "" {
					refs = append(refs, trimmed)
				}
			}
		default:
			return "", errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, key+" must be a string array", nil)
		}
		if len(refs) == 0 {
			return "", nil
		}
		encoded, err := json.Marshal(refs)
		if err != nil {
			return "", err
		}
		return string(encoded), nil
	}
	return "", nil
}

// Publish appends the event to the outbox (when taskID is set) and mirrors it on
// the event bus with the resolved event_seq attached to metadata. The metadata
// keys agent_id/task_id are always present; optional keys are added when set.
func (w *TaskEventWriter) Publish(ctx context.Context, agentID, eventType string, payload interface{}, taskID, stepID, turnID string, extraMeta map[string]string) {
	metadata := map[string]string{
		"agent_id": agentID,
		"task_id":  taskID,
	}
	for k, v := range extraMeta {
		if strings.TrimSpace(v) != "" {
			metadata[k] = v
		}
	}
	eventID := generateID("evt")
	if strings.TrimSpace(taskID) != "" {
		record, err := w.Append(ctx, eventID, taskID, stepID, turnID, eventType, payload)
		if err != nil {
			logger.Errorf(ctx, "failed to append task event: task_id=%s event_type=%s err=%v", taskID, eventType, err)
			if isInterruptEventType(eventType) {
				return
			}
		} else {
			eventID = record.ID
			metadata["event_id"] = record.ID
			metadata["event_seq"] = fmt.Sprintf("%d", record.EventSeq)
		}
	}
	metadata["event_id"] = eventID
	if w.eventBus == nil {
		return
	}
	_ = w.eventBus.Publish(ctx, domain.DomainEvent{
		EventID:   eventID,
		EventType: eventType,
		ActorID:   agentID,
		Payload:   payload,
		Metadata:  metadata,
	})
}

func isInterruptEventType(eventType string) bool {
	return eventType == string(domain.EventTypeCollaborationInterruptRequested) ||
		eventType == string(domain.EventTypeCollaborationInterruptResolved)
}
