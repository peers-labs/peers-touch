package server

import (
	"context"
)

type SubServer interface {
	// Start begins the subserver with context for lifecycle management
	Start(ctx context.Context) error

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

type BaseSubServer struct {
	name   string
	port   int
	status ServerStatus
}

func (s *BaseSubServer) Name() string {
	return s.name
}

func (s *BaseSubServer) Port() int {
	return s.port
}

func (s *BaseSubServer) Status() ServerStatus {
	return s.status
}

func NewBaseSubServer(name string, port int) *BaseSubServer {
	return &BaseSubServer{
		name:   name,
		port:   port,
		status: StatusStopped,
	}
}
