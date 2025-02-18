package server

import (
	"net/http"
)

type Server interface {
	Init(...Option) error
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
