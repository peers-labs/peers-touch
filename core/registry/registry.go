package registry

import (
	"context"
	"time"

	"github.com/dirty-bro-tech/peers-touch-go/core/option"
)

var (
	DefaultPeersNetworkNamespace = "peers-touch"
)

type Registry interface {
	Init(ctx context.Context, opts ...option.Option) error
	Options() Options
	Register(ctx context.Context, peer *Peer, opts ...RegisterOption) error
	Deregister(ctx context.Context, peer *Peer, opts ...DeregisterOption) error
	GetPeer(ctx context.Context, name string, opts ...GetOption) ([]*Peer, error)
	ListPeers(ctx context.Context, opts ...GetOption) ([]*Peer, error)
	Watch(ctx context.Context, opts ...WatchOption) (Watcher, error)
	String() string
}

type Peer struct {
	// ID is the unique identifier of the peer.
	// for libp2p, it's the peer ID encrypted with the public key of the peer.
	ID        string                 `json:"id"`
	Name      string                 `json:"name"`
	Version   string                 `json:"version"`
	Metadata  map[string]interface{} `json:"metadata"`
	Endpoints []*Endpoint            `json:"endpoints"`
	Nodes     []*Node                `json:"nodes"`
	Timestamp time.Time              `json:"timestamp"`
	Signature []byte                 `json:"signature"`
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
