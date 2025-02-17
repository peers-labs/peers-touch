package client

import "context"

type Client interface {
	Init(...Option) error

	Call(ctx context.Context, req Request, rsp interface{}, opts ...CallOption) error
}

type Request interface {
	Service() string
	Method() string
	Endpoint() string
	ContentType() string
	Body() interface{}
	Codec() codec.Writer
	Stream() bool
}
