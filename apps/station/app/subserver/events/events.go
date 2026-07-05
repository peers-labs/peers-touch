// Package events implements the realtime canonical event stream
// subserver — a single SSE endpoint per authenticated device-window
// that multiplexes every kind of realtime event (messages, receipts,
// presence, typing, future call signaling).
//
// See docs/architecture/realtime/event-stream.md for the wire
// contract; this package owns the in-process EventBus that every
// other Station subserver publishes to.
package events

import (
	"context"
	"sync"

	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

type eventsSubServer struct {
	mu     sync.RWMutex
	status server.Status
	addrs  []string
	bus    EventBus
}

func (s *eventsSubServer) Init(ctx context.Context, opts ...option.Option) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.status = server.StatusStarting
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}
	eventStore := newGormEventStore(rds)
	if err := eventStore.AutoMigrate(); err != nil {
		return err
	}
	s.bus = NewEventBus(WithDurableStore(eventStore))
	setGlobalBus(s.bus)
	return nil
}

func (s *eventsSubServer) Start(ctx context.Context, opts ...option.Option) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status = server.StatusRunning
	return nil
}

func (s *eventsSubServer) Stop(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.bus != nil {
		s.bus.Close()
	}
	setGlobalBus(nil)
	s.status = server.StatusStopped
	return nil
}

func (s *eventsSubServer) Name() string               { return "events" }
func (s *eventsSubServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *eventsSubServer) Address() server.SubserverAddress {
	return server.SubserverAddress{Address: s.addrs}
}
func (s *eventsSubServer) Status() server.Status { return s.status }

// NewEventsSubServer constructs the realtime events subserver. It is
// registered on Station boot via app/main.go.
func NewEventsSubServer(opts ...option.Option) server.Subserver {
	return &eventsSubServer{
		status: server.StatusStopped,
		addrs:  []string{},
	}
}

// ---------------------------------------------------------------------
// Package-level bus access for other subservers.
//
// Other Station subservers (friend_chat, group_chat, presence, future
// signaling) publish into the bus via GetBus(). The bus pointer is
// installed during Init and cleared during Stop, so callers must
// nil-check.
// ---------------------------------------------------------------------

var (
	busMu     sync.RWMutex
	globalBus EventBus
)

func setGlobalBus(b EventBus) {
	busMu.Lock()
	defer busMu.Unlock()
	globalBus = b
}

// GetBus returns the live EventBus, or nil if the events subserver is
// not running. Publish failures must be surfaced by durable domains:
// realtime events are persisted by the events bus before fan-out, so a
// silent skip would break the delivery contract.
func GetBus() EventBus {
	busMu.RLock()
	defer busMu.RUnlock()
	return globalBus
}
