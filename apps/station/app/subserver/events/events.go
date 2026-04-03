// Package events provides the real-time event push subserver (SSE)
package events

import (
	"context"
	"sync"

	"github.com/peers-labs/peers-touch/station/frame/core/broker"
	"github.com/peers-labs/peers-touch/station/frame/core/event"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type eventsSubServer struct {
	status server.Status
	addrs  []string
	mu     sync.RWMutex
}

func (s *eventsSubServer) Init(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusStarting

	brk := broker.Get()
	log := logger.NewLogger(ctx, logger.WithLevel(logger.InfoLevel))
	eventSystem := event.NewEventSystem(brk, log)
	event.SetGlobalEventSystem(eventSystem)

	return nil
}

func (s *eventsSubServer) Start(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusRunning
	return nil
}

func (s *eventsSubServer) Stop(ctx context.Context) error {
	s.status = server.StatusStopped
	return nil
}

func (s *eventsSubServer) Name() string               { return "events" }
func (s *eventsSubServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *eventsSubServer) Address() server.SubserverAddress {
	return server.SubserverAddress{Address: s.addrs}
}
func (s *eventsSubServer) Status() server.Status { return s.status }

func NewEventsSubServer(opts ...option.Option) server.Subserver {
	return &eventsSubServer{
		status: server.StatusStopped,
		addrs:  []string{},
	}
}
