package native

import (
	"context"
	"fmt"

	"github.com/dirty-bro-tech/peers-touch-go/core/plugin"
	nativeServer "github.com/dirty-bro-tech/peers-touch-go/core/server/native"
	"github.com/dirty-bro-tech/peers-touch-go/core/service"
	"github.com/dirty-bro-tech/peers-touch-go/core/util/log"
)

// Init initialises options. Additionally it calls cmd.Init
// which parses command line flags. cmd.Init is only called
// on first Init.
func (s *native) Init(opts ...service.Option) error {
	// process options
	for _, o := range opts {
		o(&s.opts)
	}

	if s.opts.Context == nil {
		s.opts.Context = context.Background()
	}

	if s.opts.Server == nil {
		// todo config、plugin、options
		s.opts.Server = nativeServer.NewServer()
	}

	if len(s.opts.BeforeInit) > 0 {
		for _, f := range s.opts.BeforeInit {
			err := f(&s.opts)
			if err != nil {
				log.Fatalf("init service err: %s", err)
			}
		}
	}

	// begin init
	if err := s.initComponents(); err != nil {
		log.Fatalf("init service's components err: %s", err)
	}

	return nil
}

func (s *native) initComponents() error {
	logOpts := s.opts.LoggerOptions.Options()

	// set Logger
	// only change if we have the logger and type differs
	if len(logOpts.Name) > 0 && s.opts.Logger.String() != logOpts.Name {
		l, ok := plugin.LoggerPlugins[logOpts.Name]
		if !ok {
			return fmt.Errorf("logger [%s] not found", logOpts.Name)
		}

		s.opts.Logger = l.New()
	}

	// todo init server
	if err := s.opts.Server.Init(s.opts.ServerOptions...); err != nil {
		return err

	}

	return nil
}
