package ingress

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/model"
)

// DeduplicateMiddleware skips duplicate platform deliveries.
//
// Two keys are tracked per binding:
//   - event:<binding>\x00<event_id>   primary (v2 header.event_id / v1 uuid)
//   - msgid:<binding>\x00<message_id> secondary, catching the same user
//     message arriving through two event versions with different event ids
//
// A concurrent duplicate waits until the first delivery (the leader) crosses
// its durable admission boundary; it then succeeds without side effects. A
// duplicate arriving after the leader finished is skipped immediately. A
// leader that fails before admission returns ErrRetryOnly so the platform
// redelivers without user-visible output.
func DeduplicateMiddleware() Middleware {
	return DeduplicateMiddlewareWithCache(newDedupCache(1024, 5*time.Minute))
}

// DeduplicateMiddlewareWithCache injects the cache (tests use small/short TTLs).
func DeduplicateMiddlewareWithCache(cache *dedupCache) Middleware {
	return func(next Handler) Handler {
		return func(ctx context.Context, event *model.NormalizedInboundEvent) (string, error) {
			eventKey := platformEventDedupKey(event)
			if eventKey == "" {
				return next(ctx, event)
			}
			messageKey := messageIDDedupKey(event)

			leaderEntry, state := cache.claim(eventKey)
			switch state {
			case dedupWaiting:
				if cache.waitForAcceptance(ctx, leaderEntry) {
					MarkMessageDuplicate(ctx)
					return "", nil
				}
				if err := ctx.Err(); err != nil {
					return "", err
				}
				return "", fmt.Errorf("%w: duplicate event leader failed before admission", ErrRetryOnly)
			case dedupDone:
				MarkMessageDuplicate(ctx)
				return "", nil
			}

			// Secondary message-id claim catches dual-version delivery.
			var messageEntry *dedupEntry
			if messageKey != "" {
				var msgState dedupLookupState
				messageEntry, msgState = cache.claim(messageKey)
				switch msgState {
				case dedupWaiting:
					cache.abort(eventKey, leaderEntry)
					if cache.waitForAcceptance(ctx, messageEntry) {
						MarkMessageDuplicate(ctx)
						return "", nil
					}
					if err := ctx.Err(); err != nil {
						return "", err
					}
					return "", fmt.Errorf("%w: duplicate message leader failed before admission", ErrRetryOnly)
				case dedupDone:
					cache.abort(eventKey, leaderEntry)
					MarkMessageDuplicate(ctx)
					return "", nil
				}
			}

			hasObserver := false
			if tracksTransportAcceptance(ctx) {
				registerAcceptanceObserver(ctx, func(accepted bool) {
					if accepted {
						cache.accept(eventKey, leaderEntry)
						if messageEntry != nil {
							cache.accept(messageKey, messageEntry)
						}
						return
					}
					cache.abort(eventKey, leaderEntry)
					if messageEntry != nil {
						cache.abort(messageKey, messageEntry)
					}
				})
				// When the transport exposes only a direct MarkAccepted hook,
				// wrap it so the dedup entry is admitted at the same moment.
				callbacks, _ := ctx.Value(runtimeCallbacksKey).(RuntimeCallbacks)
				hasObserver = callbacks.RegisterAcceptanceObserver != nil
				if !hasObserver && callbacks.MarkAccepted != nil {
					transportAccepted := callbacks.MarkAccepted
					callbacks.MarkAccepted = func() {
						cache.accept(eventKey, leaderEntry)
						if messageEntry != nil {
							cache.accept(messageKey, messageEntry)
						}
						transportAccepted()
					}
					ctx = context.WithValue(ctx, runtimeCallbacksKey, callbacks)
				}
			} else {
				// No asynchronous admission hook: successful completion admits.
				defer func() {
					cache.complete(eventKey, leaderEntry)
					if messageEntry != nil {
						cache.complete(messageKey, messageEntry)
					}
				}()
			}

			reply, err := next(ctx, event)
			if err != nil {
				if hasObserver {
					// Async admission owns the entry; it must abort on
					// failure. Used by the durable turn-admission wiring.
					cache.finish(eventKey, leaderEntry)
					if messageEntry != nil {
						cache.finish(messageKey, messageEntry)
					}
				} else {
					// Direct-accept mode: remove the entry so platform
					// redelivery runs as a fresh leader.
					cache.fail(eventKey, leaderEntry)
					if messageEntry != nil {
						cache.fail(messageKey, messageEntry)
					}
				}
				return reply, err
			}
			if hasObserver {
				cache.finish(eventKey, leaderEntry)
				if messageEntry != nil {
					cache.finish(messageKey, messageEntry)
				}
			} else {
				cache.complete(eventKey, leaderEntry)
				if messageEntry != nil {
					cache.complete(messageKey, messageEntry)
				}
			}
			return reply, nil
		}
	}
}

