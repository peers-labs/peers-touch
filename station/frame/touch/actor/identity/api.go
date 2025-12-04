package identity

import "context"

// IdentityService defines the service interface for identity operations
type IdentityService interface {
	CreateIdentity(ctx context.Context, username, namespace string, accountType AccountType) (*Identity, error)
	GetIdentity(ctx context.Context, ptidStr string) (*Identity, error)
	BindProvider(ctx context.Context, identityID uint64, providerName string) (*Binding, error)
	ResolveIdentity(ctx context.Context, input string) (*Identity, error)
}
