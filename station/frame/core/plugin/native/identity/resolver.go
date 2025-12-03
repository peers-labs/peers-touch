package identity

import (
	"context"

	"github.com/peers-labs/peers-touch/station/frame/core/identity/resolver"
	nativeStore "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/identity/store"
	coreStore "github.com/peers-labs/peers-touch/station/frame/core/store"
)

// NewResolver creates a new resolver with the native storage implementation
func NewResolver(ctx context.Context) (*resolver.Resolver, error) {
	// Get the global DB instance
	db, err := coreStore.GetRDS(ctx)
	if err != nil {
		return nil, err
	}

	// Create the native store implementation
	s := nativeStore.NewStore(db)

	// Auto migrate the database schema
	if err := s.AutoMigrate(); err != nil {
		return nil, err
	}

	// Create the resolver with the store
	return resolver.NewResolver(s), nil
}
