package server

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
	"github.com/dirty-bro-tech/peers-touch-go/core/service"
)

// Server 定义 Server 接口
type Server interface {
	Init(...server.Option) error
}

// nativeServer 定义 nativeServer 结构体
type nativeServer struct {
	routers []Routers

	server server.Server
}

func (n *nativeServer) Options() server.Options {
	return n.server.Options()
}

// Init 初始化 server
func (n *nativeServer) Init(opts ...server.Option) error {
	return n.server.Init(opts...)
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

func FromService(s service.Service) Server {
	ss := &nativeServer{
		server: s.Server(),
	}

	return ss
}
