package native

import (
	"context"
	"fmt"
	"net"
	"sync"

	"github.com/pion/turn/v4"
)

// turnClient manages a TURN client with automatic health checks and renewal
type turnClient struct {
	cfg    *turn.ClientConfig
	client *turn.Client
	mu     sync.Mutex
	ctx    context.Context
}

// newTurnClient creates a new self-healing TURN client manager
func newTurnClient(ctx context.Context, cfg *turn.ClientConfig) *turnClient {
	return &turnClient{
		cfg: cfg,
		ctx: ctx,
	}
}

// Get returns a healthy TURN client, renewing if necessary
func (s *turnClient) Get() (*turn.Client, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Check if existing client is healthy
	if s.client != nil && s.isAlive() {
		return s.client, nil
	}

	// Cleanup old client if exists
	if s.client != nil {
		s.client.Close()
		s.client = nil
	}

	// Create new connection
	// todo support udp
	conn, err := net.Dial("tcp", s.cfg.STUNServerAddr)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to TURN server: %w", err)
	}

	// Create new client
	newClient, err := turn.NewClient(&turn.ClientConfig{
		STUNServerAddr: s.cfg.STUNServerAddr,
		TURNServerAddr: s.cfg.TURNServerAddr,
		Conn:           turn.NewSTUNConn(conn),
		Username:       s.cfg.Username,
		Password:       s.cfg.Password,
		Realm:          s.cfg.Realm,
		LoggerFactory:  s.cfg.LoggerFactory,
	})
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to create TURN client: %w", err)
	}

	// Start listening
	if err := newClient.Listen(); err != nil {
		newClient.Close()
		conn.Close()
		return nil, fmt.Errorf("failed to start TURN listener: %w", err)
	}

	s.client = newClient
	return s.client, nil
}

// isAlive checks if the current client can communicate with the TURN server
func (s *turnClient) isAlive() bool {
	if s.client == nil {
		return false
	}

	// Use binding request to verify connectivity
	_, err := s.client.SendBindingRequest()
	return err == nil
}
