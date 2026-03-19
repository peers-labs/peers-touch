package model

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

func init() {
	store.InitTableHooks(func(ctx context.Context, rds *gorm.DB) {
		err := rds.AutoMigrate(
			&FriendChatSession{},
			&FriendChatMessage{},
			&FriendMessageAttachment{},
			&OfflineMessage{},
		)
		if err != nil {
			panic(fmt.Errorf("friend chat auto migrate failed: %v", err))
		}
	})
}
