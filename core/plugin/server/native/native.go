package native

import (
	"fmt"
	"github.com/dirty-bro-tech/peers-touch-go/core/logger"
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
	mux        *http.ServeMux
	once       sync.Once
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
		return fmt.Errorf("unsupported handler type: %T", h)
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

	s.opts.Handlers = append(s.opts.Handlers, handler)

	return nil
}

func (s *Server) Start() error {
	for _, h := range s.opts.Handlers {
		if err := s.Handle(h); err != nil {
			logger.Errorf("[native] handle %s error: %v", h.Path(), err)
			return err
		}
	}

	return s.httpServer.ListenAndServe()
}

func (s *Server) Stop() error {
	return s.httpServer.Close()
}

func (s *Server) Name() string {
	return "native"
}

func NewServer(opts ...server.Option) server.Server {
	s := &Server{
		opts: server.Options{},
	}
	for _, opt := range opts {
		opt(&s.opts)
	}
	return s
}

func (s *Server) init(option ...server.Option) error {
	for _, opt := range option {
		opt(&s.opts)
	}

	s.httpServer = &http.Server{
		Addr:    s.opts.Address,
		Handler: http.DefaultServeMux,
	}

	s.mux = http.NewServeMux()

	if s.opts.Timeout > 0 {
		s.httpServer.ReadTimeout = time.Duration(s.opts.Timeout) * time.Second
		s.httpServer.WriteTimeout = time.Duration(s.opts.Timeout) * time.Second
	}

	return nil
}
