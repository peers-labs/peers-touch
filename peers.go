package peers

import (
	"sync"

	"github.com/dirty-bro-tech/peers-touch-go/client"
	"github.com/dirty-bro-tech/peers-touch-go/object"
	"github.com/dirty-bro-tech/peers-touch-go/server"
)

type Peer interface {
	ID() object.ID
	Name() string
	Init(...Option) error
	Client() client.Client
	Server() server.Server
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

	client client.Client
	server server.Server
}

func (p *nativePeer) Client() client.Client {
	return p.client
}

func (p *nativePeer) Server() server.Server {
	return p.server
}

func (p *nativePeer) Start() error {
	return p.opts.Service.Run()
}

func (p *nativePeer) ID() object.ID {
	return object.ID("")
}

func (p *nativePeer) Name() string {
	return p.opts.Name
}

func (p *nativePeer) Init(opts ...Option) error {
	for _, o := range opts {
		o(&p.opts)
	}

	err := p.opts.Service.Init()
	if err != nil {
		return err
	}

	// wrap the client and server
	p.client = client.FromService(
		p.opts.Service,
	)

	p.server = server.FromService(
		p.opts.Service,
	)

	return nil
}

// endregion
