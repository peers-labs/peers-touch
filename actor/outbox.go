package actor

import (
	"context"
	"fmt"
	"sync"
	"time"

	o "github.com/dirty-bro-tech/peers-touch-go/object"
	ap "github.com/dirty-bro-tech/peers-touch-go/vendors/activitypub"
)

// Outbox represents an actor's outbox collection for sending activities
type Outbox struct {
	collection *ap.OrderedCollection
	actorID    o.ID
	mu         sync.RWMutex
	listeners  []OutboxListener
}

// OutboxListener defines the interface for outbox event listeners
type OutboxListener interface {
	OnActivitySent(ctx context.Context, activity *o.Activity) error
	OnActivityQueued(ctx context.Context, activity *o.Activity) error
}

// OutboxOptions provides configuration options for creating an outbox
type OutboxOptions struct {
	ActorID   o.ID
	MaxItems  int
	Listeners []OutboxListener
}

// NewOutbox creates a new outbox for the specified actor
func NewOutbox(opts OutboxOptions) *Outbox {
	collection := &ap.OrderedCollection{
		ID:           ap.ID(fmt.Sprintf("%s/outbox", opts.ActorID)),
		Type:         ap.OrderedCollectionType,
		TotalItems:   0,
		OrderedItems: make(ap.ItemCollection, 0),
		Published:    time.Now(),
	}

	if opts.MaxItems > 0 {
		// Set a reasonable default if not specified
		if opts.MaxItems < 100 {
			opts.MaxItems = 1000
		}
	}

	return &Outbox{
		collection: collection,
		actorID:    opts.ActorID,
		listeners:  opts.Listeners,
	}
}

// SendActivity adds an activity to the outbox and marks it as sent
func (o *Outbox) SendActivity(ctx context.Context, activity *o.Activity) error {
	o.mu.Lock()
	defer o.mu.Unlock()

	// Convert to activitypub type
	apActivity := (*ap.Activity)(activity)

	// Add to the beginning of the collection (most recent first)
	o.collection.OrderedItems = append(ap.ItemCollection{apActivity}, o.collection.OrderedItems...)
	o.collection.TotalItems++

	// Notify listeners that activity was sent
	for _, listener := range o.listeners {
		if err := listener.OnActivitySent(ctx, activity); err != nil {
			// Log error but don't fail the send operation
			fmt.Printf("Outbox listener error: %v\n", err)
		}
	}

	return nil
}

// QueueActivity adds an activity to the outbox for later delivery
func (o *Outbox) QueueActivity(ctx context.Context, activity *o.Activity) error {
	o.mu.Lock()
	defer o.mu.Unlock()

	// Convert to activitypub type
	apActivity := (*ap.Activity)(activity)

	// Add to the beginning of the collection (most recent first)
	o.collection.OrderedItems = append(ap.ItemCollection{apActivity}, o.collection.OrderedItems...)
	o.collection.TotalItems++

	// Notify listeners that activity was queued
	for _, listener := range o.listeners {
		if err := listener.OnActivityQueued(ctx, activity); err != nil {
			// Log error but don't fail the queue operation
			fmt.Printf("Outbox listener error: %v\n", err)
		}
	}

	return nil
}

// GetActivities returns activities from the outbox with pagination
func (ob *Outbox) GetActivities(offset, limit int) ([]o.Activity, error) {
	ob.mu.RLock()
	defer ob.mu.RUnlock()

	total := len(ob.collection.OrderedItems)
	if offset >= total {
		return []o.Activity{}, nil
	}

	end := offset + limit
	if end > total {
		end = total
	}

	activities := make([]o.Activity, 0, end-offset)
	for j := offset; j < end; j++ {
		if activity, ok := ob.collection.OrderedItems[j].(*ap.Activity); ok {
			activities = append(activities, o.Activity(*activity))
		}
	}

	return activities, nil
}

// GetCollection returns the underlying OrderedCollection
func (o *Outbox) GetCollection() *ap.OrderedCollection {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return o.collection
}

// Count returns the total number of activities in the outbox
func (o *Outbox) Count() int {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return int(o.collection.TotalItems)
}

// AddListener adds a new outbox listener
func (o *Outbox) AddListener(listener OutboxListener) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.listeners = append(o.listeners, listener)
}

// RemoveActivity removes an activity from the outbox by ID
func (o *Outbox) RemoveActivity(activityID o.ID) error {
	o.mu.Lock()
	defer o.mu.Unlock()

	for idx, item := range o.collection.OrderedItems {
		if activity, ok := item.(*ap.Activity); ok {
			if activity.ID == ap.ID(activityID) {
				// Remove the activity
				o.collection.OrderedItems = append(
					o.collection.OrderedItems[:idx],
					o.collection.OrderedItems[idx+1:]...,
				)
				o.collection.TotalItems--
				return nil
			}
		}
	}

	return fmt.Errorf("activity with ID %s not found in outbox", activityID)
}

// Clear removes all activities from the outbox
func (o *Outbox) Clear() {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.collection.OrderedItems = make(ap.ItemCollection, 0)
	o.collection.TotalItems = 0
}

// GetPendingActivities returns activities that are queued but not yet sent
// This is a placeholder - in a real implementation, you'd track delivery status
func (ob *Outbox) GetPendingActivities() ([]o.Activity, error) {
	ob.mu.RLock()
	defer ob.mu.RUnlock()

	// For now, return all activities as this is a simple implementation
	// In a production system, you'd track delivery status separately
	activities := make([]o.Activity, 0, len(ob.collection.OrderedItems))
	for _, item := range ob.collection.OrderedItems {
		if activity, ok := item.(*ap.Activity); ok {
			activities = append(activities, o.Activity(*activity))
		}
	}

	return activities, nil
}
