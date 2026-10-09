package main

import (
	"context"

	peers "github.com/peers-labs/peers-touch/station/frame"
	"github.com/peers-labs/peers-touch/station/frame/core/debug/actuator"
	"github.com/peers-labs/peers-touch/station/frame/core/node"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/runtime/role"
	"github.com/peers-labs/peers-touch/station/frame/core/server"

	actoridentity "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity"
	appmeta "github.com/peers-labs/peers-touch/station/app/subserver/app_meta"
	appletstore "github.com/peers-labs/peers-touch/station/app/subserver/applet_store"
	convsub "github.com/peers-labs/peers-touch/station/app/subserver/conversation"
	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	frontendtelemetry "github.com/peers-labs/peers-touch/station/app/subserver/frontend_telemetry"
	keyexchange "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange"
	notifsubserver "github.com/peers-labs/peers-touch/station/app/subserver/notification"
	"github.com/peers-labs/peers-touch/station/app/subserver/oauth"
	officialapplets "github.com/peers-labs/peers-touch/station/app/subserver/official_applets"
	"github.com/peers-labs/peers-touch/station/app/subserver/presence"
	recoverysub "github.com/peers-labs/peers-touch/station/app/subserver/recovery"
	"github.com/peers-labs/peers-touch/station/app/subserver/social"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard"

	federation "github.com/peers-labs/peers-touch/station/app/subserver/federation"
	groupcall "github.com/peers-labs/peers-touch/station/app/subserver/groupcall"

	_ "github.com/peers-labs/peers-touch/station/app/subserver/agent"
	_ "github.com/peers-labs/peers-touch/station/app/subserver/oss"

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
	processRole, err := role.FromEnvironment()
	if err != nil {
		panic(err)
	}

	ctx, cancel := context.WithCancel(
		role.WithContext(context.Background(), processRole),
	)
	defer cancel()

	opts := []option.Option{
		node.WithPrivateKey("private.pem"),
		node.Name(processRole.NodeName()),
	}
	if processRole.IncludesApplicationSubservers() {
		opts = append(opts, stationApplicationSubservers()...)
	}

	p := peers.NewPeer()
	err = p.Init(ctx, opts...)
	if err != nil {
		panic(err)
	}

	if err := p.Start(); err != nil {
		panic(err)
	}
}

func stationApplicationSubservers() []option.Option {
	return []option.Option{
		server.WithSubServer("actor_identity", actoridentity.NewActorIdentitySubServer),
		server.WithSubServer("app_meta", appmeta.NewAppMetaSubServer),
		server.WithSubServer("debug", actuator.NewDebugSubServer, actuator.WithDebugServerPath("/debug")),
		server.WithSubServer("events", events.NewEventsSubServer),
		server.WithSubServer("conversation", convsub.NewConversationSubServer),
		server.WithSubServer("presence", presence.NewPresenceSubServer),
		server.WithSubServer("recovery", recoverysub.NewRecoverySubServer),
		server.WithSubServer("key_exchange", keyexchange.NewKeyExchangeSubServer),
		server.WithSubServer("oauth", oauth.NewOAuthSubServer),
		server.WithSubServer("social", social.NewSocialSubServer),
		server.WithSubServer("notification", notifsubserver.NewNotificationSubServer),
		server.WithSubServer("official_applet_note", officialapplets.NewNoteSubServer),
		server.WithSubServer("official_applet_atelier", officialapplets.NewAtelierSubServer),
		server.WithSubServer("applet_store", appletstore.NewAppletStoreSubServer),
		server.WithSubServer("frontend_telemetry", frontendtelemetry.NewFrontendTelemetrySubServer),
		server.WithSubServer("dashboard", dashboard.NewDashboardSubServer),
		server.WithSubServer("federation", federation.NewFederationSubServer),
		server.WithSubServer("groupcall", groupcall.NewGroupCallSubServer),
	}
}
