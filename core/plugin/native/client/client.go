package client

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/dirty-bro-tech/peers-touch-go/core/client"
	"github.com/dirty-bro-tech/peers-touch-go/core/codec"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	native "github.com/dirty-bro-tech/peers-touch-go/core/plugin/native/transport"
	"github.com/dirty-bro-tech/peers-touch-go/core/registry"
	"github.com/dirty-bro-tech/peers-touch-go/core/transport"

	"github.com/libp2p/go-libp2p"
	dht "github.com/libp2p/go-libp2p-kad-dht"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
)

const (
	DefaultTimeout = 30 * time.Second
)

var (
	_ client.Client = (*libp2pClient)(nil)
)

// NodeInfo represents information about a network node
type NodeInfo struct {
	PeerID     string          `json:"peer_id"`
	Addresses  []string        `json:"addresses"`
	Connection *ConnectionInfo `json:"connection,omitempty"`
	IsActive   bool            `json:"is_active"`
}

// ConnectionInfo represents connection details for a peer
type ConnectionInfo struct {
	Direction  string        `json:"direction"`
	Opened     time.Time     `json:"opened"`
	NumStreams int           `json:"num_streams"`
	Latency    time.Duration `json:"latency"`
}

type libp2pClient struct {
	host      host.Host
	transport transport.Transport
	opts      *client.Options
	codecs    map[string]codec.NewCodec
	mutex     sync.RWMutex
	initOnce  sync.Once
	initErr   error
	dht       *dht.IpfsDHT
	registry  registry.Registry
}

// NewClient creates a new libp2p client
func NewClient(opts ...option.Option) client.Client {
	c := &libp2pClient{
		codecs: make(map[string]codec.NewCodec),
		opts:   client.GetOptions(),
	}

	c.opts.CallOptions = client.DefaultCallOptions()
	c.opts.Codecs = make(map[string]codec.NewCodec)

	// Register default codecs
	c.opts.Codecs = c.codecs

	// Apply options
	for _, o := range opts {
		c.opts.Apply(o)
	}

	return c
}

// NewNodeClient creates a new NodeClient with extended functionality
func NewNodeClient(opts ...option.Option) NodeClient {
	return NewClient(opts...).(*libp2pClient)
}

// WithDHT sets the DHT instance for the client
func WithDHT(dht *dht.IpfsDHT) option.Option {
	return func(o *option.Options) {
		o.AppendCtx("dht", dht)
	}
}

// WithRegistry sets the registry instance for the client
func WithRegistry(reg registry.Registry) option.Option {
	return func(o *option.Options) {
		o.AppendCtx("registry", reg)
	}
}

// Init initializes the client
func (c *libp2pClient) Init(opts ...option.Option) error {
	c.mutex.Lock()
	defer c.mutex.Unlock()

	c.initOnce.Do(func() {
		// Apply options
		for _, o := range opts {
			c.opts.Apply(o)
		}

		// Create libp2p host
		h, err := libp2p.New()
		if err != nil {
			c.initErr = fmt.Errorf("failed to create libp2p host: %w", err)
			return
		}

		c.host = h

		// Create transport
		c.transport = native.NewTransport()
		if err := c.transport.Init(); err != nil {
			c.initErr = fmt.Errorf("failed to initialize transport: %w", err)
			return
		}

		// Extract DHT and registry from context if provided
		ctx := c.opts.Ctx()
		if dhtVal := ctx.Value("dht"); dhtVal != nil {
			if dht, ok := dhtVal.(*dht.IpfsDHT); ok {
				c.dht = dht
			}
		}
		if regVal := ctx.Value("registry"); regVal != nil {
			if reg, ok := regVal.(registry.Registry); ok {
				c.registry = reg
			}
		}
	})

	return c.initErr
}

