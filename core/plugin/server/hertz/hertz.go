package hertz

import (
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
	for _, h := range s.options.Handlers {
		if hdl, ok := h.Handler().(app.HandlerFunc); ok {
			s.hertz.Any(h.Path(), hdl)
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
