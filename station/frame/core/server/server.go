package server

import (
	"context"
	"net/http"

	"github.com/peers-labs/peers-touch/station/frame/core/option"
)

// Method represents an HTTP method.
type Method string

// Me returns the string representation of the HTTP method.
func (m Method) Me() string { return string(m) }

const (
	GET     Method = "GET"
	POST    Method = "POST"
	PUT     Method = "PUT"
	DELETE  Method = "DELETE"
	PATCH   Method = "PATCH"
	HEAD    Method = "HEAD"
	OPTIONS Method = "OPTIONS"
	TRACE   Method = "TRACE"
	CONNECT Method = "CONNECT"
	ANY     Method = "ANY"
)

// Server represents a service server.
type Server interface {
	Init(...option.Option) error
	Options() *Options
	// Handle use to add new handler dynamically
	Handle(Handler) error
	Start(context.Context, ...option.Option) error
	Stop(context.Context) error
	Name() string
}

// Handler describes an endpoint handler.
type Handler interface {
	Name() string
	Path() string
	Method() Method
	// Handler returns a function that can handle different types of contexts
	Handler() interface{}
	Wrappers() []Wrapper
}

// Routers interface defines a collection of handlers with a name
// Routers defines a collection of handlers with a cluster name.
type Routers interface {
	Handlers() []Handler

	// Name declares the cluster-name of routers
	// it must be unique. Peers uses it to check if there are already routers(like activitypub
	// and management interface.) that must be registered,
	// if you want to register a bundle of routers with the same name, it will be overwritten
	Name() string
}

// RouterURL interface defines methods for router URL handling
// RouterURL defines methods for router URL handling.
type RouterURL interface {
	Name() string
	SubPath() string
}

// Wrapper defines a function type for Wrapper
// Wrapper decorates an http.Handler with context support.
type Wrapper func(ctx context.Context, next http.Handler) http.Handler

type httpHandler struct {
	name     string
	method   Method
	path     string
	handler  interface{}
	wrappers []Wrapper
}

// Wrappers returns middleware wrappers.
func (h *httpHandler) Wrappers() []Wrapper { return h.wrappers }

// Name returns handler name.
func (h *httpHandler) Name() string { return h.name }

// Path returns handler path.
func (h *httpHandler) Path() string { return h.path }

// Handler returns the underlying handler function.
func (h *httpHandler) Handler() interface{} { return h.handler }

// Method returns HTTP method.
func (h *httpHandler) Method() Method { return h.method }

// NewHandler constructs a Handler from RouterURL, handler and options.
func NewHandler(routerURL RouterURL, handler interface{}, opts ...HandlerOption) Handler {
	config := &HandlerOptions{}
	for _, opt := range opts {
		opt(config)
	}

	return &httpHandler{
		name:     routerURL.Name(),
		path:     routerURL.SubPath(),
		handler:  handler,
		method:   config.Method,
		wrappers: config.Wrappers,
	}
}
