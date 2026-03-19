package identity

import (
	"context"
	"fmt"

	coreStore "github.com/peers-labs/peers-touch/station/frame/core/store"
)

type Service struct {
	store    Store
	resolver *Resolver
}

// Ensure Service implements IdentityService
var _ IdentityService = (*Service)(nil)

// NewService creates a new identity service
func NewService(ctx context.Context) (*Service, error) {
	db, err := coreStore.GetRDS(ctx)
	if err != nil {
		return nil, err
	}
	s := NewStore(db)
	if err := s.AutoMigrate(); err != nil {
		return nil, err
	}
	r := NewResolver(s)
	return &Service{store: s, resolver: r}, nil
}

// CreateIdentity creates a new identity
func (s *Service) CreateIdentity(ctx context.Context, username, namespace string, accountType AccountType) (*Identity, error) {
	pubKey, _, err := GenerateKey()
	if err != nil {
		return nil, err
	}
	fingerprint, err := Fingerprint(pubKey)
	if err != nil {
		return nil, err
	}
	pid := &PTID{
		Version:     "v1",
		Namespace:   namespace,
		Type:        accountType,
		Username:    username,
		Fingerprint: fingerprint,
	}
	if err := pid.Validate(); err != nil {
		return nil, err
	}
	ptidStr := pid.String()
	identity := &Identity{
		PTID:        ptidStr,
		Username:    username,
		Namespace:   namespace,
		Type:        string(accountType),
		Fingerprint: fingerprint,
		Version:     "v1",
		Status:      "active",
	}
	if err := s.store.CreateIdentity(ctx, identity); err != nil {
		return nil, err
	}
	key := &Key{
		IdentityID: identity.ID,
		PublicKey:  pubKey,
		Algorithm:  "Ed25519",
		IsMaster:   true,
	}
	if err := s.store.CreateKey(ctx, key); err != nil {
		return nil, err
	}
	return identity, nil
}

// GetIdentity retrieves an identity by its PTID
func (s *Service) GetIdentity(ctx context.Context, ptidStr string) (*Identity, error) {
	return s.store.GetIdentityByPTID(ctx, ptidStr)
}

// BindProvider binds an external provider identity to the core identity
func (s *Service) BindProvider(ctx context.Context, identityID uint64, providerName string) (*Binding, error) {
	return nil, fmt.Errorf("not implemented")
}

// ResolveIdentity resolves an identity from various inputs
func (s *Service) ResolveIdentity(ctx context.Context, input string) (*Identity, error) {
	return s.resolver.Resolve(ctx, input)
}

// Convenience wrapper to match existing usage in actor layer
func CreateIdentity(ctx context.Context, username, namespace string, accountType AccountType) (*Identity, error) {
	svc, err := NewService(ctx)
	if err != nil {
		return nil, err
	}
	return svc.CreateIdentity(ctx, username, namespace, accountType)
}
