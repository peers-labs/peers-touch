package server

import (
	"context"
	"errors"
	"sort"
	"sync"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
)

// BaseServer is the base server for all servers.
// It helps to run the common logic for all servers, including start/stop server,
// key-loading, sub-servers, wrapper loading, etc.
//
// Change History:
//   - 2026-04-10: Populate Options.SubserverInstances in init() so that any
//     subserver can discover its siblings via server.GetOptions() at Start time.
type BaseServer struct {
	opts *Options

	once     sync.Once
	subMutex sync.RWMutex

	subServerStarted bool
	subServers       map[string]Subserver
}

// Options returns the server options.
func (b *BaseServer) Options() *Options {
	return b.opts
}

// Init initializes base server and subservers once.
func (b *BaseServer) Init(opts ...option.Option) error {
	b.once.Do(func() {
		if err := b.init(opts...); err != nil {
			// todo log
			panic(err)
		}
	})

	return nil
}

// Start starts all subservers sequentially.
func (b *BaseServer) Start(opts ...option.Option) error {
	if b.subServerStarted {
		return errors.New("server is already started")
	}

	b.subMutex.RLock()
	defer b.subMutex.RUnlock()

	// Domain subservers must register their Federation receivers before the
	// Federation runtime seals its registry and starts dispatching.
	for _, name := range orderedStartedSubserverNames(b.subServers) {
		sub := b.subServers[name]
		// Ensure all subservers are started
		if err := sub.Start(b.opts.Ctx()); err != nil {
			panic(err)
		}
	}

	b.subServerStarted = true
	return nil
}

// Stop stops all subservers.
func (b *BaseServer) Stop(ctx context.Context) error {
	// stop the subservers
	for _, sub := range b.subServers {
		if err := sub.Stop(ctx); err != nil {
			panic(err)
		}
	}

	return nil
}

// init applies options, constructs subservers, and merges their handlers.
func (b *BaseServer) init(opts ...option.Option) error {
	for _, opt := range opts {
		b.opts.Apply(opt)
	}

	// Bootstrap owns federation identity and must initialize before consumers.
	// Sort all remaining names so startup behavior never depends on Go map order.
	for _, name := range orderedSubserverNames(b.opts.SubServers) {
		subFuc := b.opts.SubServers[name]
		// create the sub server
		sub := subFuc.exec(subFuc.options...)
		// init the sub server
		if err := sub.Init(b.opts.Ctx()); err != nil {
			// todo log
			panic(err)
		}

		logger.Infof(b.opts.Ctx(), "init sub server: %s", sub.Name())

		// append the sub server to the map
		b.subServers[sub.Name()] = sub

		// Publish the instance into Options so sibling subservers can
		// discover each other via server.GetOptions().SubserverInstances.
		b.opts.SubserverInstances[sub.Name()] = sub

		// then append the sub server's handlers to the main server
		for _, handler := range sub.Handlers() {
			b.opts.Apply(wrapper.Wrap(func(o *Options) {
				o.Handlers = append(o.Handlers, handler)
			}))
		}
	}

	return nil
}

func orderedSubserverNames(subservers map[string]subServerNewFunctions) []string {
	names := make([]string, 0, len(subservers))
	for name := range subservers {
		if name != "bootstrap" {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	if _, ok := subservers["bootstrap"]; ok {
		names = append([]string{"bootstrap"}, names...)
	}
	return names
}

func orderedStartedSubserverNames(subservers map[string]Subserver) []string {
	names := make([]string, 0, len(subservers))
	for name := range subservers {
		if name != "federation" {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	if _, ok := subservers["federation"]; ok {
		names = append(names, "federation")
	}

	return names
}

// NewServer constructs a BaseServer and applies options.
func NewServer(opts ...option.Option) *BaseServer {
	s := &BaseServer{
		subServers: make(map[string]Subserver),
		opts:       GetOptions(),
	}
	s.Options().Apply(opts...)
	return s
}
