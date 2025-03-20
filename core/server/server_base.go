package server

import (
	"context"
	"errors"
	"sync"

	"github.com/dirty-bro-tech/peers-touch-go/core/option"
)

// BaseServer is the base server for all servers.
// It helps to run the common logic for all servers, including start/stop server,
// key-loading, sub-servers, wrapper loading, etc.
type BaseServer struct {
	opts *Options

	once     sync.Once
	subMutex sync.RWMutex

	subServerStarted bool
	subServers       map[string]SubServer
}

func (b *BaseServer) Options() *Options {
	return b.opts
}

func (b *BaseServer) Init(ctx context.Context, opts ...option.Option) error {
	b.once.Do(func() {
		if err := b.init(ctx, opts...); err != nil {
			// todo log
			panic(err)
		}
	})

	return nil
}

// Start : current job is helping to start the subservers.
func (b *BaseServer) Start(ctx context.Context, opts ...option.Option) error {
	if b.subServerStarted {
		return errors.New("server is already started")
	}

	b.subMutex.RLock()
	defer b.subMutex.RUnlock()

	// Start all subservers sequentially with shared context
	for _, sub := range b.subServers {
		// Ensure all subservers are started
		if err := sub.Start(ctx); err != nil {
			panic(err)
		}
	}

	b.subServerStarted = true
	return nil
}

func (b *BaseServer) Stop(ctx context.Context) error {
	// stop the subservers
	for _, sub := range b.subServers {
		if err := sub.Stop(ctx); err != nil {
			panic(err)
		}
	}

	return nil
}

func (b *BaseServer) init(ctx context.Context, opts ...option.Option) error {
	for _, opt := range opts {
		b.opts.Apply(opt)
	}

	// then init the sub servers
	for _, subFuc := range b.opts.SubServerOptions.subServerNewFunctions {
		// create the sub server
		sub := subFuc.exec(subFuc.options...)
		// init the sub server
		if err := sub.Init(ctx); err != nil {
			// todo log
			panic(err)
		}

		// append the sub server to the map
		b.subServers[sub.Name()] = sub

		// then append the sub server's handlers to the main server
		for _, handler := range sub.Handlers() {
			wrapper.Wrap(func(o *Options) {
				o.Handlers = append(o.Handlers, handler)
			})
		}
	}

	return nil
}

func NewServer(opts ...option.Option) *BaseServer {
	s := &BaseServer{
		opts: GetOptions(),
	}
	s.Options().Apply(opts...)
	return s
}
