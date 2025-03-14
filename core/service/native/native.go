package native

import (
	"context"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"github.com/dirty-bro-tech/peers-touch-go/core/client"
	"github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
	"github.com/dirty-bro-tech/peers-touch-go/core/service"
)

type native struct {
	opts service.Options

	once sync.Once
}

func (s *native) Name() string {
	return s.opts.Name
}

func (s *native) Options() service.Options {
	return s.opts
}

func (s *native) Client() client.Client {
	return s.opts.Client
}

func (s *native) Server() server.Server {
	return s.opts.Server
}

func (s *native) String() string {
	return "peers"
}

func (s *native) Start(ctx context.Context) error {
	for _, fn := range s.opts.BeforeStart {
		if err := fn(); err != nil {
			return err
		}
	}

	logger.Infof(ctx, "server started at %s", s.opts.Server.Options().Address)
	if err := s.opts.Server.Start(ctx); err != nil {
		return err
	}

	// todo start achievement, but now it's blocked by Start
	// so will never be called. it should be pass a exit signal
	for _, fn := range s.opts.AfterStart {
		if err := fn(); err != nil {
			return err
		}
	}

	return nil
}

func (s *native) Stop(ctx context.Context) error {
	var gerr error

	for _, fn := range s.opts.BeforeStop {
		if err := fn(); err != nil {
			gerr = err
		}
	}

	if err := s.opts.Server.Stop(ctx); err != nil {
		return err
	}

	if err := s.opts.Config.Close(); err != nil {
		return err
	}

	for _, fn := range s.opts.AfterStop {
		if err := fn(); err != nil {
			gerr = err
		}
	}

	return gerr
}

func (s *native) Run(ctx context.Context) error {
	if err := s.Start(ctx); err != nil {
		return err
	}

	logger.Infof(ctx, "[%s] server started", s.Name())

	ch := make(chan os.Signal, 1)
	if s.opts.Signal {
		signal.Notify(ch, syscall.SIGTERM, syscall.SIGINT, syscall.SIGQUIT)
	}

	select {
	// wait on kill signal
	case <-ch:
	// wait on context cancel
	case <-s.opts.Context.Done():
	}

	return s.Stop(ctx)
}

func NewService(opts ...service.Option) service.Service {
	options := newOptions(opts...)
	for _, o := range opts {
		o(&options)
	}

	return &native{
		opts: options,
	}
}
