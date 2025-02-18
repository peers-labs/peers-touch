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

// region localPeer

func newPeer(opts ...Option) Peer {
	p := &localPeer{}
	for _, opt := range opts {
		opt(&p.opts)
	}

	return p
}

type localPeer struct {
	opts Options

	once sync.Once
}

func (p *localPeer) Client() client.Client {
	return p.opts.Client
}

func (p *localPeer) Server() server.Server {
	return p.opts.Server
}

func (p *localPeer) Start() error {
	return p.opts.Server.Start()
}

func (p *localPeer) ID() object.ID {
	return object.ID("")
}

func (p *localPeer) Name() string {
	return p.opts.Name
}

func (p *localPeer) Init(opts ...Option) error {
	for _, o := range opts {
		o(&p.opts)
	}

	return nil
}

// endregion
