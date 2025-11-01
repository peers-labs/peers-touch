package plugin

import (
	"github.com/peers-touch/peers-touch/station/frame/core/client"
	"github.com/peers-touch/peers-touch/station/frame/core/config"
	"github.com/peers-touch/peers-touch/station/frame/core/logger"
	"github.com/peers-touch/peers-touch/station/frame/core/node"
	"github.com/peers-touch/peers-touch/station/frame/core/option"
	"github.com/peers-touch/peers-touch/station/frame/core/registry"
	"github.com/peers-touch/peers-touch/station/frame/core/server"
	"github.com/peers-touch/peers-touch/station/frame/core/store"
)

const (
	NativePluginName = "native"
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
	Options() []option.Option
	New(...option.Option) client.Client
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

type RegistryPlugin interface {
	Plugin
	Options() []option.Option
	New(...option.Option) registry.Registry
}

type ServicePlugin interface {
	Plugin
	Options() []option.Option
	New(*option.Options, ...option.Option) node.Node
}

type SubserverPlugin interface {
	Plugin
	Enabled() bool

	Options() []option.Option
	// New helps create the subserver for Server
	// *option.Options is not necessary here, the Server that subserver hooks on already has it.
	// The Server component will help to inject the root Options.
	New(...option.Option) server.Subserver
}
