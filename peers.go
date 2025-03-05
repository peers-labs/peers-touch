package peers

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/service/native"
	"github.com/dirty-bro-tech/peers-touch-go/touch"
	"sync"

	"github.com/dirty-bro-tech/peers-touch-go/client"
	"github.com/dirty-bro-tech/peers-touch-go/core/service"
	"github.com/dirty-bro-tech/peers-touch-go/object"
)

type Peer interface {
	ID() object.ID
	Name() string
	Init(...Option) error
	Start() error
}

func NewPeer(opts ...Option) Peer {
	return newPeer(opts...)
}

// region nativePeer
func newPeer(opts ...Option) Peer {
	p := &nativePeer{}
	for _, opt := range opts {
		opt(&p.opts)
	}

	return p
}

type nativePeer struct {
	opts Options

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

func (n *nativePeer) Init(opts ...Option) error {
	for _, o := range opts {
		o(&n.opts)
	}
	// prepare all fundamental handlers
	n.opts.appendHandlers = append(n.opts.appendHandlers, touch.Handlers()...)

	// create service. we now only support native service
	n.service = native.NewService()

	err := n.service.Init(n.opts.ServiceOptions()...)
	if err != nil {
		return err
	}

	// wrap the client and server
	return nil
}

func (n *nativePeer) Start() error {
	return n.service.Run()
}
