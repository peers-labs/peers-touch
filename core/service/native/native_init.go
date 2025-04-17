package native

import (
	"context"
	"fmt"
	"github.com/dirty-bro-tech/peers-touch-go/core/registry"

	"github.com/dirty-bro-tech/peers-touch-go/core/config"
	"github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/plugin"
	"github.com/dirty-bro-tech/peers-touch-go/core/util/log"

	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/logger/logrus"
	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/server/hertz"
	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/server/native"
)

// Init initialises options. Additionally, it calls cmd.Init
// which parses command line flags. cmd.Init is only called
// on first Init.
func (s *native) Init(ctx context.Context, opts ...option.Option) error {
	// process options
	for _, o := range opts {
		s.opts.Apply(o)
	}

	if len(s.opts.BeforeInit) > 0 {
		for _, f := range s.opts.BeforeInit {
			err := f(s.opts)
			if err != nil {
				log.Fatalf("init peers err: %s", err)
			}
		}
	}

	if s.opts.Name == "" {
		panic("name is required,")
	}

	// begin init
	if err := s.initComponents(ctx); err != nil {
		log.Fatalf("init peers' components err: %s", err)
	}

	return nil
}

func (s *native) initComponents(ctx context.Context) error {
	// set Logger
	// only change if we have the logger and type differs
	if s.opts.Logger == nil {
		// use slogs as default logger
		loggerName := config.Get("peers.logger.name").String("slogrus")
		l, ok := plugin.LoggerPlugins[loggerName]
		if !ok {
			return fmt.Errorf("logger [%s] not found", loggerName)
		}

		s.opts.Logger = l.New()
	}
	if err := s.opts.Logger.Init(ctx, s.opts.LoggerOptions...); err != nil {
		return err
	}

	// init store
	if s.opts.Store == nil {
		storeName := config.Get("peers.store.name").String(plugin.NativePluginName)
		if len(storeName) > 0 {
			if plugin.StorePlugins[storeName] == nil {
				logger.Errorf(ctx, "store %s not found, use native by default", storeName)
				storeName = plugin.NativePluginName
			}
		}

		logger.Infof(ctx, "initial store's name is: %s", storeName)

		s.opts.Store = plugin.StorePlugins[storeName].New()
	}
	if err := s.opts.Store.Init(ctx, s.opts.StoreOptions...); err != nil {
		return err
	}

	// init registry
	if s.opts.Registry == nil {
		registryName := config.Get("peers.registry.name").String(plugin.NativePluginName)
		if len(registryName) > 0 {
			if plugin.RegistryPlugins[registryName] == nil {
				logger.Errorf(ctx, "registry %s not found, use native by default", registryName)
				registryName = plugin.NativePluginName
			}
		}

		logger.Infof(ctx, "initial registry's name is: %s", registryName)

		s.opts.Registry = plugin.RegistryPlugins[registryName].New()
	}

	// todo, set private key in advance.
	if err := s.opts.Registry.Init(ctx, append(s.opts.RegistryOptions, registry.WithPrivateKey(s.opts.PrivateKey))...); err != nil {
		return err
	}

	// todo init server
	if s.opts.Server == nil {
		serverName := config.Get("peers.service.server.name").String(plugin.NativePluginName)
		if len(serverName) > 0 {
			if plugin.ServerPlugins[serverName] == nil {
				logger.Errorf(ctx, "server %s not found, use native by default", serverName)
				serverName = plugin.NativePluginName
			}
		}

		logger.Infof(ctx, "initial server's name is: %s", serverName)
		s.opts.Server = plugin.ServerPlugins[serverName].New()
	}
	if err := s.opts.Server.Init(ctx, s.opts.ServerOptions...); err != nil {
		return err
	}

	return nil
}
