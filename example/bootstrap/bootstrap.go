package main

import (
	"context"

	dht_pb "github.com/libp2p/go-libp2p-kad-dht/pb"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/peers-touch/peers-touch-go"
	"github.com/peers-touch/peers-touch-go/core/debug/actuator"
	log "github.com/peers-touch/peers-touch-go/core/logger"
	"github.com/peers-touch/peers-touch-go/core/node"
	"github.com/peers-touch/peers-touch-go/core/plugin/native/registry"
	"github.com/peers-touch/peers-touch-go/core/server"

	_ "github.com/peers-touch/peers-touch-go/core/plugin/native"
	_ "github.com/peers-touch/peers-touch-go/core/plugin/native/registry"
	_ "github.com/peers-touch/peers-touch-go/core/plugin/native/store"
	_ "github.com/peers-touch/peers-touch-go/core/plugin/store/rds/sqlite"
)

func main() {
	ctx := context.Background()
	p := peers.NewPeer()

	hookBootstrap()

	err := p.Init(
		ctx,
		node.Name("peers-touch-bootstrap-demo"),
		server.WithSubServer("debug", actuator.NewDebugSubServer, actuator.WithDebugServerPath("")),
	)
	if err != nil {
		panic(err)
	}

	err = p.Start()
	if err != nil {
		panic(err)
	}
}

func hookBootstrap() {
	native.AppendDhtRequestHook(func(ctx context.Context, s network.Stream, req *dht_pb.Message) {
		log.Infof(ctx, "got a dht request from: %s; type: %s; msg: %+v", s.Conn().RemotePeer().String(), req.Type, req)
	})
}
