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
	"github.com/dirty-bro-tech/peers-touch-go/core/transport"

	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
)

const (
	DefaultTimeout = 30 * time.Second
)

var (
	_ client.Client = (*libp2pClient)(nil)
)

type libp2pClient struct {
	host      host.Host
	transport transport.Transport
	opts      client.Options
	codecs    map[string]codec.NewCodec
	mutex     sync.RWMutex
	initOnce  sync.Once
	initErr   error
}

// NewClient creates a new libp2p client
func NewClient(opts ...option.Option) client.Client {
	c := &libp2pClient{
		codecs: make(map[string]codec.NewCodec),
		opts: client.Options{
			Options:     &option.Options{},
			CallOptions: client.DefaultCallOptions(),
			Codecs:      make(map[string]codec.NewCodec),
		},
	}

	// Register default codecs
	c.opts.Codecs = c.codecs

	// Apply options
	for _, o := range opts {
		c.opts.Apply(o)
	}

	return c
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
	})

	return c.initErr
}

// Call makes a synchronous call to a service
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

	// Get service address
	addr := req.Service()
	if addr == "" {
		return fmt.Errorf("service address is required")
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

// Stream creates a bidirectional stream to a service
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

	// Get service address
	addr := req.Service()
	if addr == "" {
		return nil, fmt.Errorf("service address is required")
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
