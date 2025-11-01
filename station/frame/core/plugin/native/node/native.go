package native

import (
	"context"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"github.com/peers-touch/peers-touch/station/frame/core/client"
	"github.com/peers-touch/peers-touch/station/frame/core/cmd"
	"github.com/peers-touch/peers-touch/station/frame/core/logger"
	"github.com/peers-touch/peers-touch/station/frame/core/node"
	"github.com/peers-touch/peers-touch/station/frame/core/option"
	"github.com/peers-touch/peers-touch/station/frame/core/peers/config"
	"github.com/peers-touch/peers-touch/station/frame/core/registry"
	"github.com/peers-touch/peers-touch/station/frame/core/server"
	"github.com/peers-touch/peers-touch/station/frame/core/util/log"
)

var (
	_ node.Node = (*native)(nil)
)

type native struct {
	opts *node.Options
	node.AbstractService

	once sync.Once
}

func (s *native) Name() string {
	return s.opts.Name
}

func (s *native) Options() *node.Options {
	return s.opts
}

func (s *native) Client() client.Client {
	return s.opts.Client
}

func (s *native) Server() server.Server {
	return s.opts.Server
}

func (s *native) String() string {
	return "peers"
}

func (s *native) Start(ctx context.Context) error {
	for _, fn := range s.opts.BeforeStart {
		if err := fn(); err != nil {
			return err
		}
	}

	ready := make(chan interface{})
	// Start server in a goroutine
	go func() {
		if err := s.opts.Server.Start(ctx, server.WithReadyChan(ready)); err != nil {
			logger.Errorf(ctx, "server start failed: %v", err)
			return
		}
	}()

	// Wait for the server to be ready
	select {
	case info := <-ready:
		logger.Infof(ctx, "server started: %v", info)
	case <-ctx.Done():
		return ctx.Err()
	}

	// register node
	if err := s.opts.Registry.Register(ctx, s.toPeer()); err != nil {
		return err
	}

	// todo start achievement, but now it's blocked by Start
	// so will never be called. it should be pass a exit signal
	for _, fn := range s.opts.AfterStart {
		if err := fn(); err != nil {
			return err
		}
	}

	logger.Infof(ctx, "peers' node started at %s", s.opts.Server.Options().Address)

	s.Finish(s)
	return nil
}

func (s *native) Stop(ctx context.Context) error {
	var gerr error

	logger.Infof(ctx, "stop native peers' node. begin to execute before stop hooks")

	for _, fn := range s.opts.BeforeStop {
		if err := fn(); err != nil {
			gerr = err
		}
	}

	logger.Infof(ctx, "stop native peers' node. begin to execute stop hooks")

	if err := s.opts.Server.Stop(ctx); err != nil {
		return err
	}

	logger.Infof(ctx, "stop native peers' node. begin to execute config close")
	if err := s.opts.Config.Close(); err != nil {
		return err
	}

	logger.Infof(ctx, "stop native peers' node. begin to execute after stop hooks")
	for _, fn := range s.opts.AfterStop {
		if err := fn(); err != nil {
			gerr = err
		}
	}

	logger.Warnf(ctx, "stop native peers' native node stopped with error: %v", gerr)

	return gerr
}

func (s *native) Run() error {
	ctx, cancel := context.WithCancel(s.opts.Ctx())
	defer cancel()
	if err := s.Start(ctx); err != nil {
		return err
	}

	logger.Infof(ctx, "[%s] server started", s.Name())

	ch := make(chan os.Signal, 1)
	if s.opts.Signal {
		signal.Notify(ch, syscall.SIGTERM, syscall.SIGINT, syscall.SIGQUIT)
	}

	select {
	// wait on kill signal
	case <-ch:
		logger.Warnf(ctx, "received signal, stopping")
	case <-ctx.Done():
		// todo, try to store canceled context data for logger
		logger.Infof(context.Background(), "[%s] server stopped", s.Name())
	}

	return s.Stop(ctx)
}

// todo, update to one node supports multiple peers
// now there is a node for one peer, it's not graceful.
func (s *native) toPeer() *registry.Registration {
	registration := &registry.Registration{
		ID:         s.opts.Id,
		Name:       s.opts.Name,
		Type:       registry.RegisterTypeNode,
		Namespaces: []string{"native"},
		Addresses:  []string{},
		Metadata: map[string]interface{}{
			"demo": "hello-world",
		},
	}

	// the root of http entrance
	if s.opts.Server != nil {
		registration.Addresses = append(registration.Addresses, s.opts.Server.Options().Address)
		registration.Metadata["server_address"] = s.opts.Server.Options().Address
	}

	return registration
}

// NewService
// todo remove rootOptions, not graceful
func NewService(rootOpts *option.Options, opts ...option.Option) node.Node {
	defaultOpts := []option.Option{
		// todo remove non-peers' code
		node.RPC("peers"),
		node.HandleSignal(true),
		// print runtime info
		node.BeforeInit(func(sOpts *node.Options) error {
			// current working directory
			wd, err := os.Getwd()
			if err != nil {
				log.Infof("failed to get working directory: %+v", err)
			}
			if wd != "" {
				log.Infof("peers-touch-go's working directory is %s", wd)
			}
			return nil
		}),
		// load config
		node.BeforeInit(func(sOpts *node.Options) error {
			// cmd helps peers parse command options and reset the options that should work.
			err := sOpts.Cmd.Init()
			if err != nil {
				log.Errorf("cmd init error: %s", err)
				return err
			}

			err = config.LoadConfig(sOpts)
			if err != nil {
				log.Errorf("load config error: %s", err)
				return err
			}

			return nil
		}),
		// Load Private Key & Public Key
		node.BeforeInit(func(sOpts *node.Options) error {
			return initKeys(sOpts)
		}),
		// parse config to options for components
		node.BeforeInit(func(sOpts *node.Options) error {
			err := config.SetOptions(sOpts)
			if err != nil {
				log.Errorf("init components' options error: %s", err)
				return err
			}

			return nil
		}),
		// kernal components pre-initialization, this helps to set up the options for each component.
		// so we can use the options by calling GetOptions() in each comp's directory.
		// other comps is going to do...
		client.WithInit(),
		// set the default components
		// see initComponents
		// node.Store(plugin.StorePlugins["native"].New()),
		// node.Server(plugin.ServerPlugins["native"].New()),
		// node.Logger(plugin.LoggerPlugins["console"].New()),
		//node.HandleSignal(true),
	}

	// make sure the custom options are applied last
	// so that they can override the default options
	defaultOpts = append(defaultOpts, opts...)

	rootOpts.Apply(defaultOpts...)

	s := &native{
		opts: node.GetOptions(rootOpts),
	}

	// set CMD for loading config
	s.opts.Cmd = cmd.NewCmd()

	return s
}
