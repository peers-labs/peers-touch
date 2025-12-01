package main

import (
	"context"

	peers "github.com/peers-labs/peers-touch/station/frame"
	"github.com/peers-labs/peers-touch/station/frame/core/debug/actuator"
	"github.com/peers-labs/peers-touch/station/frame/core/node"
	"github.com/peers-labs/peers-touch/station/frame/core/server"

	"github.com/peers-labs/peers-touch/station/app/subserver/chat"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"

	// default plugins
	_ "github.com/peers-labs/peers-touch/station/frame/core/plugin/native"
	_ "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/registry"
	_ "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/bootstrap"
	_ "github.com/peers-labs/peers-touch/station/frame/core/plugin/store/rds/postgres"
	_ "github.com/peers-labs/peers-touch/station/frame/core/plugin/store/rds/sqlite"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	p := peers.NewPeer()
	err := p.Init(
		ctx,
		node.WithPrivateKey("private.pem"),
		node.Name("peers-touch-station"),
		server.WithSubServer("debug", actuator.NewDebugSubServer, actuator.WithDebugServerPath("/debug")),
		// Use the new router pattern for station endpoints
		// server.WithSubServer("ai-box", aibox.NewAIBoxSubServer),
		server.WithSubServer("chat", chat.NewChatSubServer),
	)
	if err != nil {
		panic(err)
	}

	// Seed preset users into DB (idempotent)
	_ = touchactor.SeedPresetUsers(ctx)

	err = p.Start()
	if err != nil {
		panic(err)
	}
}
