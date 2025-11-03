package main

import (
	"context"

	aibox "github.com/peers-touch/peers-touch/station/app/subserver/ai-box"
	peers "github.com/peers-touch/peers-touch/station/frame"
	"github.com/peers-touch/peers-touch/station/frame/core/debug/actuator"
	"github.com/peers-touch/peers-touch/station/frame/core/node"
	"github.com/peers-touch/peers-touch/station/frame/core/server"

	// default plugins
	_ "github.com/peers-touch/peers-touch/station/frame/core/plugin/native"
	_ "github.com/peers-touch/peers-touch/station/frame/core/plugin/native/registry"
	_ "github.com/peers-touch/peers-touch/station/frame/core/plugin/store/rds/postgres"
	_ "github.com/peers-touch/peers-touch/station/frame/core/plugin/store/rds/sqlite"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	p := peers.NewPeer()
	err := p.Init(
		ctx,
		node.WithPrivateKey("private.pem"),
		node.Name("peers-touch-station"),
		server.WithSubServer("debug", actuator.NewDebugSubServer, actuator.WithDebugServerPath("")),
		// Use the new router pattern for station endpoints
		server.WithSubServer("ai-box", aibox.NewAIBoxSubServer),
	)
	if err != nil {
		panic(err)
		return
	}

	err = p.Start()
	if err != nil {
		panic(err)
	}
}
