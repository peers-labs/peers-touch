// Package cmd is an interface for parsing the command line
package cmd

import (
	"io"
	"math/rand"
	"os"
	"time"

	"github.com/dirty-bro-tech/peers-touch-go/core/pkg/cli"
)

type Cmd interface {
	// The cli app within this cmd
	App() *cli.App
	// Adds options, parses flags and initialise
	// exits on error
	Init(opts ...Option) error
	// Options set within this command
	Options() Options
}

type peersCmd struct {
	opts Options
	app  *cli.App
	conf string
}

var (
	DefaultFlags = []cli.Flag{
		cli.StringFlag{
			Name:   "client",
			EnvVar: "PEERS_CLIENT",
			Usage:  "Client for peer; native",
			Alias:  "peers_client_protocol",
		},
		cli.StringFlag{
			Name:   "client_request_timeout",
			EnvVar: "PEERS_CLIENT_REQUEST_TIMEOUT",
			Usage:  "Sets the client request timeout. e.g 500ms, 5s, 1m. Default: 5s",
			Alias:  "peers_client_request_timeout",
		},
		cli.IntFlag{
			Name:   "client_request_retries",
			EnvVar: "PEERS_CLIENT_REQUEST_RETRIES",
			Value:  1,
			Usage:  "Sets the client retries. Default: 1",
			Alias:  "peers_client_request_retries",
		},
		cli.IntFlag{
			Name:   "client_pool_size",
			EnvVar: "PEERS_CLIENT_POOL_SIZE",
			Usage:  "Sets the client connection pool size. Default: 1",
			Alias:  "peers_client_pool_size",
		},
		cli.StringFlag{
			Name:   "client_pool_ttl",
			EnvVar: "PEERS_CLIENT_POOL_TTL",
			Usage:  "Sets the client connection pool ttl in seconds.",
			Alias:  "peers_client_pool_ttl",
		},
		cli.IntFlag{
			Name:   "server_registry_ttl",
			EnvVar: "PEERS_SERVICE_SERVER_REGISTRY_TTL",
			Value:  60,
			Usage:  "Register TTL in seconds",
			Alias:  "peers_service_server_registry_ttl",
		},
		cli.IntFlag{
			Name:   "server_registry_interval",
			EnvVar: "PEERS_SERVICE_SERVER_REGISTRY_INTERVAL",
			Value:  30,
			Usage:  "Register interval in seconds",
			Alias:  "peers_service_server_registry_interval",
		},
		cli.StringFlag{
			Name:   "server",
			EnvVar: "PEERS_SERVICE_SERVER",
			Usage:  "Server for peers; native",
			Alias:  "peers_service_server_protocol",
		},
		cli.StringFlag{
			Name:   "server_name",
			EnvVar: "PEERS_SERVICE_SERVER_NAME",
			// todo: it's expired, need to update it
			Usage: "Name of the server. native.rpc.srv.example ?? todo",
			Alias: "peers_service_server_name",
		},
		cli.StringFlag{
			Name:   "server_version",
			EnvVar: "PEERS_SERVICE_SERVER_VERSION",
			Usage:  "Version of the server. 1.1.0",
			Alias:  "peers_service_server_version",
		},
		cli.StringFlag{
			Name:   "server_id",
			EnvVar: "PEERS_SERVICE_SERVER_ID",
			Usage:  "Id of the server. Auto-generated if not specified",
			Alias:  "peers_service_server_id",
		},
		cli.StringFlag{
			Name:   "server_address",
			EnvVar: "PEERS_SERVICE_SERVER_ADDRESS",
			Usage:  "Bind address for the server. 127.0.0.1:8080",
			Alias:  "peers_service_server_address",
		},
		cli.StringFlag{
			Name:   "server_advertise",
			EnvVar: "PEERS_SERVICE_SERVER_ADVERTISE",
			Usage:  "Used instead of the server_address when registering with discovery. 127.0.0.1:8080",
			Alias:  "peers_service_server_advertise",
		},
		cli.StringSliceFlag{
			Name:   "server_metadata",
			EnvVar: "PEERS_SERVICE_SERVER_METADATA",
			Value:  &cli.StringSlice{},
			Usage:  "A list of key-value pairs defining metadata. version=1.0.0",
			Alias:  "peers_service_server_metadata",
		},
		cli.StringFlag{
			Name:   "broker",
			EnvVar: "PEERS_BROKER",
			Usage:  "Broker for pub/sub. http, nats, rabbitmq",
			Alias:  "peers_broker_name",
		},
		cli.StringFlag{
			Name:   "broker_address",
			EnvVar: "PEERS_BROKER_ADDRESS",
			Usage:  "Comma-separated list of broker addresses",
			Alias:  "peers_broker_address",
		},
		cli.StringFlag{
			Name:   "profile",
			Usage:  "Debug profiler for cpu and memory stats",
			EnvVar: "PEERS_DEBUG_PROFILE",
			Alias:  "peers_profile",
		},
		cli.StringFlag{
			Name:   "registry",
			EnvVar: "PEERS_REGISTRY",
			Usage:  "Registry for discovery. mdns",
			Alias:  "peers_registry_name",
		},
		cli.StringFlag{
			Name:   "registry_address",
			EnvVar: "PEERS_REGISTRY_ADDRESS",
			Usage:  "Comma-separated list of registry addresses",
			Alias:  "peers_registry_address",
		},
		cli.StringFlag{
			Name:   "selector",
			EnvVar: "PEERS_SELECTOR",
			Usage:  "Selector used to pick nodes for querying",
			Alias:  "peers_selector_name",
		},
		cli.StringFlag{
			Name:   "transport",
			EnvVar: "PEERS_TRANSPORT",
			Usage:  "Transport mechanism used; http",
			Alias:  "peers_transport_name",
		},
		cli.StringFlag{
			Name:   "transport_address",
			EnvVar: "PEERS_TRANSPORT_ADDRESS",
			Usage:  "Comma-separated list of transport addresses",
			Alias:  "peers_transport_address",
		},
		cli.StringFlag{
			Name:   "logger_level",
			EnvVar: "PEERS_LOGGER_LEVEL",
			Usage:  "Logger Level; INFO",
			Alias:  "peers_logger_level",
		},
		&cli.StringFlag{
			Name:   "auth",
			EnvVar: "PEERS_AUTH",
			Usage:  "Auth for role based access control, e.g. service",
			Alias:  "peers_auth_name",
		},
		&cli.StringFlag{
			Name:   "auth_enable",
			EnvVar: "PEERS_AUTH_ENABLE",
			Usage:  "enable auth for role based access control, false",
			Alias:  "peers_auth_enable",
		},
		&cli.StringFlag{
			Name:   "auth_id",
			EnvVar: "PEERS_AUTH_CREDENTIALS_ID",
			Usage:  "Account ID used for client authentication",
			Alias:  "peers_auth_credentials_id",
		},
		&cli.StringFlag{
			Name:   "auth_secret",
			EnvVar: "PEERS_AUTH_CREDENTIALS_SECRET",
			Usage:  "Account secret used for client authentication",
			Alias:  "peers_auth_credentials_secret",
		},
		&cli.StringFlag{
			Name:   "auth_namespace",
			EnvVar: "PEERS_AUTH_NAMESPACE",
			Usage:  "Namespace for the services auth account",
			Value:  "peers.rpc",
			Alias:  "peers_auth_namespace",
		},
		&cli.StringFlag{
			Name:   "auth_public_key",
			EnvVar: "PEERS_AUTH_PUBLIC_KEY",
			Usage:  "Public key for JWT auth (base64 encoded PEM)",
			Alias:  "peers_auth_publicKey",
		},
		&cli.StringFlag{
			Name:   "auth_private_key",
			EnvVar: "PEERS_AUTH_PRIVATE_KEY",
			Usage:  "Private key for JWT auth (base64 encoded PEM)",
			Alias:  "peers_auth_privateKey",
		},
		cli.StringFlag{
			Name:   "config",
			EnvVar: "PEERS_CONFIG",
			Usage:  "config file",
			Alias:  "peers_config",
		},
	}
)

