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
			// Chat models
			&Conversation{}, &ConvMember{}, &Message{},
			&Attachment{}, &Receipt{}, &Reaction{}, &KeyEpoch{},
			// Social models (ActivityPub compatible)
			&Post{}, &PostContent{}, &PostMedia{},
			&PostLike{}, &Comment{}, &CommentLike{},
			&Follow{}, &PollVote{},
		)
		if err != nil {
			panic(fmt.Errorf("auto migrate failed: %v", err))
		}
	})
}
