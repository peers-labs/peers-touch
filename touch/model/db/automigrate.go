package db

import (
	"context"
	"fmt"

	"github.com/dirty-bro-tech/peers-touch-go/core/store"
	"gorm.io/gorm"
)

// AutoMigrate helps to migrate the database schema, like create table.
// call it after store is initiated
func init() {
	store.InitTableHooks(func(ctx context.Context, rds *gorm.DB) {
		err := rds.AutoMigrate(
			&User{}, &PeerAddress{},
			// ActivityPub models
			&ActivityPubActor{}, &ActivityPubActivity{}, &ActivityPubObject{},
			&ActivityPubFollow{}, &ActivityPubLike{}, &ActivityPubCollection{},
		)
		if err != nil {
			panic(fmt.Errorf("auto migrate failed: %v", err))
		}
	})
}
