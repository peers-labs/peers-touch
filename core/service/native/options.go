package native

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/cmd"
	cfg "github.com/dirty-bro-tech/peers-touch-go/core/config"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/peers/config"
	"github.com/dirty-bro-tech/peers-touch-go/core/service"
	"github.com/dirty-bro-tech/peers-touch-go/core/util/log"
)

func updateOptions(rootOption *service.Options, opts ...option.Option) {
	// todo override directly is not good
	rootOption.Cmd = cmd.NewCmd()

	defaultOpts := []option.Option{
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

	// make sure the custom options are applied last
	// so that they can override the default options
	defaultOpts = append(defaultOpts, opts...)

	for _, o := range defaultOpts {
		rootOption.Apply(o)
	}
}
