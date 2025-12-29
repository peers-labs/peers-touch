package server

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/transport"
)

// region server options
// serverOptionsKey is the context key for server options.
type serverOptionsKey struct{}

var (
	wrapper = option.NewWrapper[Options](serverOptionsKey{}, func(options *option.Options) *Options {
		o := &Options{
			Options:    options,
			SubServers: map[string]subServerNewFunctions{},
		}

		return o
	})
)

// Options holds configuration for the server.
type Options struct {
	*option.Options

	Address  string            `pconf:"address"` // Server address
	Timeout  int               `pconf:"timeout"` // Server timeout
	Metadata map[string]string `pconf:"metadata"`
	// Handlers is a list of handlers that injected to the server
	// usually, it's used for the initialization of the server
	// if you want to add handlers after the server is initialized,
	// you can use the server.Handler interface
	Handlers []Handler
	// store the new function for each subserver
	// key: subserver name
	// value: new function for the subserver
	SubServers map[string]subServerNewFunctions

	// ReadyChan is a channel that will be closed when the server is ready
	// it's used to signal the main process that the server is ready
	ReadyChan chan interface{}

	Transport transport.Transport
}

// WithAddress sets the server address.
func WithAddress(address string) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Address = address
	})
}

// WithTimeout sets the server timeout.
func WithTimeout(timeout int) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Timeout = timeout
	})
}

// WithMetadata associates metadata with the server.
func WithMetadata(md map[string]string) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Metadata = md
	})
}

// WithHandlers adds handlers to the server options.
func WithHandlers(handlers ...Handler) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Handlers = append(opts.Handlers, handlers...)
	})
}

// WithRouters converts routers to handlers and adds them to the server.
// Each handler's path will be prefixed with the router's name
func WithRouters(routers ...Routers) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		for _, router := range routers {
			routerName := router.Name()
			handlers := router.Handlers()

			// Create new handlers with router name prefixed to path
			for _, handler := range handlers {
				var prefixedPath string
				if routerName == "" {
					// If router name is empty, use original path without prefix
					prefixedPath = handler.Path()
				} else {
					// Otherwise, prefix with router name
					prefixedPath = "/" + routerName + handler.Path()
				}
				prefixedHandler := &httpHandler{
					name:     handler.Name(),
					method:   handler.Method(),
					path:     prefixedPath,
					handler:  handler.Handler(),
					wrappers: handler.Wrappers(),
				}
				opts.Handlers = append(opts.Handlers, prefixedHandler)
			}
		}
	})
}

// WithSubServer adds a subserver to the server.
func WithSubServer(name string, newFunc func(opts ...option.Option) Subserver, subServerOptions ...option.Option) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.SubServers[name] = subServerNewFunctions{
			exec:    newFunc,
			options: subServerOptions,
		}
	})
}

// WithReadyChan sets the readiness channel.
func WithReadyChan(c chan interface{}) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.ReadyChan = c
	})
}

// WithTransport injects a transport into server options.
func WithTransport(t transport.Transport) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Transport = t
	})
}

// endregion

// region handler options

// HandlerOption configures HandlerOptions.
type HandlerOption func(*HandlerOptions)

// WithMethod sets handler method.
func WithMethod(method Method) HandlerOption {
	return func(opts *HandlerOptions) {
		opts.Method = method
	}
}

// WithWrappers sets middleware wrappers.
func WithWrappers(wrappers ...Wrapper) HandlerOption {
	return func(opts *HandlerOptions) {
		opts.Wrappers = wrappers
	}
}

// WithHertzMiddlewares sets Hertz middlewares.
func WithHertzMiddlewares(middlewares ...func(context.Context, *app.RequestContext)) HandlerOption {
	return func(opts *HandlerOptions) {
		opts.HertzMiddlewares = middlewares
	}
}

// HandlerOptions holds per-handler configuration.
type HandlerOptions struct {
	Method           Method
	Wrappers         []Wrapper
	HertzMiddlewares []func(context.Context, *app.RequestContext)
}

// endregion

// GetOptions retrieves typed server options from the global option context.
func GetOptions() *Options {
	return option.GetOptions().Ctx().Value(serverOptionsKey{}).(*Options)
}
