package server

import "context"

// region server options

// Option is a function that can be used to configure a server
type Option func(*Options)

// Options is the server options
type Options struct {
	Address  string            `pconf:"address"` // Server address
	Timeout  int               `pconf:"timout"`  // Server timeout
	Metadata map[string]string `pconf:"metadata"`
	// Handlers is a list of handlers that injected to the server
	// usually, it's used for the initialization of the server
	// if you want to add handlers after the server is initialized,
	// you can use the server.Handler interface
	Handlers   []Handler
	SubServers map[string]SubServer // Add subServers map

	// Context is the context of the server, it should be the runtime context from main
	Context context.Context
}

// WithAddress sets the server address
func WithAddress(address string) Option {
	return func(o *Options) {
		o.Address = address
	}
}

// WithTimeout sets the server timeout
func WithTimeout(timeout int) Option {
	return func(o *Options) {
		o.Timeout = timeout
	}
}

// WithMetadata associated with the server
func WithMetadata(md map[string]string) Option {
	return func(o *Options) {
		o.Metadata = md
	}
}

func WithHandlers(handlers ...Handler) Option {
	return func(o *Options) {
		o.Handlers = handlers
	}
}

// WithSubServer adds a subserver to the server
func WithSubServer(name string, subServer SubServer) Option {
	return func(o *Options) {
		if o.SubServers == nil {
			o.SubServers = make(map[string]SubServer)
		}
		o.SubServers[name] = subServer
	}
}

// endregion

// region handler options

// HandlerOption is a function that can be used to configure a handler
type HandlerOption func(*HandlerOptions)

type HandlerOptions struct{}

// endregion
