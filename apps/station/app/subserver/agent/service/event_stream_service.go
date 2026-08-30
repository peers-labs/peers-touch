package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

type EventStream struct {
	ID      string
	AgentID string
	events  chan domain.DomainEvent
	done    chan struct{}
	once    sync.Once
}

func (s *EventStream) Events() <-chan domain.DomainEvent {
	return s.events
}

func (s *EventStream) Done() <-chan struct{} {
	return s.done
}

func (s *EventStream) Close() {
	s.once.Do(func() {
		close(s.done)
	})
}

type EventStreamService struct {
	eventBus domain.EventBus
	streams  map[string][]*EventStream
	mu       sync.RWMutex
}

func NewEventStreamService(eventBus domain.EventBus) *EventStreamService {
	svc := &EventStreamService{
		eventBus: eventBus,
		streams:  make(map[string][]*EventStream),
	}

	eventBus.SubscribeAll(func(ctx context.Context, event domain.DomainEvent) error {
		svc.dispatch(event)
		return nil
	})

	return svc
}

func (s *EventStreamService) Subscribe(ctx context.Context, agentID string) *EventStream {
	stream := &EventStream{
		ID:      fmt.Sprintf("stream-%p", &EventStream{}),
		AgentID: agentID,
		events:  make(chan domain.DomainEvent, 64),
		done:    make(chan struct{}),
	}

	s.mu.Lock()
	s.streams[agentID] = append(s.streams[agentID], stream)
	count := len(s.streams[agentID])
	s.mu.Unlock()

	logger.Infof(ctx, "event stream subscribed: agent_id=%s total=%d", agentID, count)

	go func() {
		select {
		case <-ctx.Done():
		case <-stream.Done():
		}
		s.unsubscribe(agentID, stream)
	}()

	return stream
}

func (s *EventStreamService) ReplayTaskEvents(ctx context.Context, actorPTID, agentID, taskID string, afterEventSeq int64) ([]domain.DomainEvent, error) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return nil, nil
	}
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to open agent db", err)
	}
	if strings.TrimSpace(actorPTID) != "" {
		// A task id may belong to a Canvas collaboration task (goal_owner_ptid) or
		// a Chat root task (owner_actor_ptid). Accept ownership from either source.
		var collab persistence.CollaborationTask
		collabErr := db.WithContext(ctx).Where("id = ? AND goal_owner_ptid = ?", taskID, actorPTID).First(&collab).Error
		if collabErr != nil && collabErr != gorm.ErrRecordNotFound {
			return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to get collaboration task", collabErr)
		}
		if collabErr == gorm.ErrRecordNotFound {
			var chatTask persistence.TaskRun
			chatErr := db.WithContext(ctx).Where("task_id = ? AND owner_actor_ptid = ?", taskID, actorPTID).First(&chatTask).Error
			if chatErr == gorm.ErrRecordNotFound {
				return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "task not found", chatErr)
			}
			if chatErr != nil {
				return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to get chat task", chatErr)
			}
		}
	}

	var records []persistence.TaskEvent
	if err := db.WithContext(ctx).
		Where("task_id = ? AND event_seq > ?", taskID, afterEventSeq).
		Order("event_seq ASC").
		Limit(500).
		Find(&records).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to replay task events", err)
	}

	events := make([]domain.DomainEvent, 0, len(records))
	for i := range records {
		event, ok := taskEventRecordToDomainEvent(&records[i], actorPTID, agentID)
		if ok {
			events = append(events, event)
		}
	}
	return events, nil
}

func (s *EventStreamService) unsubscribe(agentID string, stream *EventStream) {
	s.mu.Lock()
	defer s.mu.Unlock()

	streams, ok := s.streams[agentID]
	if !ok {
		return
	}

	for i, st := range streams {
		if st.ID == stream.ID {
			s.streams[agentID] = append(streams[:i], streams[i+1:]...)
			stream.Close()
			break
		}
	}

	if len(s.streams[agentID]) == 0 {
		delete(s.streams, agentID)
	}
}

func (s *EventStreamService) dispatch(event domain.DomainEvent) {
	agentID := ""
	if meta, ok := event.Metadata["agent_id"]; ok {
		agentID = meta
	}
	if agentID == "" {
		return
	}

	s.mu.RLock()
	streams, ok := s.streams[agentID]
	s.mu.RUnlock()

	if !ok {
		return
	}

	for _, stream := range streams {
		select {
		case stream.events <- event:
		default:
			logger.Warnf(context.Background(), "event stream buffer full: stream_id=%s agent_id=%s event_type=%s",
				stream.ID, agentID, event.EventType)
		}
	}
}