// Call makes a synchronous call to a node
func (c *libp2pClient) Call(ctx context.Context, req client.Request, rsp interface{}, opts ...client.CallOption) error {
	// Apply call options
	callOpts := c.opts.CallOptions
	for _, opt := range opts {
		opt(&callOpts)
	}

	// Set timeout if not already set
	if callOpts.Timeout == 0 {
		callOpts.Timeout = DefaultTimeout
	}

	// Create context with timeout
	ctx, cancel := context.WithTimeout(ctx, callOpts.Timeout)
	defer cancel()

	// Get node address
	addr := req.Service()
	if addr == "" {
		return fmt.Errorf("node address is required")
	}

	// Parse peer ID
	_, err := peer.Decode(addr)
	if err != nil {
		return fmt.Errorf("invalid peer ID: %w", err)
	}

	// Dial the peer
	client, err := c.transport.Dial(addr)
	if err != nil {
		return fmt.Errorf("failed to dial peer: %w", err)
	}
	defer client.Close()

	// Get codec
	newCodec, ok := c.codecs[req.ContentType()]
	if !ok {
		return fmt.Errorf("unsupported content type: %s", req.ContentType())
	}

	// Create codec wrapper for transport client
	codecWrapper := &transportCodec{client: client}
	codecImpl := newCodec(codecWrapper)
	defer codecImpl.Close()

	// Create codec message
	msg := &codec.Message{
		Target:   req.Service(),
		Method:   req.Method(),
		Endpoint: req.Endpoint(),
		Header:   callOpts.Metadata,
	}

	// Write request
	if err := codecImpl.Write(msg, req.Body()); err != nil {
		return fmt.Errorf("failed to write request: %w", err)
	}

	// Read response
	respMsg := &codec.Message{}
	if err := codecImpl.ReadHeader(respMsg, codec.MessageType(0)); err != nil {
		return fmt.Errorf("failed to read response header: %w", err)
	}

	if err := codecImpl.ReadBody(rsp); err != nil {
		return fmt.Errorf("failed to read response body: %w", err)
	}

	return nil
}

// Stream creates a bidirectional stream to a node
func (c *libp2pClient) Stream(ctx context.Context, req client.Request, opts ...client.CallOption) (client.Stream, error) {
	// Apply call options
	callOpts := c.opts.CallOptions
	for _, opt := range opts {
		opt(&callOpts)
	}

	// Set timeout if not already set
	if callOpts.Timeout == 0 {
		callOpts.Timeout = DefaultTimeout
	}

	// Create context with timeout
	ctx, cancel := context.WithTimeout(ctx, callOpts.Timeout)
	defer cancel()

	// Get node address
	addr := req.Service()
	if addr == "" {
		return nil, fmt.Errorf("node address is required")
	}

	// Parse peer ID
	_, err := peer.Decode(addr)
	if err != nil {
		return nil, fmt.Errorf("invalid peer ID: %w", err)
	}

	// Dial the peer
	transportClient, err := c.transport.Dial(addr)
	if err != nil {
		return nil, fmt.Errorf("failed to dial peer: %w", err)
	}

	// Get codec
	newCodec, ok := c.codecs[req.ContentType()]
	if !ok {
		transportClient.Close()
		return nil, fmt.Errorf("unsupported content type: %s", req.ContentType())
	}

	// Create codec wrapper for transport client
	codecWrapper := &transportCodec{client: transportClient}
	codecImpl := newCodec(codecWrapper)

	// Create stream
	stream := &libp2pStream{
		ctx:     ctx,
		client:  transportClient,
		codec:   codecImpl,
		req:     req,
		closed:  false,
		closeCh: make(chan struct{}),
	}

	return stream, nil
}

// Publish publishes a message (not implemented)
func (c *libp2pClient) Publish(ctx context.Context, msg client.Message, opts ...client.PublishOption) error {
	return fmt.Errorf("publish not implemented")
}

// Name returns the client name
func (c *libp2pClient) Name() string {
	return "libp2p"
}

