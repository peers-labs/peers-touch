package client

import (
	"context"
	"time"

	"github.com/peers-touch/peers-touch/station/frame/core/codec"
	"github.com/peers-touch/peers-touch/station/frame/core/option"
	"github.com/peers-touch/peers-touch/station/frame/core/registry"
)

// region server options
type registryOptionsKey struct{}

var (
	wrapper = option.NewWrapper[Options](registryOptionsKey{}, func(options *option.Options) *Options {
		o := &Options{
			Options: options,
		}

		return o
	})
)

// Default values for client options
const (
	DefaultCallTimeout = 30 * time.Second
	DefaultContentType = "application/json"
)

type Options struct {
	*option.Options

	Registry registry.Registry

	// Default Call Options
	CallOptions CallOptions
	Codecs      map[string]codec.NewCodec
}

func WithInit() option.Option {
	return wrapper.Wrap(func(o *Options) {
		// do nothing
	})
}

func Registry(r registry.Registry) option.Option {
	return wrapper.Wrap(func(o *Options) {
		o.Registry = r
	})
}

// CallOption is a function that can be used to configure a CallOptions
type CallOption func(*CallOptions)

type CallOptions struct {
	// Request timeout for the call
	Timeout time.Duration

	// Metadata for the call (headers, tracing)
	Metadata map[string]string

	// Content type for serialization
	ContentType string

	// Streaming flag
	Stream bool

	// Request ID for tracing and debugging
	RequestID string
}

// DefaultCallOptions returns sensible defaults
func DefaultCallOptions() CallOptions {
	return CallOptions{
		Timeout:     DefaultCallTimeout,
		Metadata:    make(map[string]string),
		ContentType: DefaultContentType,
		Stream:      false,
		RequestID:   "",
	}
}

// WithCallTimeout sets the timeout for the call
func WithCallTimeout(d time.Duration) CallOption {
	return func(o *CallOptions) {
		o.Timeout = d
	}
}

// WithCallMetadata adds metadata to the call
func WithCallMetadata(md map[string]string) CallOption {
	return func(o *CallOptions) {
		if o.Metadata == nil {
			o.Metadata = make(map[string]string)
		}
		for k, v := range md {
			o.Metadata[k] = v
		}
	}
}

// WithCallContentType sets the content type for the call
func WithCallContentType(ct string) CallOption {
	return func(o *CallOptions) {
		o.ContentType = ct
	}
}

// WithCallRequestID sets the request ID for tracing
func WithCallRequestID(id string) CallOption {
	return func(o *CallOptions) {
		o.RequestID = id
	}
}

// WithCallStream enables streaming mode for the call
func WithCallStream() CallOption {
	return func(o *CallOptions) {
		o.Stream = true
	}
}

// PublishOptions defines options for publish operations
type PublishOptions struct {
	// Other options for implementations of the interface
	// can be stored in a context
	Context context.Context
	// Exchange is the routing exchange for the message
	Exchange string
}

// PublishOption used by Publish.
type PublishOption func(*PublishOptions)

// MessageOptions defines options for messages
type MessageOptions struct {
	ContentType string
}

// MessageOption used by NewMessage.
type MessageOption func(*MessageOptions)

// RequestOptions defines options for requests
type RequestOptions struct {
	// Other options for implementations of the interface
	// can be stored in a context
	Context     context.Context
	ContentType string
	Stream      bool
}

// RequestOption used by NewRequest.
type RequestOption func(*RequestOptions)

func GetOptions() *Options {
	return option.GetOptions().Ctx().Value(registryOptionsKey{}).(*Options)
}
