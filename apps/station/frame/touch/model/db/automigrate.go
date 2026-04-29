package db

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

// AutoMigrate helps to migrate the database schema, like create table.
// call it after store is initiated
func init() {
	store.InitTableHooks(func(ctx context.Context, rds *gorm.DB) {
		err := rds.AutoMigrate(
			// Actor models
			&Actor{}, &ActorTouchMeta{}, &PeerAddress{}, &ActorStatus{},
			// OAuth models
			&OAuthClient{}, &OAuthAuthCode{}, &OAuthToken{},
			&OAuth2IdentityBinding{}, &OAuth2TokenState{}, &OAuth2ConnectionState{},
			// Chat models
			&Conversation{}, &ConvMember{}, &Message{},
			&Attachment{}, &Receipt{}, &Reaction{}, &KeyEpoch{},
			// Social — Moments family (see docs/architecture/social/moments.md §6).
			//
			// Public / private posts physically separated via table-name
			// prefix (D1.A) so a SQL bug in the public path can never read
			// from the private one. CUSTOM_ALLOW/DENY actor lists, comments,
			// reactions, and circles each get their own table.
			&SocialPublicPost{}, &SocialPrivatePost{},
			&SocialPrivateAudienceGrant{},
			&SocialComment{}, &SocialReaction{},
			&SocialCircle{}, &SocialCircleMember{},
			// Cross-domain relationship (kept generic — used by social subserver
			// today, may be reused by chat / oss later).
			&Follow{},
		)
		if err != nil {
			panic(fmt.Errorf("auto migrate failed: %v", err))
		}
	})
}
