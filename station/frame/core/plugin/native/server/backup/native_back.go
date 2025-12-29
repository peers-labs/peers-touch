// Package native provides a net/http backup server implementation.
package native

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/transport"
)

var (
	_ server.Server = (*Server)(nil)
)

// Server is a golang native web server based on net/http.
type Server struct {
	*server.BaseServer

	warmupLk   sync.RWMutex
	httpServer *http.Server
	mux        *http.ServeMux

	transport transport.Transport
}

// Init initializes the native backup server.
func (s *Server) Init(option ...option.Option) (err error) {
	err = s.BaseServer.Init(option...)
	if err != nil {
		return err
	}

	if s.transport == nil {
		panic("transport is necessary")
	}

	return err
}

// Handle registers an HTTP or context handler into mux.
func (s *Server) Handle(handler server.Handler) error {
	s.warmupLk.Lock()
	defer s.warmupLk.Unlock()

	// Convert handler to appropriate type
	switch h := handler.Handler().(type) {
	case http.Handler:
		s.mux.Handle(handler.Path(), http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != handler.Method().Me() {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)

				return
			}

			h.ServeHTTP(w, r)
		}))
	case server.HandlerFunc:
		s.mux.HandleFunc(handler.Path(), func(w http.ResponseWriter, r *http.Request) {
			if r.Method != handler.Method().Me() {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)

				return
			}

			h(w, r)
		})
	case server.ContextHandlerFunc:
		s.mux.HandleFunc(handler.Path(), func(w http.ResponseWriter, r *http.Request) {
			if r.Method != handler.Method().Me() {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)

				return
			}

			h(r.Context(), w, r)
		})
	default:
		return fmt.Errorf("unsupported handler type: %T of %s. ", h, handler.Name())
	}

	// Apply middlewares
	if len(handler.Wrappers()) > 0 {
		currHandler := s.mux
		for _, mw := range handler.Wrappers() {
			currHandler = http.NewServeMux()
			mw(currHandler)
		}

		s.mux = currHandler
	}

	s.Options().Handlers = append(s.Options().Handlers, handler)

	return nil
}

// Start registers handlers and starts the HTTP server.
func (s *Server) Start(ctx context.Context, _ ...option.Option) error {
	for _, h := range s.Options().Handlers {
		if err := s.Handle(h); err != nil {
			logger.Errorf(ctx, "[native] handle %s error: %v", h.Path(), err)
			return err
		}
	}

	return s.httpServer.ListenAndServe()
}

// Stop gracefully stops the HTTP server and base server.
func (s *Server) Stop(ctx context.Context) error {
	err := s.BaseServer.Stop(ctx)
	if err != nil {
		return err
	}

	return s.httpServer.Close()
}

// Name returns the server identifier.
func (s *Server) Name() string {
	return "native"
}

// NewServer constructs a backup native server with provided options.
func NewServer(opts ...option.Option) server.Server {
	s := &Server{
		BaseServer: server.NewServer(opts...),
		mux:        http.NewServeMux(),
	}

	return s
}

func (s *Server) init(_ ...option.Option) error {
	s.httpServer = &http.Server{
		Addr:    s.Options().Address,
		Handler: http.DefaultServeMux,
	}

	s.mux = http.NewServeMux()

	if s.Options().Timeout > 0 {
		s.httpServer.ReadTimeout = time.Duration(s.Options().Timeout) * time.Second
		s.httpServer.WriteTimeout = time.Duration(s.Options().Timeout) * time.Second
	}

	return nil
}
