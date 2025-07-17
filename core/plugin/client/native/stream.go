package native

import (
	"context"
	"github.com/dirty-bro-tech/peers-touch-go/core/client"
	"github.com/dirty-bro-tech/peers-touch-go/core/codec"
	"github.com/libp2p/go-libp2p/core/network"
)

type libp2pStream struct {
	stream network.Stream

	codec codec.Codec
}

func (s *libp2pStream) CloseSend() error {
	//TODO implement me
	panic("implement me")
}

func (s *libp2pStream) Context() context.Context {
	//TODO implement me
	panic("implement me")
}

func (s *libp2pStream) Request() client.Request {
	//TODO implement me
	panic("implement me")
}

func (s *libp2pStream) Response() client.Response {
	//TODO implement me
	panic("implement me")
}

func (s *libp2pStream) Error() error {
	//TODO implement me
	panic("implement me")
}

func (s *libp2pStream) Close() error {
	//TODO implement me
	panic("implement me")
}

func (s *libp2pStream) Send(msg interface{}) error {
	return s.codec.ReadBody(msg)
}

func (s *libp2pStream) Recv(rsp interface{}) error {
	dec := codec.NewDecoder(s.stream)
	return dec.Decode(rsp)
}
