package server

import (
	"context"
	"net/http"

	"github.com/dirty-bro-tech/peers-touch-go/core/option"
)

type Method string

func (m Method) Me() string {
	return string(m)
}

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

type Server interface {
	Init(...option.Option) error
	Options() *Options
	// Handle use to add new handler dynamically
	Handle(Handler) error
	Start(context.Context, ...option.Option) error
	Stop(context.Context) error
	Name() string
}

type Handler interface {
	Name() string
	Path() string
	Method() Method
	// Handler returns a function that can handle different types of contexts
	Handler() interface{}
	Wrappers() []Wrapper
}

// Routers interface defines a collection of handlers with a name
type Routers interface {
	Handlers() []Handler

	// Name declares the cluster-name of routers
	// it must be unique. Peers uses it to check if there are already routers(like activitypub
	// and management interface.) that must be registered,
	// if you want to register a bundle of routers with the same name, it will be overwritten
	Name() string
}

// RouterURL interface defines methods for router URL handling
type RouterURL interface {
	Name() string
	SubPath() string
}

// Wrapper defines a function type for Wrapper
type Wrapper func(next http.Handler) http.Handler

type httpHandler struct {
	name     string
	method   Method
	path     string
	handler  interface{}
	wrappers []Wrapper
}

func (h *httpHandler) Wrappers() []Wrapper {
	return h.wrappers
}

func (h *httpHandler) Name() string {
	return h.name
}

func (h *httpHandler) Path() string {
	return h.path
}

func (h *httpHandler) Handler() interface{} {
	return h.handler
}

func (h *httpHandler) Method() Method {
	return h.method
}

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
