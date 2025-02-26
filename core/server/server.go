package server

import (
	"net/http"
)

type Server interface {
	Init(...Option) error
	Options() Options
	// Handle use to add new handler dynamically
	Handle(Handler) error
	Start() error
	Stop() error
	Name() string
}

type Handler interface {
	Name() string
	Path() string
	// Handler returns a function that can handle different types of contexts
	Handler() interface{}
	Wrappers() []Wrapper
}

// Wrapper defines a function type for Wrapper
type Wrapper func(next http.Handler) http.Handler

type httpHandler struct {
	name     string
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
