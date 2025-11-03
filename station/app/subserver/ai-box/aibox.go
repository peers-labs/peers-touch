package aibox

import (
	"context"

	"github.com/peers-touch/peers-touch/station/frame/core/option"
	"github.com/peers-touch/peers-touch/station/frame/core/server"
)

var (
	_ server.Subserver = (*aiBoxSubServer)(nil)
)

// aiBoxURL implements server.RouterURL for station endpoints
type aiBoxURL struct {
	name string
	path string
}

func (s aiBoxURL) SubPath() string {
	return s.path
}

func (s aiBoxURL) Name() string {
	return s.name
}

// aiBoxSubServer handles photo upload requests
type aiBoxSubServer struct {
	opts *Options

	addrs  []string      // Populated from configuration
	status server.Status // Track server status
}

func (s *aiBoxSubServer) Init(ctx context.Context, opts ...option.Option) error {
	//TODO implement me
	panic("implement me")
}

func (s *aiBoxSubServer) Start(ctx context.Context, opts ...option.Option) error {
	//TODO implement me
	panic("implement me")
}

func (s *aiBoxSubServer) Stop(ctx context.Context) error {
	//TODO implement me
	panic("implement me")
}

func (s *aiBoxSubServer) Status() server.Status {
	//TODO implement me
	panic("implement me")
}

// Name returns the subserver identifier
func (s *aiBoxSubServer) Name() string {
	return "photo-save"
}

// Type returns the subserver type (HTTP in this case)
func (s *aiBoxSubServer) Type() server.SubserverType {
	return server.SubserverTypeHTTP
}

// Address returns the listening addresses
func (s *aiBoxSubServer) Address() server.SubserverAddress {
	return server.SubserverAddress{
		Address: s.addrs,
	}
}

// Handlers defines the upload, list, and get endpoints
func (s *aiBoxSubServer) Handlers() []server.Handler {
	return []server.Handler{
		server.NewHandler(
			aiBoxURL{name: "ai-box", path: "/provider/new"},
			handleNewProvider,              // Handler function
			server.WithMethod(server.POST), // HTTP method
		),
	}
}
