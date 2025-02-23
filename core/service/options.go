package service

import (
	"context"

	"github.com/dirty-bro-tech/peers-touch-go/core/client"
	"github.com/dirty-bro-tech/peers-touch-go/core/config"
	"github.com/dirty-bro-tech/peers-touch-go/core/config/cmd"
	"github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/registry"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
	"github.com/dirty-bro-tech/peers-touch-go/core/transport"
)

type Option func(o *Options)

type Options struct {
	// maybe put them in metadata is better
	Id   string
	Name string
	RPC  string
	Cmd  cmd.Cmd
	Conf string

	ClientOptions   ClientOptions
	ServerOptions   ServerOptions
	RegistryOptions RegistryOptions
	ConfigOptions   ConfigOptions
	LoggerOptions   LoggerOptions

	Client    client.Client
	Server    server.Server
	Registry  registry.Registry
	Transport transport.Transport
	Config    config.Config
	Logger    logger.Logger

	// Before and After funcs
	BeforeInit  []func(sOpts *Options) error
	BeforeStart []func() error
	BeforeStop  []func() error
	AfterStart  []func() error
	AfterStop   []func() error

	// Other options for implementations of the interface
	// can be stored in a context
	Context context.Context

	Signal bool
}

type ClientOptions []client.Option

func (c ClientOptions) Options() client.Options {
	opts := client.Options{}
	for _, o := range c {
		o(&opts)
	}

	return opts
}

type ServerOptions []server.Option

func (c ServerOptions) Options() server.Options {
	opts := server.Options{}
	for _, o := range c {
		o(&opts)
	}

	return opts
}

type RegistryOptions []registry.Option

func (c RegistryOptions) Options() registry.Options {
	opts := registry.Options{}
	for _, o := range c {
		o(&opts)
	}

	return opts
}

type ConfigOptions []config.Option

func (c ConfigOptions) Options() config.Options {
	opts := config.Options{}
	for _, o := range c {
		o(&opts)
	}

	return opts
}

type LoggerOptions []logger.Option

func (c LoggerOptions) Options() logger.Options {
	opts := logger.Options{}
	for _, o := range c {
		o(&opts)
	}

	return opts
}

func Name(c string) Option {
	return func(o *Options) {
		o.Name = c
	}
}

func Cmd(c cmd.Cmd) Option {
	return func(o *Options) {
		o.Cmd = c
	}
}

// RPC sets the type of service, eg. stack, grpc
// but this func will be deprecated
func RPC(r string) Option {
	return func(o *Options) {
		o.RPC = r
	}
}

func Logger(l logger.Logger) Option {
	return func(o *Options) {
		o.Logger = l
	}
}

func Client(c client.Client) Option {
	return func(o *Options) {
		o.Client = c
	}
}

func Config(c config.Config) Option {
	return func(o *Options) {
		o.Config = c
	}
}

// Context specifies a context for the service.
// Can be used to signal shutdown of the service.
// Can be used for extra option values.
func Context(ctx context.Context) Option {
	return func(o *Options) {
		o.Context = ctx
	}
}

// HandleSignal toggles automatic installation of the signal handler that
// traps TERM, INT, and QUIT.  Users of this feature to disable the signal
// handler, should control liveness of the service through the context.
func HandleSignal(b bool) Option {
	return func(o *Options) {
		o.Signal = b
	}
}

func Server(s server.Server) Option {
	return func(o *Options) {
		o.Server = s
	}
}

// Registry sets the registry for the service
// and the underlying components
func Registry(r registry.Registry) Option {
	return func(o *Options) {
		o.Registry = r
	}
}

// Transport sets the transport for the service
// and the underlying components
func Transport(t transport.Transport) Option {
	return func(o *Options) {
		o.Transport = t
	}
}

// Address sets the address of the server
func Address(addr string) Option {
	return func(o *Options) {
		o.ServerOptions = append(o.ServerOptions, server.WithAddress(addr))
	}
}

func BeforeInit(fn func(sOpts *Options) error) Option {
	return func(o *Options) {
		o.BeforeInit = append(o.BeforeInit, fn)
	}
}

func BeforeStart(fn func() error) Option {
	return func(o *Options) {
		o.BeforeStart = append(o.BeforeStart, fn)
	}
}

func BeforeStop(fn func() error) Option {
	return func(o *Options) {
		o.BeforeStop = append(o.BeforeStop, fn)
	}
}

func AfterStart(fn func() error) Option {
	return func(o *Options) {
		o.AfterStart = append(o.AfterStart, fn)
	}
}

func AfterStop(fn func() error) Option {
	return func(o *Options) {
		o.AfterStop = append(o.AfterStop, fn)
	}
}
