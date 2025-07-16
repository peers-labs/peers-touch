package native

import (
	"context"
	"errors"
	"fmt"

	"github.com/dirty-bro-tech/peers-touch-go/core/client"
	"github.com/dirty-bro-tech/peers-touch-go/core/codec"
	"github.com/dirty-bro-tech/peers-touch-go/core/plugin"
	dht "github.com/libp2p/go-libp2p-kad-dht"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
)

type libp2pClient struct {
	host host.Host
	dht  *dht.IpfsDHT
	opts client.Options
}

func (c *libp2pClient) Init(opts ...libp2pClient.Option) error {
	// Initialization logic using libp2p
	return nil
}

func (c *libp2pClient) Call(ctx context.Context, req libp2pClient.Request, rsp interface{}, opts ...libp2pClient.CallOption) error {
	// Libp2p RPC implementation
	pid, err := peer.Decode(req.Service())
	if err != nil {
		return fmt.Errorf("invalid peer ID: %w", err)
	}

	s, err := c.host.NewStream(ctx, pid, "/peers-rpc/1.0.0")
	if err != nil {
		return fmt.Errorf("failed to create stream: %w", err)
	}
	defer s.Close()

	// Write request
	enc := codec.NewEncoder(s)
	if err := enc.Encode(req.Body()); err != nil {
		return fmt.Errorf("encoding error: %w", err)
	}

	// Read response
	dec := codec.NewDecoder(s)
	return dec.Decode(rsp)
}

func (c *libp2pClient) Stream(ctx context.Context, req libp2pClient.Request, opts ...libp2pClient.CallOption) (libp2pClient.Stream, error) {
	pid, err := peer.Decode(req.Service())
	if err != nil {
		return nil, fmt.Errorf("invalid peer ID: %w", err)
	}

	s, err := c.host.NewStream(ctx, pid, "/peers-stream/1.0.0")
	if err != nil {
		return nil, err
	}

	return &libp2pStream{stream: s}, nil
}

func (c *libp2pClient) Publish(ctx context.Context, msg libp2pClient.Message, opts ...libp2pClient.PublishOption) error {
	// Implement pubsub logic
	return errors.New("pubsub not implemented yet")
}

func (c *libp2pClient) Name() string {
	return "native"
}

type libp2pStream struct {
	stream network.Stream
}

func (s *libp2pStream) Send(msg interface{}) error {
	enc := codec.NewEncoder(s.stream)
	return enc.Encode(msg)
}

func (s *libp2pStream) Recv(rsp interface{}) error {
	dec := codec.NewDecoder(s.stream)
	return dec.Decode(rsp)
}

// ... Implement other Stream interface methods ...

func init() {
	client := &libp2pClient{}
	plugin.ClientPlugins[client.Name()] = client
}
