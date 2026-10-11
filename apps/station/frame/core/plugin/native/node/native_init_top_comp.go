package native

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin"
	registryNative "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/registry"
	nativeRelay "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/relay"
	bootstrapNative "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/bootstrap"
	relayControl "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay"
	transportNative "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/transport"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/transport/securehttp"
	"github.com/peers-labs/peers-touch/station/frame/core/registry"
	"github.com/peers-labs/peers-touch/station/frame/core/runtime/role"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
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
				logger.Fatalf(ctx, "init peers err: %s", err)
			}
		}
	}

	if s.opts.Name == "" {
		hostName, err := os.Hostname()
		if err != nil {
			logger.Errorf(ctx, "get hostname failed: %v", err)
			hostName = "unknown"
		}
		s.opts.Name = "peers-touch-go:s:name:" + hostName
	}

	if s.opts.Id == "" {
		s.opts.Id = "peers-touch-go:s:id:" + s.opts.Name
	}

	// begin init
	if err := s.initComponents(ctx); err != nil {
		logger.Fatalf(ctx, "init peers' components err: %s", err)
	}

	return nil
}

func (s *native) initComponents(ctx context.Context) (err error) {
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
		logger.Infof(ctx, "identity service initialized and injected")
	}

	if s.opts.Transport == nil {
		transportName := config.Get("peers.node.transport.name").String(plugin.NativePluginName)
		if len(transportName) > 0 {
			if plugin.TransportPlugins[transportName] == nil {
				logger.Errorf(ctx, "transport %s not found, use native by default", transportName)
				transportName = plugin.NativePluginName
			}
		}
		logger.Infof(ctx, "initial transport's name is: %s", transportName)
		transportPlugin := plugin.TransportPlugins[transportName]
		s.opts.Transport = transportPlugin.New()
		s.opts.TransportOptions = append(s.opts.TransportOptions, transportPlugin.Options()...)
	}
	processRole, err := role.FromContext(ctx)
	if err != nil {
		return fmt.Errorf("initialize process role: %w", err)
	}
	relayConfig, err := nativeRelay.ConfigFromRegistered()
	if err != nil {
		return fmt.Errorf("resolve standard Relay config: %w", err)
	}
	relayRuntime, err := nativeRelay.NewRuntime(
		relayConfig,
		processRole == role.Station,
	)
	if err != nil {
		return fmt.Errorf("initialize standard Relay runtime: %w", err)
	}
	kernel, err := newP2PKernel(
		s.opts.Transport,
		relayRuntime.LibP2POptions(processRole == role.Relay),
		s.opts.TransportOptions...,
	)
	if err != nil {
		return fmt.Errorf("init P2P kernel Host: %w", err)
	}
	s.kernel = kernel
	initialized := false
	defer func() {
		if initialized {
			return
		}
		if closeErr := kernel.Close(); closeErr != nil {
			err = errors.Join(err, closeErr)
		}
	}()
	if err := kernel.AttachComponent(relayRuntime); err != nil {
		return fmt.Errorf("attach standard Relay runtime: %w", err)
	}
	if err := s.opts.Transport.Init(
		append(
			s.opts.TransportOptions,
			transportNative.WithHost(kernel.Host()),
		)...,
	); err != nil {
		return fmt.Errorf("init transport err: %s", err)
	}
	nodeIdentity, err := securehttp.NewNodeTLSIdentity(
		kernel.Host().Peerstore().PrivKey(kernel.Host().ID()),
		time.Now(),
	)
	if err != nil {
		return fmt.Errorf("create secure HTTP Node identity: %w", err)
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

		s.opts.Registry = plugin.RegistryPlugins[registryName].New(registry.WithStore(s.opts.Store))
	}

	if len(s.opts.PrivateKey) == 0 {
		return fmt.Errorf("init registry err: missing private key")
	}
	if err := s.opts.Registry.Init(
		ctx,
		append(
			s.opts.RegistryOptions,
			registryNative.WithHost(kernel.Host()),
			registry.WithPrivateKey(s.opts.PrivateKey),
		)...,
	); err != nil {
		return fmt.Errorf("init registry err: %v", err)
	}
	if err := kernel.AttachDHT(s.opts.Registry); err != nil {
		return fmt.Errorf("init P2P kernel DHT: %w", err)
	}
	rootKey, err := bootstrapNative.StationRootKey()
	if err != nil {
		return err
	}
	stationPeerID, err := peer.IDFromPrivateKey(rootKey)
	if err != nil {
		return fmt.Errorf("derive logical Station PeerID: %w", err)
	}
	if stationPeerID == kernel.Host().ID() {
		return fmt.Errorf(
			"logical Station root and Node Host identities must be independent",
		)
	}
	nodeIncarnation, err := newNodeIncarnation()
	if err != nil {
		return err
	}
	s.nodeIncarnation = nodeIncarnation
	s.opts.Id = stationPeerID.String()
	s.opts.ServerOptions = append(
		s.opts.ServerOptions,
		server.WithMetadataEntry("node_peer_id", kernel.Host().ID().String()),
		server.WithMetadataEntry("node_incarnation", nodeIncarnation),
	)

	// init server
	if s.opts.Server == nil {
		serverName := config.Get("peers.node.server.name").String(plugin.NativePluginName)
		if len(serverName) > 0 {
			if plugin.ServerPlugins[serverName] == nil {
				logger.Errorf(ctx, "server %s not found, use native by default", serverName)
				serverName = plugin.NativePluginName
			}
		}

		logger.Infof(ctx, "initial server's name is: %s", serverName)
		s.primeServerOptions()
		s.opts.Server = plugin.ServerPlugins[serverName].New()

		// Inject plugin subservers into subServerNewFunctions
		for name, p := range plugin.SubserverPlugins {
			if !processRole.AllowsPluginSubserver(name) {
				logger.Infof(ctx, "subserver [%s] is excluded from role [%s]", name, processRole)
				continue
			}
			if p.Enabled() {
				var subserverOptions []option.Option
				if name == "bootstrap" {
					subserverOptions = append(
						subserverOptions,
						bootstrapNative.WithKernel(
							kernel.Host(),
							kernel.DHT(),
						),
						bootstrapNative.WithStationRootKey(rootKey),
						bootstrapNative.WithCircuitRoutes(
							nodeIdentity.SPKISHA256(),
							relayRuntime.LiveRoutes,
						),
					)
				}
				if name == "relay" {
					subserverOptions = append(
						subserverOptions,
						relayControl.WithAdmission(relayRuntime.Admission()),
						relayControl.WithHost(kernel.Host()),
					)
				}
				s.opts.ServerOptions = append(
					s.opts.ServerOptions,
					server.WithSubServer(
						name,
						p.New,
						subserverOptions...,
					),
				)
			} else {
				logger.Infof(ctx, "subserver [%s] is disabled", name)
			}
		}
		if processRole == role.Relay {
			relayPlugin := plugin.SubserverPlugins["relay"]
			if relayPlugin == nil || !relayPlugin.Enabled() {
				return fmt.Errorf("initialize relay role: relay subserver is unavailable or disabled")
			}
		}
	}
	if err := s.opts.Server.Init(append([]option.Option{server.WithTransport(s.opts.Transport)}, s.opts.ServerOptions...)...); err != nil {
		return err
	}
	s.cluster, err = newStationClusterAdmission(
		ctx,
		processRole,
		s.opts.Id,
		kernel.Host().ID().String(),
		nodeIncarnation,
		s.opts.Server.Options(),
	)
	if err != nil {
		return fmt.Errorf("initialize Station cluster admission: %w", err)
	}
	if processRole == role.Station && relayConfig.Pool.Mode != nativeRelay.PoolModeOff {
		bootstrapSigner, ok := s.opts.Server.Options().
			SubserverInstances["bootstrap"].(nativeRelay.StationControlSigner)
		if !ok {
			return fmt.Errorf(
				"configure Station Relay control: bootstrap signer is unavailable",
			)
		}
		if err := relayRuntime.ConfigureStationControl(
			bootstrapSigner,
			nodeIdentity.SPKISHA256(),
		); err != nil {
			return fmt.Errorf("configure Station Relay control: %w", err)
		}
	}
	backendURL, err := secureHTTPBackendURL(s.opts.Server.Options().Address)
	if err != nil {
		return err
	}
	ingress, err := securehttp.NewIngress(securehttp.IngressConfig{
		BackendURL: backendURL,
		Identity:   nodeIdentity,
	})
	if err != nil {
		return fmt.Errorf("create secure HTTP ingress: %w", err)
	}
	if err := kernel.AttachComponent(ingress); err != nil {
		return fmt.Errorf("attach secure HTTP ingress: %w", err)
	}
	initialized = true
	return nil
}

func (s *native) primeServerOptions() {
	// Server constructors read typed options before Init. Roles without
	// app-level server options still need that option context initialized.
	s.opts.Apply(server.WithTransport(s.opts.Transport))
}

func secureHTTPBackendURL(address string) (*url.URL, error) {
	_, port, err := net.SplitHostPort(address)
	if err != nil || port == "" {
		return nil, fmt.Errorf(
			"secure HTTP ingress requires a Station listen address with port: %q",
			address,
		)
	}
	return &url.URL{
		Scheme: "http",
		Host:   net.JoinHostPort("127.0.0.1", port),
	}, nil
}
