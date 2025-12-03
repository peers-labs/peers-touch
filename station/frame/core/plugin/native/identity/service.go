package identity

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/frame/core/identity/api"
	"github.com/peers-labs/peers-touch/station/frame/core/identity/crypto"
	"github.com/peers-labs/peers-touch/station/frame/core/identity/model"
	"github.com/peers-labs/peers-touch/station/frame/core/identity/ptid"
	"github.com/peers-labs/peers-touch/station/frame/core/identity/resolver"
	nativeStore "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/identity/store"
	coreStore "github.com/peers-labs/peers-touch/station/frame/core/store"
)

type Service struct {
	store    *nativeStore.Store
	resolver *resolver.Resolver
}

// Ensure Service implements api.IdentityService
var _ api.IdentityService = (*Service)(nil)

// NewService creates a new identity service
func NewService(ctx context.Context) (*Service, error) {
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

	// Create the resolver
	r := resolver.NewResolver(s)

	return &Service{
		store:    s,
		resolver: r,
	}, nil
}

// CreateIdentity creates a new identity
func (s *Service) CreateIdentity(ctx context.Context, username, namespace string, accountType ptid.AccountType) (*model.Identity, error) {
	// 1. Generate key pair
	pubKey, _, err := crypto.GenerateKey()
	if err != nil {
		return nil, err
	}

	// 2. Generate PTID string to get the fingerprint
	fingerprint, err := crypto.Fingerprint(pubKey)
	if err != nil {
		return nil, err
	}
	
	// Create PTID struct
	pid := &ptid.PTID{
		Version:     "v1",
		Namespace:   namespace,
		Type:        accountType,
		Username:    username,
		Fingerprint: fingerprint,
	}
	
	// Validate PTID
	if err := pid.Validate(); err != nil {
		return nil, err
	}

	ptidStr := pid.String()

	// 3. Create Identity Model
	identity := &model.Identity{
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

	// 4. Create Key Model
	key := &model.Key{
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
func (s *Service) GetIdentity(ctx context.Context, ptidStr string) (*model.Identity, error) {
	return s.store.GetIdentityByPTID(ctx, ptidStr)
}

// BindProvider binds an external provider identity to the core identity
func (s *Service) BindProvider(ctx context.Context, identityID uint64, providerName string) (*model.Binding, error) {
	// TODO: Implement provider binding logic
	return nil, fmt.Errorf("not implemented")
}

// ResolveIdentity resolves an identity from various inputs
func (s *Service) ResolveIdentity(ctx context.Context, input string) (*model.Identity, error) {
	return s.resolver.Resolve(ctx, input)
}
