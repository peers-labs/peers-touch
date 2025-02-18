package native

import (
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/dirty-bro-tech/peers-touch-go/core/server"
)

// Server is a golang native web server based on net/http.
type Server struct {
	warmupLk sync.RWMutex

	httpServer *http.Server
	handlers   []server.Handler
}

func (s *Server) Init(option ...server.Option) error {
	opts := &server.Options{
		Address: ":8080", // Default address
		Timeout: 0,       // Default timeout, 0 means no timeout
	}
	for _, opt := range option {
		opt(opts)
	}

	s.httpServer = &http.Server{
		Addr:    opts.Address,
		Handler: http.DefaultServeMux,
	}

	if opts.Timeout > 0 {
		s.httpServer.ReadTimeout = time.Duration(opts.Timeout) * time.Second
		s.httpServer.WriteTimeout = time.Duration(opts.Timeout) * time.Second
	}

	return nil
}

func (s *Server) Handle(handler server.Handler) error {
	s.warmupLk.Lock()
	defer s.warmupLk.Unlock()
	// check if handler is already registered
	for _, h := range s.handlers {
		if h.Name() == handler.Name() {
			return fmt.Errorf("handler for %s already exists", handler.Handler())
		}
	}

	s.handlers = append(s.handlers, handler)

	return nil
}

func (s *Server) Start() error {
	// add all handlers to http.DefaultServeMux
	for _, handler := range s.handlers {
		http.Handle(handler.Path(), handler.Handler())
	}
	return s.httpServer.ListenAndServe()
}

func (s *Server) Stop() error {
	return s.httpServer.Close()
}

func (s *Server) Name() string {
	return "Native-HTTP-Server"
}

type Handler struct {
	name    string
	path    string
	handler http.Handler
}

func (h *Handler) Name() string {
	return h.name
}

func (h *Handler) Path() string {
	return h.path
}

func (h *Handler) Handler() http.Handler {
	return h.handler
}

func NewHandler(name, path string, handler http.Handler) server.Handler {
	return &Handler{
		name:    name,
		path:    path,
		handler: handler,
	}
}

func NewServer() server.Server {
	return &Server{}
}
