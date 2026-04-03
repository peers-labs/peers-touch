package main

import (
	"context"

	peers "github.com/peers-labs/peers-touch/station/frame"
	"github.com/peers-labs/peers-touch/station/frame/core/debug/actuator"
	"github.com/peers-labs/peers-touch/station/frame/core/node"
	"github.com/peers-labs/peers-touch/station/frame/core/server"

	_ "github.com/peers-labs/peers-touch/station/app/subserver/ai_chat"
	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	friendchat "github.com/peers-labs/peers-touch/station/app/subserver/friend_chat"
	groupchat "github.com/peers-labs/peers-touch/station/app/subserver/group_chat"
	"github.com/peers-labs/peers-touch/station/app/subserver/oauth"

	_ "github.com/peers-labs/peers-touch/station/app/subserver/oss"
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
		server.WithSubServer("friend_chat", friendchat.NewFriendChatSubServer),
		server.WithSubServer("group_chat", groupchat.NewGroupChatSubServer),
		server.WithSubServer("oauth", oauth.NewOAuthSubServer),
		server.WithSubServer("events", events.NewEventsSubServer),
	)
	if err != nil {
		panic(err)
	}

	if err := p.Start(); err != nil {
		panic(err)
	}
}
