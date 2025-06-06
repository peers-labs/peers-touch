package main

import (
	"context"
	"net/http"

	"github.com/dirty-bro-tech/peers-touch-go"
	"github.com/dirty-bro-tech/peers-touch-go/core/debug/actuator"
	log "github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/plugin/registry/native"
	"github.com/dirty-bro-tech/peers-touch-go/core/plugin/subserver/turn"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
	"github.com/dirty-bro-tech/peers-touch-go/core/service"
	dht_pb "github.com/libp2p/go-libp2p-kad-dht/pb"
	"github.com/libp2p/go-libp2p/core/network"

	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/native"
	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/registry/native"
	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/store/native"
	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/store/rds/sqlite"
)

func main() {
	ctx := context.Background()
	p := peers.NewPeer()

	hookBootstrap()

	err := p.Init(
		ctx,
		service.Name("peers-touch-bootstrap-demo"),
		server.WithSubServer("turn", turn.NewTurnSubServer),
		server.WithSubServer("debug", actuator.NewDebugSubServer, actuator.WithDebugServerPath("")),
		server.WithHandlers(
			server.NewHandler("hello-world", "/hello", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Write([]byte("hello world, from a bootstrap handler"))
			})),
		),
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
