package client

import (
	"context"
	"fmt"
	"sync"

	"github.com/peers-labs/peers-touch/station/frame/core/client"
	"github.com/peers-labs/peers-touch/station/frame/core/codec"
	"github.com/peers-labs/peers-touch/station/frame/core/transport"
)

// libp2pStream implements the client.Stream interface
type libp2pStream struct {
	ctx    context.Context
	client transport.Client
	codec  codec.Codec
	req    client.Request
	closed bool

	closeCh chan struct{}
	mutex   sync.Mutex
}

// Context returns the stream context.
func (s *libp2pStream) Context() context.Context {
	return s.ctx
}

// Request returns the stream request.
func (s *libp2pStream) Request() client.Request {
	return s.req
}

// Response returns the stream response (nil for this implementation).
func (s *libp2pStream) Response() client.Response {
	// Not implemented in this simplified version
	return nil
}

// Send writes a message to the stream using the codec.
func (s *libp2pStream) Send(msg interface{}) error {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	if s.closed {
		return fmt.Errorf("stream closed")
	}

	codecMsg := &codec.Message{
		Target:   s.req.Service(),
		Method:   s.req.Method(),
		Endpoint: s.req.Endpoint(),
	}

	return s.codec.Write(codecMsg, msg)
}

// Recv reads a message from the stream using the codec.
func (s *libp2pStream) Recv(msg interface{}) error {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	if s.closed {
		return fmt.Errorf("stream closed")
	}

	codecMsg := &codec.Message{}
	if err := s.codec.ReadHeader(codecMsg, codec.MessageType(0)); err != nil {
		return err
	}

	return s.codec.ReadBody(msg)
}

// Error returns the last stream error (not tracked).
func (s *libp2pStream) Error() error {
	// Not implemented in this simplified version
	return nil
}

// Close closes the codec and client.
func (s *libp2pStream) Close() error {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	if s.closed {
		return nil
	}

	s.closed = true
	close(s.closeCh)

	if err := s.codec.Close(); err != nil {
		return err
	}

	return s.client.Close()
}

// CloseSend closes the sending side of the stream.
func (s *libp2pStream) CloseSend() error {
	// Same as Close for this implementation
	return s.Close()
}
