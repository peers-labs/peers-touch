package event

import (
	"context"
	"sync"

	"github.com/peers-labs/peers-touch/station/frame/core/broker"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// DeliveryResult represents the result of event delivery
type DeliveryResult struct {
	EventID     string
	TargetID    string
	Status      EventStatus
	SentCount   int  // Number of connections that received the event
	IsOnline    bool // Whether the target was online
}

// DeliveryRouter routes events to the appropriate connections based on scope
// Implements the DeliveryRouter from the design doc
type DeliveryRouter struct {
	hub      *ConnectionHub
	broker   broker.Broker
	logger   logger.Logger
	mu       sync.RWMutex
	sequence map[string]int64 // targetID -> last sequence number
}

// NewDeliveryRouter creates a new DeliveryRouter
func NewDeliveryRouter(hub *ConnectionHub, brk broker.Broker, log logger.Logger) *DeliveryRouter {
	return &DeliveryRouter{
		hub:      hub,
		broker:   brk,
		logger:   log,
		sequence: make(map[string]int64),
	}
}

// Route routes an event to the appropriate targets
func (r *DeliveryRouter) Route(ctx context.Context, event *Event) []DeliveryResult {
	registry := r.hub.GetRegistry()
	targetActors := registry.GetTargetActors(event)

	results := make([]DeliveryResult, 0, len(targetActors))

	for _, targetID := range targetActors {
		// Check if target should receive this event type
		if !registry.ShouldReceive(targetID, event.Type) {
			continue
		}

		// Assign sequence number for this target
		event.Seq = r.nextSequence(targetID)

		// Check if target is online
		isOnline := r.hub.IsActorOnline(targetID)

		if isOnline {
			// Target is online, broadcast to their connections
			sentCount := r.hub.Broadcast(targetID, event)
			results = append(results, DeliveryResult{
				EventID:   event.ID,
				TargetID:  targetID,
				Status:    StatusInFlight,
				SentCount: sentCount,
				IsOnline:  true,
			})
			logger.Debugf(ctx, "[DeliveryRouter] Delivered event %s to %d connections of actor %s",
				event.ID, sentCount, targetID)
		} else {
			// Target is offline, store in broker for later retrieval
			results = append(results, DeliveryResult{
				EventID:   event.ID,
				TargetID:  targetID,
				Status:    StatusQueueSkipped,
				SentCount: 0,
				IsOnline:  false,
			})
			logger.Debugf(ctx, "[DeliveryRouter] Actor %s offline, event %s stored for later", targetID, event.ID)
		}

		// Always store event in broker for pull-based catch-up
		if r.broker != nil {
			topic := "events:" + targetID
			data, err := event.ToJSON()
			if err == nil {
				r.broker.Publish(ctx, topic, event.ID, nil, data, broker.PublishOptions{})
			}
		}
	}

	return results
}

// nextSequence generates the next sequence number for a target
func (r *DeliveryRouter) nextSequence(targetID string) int64 {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.sequence[targetID]++
	return r.sequence[targetID]
}

// PublishEvent is a convenience method to create and route an event
func (r *DeliveryRouter) PublishEvent(ctx context.Context, eventType EventType, actorID, targetID, objectID string, scope Scope, payload interface{}) error {
	event, err := NewEvent(eventType, actorID, targetID, objectID, scope, payload)
	if err != nil {
		return err
	}

	r.Route(ctx, event)
	return nil
}

// PublishChatMessage publishes a chat message event
func (r *DeliveryRouter) PublishChatMessage(ctx context.Context, senderID, recipientID, convID, messageID, content, msgType string) error {
	payload := ChatMessagePayload{
		ConvID:    convID,
		MessageID: messageID,
		SenderID:  senderID,
		Content:   content,
		MsgType:   msgType,
	}

	return r.PublishEvent(ctx, EventChatMessageAppended, senderID, recipientID, messageID, ScopeActor, payload)
}

// PublishMessageRead publishes a message read event
func (r *DeliveryRouter) PublishMessageRead(ctx context.Context, readerID, senderID, messageID string) error {
	payload := map[string]string{
		"readerId":  readerID,
		"messageId": messageID,
	}

	return r.PublishEvent(ctx, EventChatMessageRead, readerID, senderID, messageID, ScopeActor, payload)
}
