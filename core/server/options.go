package server

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
)

// region server options
type serverOptionsKey struct{}

var (
	wrapper = option.NewWrapper[Options](serverOptionsKey{}, func(options *option.Options) *Options {
		return &Options{
			Options: options,
			SubServerOptions: &SubServerOptions{
				subServerNewFunctions: make(map[string]subServerNewFunctions),
			},
		}
	})
)

// Options is the server options
type Options struct {
	*option.Options

	Address  string            `pconf:"address"` // Server address
	Timeout  int               `pconf:"timeout"` // Server timeout
	Metadata map[string]string `pconf:"metadata"`
	// Handlers is a list of handlers that injected to the server
	// usually, it's used for the initialization of the server
	// if you want to add handlers after the server is initialized,
	// you can use the server.Handler interface
	Handlers         []Handler
	SubServerOptions *SubServerOptions

	// ReadyChan is a channel that will be closed when the server is ready
	// it's used to signal the main process that the server is ready
	ReadyChan chan interface{}
}

// WithAddress sets the server address
func WithAddress(address string) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Address = address
	})
}

// WithTimeout sets the server timeout
func WithTimeout(timeout int) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Timeout = timeout
	})
}

// WithMetadata associated with the server
func WithMetadata(md map[string]string) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Metadata = md
	})
}

func WithHandlers(handlers ...Handler) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Handlers = handlers
	})
}

// WithSubServer adds a subserver to the server
func WithSubServer(name string, newFunc func(opts ...option.Option) SubServer, subServerOptions ...option.Option) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.SubServerOptions.subServerNewFunctions[name] = subServerNewFunctions{
			exec:    newFunc,
			options: subServerOptions,
		}
	})
}

func WithReadyChan(c chan interface{}) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.ReadyChan = c
	})
}

// endregion

// region handler options

// HandlerOption is a function that can be used to configure a handler
type HandlerOption func(*HandlerOptions)

type HandlerOptions struct{}

// endregion

func GetOptions() *Options {
	return option.GetOptions().Ctx().Value(serverOptionsKey{}).(*Options)
}
