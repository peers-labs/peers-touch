package federation

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

// MigrateSchema is the single schema-registration owner for framework
// Federation authentication state.
func MigrateSchema(ctx context.Context, database *gorm.DB) error {
	if database == nil {
		return fmt.Errorf("federation: migrate schema: database is required")
	}
	if err := database.WithContext(ctx).AutoMigrate(
		&AuthLocalKeyRow{},
		&contentProofVerificationKeyRow{},
		&PeerKeyRow{},
	); err != nil {
		return fmt.Errorf("federation: migrate schema: %w", err)
	}
	return nil
}

func init() {
	store.InitTableHooks(func(ctx context.Context, database *gorm.DB) {
		if err := MigrateSchema(ctx, database); err != nil {
			panic(err)
		}
	})
}
