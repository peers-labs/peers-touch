package turn

import (
	"fmt"
	"net"
	"os"
	"os/signal"
	"syscall"

	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
	"github.com/pion/turn/v4"
)

import (
	"context"
)

type SubServer struct {
	opts    *server.SubServerOptions
	extOpts *Options

	name    string
	port    int
	status  server.ServerStatus
	server  *turn.Server
	udpConn net.PacketConn
	tcpLis  *net.TCPListener
}

func (s *SubServer) Init(ctx context.Context, opts ...option.Option) error {
	// Configuration would typically come from options
	publicIP := "127.0.0.1"
	realm := "peers-touch"

	// Initialize network listeners
	udpConn, err := net.ListenPacket("udp4", fmt.Sprintf(":%d", s.port))
	if err != nil {
		return fmt.Errorf("UDP listen error: %w", err)
	}

	tcpLis, err := net.ListenTCP("tcp4", &net.TCPAddr{Port: s.port})
	if err != nil {
		udpConn.Close()
		return fmt.Errorf("TCP listen error: %w", err)
	}

	// Store references
	s.udpConn = udpConn
	s.tcpLis = tcpLis

	// Create TURN server
	s.server, err = turn.NewServer(turn.ServerConfig{
		Realm: realm,
		AuthHandler: func(username, realm string, srcAddr net.Addr) ([]byte, bool) {
			return turn.GenerateAuthKey("shared-secret", username, realm), true
		},
		ListenerConfigs: []turn.ListenerConfig{{
			Listener: tcpLis,
			RelayAddressGenerator: &turn.RelayAddressGeneratorStatic{
				RelayAddress: net.ParseIP(publicIP),
				Address:      "0.0.0.0",
			},
		}},
		PacketConnConfigs: []turn.PacketConnConfig{{
			PacketConn: udpConn,
			RelayAddressGenerator: &turn.RelayAddressGeneratorStatic{
				RelayAddress: net.ParseIP(publicIP),
				Address:      "0.0.0.0",
			},
		}},
	})

	return err
}

func (s *SubServer) Start(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusRunning

	// Handle graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		s.Stop(ctx)
	}()

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

// Interface implementations
func (s *SubServer) Name() string                { return s.name }
func (s *SubServer) Port() int                   { return s.port }
func (s *SubServer) Status() server.ServerStatus { return s.status }
func (s *SubServer) Handlers() []server.Handler  { return nil }

func NewTurnSubServer(opts ...option.Option) server.SubServer {
	rs := &SubServer{}
	rs.opts.Apply(opts...)
	return rs
}
