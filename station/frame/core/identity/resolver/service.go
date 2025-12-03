package resolver

import (
	"context"
	"fmt"
	"strings"

	"github.com/peers-labs/peers-touch/station/frame/core/identity/adapter"
	"github.com/peers-labs/peers-touch/station/frame/core/identity/model"
	"github.com/peers-labs/peers-touch/station/frame/core/identity/ptid"
)

// Store defines the storage interface required by the resolver
type Store interface {
	// GetIdentityByPTID retrieves an identity by its PTID string
	GetIdentityByPTID(ctx context.Context, ptid string) (*model.Identity, error)

	// GetIdentityByID retrieves an identity by its ID
	GetIdentityByID(ctx context.Context, id uint64) (*model.Identity, error)

	// GetIdentityByAlias retrieves an identity by one of its aliases
	GetIdentityByAlias(ctx context.Context, alias string) (*model.Identity, error)

	// GetBinding retrieves a binding by provider and provider ID
	GetBinding(ctx context.Context, provider, providerID string) (*model.Binding, error)
}

type Resolver struct {
	store Store
}

func NewResolver(store Store) *Resolver {
	return &Resolver{
		store: store,
	}
}

// Resolve resolves an input string to a core Identity
func (r *Resolver) Resolve(ctx context.Context, input string) (*model.Identity, error) {
	// 1. Try to parse as PTID
	if id, err := ptid.Parse(input); err == nil {
		return r.store.GetIdentityByPTID(ctx, id.String())
	}

	// 2. Try to resolve via adapters (e.g., is it a PeerID?)
	adapters := adapter.List()
	for _, a := range adapters {
		// Check if the input is a valid ID for this provider
		providerID, err := a.Parse(ctx, input)
		if err != nil {
			continue
		}

		// Try to find binding in local DB
		binding, err := r.store.GetBinding(ctx, a.Name(), providerID)
		if err == nil && binding != nil {
			return r.store.GetIdentityByID(ctx, binding.IdentityID)
		}

		// Fallback: Try to resolve remotely via adapter's From method
		// This might return a partial identity or try to do a remote lookup
		if identity, err := a.From(ctx, input); err == nil && identity != nil {
			return identity, nil
		}
	}

	// 3. Try to parse as Alias (e.g., acct:user@domain)
	if strings.HasPrefix(input, "acct:") || strings.HasPrefix(input, "pt:") {
		return r.store.GetIdentityByAlias(ctx, input)
	}

	return nil, fmt.Errorf("unable to resolve identity from input: %s", input)
}
