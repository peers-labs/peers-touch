package actor

import (
	"sync"
	"time"

	o "github.com/peers-touch/peers-touch/station/frame/object"
	ap "github.com/peers-touch/peers-touch/station/frame/vendors/activitypub"
)

// Liked represents an actor's liked collection
type Liked struct {
	ap.OrderedCollection
	mu        sync.RWMutex
	listeners []LikedListener
}

// LikedListener defines the interface for liked collection event listeners
type LikedListener interface {
	OnLike(object o.ID) error
	OnUnlike(object o.ID) error
}

// NewLiked creates a new Liked collection
func NewLiked(id o.ID) *Liked {
	return &Liked{
		OrderedCollection: ap.OrderedCollection{
			ID:           ap.ID(id),
			Type:         ap.OrderedCollectionType,
			Published:    time.Now(),
			OrderedItems: make(ap.ItemCollection, 0),
		},
		listeners: make([]LikedListener, 0),
	}
}

// Like adds an object to the liked collection
func (l *Liked) Like(object o.ID) error {
	l.mu.Lock()
	defer l.mu.Unlock()

	// Check if already liked
	objectIRI := ap.IRI(object)
	if l.OrderedCollection.Contains(objectIRI) {
		return nil
	}

	// Add to collection (prepend for reverse chronological order)
	err := l.OrderedCollection.Append(objectIRI)
	if err != nil {
		return err
	}

	// Notify listeners
	for _, listener := range l.listeners {
		if err := listener.OnLike(object); err != nil {
			return err
		}
	}

	return nil
}

// Unlike removes an object from the liked collection
func (l *Liked) Unlike(object o.ID) error {
	l.mu.Lock()
	defer l.mu.Unlock()

	objectIRI := ap.IRI(object)
	if !l.OrderedCollection.Contains(objectIRI) {
		return nil
	}

	// Remove from collection
	newItems := make(ap.ItemCollection, 0, len(l.OrderedCollection.OrderedItems))
	for _, item := range l.OrderedCollection.OrderedItems {
		if !ap.ItemsEqual(item, objectIRI) {
			newItems = append(newItems, item)
		}
	}
	l.OrderedCollection.OrderedItems = newItems

	// Notify listeners
	for _, listener := range l.listeners {
		if err := listener.OnUnlike(object); err != nil {
			return err
		}
	}

	return nil
}

// GetLiked returns all liked objects
func (l *Liked) GetLiked() []o.ID {
	l.mu.RLock()
	defer l.mu.RUnlock()

	liked := make([]o.ID, 0, len(l.OrderedCollection.OrderedItems))
	for _, item := range l.OrderedCollection.OrderedItems {
		if iri, ok := item.(ap.IRI); ok {
			liked = append(liked, o.ID(iri))
		}
	}
	return liked
}

// GetLikedPaginated returns a paginated list of liked objects
func (l *Liked) GetLikedPaginated(offset, limit int) []o.ID {
	l.mu.RLock()
	defer l.mu.RUnlock()

	items := l.OrderedCollection.OrderedItems
	if offset >= len(items) {
		return []o.ID{}
	}

	end := offset + limit
	if end > len(items) {
		end = len(items)
	}

	liked := make([]o.ID, 0, end-offset)
	for i := offset; i < end; i++ {
		if iri, ok := items[i].(ap.IRI); ok {
			liked = append(liked, o.ID(iri))
		}
	}
	return liked
}

// IsLiked checks if an object is liked
func (l *Liked) IsLiked(object o.ID) bool {
	l.mu.RLock()
	defer l.mu.RUnlock()

	return l.OrderedCollection.Contains(ap.IRI(object))
}

// Count returns the number of liked objects
func (l *Liked) Count() uint {
	l.mu.RLock()
	defer l.mu.RUnlock()

	return l.OrderedCollection.Count()
}

// AddListener adds a liked event listener
func (l *Liked) AddListener(listener LikedListener) {
	l.mu.Lock()
	defer l.mu.Unlock()

	l.listeners = append(l.listeners, listener)
}

// RemoveListener removes a liked event listener
func (l *Liked) RemoveListener(listener LikedListener) {
	l.mu.Lock()
	defer l.mu.Unlock()

	for i, li := range l.listeners {
		if li == listener {
			l.listeners = append(l.listeners[:i], l.listeners[i+1:]...)
			break
		}
	}
}

// Clear removes all liked objects
func (l *Liked) Clear() error {
	l.mu.Lock()
	defer l.mu.Unlock()

	l.OrderedCollection.OrderedItems = make(ap.ItemCollection, 0)
	return nil
}