// GetActiveNodes returns information about active nodes in the network
func (c *libp2pClient) GetActiveNodes(ctx context.Context) ([]*NodeInfo, error) {
	if err := c.Init(); err != nil {
		return nil, fmt.Errorf("failed to initialize client: %w", err)
	}

	var nodes []*NodeInfo

	// Get connected peers from libp2p host
	connectedPeers := c.host.Network().Peers()
	for _, peerID := range connectedPeers {
		// Get peer addresses
		addrs := c.host.Peerstore().Addrs(peerID)
		addrStrs := make([]string, len(addrs))
		for i, addr := range addrs {
			addrStrs[i] = addr.String()
		}

		// Get connection info
		conns := c.host.Network().ConnsToPeer(peerID)
		var connectionInfo *ConnectionInfo
		if len(conns) > 0 {
			conn := conns[0]
			latency := c.host.Peerstore().LatencyEWMA(peerID)
			connectionInfo = &ConnectionInfo{
				Direction:  conn.Stat().Direction.String(),
				Opened:     conn.Stat().Opened,
				NumStreams: conn.Stat().NumStreams,
				Latency:    latency,
			}
		}

		nodes = append(nodes, &NodeInfo{
			PeerID:     peerID.String(),
			Addresses:  addrStrs,
			Connection: connectionInfo,
			IsActive:   c.host.Network().Connectedness(peerID) == network.Connected,
		})
	}

	// If we have DHT access, also get peers from DHT
	if c.dht != nil {
		if dhtPeers, err := c.getDHTNodes(ctx); err == nil {
			nodes = append(nodes, dhtPeers...)
		}
	}

	return nodes, nil
}

// GetNodeInfo returns information about a specific node
func (c *libp2pClient) GetNodeInfo(ctx context.Context, peerID string) (*NodeInfo, error) {
	if err := c.Init(); err != nil {
		return nil, fmt.Errorf("failed to initialize client: %w", err)
	}

	// Parse peer ID
	pid, err := peer.Decode(peerID)
	if err != nil {
		return nil, fmt.Errorf("invalid peer ID: %w", err)
	}

	// Get peer addresses
	addrs := c.host.Peerstore().Addrs(pid)
	addrStrs := make([]string, len(addrs))
	for i, addr := range addrs {
		addrStrs[i] = addr.String()
	}

	// Get connection info
	conns := c.host.Network().ConnsToPeer(pid)
	var connectionInfo *ConnectionInfo
	if len(conns) > 0 {
		conn := conns[0]
		latency := c.host.Peerstore().LatencyEWMA(pid)
		connectionInfo = &ConnectionInfo{
			Direction:  conn.Stat().Direction.String(),
			Opened:     conn.Stat().Opened,
			NumStreams: conn.Stat().NumStreams,
			Latency:    latency,
		}
	}

	return &NodeInfo{
		PeerID:     peerID,
		Addresses:  addrStrs,
		Connection: connectionInfo,
		IsActive:   c.host.Network().Connectedness(pid) == network.Connected,
	}, nil
}

// ListPeers returns a list of peers from the registry
func (c *libp2pClient) ListPeers(ctx context.Context) ([]*registry.Peer, error) {
	if err := c.Init(); err != nil {
		return nil, fmt.Errorf("failed to initialize client: %w", err)
	}

	if c.registry != nil {
		return c.registry.ListPeers(ctx)
	}

	return nil, fmt.Errorf("registry not available")
}

// getDHTNodes retrieves nodes from DHT
func (c *libp2pClient) getDHTNodes(ctx context.Context) ([]*NodeInfo, error) {
	var nodes []*NodeInfo

	// Get routing table peers
	routingTable := c.dht.RoutingTable()
	for _, peerID := range routingTable.ListPeers() {
		// Skip if already in connected peers
		if c.host.Network().Connectedness(peerID) == network.Connected {
			continue
		}

		// Try to find peer info
		peerInfo, err := c.dht.FindPeer(ctx, peerID)
		if err != nil {
			continue
		}

		addrStrs := make([]string, len(peerInfo.Addrs))
		for i, addr := range peerInfo.Addrs {
			addrStrs[i] = addr.String()
		}

		nodes = append(nodes, &NodeInfo{
			PeerID:    peerID.String(),
			Addresses: addrStrs,
			IsActive:  false, // DHT peers are not directly connected
		})
	}

	return nodes, nil
}

// transportCodec wraps a transport client to implement io.ReadWriteCloser
type transportCodec struct {
	client transport.Client
}

func (tc *transportCodec) Read(p []byte) (n int, err error) {
	// This is a simplified implementation
	// In a real implementation, you would need to handle the protocol properly
	return 0, fmt.Errorf("read not implemented for transport codec")
}

func (tc *transportCodec) Write(p []byte) (n int, err error) {
	// This is a simplified implementation
	// In a real implementation, you would need to handle the protocol properly
	return 0, fmt.Errorf("write not implemented for transport codec")
}

func (tc *transportCodec) Close() error {
	return tc.client.Close()
}
