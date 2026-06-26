package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

type EventStream struct {
	ID        string
	AgentID   string
	events    chan domain.DomainEvent
	done      chan struct{}
	once      sync.Once
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
		EventID   string          `json:"event_id"`
		EventType string          `json:"event_type"`
		OccurredAt int64          `json:"occurred_at"`
		ActorID   string          `json:"actor_id,omitempty"`
		Payload   interface{}     `json:"payload"`
		Metadata  map[string]string `json:"metadata,omitempty"`
	}

	env := eventEnvelope{
		EventID:   event.EventID,
		EventType: event.EventType,
		OccurredAt: event.OccurredAt.UnixMilli(),
		ActorID:   event.ActorID,
		Payload:   event.Payload,
		Metadata:  event.Metadata,
	}

	data, _ := json.Marshal(env)
	return data
}
