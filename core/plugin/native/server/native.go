package native

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
	"github.com/libp2p/go-libp2p/core/host"
)

// Server is a golang native web server based on net/http.
type Server struct {
	*server.BaseServer

	warmupLk   sync.RWMutex
	httpServer *http.Server
	mux        *http.ServeMux
	libp2pHost host.Host
	once       sync.Once
}

func (s *Server) Init(option ...option.Option) (err error) {
	err = s.BaseServer.Init(option...)
	if err != nil {
		return err
	}

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

func (s *Server) Start(ctx context.Context, opts ...option.Option) error {
	for _, h := range s.Options().Handlers {
		if err := s.Handle(h); err != nil {
			logger.Errorf(ctx, "[native] handle %s error: %v", h.Path(), err)
			return err
		}
	}

	return s.httpServer.ListenAndServe()
}

func (s *Server) Stop(ctx context.Context) error {
	err := s.BaseServer.Stop(ctx)
	if err != nil {
		return err
	}

	return s.httpServer.Close()
}

func (s *Server) Name() string {
	return "native"
}

func NewServer(opts ...option.Option) server.Server {
	s := &Server{
		BaseServer: server.NewServer(opts...),
		mux:        http.NewServeMux(),
	}

	return s
}

func (s *Server) init(option ...option.Option) error {
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
