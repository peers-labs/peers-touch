package native

import (
	"context"

	"github.com/dirty-bro-tech/peers-touch-go/core/cmd"
	cfg "github.com/dirty-bro-tech/peers-touch-go/core/config"
	"github.com/dirty-bro-tech/peers-touch-go/core/peers/config"
	"github.com/dirty-bro-tech/peers-touch-go/core/service"
	"github.com/dirty-bro-tech/peers-touch-go/core/util/log"
)

func newOptions(opts ...service.Option) service.Options {
	options := service.Options{
		// todo support options
		Cmd: cmd.NewCmd(),
	}

	defaultOpts := []service.Option{
		service.Context(context.Background()),
		// todo remove non-peers' code
		service.RPC("peers"),
		// load config
		service.BeforeInit(func(sOpts *service.Options) error {
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
		// parse config to options for components
		service.BeforeInit(func(sOpts *service.Options) error {
			err := config.SetOptions(sOpts)
			if err != nil {
				log.Errorf("init components' options error: %s", err)
				return err
			}

			return nil
		}),

		// set the default components
		// service.Client(plugin.ClientPlugins["mucp"].New()),
		// service.Server(plugin.ServerPlugins["native"].New()),
		// service.Logger(plugin.LoggerPlugins["console"].New()),
		service.Config(cfg.DefaultConfig),
		//service.HandleSignal(true),
	}

	defaultOpts = append(defaultOpts, opts...)

	for _, o := range defaultOpts {
		o(&options)
	}

	return options
}
