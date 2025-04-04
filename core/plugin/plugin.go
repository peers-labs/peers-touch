package plugin

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/client"
	"github.com/dirty-bro-tech/peers-touch-go/core/config"
	"github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
	"github.com/dirty-bro-tech/peers-touch-go/core/store"
)

type Plugin interface {
	Name() string
}

type LoggerPlugin interface {
	Plugin
	Options() []logger.Option
	New(...logger.Option) logger.Logger
}

type ClientPlugin interface {
	Plugin
	Options() []client.Option
	New(...client.Option) client.Client
}

type ServerPlugin interface {
	Plugin
	Options() []option.Option
	New(...option.Option) server.Server
}

type ConfigPlugin interface {
	Plugin
	Options() []option.Option
	New(...option.Option) config.Config
}

type StorePlugin interface {
	Plugin
	Options() []option.Option
	New(...option.Option) store.Store
}
