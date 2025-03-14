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
	*server.BaseServer

	hertz *hz.Hertz
}

func NewServer(opts ...server.Option) *Server {
	s := &Server{
		BaseServer: &server.BaseServer{},
	}

	err := s.Init(context.Background(), opts...)
	if err != nil {
		panic(err)
	}

	return s
}

func (s *Server) Init(ctx context.Context, opts ...server.Option) error {
	err := s.BaseServer.Init(ctx, opts...)
	if err != nil {
		return err
	}

	s.hertz = hz.New(hz.WithHostPorts(s.Options().Address))
	return nil
}

func (s *Server) Handle(h server.Handler) error {
	if hdl, ok := h.Handler().(app.HandlerFunc); ok {
		s.hertz.Any(h.Path(), hdl)
	}

	return nil
}

func (s *Server) Start(ctx context.Context) error {
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

	s.hertz.Spin()
	return nil
}

func (s *Server) Stop(ctx context.Context) error {
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
