package server

import (
	"net/http"
)

type Server interface {
	Init(...Option) error
	Options() Options
	Handle(Handler) error
	Start() error
	Stop() error
	Name() string
}

type Handler interface {
	Name() string
	Path() string
	Handler() http.Handler
}

type httpHandler struct {
	name    string
	path    string
	handler http.Handler
}

func (h *httpHandler) Name() string {
	return h.name
}

func (h *httpHandler) Path() string {
	return h.path
}

func (h *httpHandler) Handler() http.Handler {
	return h.handler
}

func NewHandler(name, path string, handler http.Handler) Handler {
	return &httpHandler{
		name:    name,
		path:    path,
		handler: handler,
	}
}
