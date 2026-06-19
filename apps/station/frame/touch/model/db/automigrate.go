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
			&SocialMomentDelivery{},
			&SocialPrivateAudienceGrant{},
			&SocialComment{}, &SocialReaction{},
			&SocialCircle{}, &SocialCircleMember{},
			&SocialStationModerationPolicy{},
			// Cross-domain relationship (kept generic — used by social subserver
			// today, may be reused by chat / oss later).
			&Follow{},
			// Station access gate. Policy is the Dashboard-managed source of
			// truth; attempts are the persisted lifecycle/state-machine record;
			// invite codes are Station-issued credentials for the invite.code gate.
			&AccessPolicy{}, &AccessAttempt{}, &AccessInviteCode{},
		)
		if err != nil {
			panic(fmt.Errorf("auto migrate failed: %v", err))
		}
	})
}
