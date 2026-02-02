package main

import (
	"context"
	"log"
	"os"

	peers "github.com/peers-labs/peers-touch/station/frame"
	"github.com/peers-labs/peers-touch/station/frame/core/debug/actuator"
	"github.com/peers-labs/peers-touch/station/frame/core/node"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"

	friendchat "github.com/peers-labs/peers-touch/station/app/subserver/friend_chat"
	groupchat "github.com/peers-labs/peers-touch/station/app/subserver/group_chat"
	"github.com/peers-labs/peers-touch/station/app/subserver/oauth"
	touchactivitypub "github.com/peers-labs/peers-touch/station/frame/touch/activitypub"
	"github.com/peers-labs/peers-touch/station/frame/touch/auth"

	// default plugins
	_ "github.com/peers-labs/peers-touch/station/app/subserver/oss"
	_ "github.com/peers-labs/peers-touch/station/frame/core/plugin/native"
	_ "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/registry"
	_ "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/bootstrap"
	_ "github.com/peers-labs/peers-touch/station/frame/core/plugin/store/rds/postgres"
	_ "github.com/peers-labs/peers-touch/station/frame/core/plugin/store/rds/sqlite"
)

func main() {
	_ = log.Print
	_ = os.Args

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	p := peers.NewPeer()

	// Initialize Auth Provider (Core)
	// jwtProvider := auth.NewJWTProvider(auth.Get().Secret, auth.Get().AccessTTL)

	err := p.Init(
		ctx,
		node.WithPrivateKey("private.pem"),
		node.Name("peers-touch-station"),
		server.WithSubServer("debug", actuator.NewDebugSubServer, actuator.WithDebugServerPath("/debug")),
		// Use the new router pattern for station endpoints
		// server.WithSubServer("ai-box", aibox.NewAIBoxSubServer),
		server.WithSubServer("friend_chat", friendchat.NewFriendChatSubServer),
		server.WithSubServer("group_chat", groupchat.NewGroupChatSubServer),
		server.WithSubServer("oauth", oauth.NewOAuthSubServer),
	)
	if err != nil {
		panic(err)
	}

	// Seed preset users into DB (idempotent)
	_ = touchactivitypub.SeedPresetUsers(ctx)

	// Initialize session store with database
	getDBWrapper := func(c context.Context) (*gorm.DB, error) {
		return store.GetRDS(c)
	}
	if err := auth.InitDBSessionStore(getDBWrapper); err != nil {
		log.Printf("Warning: Failed to init DB session store: %v, using memory store", err)
	}

	err = p.Start()
	if err != nil {
		panic(err)
	}
}
