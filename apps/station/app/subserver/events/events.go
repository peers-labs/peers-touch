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
	s.bus = NewEventBus()
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
// not running. Other subservers should treat nil as "skip publish";
// the realtime plane is a delivery convenience, not a durability
// path. (Durable persistence still happens in the publisher's own
// subsystem, e.g. friend_chat writes the message to its DB before
// calling GetBus().Publish().)
func GetBus() EventBus {
	busMu.RLock()
	defer busMu.RUnlock()
	return globalBus
}
