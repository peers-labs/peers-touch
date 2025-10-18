package registry

import (
	"context"
	"time"

	"github.com/peers-touch/peers-touch-go/core/option"
)

type StationType = string

const (
	StationTypeStun      StationType = "stun"
	StationTypeTurnRelay StationType = "turnRelay"
	StationTypeHttp      StationType = "http"
)

type Registry interface {
	Init(ctx context.Context, opts ...option.Option) error
	Options() Options
	Register(ctx context.Context, peer *Peer, opts ...RegisterOption) error
	Deregister(ctx context.Context, peer *Peer, opts ...DeregisterOption) error
	GetPeer(ctx context.Context, opts ...GetOption) (*Peer, error)
	ListPeers(ctx context.Context, opts ...GetOption) ([]*Peer, error)
	Watch(ctx context.Context, opts ...WatchOption) (Watcher, error)
	String() string
}

type Peer struct {
	// ID is the unique identifier of the peer.
	// for libp2p, it's the peer ID encrypted with the public key of the peer.
	ID       string                 `json:"id"`
	Name     string                 `json:"name"`
	Version  string                 `json:"version"`
	Metadata map[string]interface{} `json:"metadata"`

	// EndStation maintains the available connect-to information of the peer.
	// Registry should help set the value after registering to various networks like turn/bootstrap/mdns/http/tcp, etc.
	// The clients can use the value to connect to the peer's endpoints declared in stations.
	// These stations can be stored in memory only. Because networks change frequently. we can get those addresses info
	// through a superstructure http interface of 'peers-touch' by an activitypub like interface.
	EndStation map[string]*EndStation `json:"endstation"`
	Timestamp  time.Time              `json:"timestamp"`
	Signature  []byte                 `json:"signature"`
}

type EndStation struct {
	Name       string
	Typ        StationType
	NetAddress string

	Endpoints []*Endpoint `json:"endpoints"`
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
