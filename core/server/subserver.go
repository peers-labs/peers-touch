package server

import (
	"context"
)

// SubServer is used to define subcomponent of the main server, which should be run with a port like a normal server.
// We define a subserver interface to make it easier to manage the lifecycle of the subservers with the main server.
// When you want to add some component and make it run with the main server, you can implement this interface and
// add it to the main server.
type SubServer interface {
	// Init initializes the subserver with context
	Init(ctx context.Context, opts ...SubServerOption) error

	// Start begins the subserver with context for lifecycle management
	// Actually, SubServer would be started before the main server, due to the simplicity of the implementation.
	// And BaseServer will help to start subservers in method BaseServer.Start.
	// Every subserver should be start self asynchronously.
	Start(ctx context.Context, opts ...SubServerOption) error

	// Stop gracefully shuts down the subserver with context
	Stop(ctx context.Context) error

	// Name returns the unique identifier for this subserver
	Name() string

	// Port returns the listening port of the subserver
	Port() int

	// Status returns the current state of the subserver
	Status() ServerStatus
}

type ServerStatus string

const (
	StatusStopped  ServerStatus = "stopped"
	StatusStarting ServerStatus = "starting"
	StatusRunning  ServerStatus = "running"
	StatusStopping ServerStatus = "stopping"
	StatusError    ServerStatus = "error"
)

type SubServerOptions struct {
	Ctx context.Context
}

type SubServerOption func(s *SubServerOptions)
