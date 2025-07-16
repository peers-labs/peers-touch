package client

import "context"

// Option is a function that can be used to configure a Client
type Option func(*Options)

type Options struct {
}

// CallOption is a function that can be used to configure a CallOptions
type CallOption func(*CallOptions)

type CallOptions struct{}

type PublishOptions struct {
	// Other options for implementations of the interface
	// can be stored in a context
	Context context.Context
	// Exchange is the routing exchange for the message
	Exchange string
}

// PublishOption used by Publish.
type PublishOption func(*PublishOptions)

type MessageOptions struct {
	ContentType string
}

// MessageOption used by NewMessage.
type MessageOption func(*MessageOptions)

type RequestOptions struct {

	// Other options for implementations of the interface
	// can be stored in a context
	Context     context.Context
	ContentType string
	Stream      bool
}

// RequestOption used by NewRequest.
type RequestOption func(*RequestOptions)
