package actor

import (
	"context"
	"fmt"
	"sync"
	"time"

	o "github.com/dirty-bro-tech/peers-touch-go/object"
	ap "github.com/dirty-bro-tech/peers-touch-go/vendors/activitypub"
)

// Inbox represents an actor's inbox collection for receiving activities
type Inbox struct {
	collection *ap.OrderedCollection
	actorID    o.ID
	mu         sync.RWMutex
	listeners  []InboxListener
}

// InboxListener defines the interface for inbox event listeners
type InboxListener interface {
	OnActivityReceived(ctx context.Context, activity *o.Activity) error
}

// InboxOptions provides configuration options for creating an inbox
type InboxOptions struct {
	ActorID   o.ID
	MaxItems  int
	Listeners []InboxListener
}

// NewInbox creates a new inbox for the specified actor
func NewInbox(opts InboxOptions) *Inbox {
	collection := &ap.OrderedCollection{
		ID:           ap.ID(fmt.Sprintf("%s/inbox", opts.ActorID)),
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

	return &Inbox{
		collection: collection,
		actorID:    opts.ActorID,
		listeners:  opts.Listeners,
	}
}

// ReceiveActivity adds an activity to the inbox
func (i *Inbox) ReceiveActivity(ctx context.Context, activity *o.Activity) error {
	i.mu.Lock()
	defer i.mu.Unlock()

	// Convert to activitypub type
	apActivity := (*ap.Activity)(activity)

	// Add to the beginning of the collection (most recent first)
	i.collection.OrderedItems = append(ap.ItemCollection{apActivity}, i.collection.OrderedItems...)
	i.collection.TotalItems++

	// Notify listeners
	for _, listener := range i.listeners {
		if err := listener.OnActivityReceived(ctx, activity); err != nil {
			// Log error but don't fail the receive operation
			fmt.Printf("Inbox listener error: %v\n", err)
		}
	}

	return nil
}

// GetActivities returns activities from the inbox with pagination
func (i *Inbox) GetActivities(offset, limit int) ([]o.Activity, error) {
	i.mu.RLock()
	defer i.mu.RUnlock()

	total := len(i.collection.OrderedItems)
	if offset >= total {
		return []o.Activity{}, nil
	}

	end := offset + limit
	if end > total {
		end = total
	}

	activities := make([]o.Activity, 0, end-offset)
	for j := offset; j < end; j++ {
		if activity, ok := i.collection.OrderedItems[j].(*ap.Activity); ok {
			activities = append(activities, o.Activity(*activity))
		}
	}

	return activities, nil
}

// GetCollection returns the underlying OrderedCollection
func (i *Inbox) GetCollection() *ap.OrderedCollection {
	i.mu.RLock()
	defer i.mu.RUnlock()
	return i.collection
}

// Count returns the total number of activities in the inbox
func (i *Inbox) Count() int {
	i.mu.RLock()
	defer i.mu.RUnlock()
	return int(i.collection.TotalItems)
}

// AddListener adds a new inbox listener
func (i *Inbox) AddListener(listener InboxListener) {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.listeners = append(i.listeners, listener)
}

// RemoveActivity removes an activity from the inbox by ID
func (i *Inbox) RemoveActivity(activityID o.ID) error {
	i.mu.Lock()
	defer i.mu.Unlock()

	for idx, item := range i.collection.OrderedItems {
		if activity, ok := item.(*ap.Activity); ok {
			if activity.ID == ap.ID(activityID) {
				// Remove the activity
				i.collection.OrderedItems = append(
					i.collection.OrderedItems[:idx],
					i.collection.OrderedItems[idx+1:]...,
				)
				i.collection.TotalItems--
				return nil
			}
		}
	}

	return fmt.Errorf("activity with ID %s not found in inbox", activityID)
}

// Clear removes all activities from the inbox
func (i *Inbox) Clear() {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.collection.OrderedItems = make(ap.ItemCollection, 0)
	i.collection.TotalItems = 0
}
