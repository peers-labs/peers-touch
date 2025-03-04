package server

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/plugin/server/native"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
)

// Server is a wrapper of core.Server
// we use it for activitypub interface packaging
type Server interface {
	// Init just initials the self options rather than the core server
	Init(...Option) error

	// Core return the core server
	Core() server.Server
}

// nativeServer 定义 nativeServer 结构体
type nativeServer struct {
	opts    Options
	routers map[string]*Routers

	server server.Server
}

func (n *nativeServer) Options() server.Options {
	return n.server.Options()
}

// Init 初始化 server
func (n *nativeServer) Init(opts ...Option) error {
	// append the initial options to the server options
	for _, o := range opts {
		o(&n.opts)
	}

	// check the necessary routers
	if n.opts.routers[RoutersNameManagement] == nil {
		n.opts.routers[RoutersNameManagement] = NewManageRouter()
	}

	if n.opts.routers[RoutersNameActivityPub] == nil {
		n.opts.routers[RoutersNameActivityPub] = NewActivityPubRouter()
	}

	if n.opts.coreServer == nil {
		var serverOptions []server.Option
		serverOptions = append(serverOptions, n.opts.coreServerOptions...)
		// append the routers to the server options
		for _, rs := range n.opts.routers {
			for _, r := range rs.Routers() {
				serverOptions = append(serverOptions, server.WithHandlers(convertRouterToServerHandler(r)))
			}
		}
		n.opts.coreServer = native.NewServer(serverOptions...)
	}

	return nil
}

func (n *nativeServer) Core() server.Server {
	return n.server
}

// Start the server
func (n *nativeServer) Start() error {
	return n.server.Start()
}

// Stop the server
func (n *nativeServer) Stop() error {
	return n.server.Stop()
}

// Name 获取 server 名称
func (n *nativeServer) Name() string {
	return n.server.Name()
}

func NewServer(opts ...Option) Server {
	ss := &nativeServer{}
	for _, opt := range opts {
		opt(&ss.opts)
	}

	return ss
}
