package server

import (
	"context"

	"github.com/peers-labs/peers-touch/station/frame/core/option"
)

// Server represents a service server.
type Server interface {
	Init(...option.Option) error
	Options() *Options
	// Handle use to add new handler dynamically
	Handle(Handler) error
	Start(context.Context, ...option.Option) error
	Stop(context.Context) error
	Name() string
}

// Routers interface defines a collection of handlers with a name
// Routers defines a collection of handlers with a cluster name.
type Routers interface {
	Handlers() []Handler

	// Name declares the cluster-name of routers
	// it must be unique. Peers uses it to check if there are already routers(like activitypub
	// and management interface.) that must be registered,
	// if you want to register a bundle of routers with the same name, it will be overwritten
	Name() string
}
