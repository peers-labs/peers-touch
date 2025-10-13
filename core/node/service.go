package node

import (
	"context"
	"sync"

	"github.com/dirty-bro-tech/peers-touch-go/core/client"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
)

var (
	s Node
)

type Node = Service

// Service is an interface that wraps the lower level libraries
// within stack. It's a convenience method for building
// and initialising services.
type Service interface {
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

type AbstractService struct {
	Service

	doOnce sync.Once
}

// Finish tells the root that the real node's initialization
// Call this method in the real node's Init method or after starting
// todo Stop event empty s
func (as *AbstractService) Finish(sIn Service) {
	as.doOnce.Do(func() {
		as.Service = sIn
		s = as
	})
}

func GetService() Service {
	if s == nil {
		panic("node not initialized")
	}

	return s
}
