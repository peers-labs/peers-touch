package hertz

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	hz "github.com/cloudwego/hertz/pkg/app/server"
	log "github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
)

type Server struct {
	*server.BaseServer

	hertz *hz.Hertz

	lock    sync.RWMutex
	started bool
}

func NewServer(opts ...option.Option) *Server {
	s := &Server{
		BaseServer: server.NewServer(opts...),
	}

	return s
}

func (s *Server) Init(ctx context.Context, opts ...option.Option) error {
	err := s.BaseServer.Init(ctx, opts...)
	if err != nil {
		return err
	}

	s.Options().Apply(opts...)

	s.hertz = hz.New(hz.WithHostPorts(s.Options().Address))
	return nil
}

func (s *Server) Handle(h server.Handler) error {
	if hdl, ok := h.Handler().(app.HandlerFunc); ok {
		s.hertz.Any(h.Path(), hdl)
	}

	return nil
}

func (s *Server) Start(ctx context.Context, opts ...option.Option) error {
	s.lock.Lock()
	defer s.lock.Unlock()
	if s.started {
		log.Errorf(ctx, "server already started!")
		return nil
	}

	ctx, cancel := context.WithCancel(ctx)

	s.Options().Apply(opts...)
	err := s.BaseServer.Start(ctx)
	if err != nil {
		log.Errorf(ctx, "warmup baseServer error: %v", err)
		return err
	}

	s.hertz.OnShutdown = append(s.hertz.OnShutdown, func(hertzCtx context.Context) {
		log.Infof(hertzCtx, "shutdown hertz")
		cancel()
	})

	for _, handler := range s.Options().Handlers {
		switch h := handler.Handler().(type) {
		case func(context.Context, *app.RequestContext):
			s.hertz.GET(handler.Path(), h)
		case http.Handler:
			// Convert http.Handler to Hertz handler
			hertzHandler := func(c context.Context, ctx *app.RequestContext) {
				// Create http.Request from Hertz context
				req := &http.Request{
					Method: string(ctx.Method()),
					Header: make(http.Header),
				}

				// Copy headers
				ctx.Request.Header.VisitAll(func(key, value []byte) {
					req.Header.Set(string(key), string(value))
				})

				// Create response writer
				rw := &responseWriter{ctx: ctx}

				// Call the original handler
				h.ServeHTTP(rw, req)
			}
			s.hertz.GET(handler.Path(), hertzHandler)
		default:
			return fmt.Errorf("unsupported handler type: %T", h)
		}
	}

	go s.hertz.Spin()
	select {
	// wait for server to start
	// TODO maybe need a better way to wait for server to start
	case <-time.After(time.Second * 3):
	}
	if s.Options().ReadyChan != nil {
		s.Options().ReadyChan <- struct {
			Msg string
		}{
			Msg: "ready",
		}
	}

	s.started = true
	return nil
}

func (s *Server) Stop(ctx context.Context) error {
	// Add fresh shutdown context with longer timeout
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// First stop base server components
	if err := s.BaseServer.Stop(shutdownCtx); err != nil {
		return err
	}

	// Then stop Hertz server with proper error handling
	if err := s.hertz.Engine.Close(); err != nil {
		return fmt.Errorf("hertz engine close error: %w", err)
	}

	// Wait for server to actually stop with new context
	select {
	case <-shutdownCtx.Done():
		if errors.Is(shutdownCtx.Err(), context.DeadlineExceeded) {
			return fmt.Errorf("server shutdown timed out after 15s")
		}
		return nil
	}
}

func (s *Server) Name() string {
	return "hertz"
}

// responseWriter implements http.ResponseWriter for Hertz
type responseWriter struct {
	ctx *app.RequestContext
}

func (w *responseWriter) Header() http.Header {
	// Convert Hertz headers to http.Header
	h := make(http.Header)
	w.ctx.Response.Header.VisitAll(func(key, value []byte) {
		h.Add(string(key), string(value))
	})
	return h
}

func (w *responseWriter) Write(data []byte) (int, error) {
	w.ctx.Write(data)
	return len(data), nil
}

func (w *responseWriter) WriteHeader(statusCode int) {
	w.ctx.SetStatusCode(statusCode)
}
