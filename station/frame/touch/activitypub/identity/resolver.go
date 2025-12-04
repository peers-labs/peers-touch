package identity

import (
	"context"
	"fmt"
	"strings"
)

// Store defines the storage interface required by the resolver
type Store interface {
	GetIdentityByPTID(ctx context.Context, ptid string) (*Identity, error)
	GetIdentityByID(ctx context.Context, id uint64) (*Identity, error)
	GetIdentityByAlias(ctx context.Context, alias string) (*Identity, error)
	GetBinding(ctx context.Context, provider, providerID string) (*Binding, error)
	CreateIdentity(ctx context.Context, m *Identity) error
	CreateKey(ctx context.Context, k *Key) error
	CreateBinding(ctx context.Context, b *Binding) error
}

type Resolver struct {
	store Store
}

func NewResolver(store Store) *Resolver {
	return &Resolver{store: store}
}

// Resolve resolves an input string to a core Identity
func (r *Resolver) Resolve(ctx context.Context, input string) (*Identity, error) {
	if id, err := Parse(input); err == nil {
		return r.store.GetIdentityByPTID(ctx, id.String())
	}

	adapters := List()
	for _, a := range adapters {
		providerID, err := a.Parse(ctx, input)
		if err != nil {
			continue
		}
		binding, err := r.store.GetBinding(ctx, a.Name(), providerID)
		if err == nil && binding != nil {
			return r.store.GetIdentityByID(ctx, binding.IdentityID)
		}
		if identity, err := a.From(ctx, input); err == nil && identity != nil {
			return identity, nil
		}
	}

	if strings.HasPrefix(input, "acct:") || strings.HasPrefix(input, "pt:") {
		return r.store.GetIdentityByAlias(ctx, input)
	}

	return nil, fmt.Errorf("unable to resolve identity from input: %s", input)
}
