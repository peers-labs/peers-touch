package hertz

import (
	"net/http"

	"context"
	"github.com/cloudwego/hertz/pkg/app"
	hz "github.com/cloudwego/hertz/pkg/app/server"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
)

type HertzServer struct {
	hertz   *hz.Hertz
	options Options
}

func NewServer(opts ...server.Option) *HertzServer {
	s := &HertzServer{}
	s.Init(opts...)
	return s
}

func (s *HertzServer) Init(opts ...server.Option) error {
	// First apply base server options
	for _, opt := range opts {
		if baseOpt, ok := opt.(server.Option); ok {
			baseOpt(&s.options.Options)
		}
	}
	s.hertz = hz.New(hz.WithHostPorts(s.options.Address))
	return nil
}

func (s *HertzServer) Options() Options {
	return s.options
}

func (s *HertzServer) Handle(h server.Handler) error {
	handler := func(c context.Context, ctx *app.RequestContext) {
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
		h.Handler().ServeHTTP(rw, req)
	}

	s.hertz.Any(h.Path(), handler)
	return nil
}

func (s *HertzServer) Start() error {
	return s.hertz.Spin()
}

func (s *HertzServer) Stop() error {
	return s.hertz.Close()
}

func (s *HertzServer) Name() string {
	return "hertz"
}
