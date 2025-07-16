package client

// we follow the design of go-micro. thanks for the great work.

import (
	"context"

	"github.com/dirty-bro-tech/peers-touch-go/core/codec"
)

// Client is an interface that represents a client.
type Client interface {
	Init(...Option) error

	Call(ctx context.Context, req Request, rsp interface{}, opts ...CallOption) error
	Stream(ctx context.Context, req Request, opts ...CallOption) (Stream, error)
	Publish(ctx context.Context, msg Message, opts ...PublishOption) error
	Name() string
}

// Message is the interface for publishing asynchronously.
type Message interface {
	Topic() string
	Payload() interface{}
	ContentType() string
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

// Stream is the inteface for a bidirectional synchronous stream.
type Stream interface {
	Closer
	Context() context.Context
	Request() Request
	Response() Response
	Send(interface{}) error
	Recv(interface{}) error
	Error() error
	Close() error
}

// Closer handle client close.
type Closer interface {
	// CloseSend closes the send direction of the stream.
	CloseSend() error
}
