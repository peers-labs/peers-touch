package client

import (
	"context"
	"fmt"
	"sync"

	"github.com/peers-touch/peers-touch/station/frame/core/client"
	"github.com/peers-touch/peers-touch/station/frame/core/codec"
	"github.com/peers-touch/peers-touch/station/frame/core/transport"
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

func (s *libp2pStream) Context() context.Context {
	return s.ctx
}

func (s *libp2pStream) Request() client.Request {
	return s.req
}

func (s *libp2pStream) Response() client.Response {
	// Not implemented in this simplified version
	return nil
}

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

func (s *libp2pStream) Error() error {
	// Not implemented in this simplified version
	return nil
}

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

func (s *libp2pStream) CloseSend() error {
	// For this implementation, CloseSend is the same as Close
	return s.Close()
}
