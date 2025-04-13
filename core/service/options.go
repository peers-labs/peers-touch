package service

import (
	"sync"

	"github.com/dirty-bro-tech/peers-touch-go/core/client"
	"github.com/dirty-bro-tech/peers-touch-go/core/cmd"
	"github.com/dirty-bro-tech/peers-touch-go/core/config"
	"github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/registry"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
	"github.com/dirty-bro-tech/peers-touch-go/core/store"
	"github.com/dirty-bro-tech/peers-touch-go/core/transport"
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

	ClientOptions   ClientOptions
	ServerOptions   ServerOptions
	StoreOptions    StoreOptions
	RegistryOptions RegistryOptions
	ConfigOptions   ConfigOptions
	LoggerOptions   LoggerOptions

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

type ClientOptions []client.Option

type ServerOptions []option.Option

type StoreOptions []option.Option

type RegistryOptions []option.Option

type ConfigOptions []option.Option

type LoggerOptions []logger.Option

func Name(c string) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Name = c
	})
}

func Cmd(c cmd.Cmd) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Cmd = c
	})
}

// RPC sets the type of service, eg. stack, grpc
// but this func will be deprecated
func RPC(r string) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.RPC = r
	})

}

func Logger(l logger.Logger) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Logger = l
	})
}

func Client(c client.Client) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Client = c
	})
}

func Config(c config.Config) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Config = c
	})
}

func Store(c store.Store) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Store = c
	})
}

// HandleSignal toggles automatic installation of the signal handler that
// traps TERM, INT, and QUIT.  Users of this feature to disable the signal
// handler, should control liveness of the service through the context.
func HandleSignal(b bool) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Signal = b
	})
}

func Server(s server.Server) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Server = s
	})
}

// Registry sets the registry for the service
// and the underlying components
func Registry(r registry.Registry) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Registry = r
	})
}

// Transport sets the transport for the service
// and the underlying components
func Transport(t transport.Transport) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.Transport = t
	})
}

// Address sets the address of the server
func Address(addr string) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.ServerOptions = append(opts.ServerOptions, server.WithAddress(addr))
	})
}

func BeforeInit(fn func(sOpts *Options) error) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.BeforeInit = append(opts.BeforeInit, fn)
	})
}
func BeforeStart(fn func() error) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.BeforeStart = append(opts.BeforeStart, fn)
	})
}

func BeforeStop(fn func() error) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.BeforeStop = append(opts.BeforeStop, fn)
	})
}

func AfterStart(fn func() error) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.AfterStart = append(opts.AfterStart, fn)
	})
}

func AfterStop(fn func() error) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.AfterStop = append(opts.AfterStop, fn)
	})
}

// WithHandlers adds handlers to the service's server
func WithHandlers(handlers ...server.Handler) option.Option {
	return wrapper.Wrap(func(opts *Options) {
		opts.ServerOptions = append(opts.ServerOptions, server.WithHandlers(handlers...))
	})
}

func GetOptions(o *option.Options) *Options {
	optionsAccessLock.Lock()
	defer optionsAccessLock.Unlock()

	opts := o.Ctx().Value(serviceOptionsKey{}).(*Options)
	if opts.Options == nil {
		opts.Options = o
	}

	return opts
}
