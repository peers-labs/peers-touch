package server

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
	"github.com/dirty-bro-tech/peers-touch-go/core/service"
)

// Server 定义 Server 接口
type Server server.Server

// nativeServer 定义 nativeServer 结构体
type nativeServer struct {
	server server.Server
}

func (n *nativeServer) Options() server.Options {
	return n.server.Options()
}

func (n *nativeServer) Handle(handler server.Handler) error {
	return n.server.Handle(handler)
}

// Init 初始化 server
func (n *nativeServer) Init(option ...server.Option) error {
	return n.server.Init(option...)
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

// FromService creates a new Server from a service.Service
func FromService(s service.Service) Server {
	return &nativeServer{
		server: s.Server(), // 假设这里有一个 NewServer 函数来创建 server 实例
	}
}
