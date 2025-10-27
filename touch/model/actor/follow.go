package actor

import (
	"sync"
	"time"

	o "github.com/peers-touch/peers-touch-go/object"
	ap "github.com/peers-touch/peers-touch-go/vendors/activitypub"
)

// Following represents an actor's following collection
type Following struct {
	ap.Collection
	mu        sync.RWMutex
	listeners []FollowingListener
}

// FollowingListener defines the interface for following collection event listeners
type FollowingListener interface {
	OnFollow(actor o.ID) error
	OnUnfollow(actor o.ID) error
}

// NewFollowing creates a new Following collection
func NewFollowing(id o.ID) *Following {
	return &Following{
		Collection: ap.Collection{
			ID:        ap.ID(id),
			Type:      ap.CollectionType,
			Published: time.Now(),
			Items:     make(ap.ItemCollection, 0),
		},
		listeners: make([]FollowingListener, 0),
	}
}

// Follow adds an actor to the following collection
func (f *Following) Follow(actor o.ID) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	// Check if already following
	actorIRI := ap.IRI(actor)
	if f.Collection.Contains(actorIRI) {
		return nil
	}

	// Add to collection
	err := f.Collection.Append(actorIRI)
	if err != nil {
		return err
	}

	// Notify listeners
	for _, listener := range f.listeners {
		if err := listener.OnFollow(actor); err != nil {
			return err
		}
	}

	return nil
}

// Unfollow removes an actor from the following collection
func (f *Following) Unfollow(actor o.ID) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	actorIRI := ap.IRI(actor)
	if !f.Collection.Contains(actorIRI) {
		return nil
	}

	// Remove from collection
	newItems := make(ap.ItemCollection, 0, len(f.Collection.Items))
	for _, item := range f.Collection.Items {
		if !ap.ItemsEqual(item, actorIRI) {
			newItems = append(newItems, item)
		}
	}
	f.Collection.Items = newItems

	// Notify listeners
	for _, listener := range f.listeners {
		if err := listener.OnUnfollow(actor); err != nil {
			return err
		}
	}

	return nil
}

// GetFollowing returns all actors being followed
func (f *Following) GetFollowing() []o.ID {
	f.mu.RLock()
	defer f.mu.RUnlock()

	following := make([]o.ID, 0, len(f.Collection.Items))
	for _, item := range f.Collection.Items {
		if iri, ok := item.(ap.IRI); ok {
			following = append(following, o.ID(iri))
		}
	}
	return following
}

// IsFollowing checks if an actor is being followed
func (f *Following) IsFollowing(actor o.ID) bool {
	f.mu.RLock()
	defer f.mu.RUnlock()

	return f.Collection.Contains(ap.IRI(actor))
}

// Count returns the number of actors being followed
func (f *Following) Count() uint {
	f.mu.RLock()
	defer f.mu.RUnlock()

	return f.Collection.Count()
}

// AddListener adds a following event listener
func (f *Following) AddListener(listener FollowingListener) {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.listeners = append(f.listeners, listener)
}

// RemoveListener removes a following event listener
func (f *Following) RemoveListener(listener FollowingListener) {
	f.mu.Lock()
	defer f.mu.Unlock()

	for i, l := range f.listeners {
		if l == listener {
			f.listeners = append(f.listeners[:i], f.listeners[i+1:]...)
			break
		}
	}
}

// Clear removes all following relationships
func (f *Following) Clear() error {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.Collection.Items = make(ap.ItemCollection, 0)
	return nil
}

// Followers represents an actor's followers collection
type Followers struct {
	ap.Collection
	mu        sync.RWMutex
	listeners []FollowersListener
}

// FollowersListener defines the interface for followers collection event listeners
type FollowersListener interface {
	OnFollowerAdded(actor o.ID) error
	OnFollowerRemoved(actor o.ID) error
}

// NewFollowers creates a new Followers collection
func NewFollowers(id o.ID) *Followers {
	return &Followers{
		Collection: ap.Collection{
			ID:        ap.ID(id),
			Type:      ap.CollectionType,
			Published: time.Now(),
			Items:     make(ap.ItemCollection, 0),
		},
		listeners: make([]FollowersListener, 0),
	}
}

// AddFollower adds an actor to the followers collection
func (f *Followers) AddFollower(actor o.ID) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	// Check if already a follower
	actorIRI := ap.IRI(actor)
	if f.Collection.Contains(actorIRI) {
		return nil
	}

	// Add to collection
	err := f.Collection.Append(actorIRI)
	if err != nil {
		return err
	}

	// Notify listeners
	for _, listener := range f.listeners {
		if err := listener.OnFollowerAdded(actor); err != nil {
			return err
		}
	}

	return nil
}

// RemoveFollower removes an actor from the followers collection
func (f *Followers) RemoveFollower(actor o.ID) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	actorIRI := ap.IRI(actor)
	if !f.Collection.Contains(actorIRI) {
		return nil
	}

	// Remove from collection
	newItems := make(ap.ItemCollection, 0, len(f.Collection.Items))
	for _, item := range f.Collection.Items {
		if !ap.ItemsEqual(item, actorIRI) {
			newItems = append(newItems, item)
		}
	}
	f.Collection.Items = newItems

	// Notify listeners
	for _, listener := range f.listeners {
		if err := listener.OnFollowerRemoved(actor); err != nil {
			return err
		}
	}

	return nil
}

// GetFollowers returns all follower actors
func (f *Followers) GetFollowers() []o.ID {
	f.mu.RLock()
	defer f.mu.RUnlock()

	followers := make([]o.ID, 0, len(f.Collection.Items))
	for _, item := range f.Collection.Items {
		if iri, ok := item.(ap.IRI); ok {
			followers = append(followers, o.ID(iri))
		}
	}
	return followers
}

// IsFollower checks if an actor is a follower
func (f *Followers) IsFollower(actor o.ID) bool {
	f.mu.RLock()
	defer f.mu.RUnlock()

	return f.Collection.Contains(ap.IRI(actor))
}

// Count returns the number of followers
func (f *Followers) Count() uint {
	f.mu.RLock()
	defer f.mu.RUnlock()

	return f.Collection.Count()
}

// AddListener adds a followers event listener
func (f *Followers) AddListener(listener FollowersListener) {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.listeners = append(f.listeners, listener)
}

// RemoveListener removes a followers event listener
func (f *Followers) RemoveListener(listener FollowersListener) {
	f.mu.Lock()
	defer f.mu.Unlock()

	for i, l := range f.listeners {
		if l == listener {
			f.listeners = append(f.listeners[:i], f.listeners[i+1:]...)
			break
		}
	}
}

// Clear removes all followers
func (f *Followers) Clear() error {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.Collection.Items = make(ap.ItemCollection, 0)
	return nil
}
