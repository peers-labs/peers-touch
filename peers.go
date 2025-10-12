package peers

import (
	"context"
	"sync"

	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/plugin"
	"github.com/dirty-bro-tech/peers-touch-go/core/service"
	"github.com/dirty-bro-tech/peers-touch-go/object"
	"github.com/dirty-bro-tech/peers-touch-go/touch"
)

type Peer interface {
	ID() object.ID
	Name() string
	Init(context.Context, ...option.Option) error
	Start() error
}

func NewPeer(opts ...option.Option) Peer {
	return newPeer(opts...)
}

// region nativePeer
func newPeer(opts ...option.Option) Peer {
	p := &nativePeer{
		opts: &Options{
			Options: &option.Options{},
		},
	}
	for _, opt := range opts {
		p.opts.Apply(opt)
	}

	return p
}

type nativePeer struct {
	opts *Options

	once sync.Once

	service service.Service
}

func (n *nativePeer) ID() object.ID {
	return object.ID("")
}

func (n *nativePeer) Name() string {
	return n.service.Name()
}

func (n *nativePeer) Init(ctx context.Context, opts ...option.Option) error {
	var err error
	n.once.Do(func() {
		// set context should be the first step
		n.opts.Apply(option.WithRootCtx(ctx))

		// prepare all fundamental handlers
		opts = append(opts, touch.Routers()...)

		for _, o := range opts {
			n.opts.Apply(o)
		}

		if n.opts.NewService != nil {
			// Use custom service creation function
			nodeInstance := n.opts.NewService(n.opts.Options, opts...)
			// Convert node.Node to service.Service if needed
			if svc, ok := nodeInstance.(service.Service); ok {
				n.service = svc
			} else {
				panic("NewService function must return a service.Service compatible type")
			}
		} else {
			// todo add default service
			if plugin.ServicePlugins[plugin.NativePluginName] == nil {
				panic("new service failed, try to use default service by importing peers-touch-go/core/plugin/native")
			}

			n.service = plugin.ServicePlugins[plugin.NativePluginName].New(n.opts.Options, opts...)
		}

		err = n.service.Init(n.opts.Ctx())
	})

	// wrap the client and server
	return err
}

func (n *nativePeer) Start() error {
	return n.service.Run()
}
