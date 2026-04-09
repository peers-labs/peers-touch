package activitypub

import (
	"context"
	"sync"

	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type subServer struct {
	mu     sync.RWMutex
	status server.Status
}

func NewActivityPubSubServer(opts ...option.Option) server.Subserver {
	return &subServer{status: server.StatusStopped}
}

func (s *subServer) Init(ctx context.Context, opts ...option.Option) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status = server.StatusStarting
	return nil
}

func (s *subServer) Start(ctx context.Context, opts ...option.Option) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status = server.StatusRunning
	return nil
}

func (s *subServer) Stop(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status = server.StatusStopped
	return nil
}

func (s *subServer) Name() string               { return "activitypub" }
func (s *subServer) Type() server.SubserverType { return server.SubserverTypeHTTP }

func (s *subServer) Address() server.SubserverAddress {
	return server.SubserverAddress{}
}

func (s *subServer) Status() server.Status {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.status
}

func (s *subServer) Handlers() []server.Handler {
	return apHandlers()
}
