package infrastructure

import (
	"fmt"

	modeldb "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

// MigrateIdentitySchema performs the Social PTID hard cut as one transaction.
func MigrateIdentitySchema(rds *gorm.DB) error {
	if err := migrateSocialIdentityColumns(rds); err != nil {
		return err
	}
	if err := rds.AutoMigrate(&friendshipModel{}); err != nil {
		return fmt.Errorf("social: migrate friend relationship schema: %w", err)
	}
	return nil
}

func migrateSocialIdentityColumns(rds *gorm.DB) error {
	return rds.Transaction(func(tx *gorm.DB) error {
		for _, rename := range []struct {
			table string
			from  string
			to    string
		}{
			{table: "friend_chat_friendships", from: "actor_did", to: "actor_ptid"},
			{table: "friend_chat_friendships", from: "peer_did", to: "peer_ptid"},
		} {
			if err := modeldb.MigrateStringIdentityColumn(tx, rename.table, rename.from, rename.to); err != nil {
				return fmt.Errorf(
					"social: rename legacy identity column %s.%s to %s: %w",
					rename.table,
					rename.from,
					rename.to,
					err,
				)
			}
		}
		return nil
	})
}
