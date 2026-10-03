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
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
)

const callResolutionSweepInterval = time.Second

type eventsSubServer struct {
	mu                   sync.RWMutex
	status               server.Status
	addrs                []string
	bus                  EventBus
	callResolution       *callResolutionStore
	federation           realtimeFederationRuntime
	actorHomes           actorHomeStationResolver
	federatedCallSignals *federatedCallSignalSender
	localStationPeerID   string
	callResolutionCancel context.CancelFunc
	callResolutionDone   chan struct{}
}

func (s *eventsSubServer) Init(ctx context.Context, opts ...option.Option) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.status = server.StatusStarting
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}
	eventBus, err := NewDurableEventBus(rds)
	if err != nil {
		return err
	}
	callResolution := newCallResolutionStore(rds)
	if err := callResolution.AutoMigrate(); err != nil {
		return err
	}
	s.bus = eventBus
	s.callResolution = callResolution
	setGlobalBus(s.bus)
	return nil
}

func (s *eventsSubServer) Start(ctx context.Context, opts ...option.Option) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.bindFederation(); err != nil {
		s.status = server.StatusError
		return err
	}
	if s.callResolution != nil && s.callResolutionCancel == nil {
		reaperContext, cancel := context.WithCancel(context.Background())
		done := make(chan struct{})
		s.callResolutionCancel = cancel
		s.callResolutionDone = done
		go func() {
			defer close(done)
			s.reapCallResolutions(reaperContext)
		}()
	}
	s.status = server.StatusRunning
	return nil
}

func (s *eventsSubServer) Stop(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.bus != nil {
		s.bus.Close()
	}
	if s.callResolutionCancel != nil {
		s.callResolutionCancel()
		<-s.callResolutionDone
		s.callResolutionCancel = nil
		s.callResolutionDone = nil
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

func (s *eventsSubServer) reapCallResolutions(ctx context.Context) {
	ticker := time.NewTicker(callResolutionSweepInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			expired, err := s.callResolution.sweep(ctx)
			if err != nil {
				continue
			}
			for index := range expired {
				s.fanOutNoAnswer(ctx, expired[index])
			}
		}
	}
}

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

// PublishPeerSignal handles an inbound Federation-forwarded signal by
// re-authorizing the sender/recipient pair and publishing to the local
// EventBus. It satisfies the realtimeSignalPeerCapabilities interface
// consumed by the federation peer route handler.
func (s *eventsSubServer) PublishPeerSignal(
	ctx context.Context,
	recipientPTID string,
	signal *realtime.CallSignal,
) error {
	if signal == nil || recipientPTID == "" {
		return server.BadRequest("signal and recipient are required")
	}
	senderPTID := signal.GetFromActorPtid()
	if senderPTID != recipientPTID {
		authorizer := getSignalAuthorizer()
		if authorizer == nil {
			logger.DefaultHelper.Warnf(
				"events: peer signal authorizer not registered sender_ptid=%s",
				senderPTID,
			)
			return server.NewHandlerError(503, "signal authorization unavailable")
		}
		allowed, err := authorizer.CanSignal(senderPTID, recipientPTID)
		if err != nil {
			return server.InternalErrorWithCause("signal authorization check", err)
		}
		if !allowed {
			return server.Forbidden("not authorized to signal this recipient")
		}
	}
	bus := GetBus()
	if bus == nil {
		return server.NewHandlerError(503, "event bus not initialized")
	}
	ev := &realtime.StreamEvent{
		Kind: &realtime.StreamEvent_Signaling{Signaling: signal},
	}
	if _, err := bus.Publish(recipientPTID, ev); err != nil {
		logger.DefaultHelper.Warnf(
			"events: peer signal publish failed recipient_ptid=%s: %v",
			recipientPTID, err,
		)
		return server.InternalErrorWithCause("publish peer signal", err)
	}

	return nil
}
