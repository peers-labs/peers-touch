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
			&Actor{}, &ActorTouchMeta{}, &PeerAddress{},
			// ActivityPub models
			&ActivityPubActivity{}, &ActivityPubObject{},
			&ActivityPubFollow{}, &ActivityPubLike{}, &ActivityPubCollection{},
			// OAuth models
			&OAuthClient{}, &OAuthAuthCode{}, &OAuthToken{},
			&Conversation{},
			&ConvMember{},
			&Message{},
			&Attachment{},
			&Receipt{},
			&Reaction{},
			&KeyEpoch{},
			&ActorStatus{},
		)
		if err != nil {
			panic(fmt.Errorf("auto migrate failed: %v", err))
		}
	})
}
