package event

import (
	"sync"
)

// Subscription represents an actor's event subscription
type Subscription struct {
	ActorID    string
	Scope      Scope
	ScopeID    string       // e.g., convID for conv scope
	EventTypes []EventType  // Types to receive (empty = all)
}

// SubscriptionRegistry maintains actor/conv/content subscriptions to connection mappings
// Implements the SubscriptionRegistry from the design doc
type SubscriptionRegistry struct {
	mu   sync.RWMutex
	hub  *ConnectionHub
	
	// Actor subscriptions: actorID -> subscription config
	actorSubs map[string]*Subscription
	
	// Conversation subscriptions: convID -> [actorIDs]
	convSubs map[string][]string
	
	// Content subscriptions: contentID -> [actorIDs]
	contentSubs map[string][]string
}

// NewSubscriptionRegistry creates a new SubscriptionRegistry
func NewSubscriptionRegistry(hub *ConnectionHub) *SubscriptionRegistry {
	return &SubscriptionRegistry{
		hub:         hub,
		actorSubs:   make(map[string]*Subscription),
		convSubs:    make(map[string][]string),
		contentSubs: make(map[string][]string),
	}
}

// SubscribeActor subscribes an actor to receive their own events
func (r *SubscriptionRegistry) SubscribeActor(actorID string, eventTypes []EventType) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.actorSubs[actorID] = &Subscription{
		ActorID:    actorID,
		Scope:      ScopeActor,
		EventTypes: eventTypes,
	}
}

// UnsubscribeActor removes an actor's subscription
func (r *SubscriptionRegistry) UnsubscribeActor(actorID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	delete(r.actorSubs, actorID)
}

// SubscribeConversation subscribes an actor to a conversation's events
func (r *SubscriptionRegistry) SubscribeConversation(convID, actorID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Check if already subscribed
	for _, id := range r.convSubs[convID] {
		if id == actorID {
			return
		}
	}
	r.convSubs[convID] = append(r.convSubs[convID], actorID)
}

// UnsubscribeConversation removes an actor from a conversation subscription
func (r *SubscriptionRegistry) UnsubscribeConversation(convID, actorID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	actors := r.convSubs[convID]
	for i, id := range actors {
		if id == actorID {
			r.convSubs[convID] = append(actors[:i], actors[i+1:]...)
			break
		}
	}
}

// GetConversationSubscribers returns all actors subscribed to a conversation
func (r *SubscriptionRegistry) GetConversationSubscribers(convID string) []string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	actors := r.convSubs[convID]
	result := make([]string, len(actors))
	copy(result, actors)
	return result
}

// SubscribeContent subscribes an actor to a content's events (likes, comments, etc.)
func (r *SubscriptionRegistry) SubscribeContent(contentID, actorID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	for _, id := range r.contentSubs[contentID] {
		if id == actorID {
			return
		}
	}
	r.contentSubs[contentID] = append(r.contentSubs[contentID], actorID)
}

// ShouldReceive checks if an actor should receive a specific event type
func (r *SubscriptionRegistry) ShouldReceive(actorID string, eventType EventType) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()

	sub, exists := r.actorSubs[actorID]
	if !exists {
		return true // Default: receive all if no specific filter
	}

	if len(sub.EventTypes) == 0 {
		return true // Empty filter = receive all
	}

	for _, t := range sub.EventTypes {
		if t == eventType {
			return true
		}
	}
	return false
}

// GetTargetActors returns all actors who should receive an event based on scope
func (r *SubscriptionRegistry) GetTargetActors(event *Event) []string {
	switch event.Scope {
	case ScopeActor:
		// Direct actor events go to the target actor
		return []string{event.TargetID}
		
	case ScopeConv:
		// Conversation events go to all conversation members
		return r.GetConversationSubscribers(event.ObjectID)
		
	case ScopeContent:
		// Content events go to content subscribers
		r.mu.RLock()
		defer r.mu.RUnlock()
		actors := r.contentSubs[event.ObjectID]
		result := make([]string, len(actors))
		copy(result, actors)
		return result
		
	default:
		return []string{event.TargetID}
	}
}

// Stats returns subscription statistics
func (r *SubscriptionRegistry) Stats() map[string]interface{} {
	r.mu.RLock()
	defer r.mu.RUnlock()

	return map[string]interface{}{
		"actor_subscriptions":       len(r.actorSubs),
		"conversation_subscriptions": len(r.convSubs),
		"content_subscriptions":      len(r.contentSubs),
	}
}
