package service

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/client"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
)

// Service is an interface that wraps the lower level libraries
// within stack. Its a convenience method for building
// and initialising services.
type Service interface {
	// Name The service name
	Name() string
	// Init initialises options
	Init(...Option) error
	// Options returns the current options
	Options() Options
	// Client is used to call services
	Client() client.Client
	// Server is for handling requests and events
	Server() server.Server
	// Run the service
	Run() error
}
