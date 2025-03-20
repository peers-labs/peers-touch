package peers

import (
	"context"
	"sync"

	"github.com/dirty-bro-tech/peers-touch-go/client"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/service"
	"github.com/dirty-bro-tech/peers-touch-go/core/service/native"
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
	client  client.Client
}

func (n *nativePeer) ID() object.ID {
	return object.ID("")
}

func (n *nativePeer) Name() string {
	return n.opts.Name
}

func (n *nativePeer) Init(ctx context.Context, opts ...option.Option) error {
	var err error
	n.once.Do(func() {
		// set context should be the first step
		n.opts.Apply(option.WithRootCtx(ctx))

		// prepare all fundamental handlers
		// todo transfer handlers' option to option.option
		opts = append(opts, touch.Handlers()...)

		for _, o := range opts {
			n.opts.Apply(o)
		}

		// create service. we now only support native service
		n.service = native.NewService(n.opts.Options, opts...)

		err = n.service.Init(n.opts.Ctx())
	})

	// wrap the client and server
	return err
}

func (n *nativePeer) Start() error {
	return n.service.Run()
}
