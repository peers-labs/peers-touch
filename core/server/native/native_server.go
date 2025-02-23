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
	warmupLk   sync.RWMutex
	opts       server.Options
	httpServer *http.Server

	once sync.Once
}

func (s *Server) Options() server.Options {
	return s.opts
}

func (s *Server) Init(option ...server.Option) (err error) {
	s.once.Do(func() {
		if err = s.init(option...); err != nil {
			// todo log
		}
	})

	return err
}

func (s *Server) Handle(handler server.Handler) error {
	s.warmupLk.Lock()
	defer s.warmupLk.Unlock()
	// check if handler is already registered
	for _, h := range s.opts.Handlers {
		if h.Name() == handler.Name() {
			return fmt.Errorf("handler for %s already exists", handler.Handler())
		}
	}

	return nil
}

func (s *Server) Start() error {
	// add all handlers to http.DefaultServeMux
	for _, handler := range s.opts.Handlers {
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

func NewServer() server.Server {
	return &Server{}
}

func (s *Server) init(option ...server.Option) error {
	s.opts = server.Options{
		Address: ":8080", // Default address
		Timeout: 0,       // Default timeout, 0 means no timeout
	}
	for _, opt := range option {
		opt(&s.opts)
	}

	s.httpServer = &http.Server{
		Addr:    s.opts.Address,
		Handler: http.DefaultServeMux,
	}

	if s.opts.Timeout > 0 {
		s.httpServer.ReadTimeout = time.Duration(s.opts.Timeout) * time.Second
		s.httpServer.WriteTimeout = time.Duration(s.opts.Timeout) * time.Second
	}

	return nil
}
