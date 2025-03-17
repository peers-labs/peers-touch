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
	Init(context.Context, ...option.Option) error
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

func NewHandler(name, path string, handler interface{}, opts ...HandlerOption) Handler {
	config := &HandlerOptions{}
	for _, opt := range opts {
		opt(config)
	}

	return &httpHandler{
		name:    name,
		path:    path,
		handler: handler,
		// wrapper: config.middlewares,
	}
}