func SerializeEvent(event domain.DomainEvent) []byte {
	type eventEnvelope struct {
		EventID    string            `json:"event_id"`
		EventType  string            `json:"event_type"`
		OccurredAt int64             `json:"occurred_at"`
		ActorPTID  string            `json:"actor_ptid,omitempty"`
		AgentID    string            `json:"agent_id,omitempty"`
		Payload    interface{}       `json:"payload"`
		Metadata   map[string]string `json:"metadata,omitempty"`
	}

	env := eventEnvelope{
		EventID:    event.EventID,
		EventType:  event.EventType,
		OccurredAt: event.OccurredAt.UnixMilli(),
		ActorPTID:  event.ActorPTID,
		AgentID:    event.AgentID,
		Payload:    event.Payload,
		Metadata:   event.Metadata,
	}

	data, _ := json.Marshal(env)
	return data
}

func taskEventRecordToDomainEvent(record *persistence.TaskEvent, actorPTID, subscribedAgentID string) (domain.DomainEvent, bool) {
	payload := map[string]interface{}{}
	if strings.TrimSpace(record.Payload) != "" {
		if err := json.Unmarshal([]byte(record.Payload), &payload); err != nil {
			payload["raw"] = record.Payload
		}
	}
	payloadAgentID := payloadString(payload, "agent_id")
	if payloadAgentID != "" && subscribedAgentID != "" && payloadAgentID != subscribedAgentID {
		return domain.DomainEvent{}, false
	}
	agentID := payloadAgentID
	if agentID == "" {
		agentID = subscribedAgentID
	}
	metadata := map[string]string{
		"task_id":   record.TaskID,
		"event_id":  record.ID,
		"event_seq": fmt.Sprintf("%d", record.EventSeq),
	}
	if agentID != "" {
		metadata["agent_id"] = agentID
	}
	if strings.TrimSpace(record.StepID) != "" {
		metadata["node_id"] = record.StepID
	}
	return domain.DomainEvent{
		EventID:    record.ID,
		EventType:  taskEventDomainType(record.EventType, payload),
		OccurredAt: record.CreatedAt,
		ActorPTID:  strings.TrimSpace(actorPTID),
		AgentID:    agentID,
		Payload:    payload,
		Metadata:   metadata,
	}, true
}

func taskEventDomainType(eventType int32, payload map[string]interface{}) string {
	switch payloadString(payload, "block_kind") {
	case "artifact":
		return string(domain.EventTypeCollaborationArtifactCreated)
	case "gate_result":
		return string(domain.EventTypeCollaborationGateResult)
	case "decision_resolved":
		return string(domain.EventTypeCollaborationInterruptResolved)
	}
	switch model.TaskEventType(eventType) {
	case model.TaskEventType_TASK_EVENT_TYPE_TASK_CREATED:
		return string(domain.EventTypeCollaborationTaskCreated)
	case model.TaskEventType_TASK_EVENT_TYPE_TASK_STATUS_CHANGED:
		switch intPayload(payload, "status") {
		case int(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_FAILED):
			return string(domain.EventTypeCollaborationTaskFailed)
		case int(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_CANCELLED):
			return string(domain.EventTypeCollaborationTaskCancelled)
		default:
			return string(domain.EventTypeCollaborationTaskCompleted)
		}
	case model.TaskEventType_TASK_EVENT_TYPE_STEP_STARTED:
		return string(domain.EventTypeCollaborationNodeRunning)
	case model.TaskEventType_TASK_EVENT_TYPE_STEP_COMPLETED:
		return string(domain.EventTypeCollaborationNodeCompleted)
	case model.TaskEventType_TASK_EVENT_TYPE_STEP_FAILED:
		return string(domain.EventTypeCollaborationNodeFailed)
	case model.TaskEventType_TASK_EVENT_TYPE_ARTIFACT_CREATED:
		return string(domain.EventTypeCollaborationArtifactCreated)
	case model.TaskEventType_TASK_EVENT_TYPE_GATE_RESULT:
		return string(domain.EventTypeCollaborationGateResult)
	case model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_REQUESTED:
		return string(domain.EventTypeCollaborationInterruptRequested)
	case model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_RESOLVED:
		return string(domain.EventTypeCollaborationInterruptResolved)
	case model.TaskEventType_TASK_EVENT_TYPE_FEEDBACK_RECORDED:
		return string(domain.EventTypeCollaborationFeedbackRecorded)
	case model.TaskEventType_TASK_EVENT_TYPE_TURN_EVENT:
		return string(domain.EventTypeAgentTurnCompleted)
	default:
		return model.TaskEventType(eventType).String()
	}
}

func payloadString(payload map[string]interface{}, key string) string {
	value, ok := payload[key]
	if !ok {
		return ""
	}
	if str, ok := value.(string); ok {
		return strings.TrimSpace(str)
	}
	return ""
}

func intPayload(payload map[string]interface{}, key string) int {
	switch value := payload[key].(type) {
	case float64:
		return int(value)
	case int:
		return value
	case int32:
		return int(value)
	case int64:
		return int(value)
	default:
		return 0
	}
}
