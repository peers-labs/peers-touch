package server

import (
	"context"

	"github.com/dirty-bro-tech/peers-touch-go/core/option"
)

// Subserver is used to define subcomponent of the main server, which should be run with a port like a normal server.
// We define a subserver interface to make it easier to manage the lifecycle of the subservers with the main server.
// When you want to add some component and make it run with the main server, you can implement this interface and
// add it to the main server.
type Subserver interface {
	// Init initializes the subserver with context
	Init(ctx context.Context, opts ...option.Option) error

	// Start begins the subserver with context for lifecycle management
	// Actually, Subserver would be started before the main server, due to the simplicity of the implementation.
	// And BaseServer will help to start subservers in method BaseServer.Start.
	// Every subserver should be start self asynchronously.
	Start(ctx context.Context, opts ...option.Option) error

	// Stop gracefully shuts down the subserver with context
	Stop(ctx context.Context) error

	// Name returns the unique identifier for this subserver
	Name() string

	// Port returns the listening port of the subserver
	Port() int

	// Status returns the current state of the subserver
	Status() ServerStatus

	// Handlers helps subserver to register its own handlers to the main server
	// if no handler needs to register, just return nil
	Handlers() []Handler
}

type ServerStatus string

const (
	StatusStopped  ServerStatus = "stopped"
	StatusStarting ServerStatus = "starting"
	StatusRunning  ServerStatus = "running"
	StatusStopping ServerStatus = "stopping"
	StatusError    ServerStatus = "error"
)

type subServerNewFunctions struct {
	exec    func(...option.Option) Subserver
	options []option.Option
}
