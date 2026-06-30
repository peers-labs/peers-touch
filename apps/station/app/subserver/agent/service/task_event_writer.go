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
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

// TaskEventWriter appends task events to the durable outbox with a monotonic
// per-task sequence and mirrors them onto the realtime event bus.
type TaskEventWriter struct {
	eventBus domain.EventBus
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
	db, err := w.getDB(ctx)
	if err != nil {
		return nil, err
	}
	payloadJSON, _ := json.Marshal(payload)
	record := persistence.TaskEvent{
		ID:        strings.TrimSpace(eventID),
		TaskID:    strings.TrimSpace(taskID),
		StepID:    strings.TrimSpace(stepID),
		TurnID:    strings.TrimSpace(turnID),
		EventType: int32(taskEventTypeForDomainEvent(eventType)),
		Payload:   string(payloadJSON),
		CreatedAt: time.Now(),
	}
	if record.ID == "" {
		record.ID = generateID("evt")
	}
	if record.TaskID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "task_id is required", nil)
	}
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var last persistence.TaskEvent
		if err := tx.Where("task_id = ?", record.TaskID).Order("event_seq DESC").First(&last).Error; err != nil && err != gorm.ErrRecordNotFound {
			return err
		}
		record.EventSeq = last.EventSeq + 1
		return tx.Create(&record).Error
	}); err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to append task event", err)
	}
	return &record, nil
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
		} else {
			eventID = record.ID
			metadata["event_seq"] = fmt.Sprintf("%d", record.EventSeq)
		}
	}
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
