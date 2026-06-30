package main

import (
	"context"

	peers "github.com/peers-labs/peers-touch/station/frame"
	"github.com/peers-labs/peers-touch/station/frame/core/debug/actuator"
	"github.com/peers-labs/peers-touch/station/frame/core/node"
	"github.com/peers-labs/peers-touch/station/frame/core/server"

	appmeta "github.com/peers-labs/peers-touch/station/app/subserver/app_meta"
	appletstore "github.com/peers-labs/peers-touch/station/app/subserver/applet_store"
	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	friendchat "github.com/peers-labs/peers-touch/station/app/subserver/friend_chat"
	groupchat "github.com/peers-labs/peers-touch/station/app/subserver/group_chat"
	keyexchange "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange"
	notifsubserver "github.com/peers-labs/peers-touch/station/app/subserver/notification"
	"github.com/peers-labs/peers-touch/station/app/subserver/oauth"
	officialapplets "github.com/peers-labs/peers-touch/station/app/subserver/official_applets"
	"github.com/peers-labs/peers-touch/station/app/subserver/presence"
	"github.com/peers-labs/peers-touch/station/app/subserver/social"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard"

	_ "github.com/peers-labs/peers-touch/station/app/subserver/oss"
	_ "github.com/peers-labs/peers-touch/station/app/subserver/agent"

	_ "github.com/peers-labs/peers-touch/station/frame/core/plugin/native"
	_ "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/registry"
	_ "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/bootstrap"
	_ "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay"
	_ "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay-client"
	_ "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/turn"
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
		server.WithSubServer("app_meta", appmeta.NewAppMetaSubServer),
		server.WithSubServer("debug", actuator.NewDebugSubServer, actuator.WithDebugServerPath("/debug")),
		server.WithSubServer("events", events.NewEventsSubServer),
		server.WithSubServer("presence", presence.NewPresenceSubServer),
		server.WithSubServer("friend_chat", friendchat.NewFriendChatSubServer),
		server.WithSubServer("key_exchange", keyexchange.NewKeyExchangeSubServer),
		server.WithSubServer("group_chat", groupchat.NewGroupChatSubServer),
		server.WithSubServer("oauth", oauth.NewOAuthSubServer),
		server.WithSubServer("social", social.NewSocialSubServer),
		server.WithSubServer("notification", notifsubserver.NewNotificationSubServer),
		server.WithSubServer("official_applet_note", officialapplets.NewNoteSubServer),
		server.WithSubServer("applet_store", appletstore.NewAppletStoreSubServer),
		server.WithSubServer("dashboard", dashboard.NewDashboardSubServer),
	)
	if err != nil {
		panic(err)
	}

	if err := p.Start(); err != nil {
		panic(err)
	}
}
