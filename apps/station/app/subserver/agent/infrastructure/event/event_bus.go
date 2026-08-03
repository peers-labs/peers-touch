package event

import (
	"context"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
)

type MemoryEventBus struct {
	mu          sync.RWMutex
	subscribers map[string][]domain.EventHandler
	globalSubs  []domain.EventHandler
}

func NewMemoryEventBus() *MemoryEventBus {
	return &MemoryEventBus{
		subscribers: make(map[string][]domain.EventHandler),
	}
}

func (b *MemoryEventBus) Publish(ctx context.Context, event domain.DomainEvent) error {
	if event.OccurredAt.IsZero() {
		event.OccurredAt = time.Now()
	}

	b.mu.RLock()
	defer b.mu.RUnlock()

	for _, handler := range b.globalSubs {
		go func(h domain.EventHandler) {
			_ = h(ctx, event)
		}(handler)
	}

	handlers, ok := b.subscribers[event.EventType]
	if !ok {
		return nil
	}

	for _, handler := range handlers {
		go func(h domain.EventHandler) {
			_ = h(ctx, event)
		}(handler)
	}

	return nil
}

func (b *MemoryEventBus) Subscribe(eventType string, handler domain.EventHandler) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.subscribers[eventType] = append(b.subscribers[eventType], handler)
}

func (b *MemoryEventBus) SubscribeAll(handler domain.EventHandler) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.globalSubs = append(b.globalSubs, handler)
}

func (b *MemoryEventBus) Unsubscribe(eventType string, handler domain.EventHandler) {
	b.mu.Lock()
	defer b.mu.Unlock()

	handlers, ok := b.subscribers[eventType]
	if !ok {
		return
	}

	for i, h := range handlers {
		if &h == &handler {
			b.subscribers[eventType] = append(handlers[:i], handlers[i+1:]...)
			break
		}
	}
}

var _ domain.EventBus = (*MemoryEventBus)(nil)
