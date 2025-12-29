package node

import (
	"context"
	"sync"

	"github.com/peers-labs/peers-touch/station/frame/core/client"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

var (
	s Node
)

type Node = service

// service wraps the lower level libraries within the stack and exposes
// a convenience interface for building and initialising services.
type service interface {
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
	service

	doOnce sync.Once
}

// Finish registers the real node implementation into the global accessor.
// Call this in the real node's Init or after starting.
func (as *AbstractService) Finish(sIn service) {
	as.doOnce.Do(func() {
		as.service = sIn
		s = as
	})
}

// GetService returns the registered node service.
func GetService() service {
	if s == nil {
		panic("node not initialized")
	}

	return s
}
