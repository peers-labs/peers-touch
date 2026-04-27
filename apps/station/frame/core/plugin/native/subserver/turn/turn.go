// Package turn provides a TURN subserver implementation.
package turn

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"net"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/pion/turn/v4"
)

// SubServer implements a TURN service.
type SubServer struct {
	opts *Options

	status  server.Status
	server  *turn.Server
	udpConn net.PacketConn
	tcpLis  *net.TCPListener

	address string
}

// Init initializes TURN server and listeners.
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
		_ = udpConn.Close()
		return fmt.Errorf("TCP listen error: %w", err)
	}

	// Store references
	s.udpConn = udpConn
	s.tcpLis = tcpLis

	// Create TURN server.
	//
	// Auth uses RFC-5766 short-term credentials (a.k.a. TURN-REST):
	//   username   = "<expiry-unix>:<name>"
	//   credential = base64(HMAC-SHA1(authSecret, username))
	//
	// `ICEHandler.GenerateCredentials` (handed out via /api/v1/turn/ice-servers)
	// emits exactly that pair. The previous implementation called
	// `GenerateAuthKey(username, realm, username)`, which forced the
	// password to equal the username — that never matches what the client
	// presents, so every TURN allocation was rejected and WebRTC silently
	// "Fallback"-ed with no media path at all.
	authSecret := s.opts.AuthSecret
	s.server, err = turn.NewServer(turn.ServerConfig{
		Realm:         s.opts.Realm,
		LoggerFactory: NewLoggerFactory(),
		AuthHandler: func(username, realm string, srcAddr net.Addr) ([]byte, bool) {
			if authSecret == "" {
				return nil, false
			}
			if !isShortTermCredentialFresh(username) {
				return nil, false
			}
			mac := hmac.New(sha1.New, []byte(authSecret))
			mac.Write([]byte(username))
			password := base64.StdEncoding.EncodeToString(mac.Sum(nil))
			return turn.GenerateAuthKey(username, realm, password), true
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

// Start begins TURN service and signal handling.
func (s *SubServer) Start(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusRunning

	// listPeers graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		if err := s.Stop(ctx); err != nil {
			logger.Errorf(ctx, "TURN server stop error: %v", err)
		}
	}()

	// logs debug information
	logger.Infof(ctx, "Starting TURN server\nPort: %d\nRealm: %s\nPublic IP: %s\nAuth Secret: [%t]",
		s.opts.Port, s.opts.Realm, s.opts.PublicIP, s.opts.AuthSecret != "")
	return nil
}

// Stop shuts down listeners and the TURN server.
func (s *SubServer) Stop(_ context.Context) error {
	s.status = server.StatusStopping
	defer func() { s.status = server.StatusStopped }()

	if err := s.server.Close(); err != nil {
		return err
	}
	return nil
}

// Name returns the subserver identifier.
func (s *SubServer) Name() string { return "turn" }

// Address returns the listening address.
func (s *SubServer) Address() server.SubserverAddress {
	return server.SubserverAddress{
		Address: []string{s.address},
	}
}

// Status returns current server status.
func (s *SubServer) Status() server.Status { return s.status }

// Handlers returns HTTP handlers for ICE server configuration.
// TURN core relay service (UDP/TCP) is handled by pion/turn library and doesn't need HTTP handlers.
// Only ICE configuration API needs HTTP endpoint for clients to discover STUN/TURN servers.
func (s *SubServer) Handlers() []server.Handler {
	return NewICEHandler(s.opts).Handlers()
}

// Type returns the subserver type.
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

// isShortTermCredentialFresh accepts only credentials whose embedded expiry is
// still in the future. Username format is "<unix-expiry>:<name>"; anything
// else (no colon, non-numeric prefix, or already-expired) is rejected.
func isShortTermCredentialFresh(username string) bool {
	idx := strings.IndexByte(username, ':')
	if idx <= 0 {
		return false
	}
	expiry, err := strconv.ParseInt(username[:idx], 10, 64)
	if err != nil {
		return false
	}
	return time.Now().Unix() < expiry
}
