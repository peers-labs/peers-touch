package hertz

import (
	"context"
	"fmt"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	hz "github.com/cloudwego/hertz/pkg/app/server"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
)

type Server struct {
	hertz   *hz.Hertz
	options server.Options
}

func NewServer(opts ...server.Option) *Server {
	s := &Server{}
	for _, opt := range opts {
		opt(&s.options)
	}

	return s
}

func (s *Server) Init(opts ...server.Option) error {
	// First apply base server options
	for _, opt := range opts {
		opt(&s.options)
	}

	s.hertz = hz.New(hz.WithHostPorts(s.options.Address))
	return nil
}

func (s *Server) Options() server.Options {
	return s.options
}

func (s *Server) Handle(h server.Handler) error {
	if hdl, ok := h.Handler().(app.HandlerFunc); ok {
		s.hertz.Any(h.Path(), hdl)
	}

	return nil
}

func (s *Server) Start() error {
	for _, handler := range s.options.Handlers {
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

	s.hertz.Spin()
	return nil
}

func (s *Server) Stop() error {
	return s.hertz.Close()
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
