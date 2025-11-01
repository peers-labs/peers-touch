package turn

import (
	"fmt"
	"net"
	"os"
	"os/signal"
	"syscall"

	"github.com/peers-touch/peers-touch/station/frame/core/logger"
	"github.com/peers-touch/peers-touch/station/frame/core/option"
	"github.com/peers-touch/peers-touch/station/frame/core/server"
	"github.com/pion/turn/v4"
)

import (
	"context"
)

type SubServer struct {
	opts *Options

	status  server.Status
	server  *turn.Server
	udpConn net.PacketConn
	tcpLis  *net.TCPListener

	address string
}

func (s *SubServer) Init(ctx context.Context, opts ...option.Option) error {
	for _, opt := range opts {
		s.opts.Apply(opt)
	}

	s.address = fmt.Sprintf(":%d", s.opts.Port)

	// Initialize network listeners
	udpConn, err := net.ListenPacket("udp4", s.address)
	if err != nil {
		return fmt.Errorf("UDP listen error: %w", err)
	}

	tcpLis, err := net.ListenTCP("tcp4", &net.TCPAddr{Port: s.opts.Port})
	if err != nil {
		udpConn.Close()
		return fmt.Errorf("TCP listen error: %w", err)
	}

	// Store references
	s.udpConn = udpConn
	s.tcpLis = tcpLis

	// Create TURN server
	s.server, err = turn.NewServer(turn.ServerConfig{
		Realm:         s.opts.Realm,
		LoggerFactory: NewLoggerFactory(),
		AuthHandler: func(username, realm string, srcAddr net.Addr) ([]byte, bool) {
			return turn.GenerateAuthKey(username, realm, username), true
		},
		ListenerConfigs: []turn.ListenerConfig{{
			Listener: tcpLis,
			RelayAddressGenerator: &turn.RelayAddressGeneratorStatic{
				RelayAddress: net.ParseIP(s.opts.PublicIP),
				Address:      "0.0.0.0",
			},
		}},
		PacketConnConfigs: []turn.PacketConnConfig{{
			PacketConn: udpConn,
			RelayAddressGenerator: &turn.RelayAddressGeneratorStatic{
				RelayAddress: net.ParseIP(s.opts.PublicIP),
				Address:      "0.0.0.0",
			},
		}},
	})

	return err
}

func (s *SubServer) Start(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusRunning

	// listPeers graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		s.Stop(ctx)
	}()

	// logs debug information
	logger.Infof(ctx, "Starting TURN server\nPort: %d\nRealm: %s\nPublic IP: %s\nAuth Secret: [%t]",
		s.opts.Port, s.opts.Realm, s.opts.PublicIP, s.opts.AuthSecret != "")
	return nil
}

func (s *SubServer) Stop(ctx context.Context) error {
	s.status = server.StatusStopping
	defer func() { s.status = server.StatusStopped }()

	if err := s.server.Close(); err != nil {
		return err
	}
	return nil
}

func (s *SubServer) Name() string { return "turn" }
func (s *SubServer) Address() server.SubserverAddress {
	return server.SubserverAddress{
		Address: []string{s.address},
	}
}

func (s *SubServer) Status() server.Status      { return s.status }
func (s *SubServer) Handlers() []server.Handler { return nil }

func (s *SubServer) Type() server.SubserverType {
	return server.SubserverTypeTurn
}

// NewTurnSubServer creates a new TURN subserver with the provided options.
// Call it after root Ctx is initialized, which is initialized in BeforeInit of predominate process.
func NewTurnSubServer(opts ...option.Option) server.Subserver {
	turnS := &SubServer{
		opts: option.GetOptions(opts...).Ctx().Value(optionsKey{}).(*Options),
	}

	return turnS
}
