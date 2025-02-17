package client

import (
	"context"

	"github.com/dirty-bro-tech/peers-touch-go/core/codec"
)

// Client is an interface that represents a client.
type Client interface {
	Init(...Option) error

	Call(ctx context.Context, req Request, rsp interface{}, opts ...CallOption) error
	Name() string
}

// Request is an interface that represents a request to be sent to a server.
type Request interface {
	Service() string
	Method() string
	Endpoint() string
	ContentType() string
	Body() interface{}
	Codec() codec.Writer
}

// Response is an interface that represents a response from a server.
type Response interface {
	Codec() codec.Reader
	Header() map[string]string
	Read() ([]byte, error)
}
