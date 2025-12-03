package api

import (
	"context"

	"github.com/peers-labs/peers-touch/station/frame/core/identity/model"
	"github.com/peers-labs/peers-touch/station/frame/core/identity/ptid"
)

// IdentityService defines the core identity operations
type IdentityService interface {
	// CreateIdentity creates a new identity
	CreateIdentity(ctx context.Context, username, namespace string, accountType ptid.AccountType) (*model.Identity, error)

	// GetIdentity retrieves an identity by its PTID
	GetIdentity(ctx context.Context, ptidStr string) (*model.Identity, error)

	// BindProvider binds an external provider identity to the core identity
	BindProvider(ctx context.Context, identityID uint64, providerName string) (*model.Binding, error)

	// ResolveIdentity resolves an identity from various inputs (PTID, Alias, Provider ID)
	ResolveIdentity(ctx context.Context, input string) (*model.Identity, error)
}