func init() {
	rand.Seed(time.Now().Unix())
	help := cli.HelpPrinter
	cli.HelpPrinter = func(writer io.Writer, templ string, data interface{}) {
		help(writer, templ, data)
		os.Exit(0)
	}
}

func newCmd(opts ...Option) Cmd {
	options := Options{}

	for _, o := range opts {
		o(&options)
	}

	if len(options.Description) == 0 {
		options.Description = "a peers service"
	}

	cmd := new(peersCmd)
	cmd.opts = options
	cmd.app = cli.NewApp()
	cmd.app.Name = cmd.opts.Name
	cmd.app.Version = cmd.opts.Version
	cmd.app.Usage = cmd.opts.Description
	cmd.app.Flags = DefaultFlags
	cmd.app.Before = cmd.before
	cmd.app.Action = func(c *cli.Context) {}
	if len(options.Version) == 0 {
		cmd.app.HideVersion = true
	}

	return cmd
}

func (c *peersCmd) ConfigFile() string {
	return c.conf
}

func (c *peersCmd) before(ctx *cli.Context) (err error) {
	// set the config file path
	if filePath := ctx.String("config"); len(filePath) > 0 {
		c.conf = filePath
	}

	return nil
}

func (c *peersCmd) App() *cli.App {
	return c.app
}

func (c *peersCmd) Options() Options {
	return c.opts
}

func (c *peersCmd) Init(opts ...Option) error {
	for _, o := range opts {
		o(&c.opts)
	}
	c.app.Name = c.opts.Name
	c.app.Version = c.opts.Version
	c.app.HideVersion = len(c.opts.Version) == 0
	c.app.Usage = c.opts.Description
	return c.app.Run(os.Args)
}

func NewCmd(opts ...Option) Cmd {
	return newCmd(opts...)
}