func platformEventDedupKey(event *model.NormalizedInboundEvent) string {
	eventID := strings.TrimSpace(event.GetEventId())
	if eventID == "" {
		return ""
	}
	return "event:" + scopedDedupValue(event.GetBindingId(), eventID)
}

func messageIDDedupKey(event *model.NormalizedInboundEvent) string {
	messageID := strings.TrimSpace(event.GetMessageId())
	if messageID == "" {
		return ""
	}
	return "msgid:" + scopedDedupValue(event.GetBindingId(), messageID)
}

func scopedDedupValue(bindingID, value string) string {
	bindingID = strings.TrimSpace(bindingID)
	if bindingID == "" {
		return value
	}
	return bindingID + "\x00" + value
}

type dedupLookupState int

const (
	dedupLeader dedupLookupState = iota
	dedupWaiting
	dedupDone
)

type dedupEntry struct {
	inFlight  bool
	finished  bool
	accepted  bool
	waiters   int
	expiresAt time.Time

	acceptedC chan struct{}
	done      chan struct{}
}

type dedupCache struct {
	mu      sync.Mutex
	entries map[string]*dedupEntry
	maxSize int
	ttl     time.Duration
}

func newDedupCache(maxSize int, ttl time.Duration) *dedupCache {
	return &dedupCache{
		entries: make(map[string]*dedupEntry, maxSize),
		maxSize: maxSize,
		ttl:     ttl,
	}
}

func (c *dedupCache) claim(key string) (*dedupEntry, dedupLookupState) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if e, ok := c.entries[key]; ok {
		if e.inFlight {
			return e, dedupWaiting
		}
		if !e.expiresAt.IsZero() && time.Now().After(e.expiresAt) {
			delete(c.entries, key)
		} else {
			return e, dedupDone
		}
	}

	// Evict expired entries, then one completed entry, when at capacity.
	// In-flight entries are never evicted so duplicate suppression holds.
	if len(c.entries) >= c.maxSize {
		now := time.Now()
		for k, v := range c.entries {
			if v.inFlight {
				continue
			}
			if !v.expiresAt.IsZero() && now.After(v.expiresAt) {
				delete(c.entries, k)
			}
		}
	}
	if len(c.entries) >= c.maxSize {
		for k, v := range c.entries {
			if v.inFlight {
				continue
			}
			delete(c.entries, k)
			break
		}
	}
	e := &dedupEntry{
		inFlight:  true,
		acceptedC: make(chan struct{}),
		done:      make(chan struct{}),
	}
	c.entries[key] = e
	return e, dedupLeader
}

func (c *dedupCache) accept(key string, entry *dedupEntry) {
	if entry == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	current, ok := c.entries[key]
	if !ok || current != entry || current.accepted {
		return
	}
	current.accepted = true
	close(current.acceptedC)
	if current.finished && current.inFlight {
		current.inFlight = false
		current.expiresAt = time.Now().Add(c.ttl)
		close(current.done)
	}
}

func (c *dedupCache) finish(key string, entry *dedupEntry) {
	if entry == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	current, ok := c.entries[key]
	if !ok || current != entry || current.finished {
		return
	}
	current.finished = true
	if current.accepted && current.inFlight {
		current.inFlight = false
		current.expiresAt = time.Now().Add(c.ttl)
		close(current.done)
	}
}

func (c *dedupCache) complete(key string, entry *dedupEntry) {
	if entry == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	current, ok := c.entries[key]
	if !ok || current != entry {
		return
	}
	if current.inFlight {
		if !current.accepted {
			current.accepted = true
			close(current.acceptedC)
		}
		current.inFlight = false
		current.expiresAt = time.Now().Add(c.ttl)
		close(current.done)
	}
}

func (c *dedupCache) abort(key string, entry *dedupEntry) {
	if entry == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	current, ok := c.entries[key]
	if !ok || current != entry {
		return
	}
	if current.inFlight {
		close(current.done)
	}
	delete(c.entries, key)
}

func (c *dedupCache) fail(key string, entry *dedupEntry) {
	if entry == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	current, ok := c.entries[key]
	if !ok || current != entry || !current.inFlight {
		return
	}
	current.finished = true
	close(current.done)
	if current.accepted {
		current.inFlight = false
		current.expiresAt = time.Now().Add(c.ttl)
		return
	}
	delete(c.entries, key)
}

func (c *dedupCache) waitForAcceptance(ctx context.Context, entry *dedupEntry) bool {
	if entry == nil {
		return false
	}
	c.mu.Lock()
	entry.waiters++
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		entry.waiters--
		c.mu.Unlock()
	}()
	select {
	case <-entry.acceptedC:
	case <-entry.done:
	case <-ctx.Done():
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return entry.accepted
}
