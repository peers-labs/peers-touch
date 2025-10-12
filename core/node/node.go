package node

import (
	"context"
	"sync"

	"github.com/dirty-bro-tech/peers-touch-go/core/client"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
)

var (
	n Node
)

// Node is an interface that wraps the lower level libraries
// within stack. It's a convenience method for building
// and initialising nodes.
type Node interface {
	// Name The node name
	Name() string
	// Init initialises options
	Init(context.Context, ...option.Option) error
	// Options returns the current options
	Options() *Options
	// Client is used to call services
	Client() client.Client
	// Server is for handling requests and events
	Server() server.Server
	// Run the node
	Run() error
}

type AbstractNode struct {
	Node

	doOnce sync.Once
}

// Finish tells the root that the real node's initialization
// Call this method in the real node's Init method or after starting
// todo Stop event empty n
func (an *AbstractNode) Finish(nIn Node) {
	an.doOnce.Do(func() {
		an.Node = nIn
		n = an
	})
}

func GetNode() Node {
	if n == nil {
		panic("node not initialized")
	}

	return n
}
