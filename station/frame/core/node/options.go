package node

import (
	"sync"

	"github.com/peers-labs/peers-touch/station/frame/core/client"
	"github.com/peers-labs/peers-touch/station/frame/core/cmd"
	"github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/registry"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/core/transport"
)

type serviceOptionsKey struct{}

var (
	wrapper = option.NewWrapper[Options](serviceOptionsKey{}, func(options *option.Options) *Options {
		return &Options{
			Options: options,
		}
	})
	optionsAccessLock sync.RWMutex
)

type Options struct {
	*option.Options

	// maybe put them in metadata is better
	Id   string
	Name string
	RPC  string
	Cmd  cmd.Cmd
	Conf string
	// todo, putting private key here is not a good idea
	PrivateKey string
	PublicKey  string

	ClientOptions    ClientOptions
	ServerOptions    ServerOptions
	StoreOptions     StoreOptions
	RegistryOptions  RegistryOptions
	ConfigOptions    ConfigOptions
	LoggerOptions    LoggerOptions
	TransportOptions TransportOptions

	Client    client.Client
	Server    server.Server
	Registry  registry.Registry
	Transport transport.Transport
	Config    config.Config
	Store     store.Store
	Logger    logger.Logger

	// Before and After funcs
	BeforeInit  []func(sOpts *Options) error
	BeforeStart []func() error
	BeforeStop  []func() error
	AfterStart  []func() error
	AfterStop   []func() error

	Signal bool
}

type ClientOptions []option.Option

type ServerOptions []option.Option

type StoreOptions []option.Option

type RegistryOptions []option.Option

type ConfigOptions []option.Option

type LoggerOptions []logger.Option

type TransportOptions []option.Option

// Name sets the node name.
func Name(c string) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Name = c
	})
}

// Cmd sets the command runner.
func Cmd(c cmd.Cmd) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Cmd = c
	})
}

// RPC sets the type of node, eg. stack, grpc
// but this func will be deprecated
// RPC sets the node RPC type (deprecated).
func RPC(r string) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.RPC = r
	})

}

// Logger injects a logger instance.
func Logger(l logger.Logger) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Logger = l
	})
}

// Client injects a client instance.
func Client(c client.Client) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Client = c
	})
}

// Config injects a config instance.
func Config(c config.Config) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Config = c
	})
}

// Store injects a store instance.
func Store(c store.Store) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Store = c
	})
}

// HandleSignal toggles automatic installation of the signal handler that
// traps TERM, INT, and QUIT.  Users of this feature to disable the signal
// handler, should control liveness of the node through the context.
func HandleSignal(b bool) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Signal = b
	})
}

// Server injects a server instance.
func Server(s server.Server) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Server = s
	})
}

// Registry sets the registry for the node
// and the underlying components
// Registry injects a registry instance.
func Registry(r registry.Registry) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Registry = r
	})
}

// Transport sets the transport for the node
// and the underlying components
// Transport injects a transport instance.
func Transport(t transport.Transport) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Transport = t
	})
}

// Address sets the address of the server
// Address sets server address.
func Address(addr string) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.ServerOptions = append(opts.ServerOptions, server.WithAddress(addr))
	})
}

// BeforeInit appends a hook executed before initialization.
func BeforeInit(fn func(sOpts *Options) error) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.BeforeInit = append(opts.BeforeInit, fn)
	})
}

// BeforeStart appends a hook executed before start.
func BeforeStart(fn func() error) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.BeforeStart = append(opts.BeforeStart, fn)
	})
}

// BeforeStop appends a hook executed before stop.
func BeforeStop(fn func() error) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.BeforeStop = append(opts.BeforeStop, fn)
	})
}

// AfterStart appends a hook executed after start.
func AfterStart(fn func() error) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.AfterStart = append(opts.AfterStart, fn)
	})
}

// AfterStop appends a hook executed after stop.
func AfterStop(fn func() error) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.AfterStop = append(opts.AfterStop, fn)
	})
}

// WithPrivateKey sets private key for the node.
func WithPrivateKey(key string) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.PrivateKey = key
	})
}

// WithHandlers adds handlers to the node's server
// WithHandlers adds HTTP handlers to the server.
func WithHandlers(handlers ...server.Handler) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.ServerOptions = append(opts.ServerOptions, server.WithHandlers(handlers...))
	})
}

// GetOptions retrieves typed node options from generic options.
func GetOptions(o *option.Options) *Options {
	optionsAccessLock.Lock()
	defer optionsAccessLock.Unlock()

	opts := o.Ctx().Value(serviceOptionsKey{}).(*Options)
	if opts.Options == nil {
		opts.Options = o
	}

	return opts
}
