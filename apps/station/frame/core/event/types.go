package event

import (
	"encoding/json"
	"time"
)

// EventType defines the type of event (following design doc conventions)
type EventType string

const (
	// Chat events
	EventChatMessageAppended  EventType = "chat.message.appended"
	EventChatMessageDelivered EventType = "chat.message.delivered"
	EventChatMessageRead      EventType = "chat.message.read"

	// Follow events
	EventFollowRequested EventType = "follow.requested"
	EventFollowAccepted  EventType = "follow.accepted"
	EventFollowRejected  EventType = "follow.rejected"
	EventFollowUndone    EventType = "follow.undone"

	// System events
	EventSystemAlert       EventType = "system.alert"
	EventNodeStatusChanged EventType = "node.status.changed"
)

// Scope defines the event scope (who should receive it)
type Scope string

const (
	ScopeActor   Scope = "actor"   // Events for a specific actor
	ScopeConv    Scope = "conv"    // Events for a conversation
	ScopeContent Scope = "content" // Events for specific content
)

// Event represents a domain event that can be pushed to clients
type Event struct {
	ID        string            `json:"eventId"`
	Version   int               `json:"version"`
	Type      EventType         `json:"type"`
	ActorID   string            `json:"actorId"`   // Sender/originator
	TargetID  string            `json:"targetId"`  // Target actor (recipient)
	ObjectID  string            `json:"objectId"`  // Related object (message, post, etc.)
	Scope     Scope             `json:"scope"`
	Seq       int64             `json:"seq"`       // Per-target sequence number
	Timestamp time.Time         `json:"ts"`
	Payload   json.RawMessage   `json:"payload"`
	Headers   map[string]string `json:"headers,omitempty"`
}

// EventStatus represents the lifecycle state of an event
type EventStatus string

const (
	StatusPending      EventStatus = "PENDING"       // Written to outbox, awaiting dispatch
	StatusQueueSkipped EventStatus = "QUEUE_SKIPPED" // Target offline, stored for later
	StatusEnqueued     EventStatus = "ENQUEUED"      // In memory queue
	StatusInFlight     EventStatus = "IN_FLIGHT"     // Sent, awaiting ACK
	StatusAcked        EventStatus = "ACKED"         // Confirmed received
	StatusTimeout      EventStatus = "TIMEOUT"       // ACK deadline passed
	StatusRetry        EventStatus = "RETRY"         // Scheduled for retry
	StatusDeadLetter   EventStatus = "DEAD_LETTER"   // Exceeded max retries
)

// ChatMessagePayload is the payload for chat.message.* events
type ChatMessagePayload struct {
	ConvID    string `json:"convId"`
	MessageID string `json:"msgId"`
	SenderID  string `json:"senderId"`
	Content   string `json:"content,omitempty"`
	MsgType   string `json:"msgType,omitempty"`
	Timestamp int64  `json:"timestamp"`
}

// ToJSON converts the event to JSON bytes for SSE transmission
func (e *Event) ToJSON() ([]byte, error) {
	return json.Marshal(e)
}

// NewEvent creates a new event with auto-generated ID and timestamp
func NewEvent(eventType EventType, actorID, targetID, objectID string, scope Scope, payload interface{}) (*Event, error) {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	return &Event{
		ID:        generateEventID(),
		Version:   1,
		Type:      eventType,
		ActorID:   actorID,
		TargetID:  targetID,
		ObjectID:  objectID,
		Scope:     scope,
		Timestamp: time.Now().UTC(),
		Payload:   payloadBytes,
	}, nil
}

// generateEventID generates a time-based unique event ID
func generateEventID() string {
	return time.Now().UTC().Format("20060102T150405.000000000")
}
