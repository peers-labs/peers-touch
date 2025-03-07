package registry

import "context"

type Registry interface {
	Init(ctx context.Context, opts ...Option) error
	Options() Options
	Register(ctx context.Context, peer *Peer, opts ...RegisterOption) error
	Deregister(ctx context.Context, peer *Peer, opts ...DeregisterOption) error
	GetPeer(ctx context.Context, name string, opts ...GetOption) ([]*Peer, error)
	Watch(ctx context.Context, opts ...WatchOption) (Watcher, error)
	String() string
}

type Peer struct {
	Name      string            `json:"name"`
	Version   string            `json:"version"`
	Metadata  map[string]string `json:"metadata"`
	Endpoints []*Endpoint       `json:"endpoints"`
	Nodes     []*Node           `json:"nodes"`
}

type Node struct {
	Metadata map[string]string `json:"metadata"`
	Id       string            `json:"id"`
	Address  string            `json:"address"`
}

type Endpoint struct {
	Request  *Value            `json:"request"`
	Response *Value            `json:"response"`
	Metadata map[string]string `json:"metadata"`
	Name     string            `json:"name"`
}

type Value struct {
	Name   string   `json:"name"`
	Type   string   `json:"type"`
	Values []*Value `json:"values"`
}
