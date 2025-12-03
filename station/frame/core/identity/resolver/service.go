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
		// First check if adapter can resolve it directly (e.g. extract info)
		// But typically adapter.From returns a *model.Identity which might just be a partial object
		// or it might need to look up in DB.
		// If adapter returns a partial identity (e.g. just containing a PeerID reference),
		// we might need to look up the binding in our DB.

		// Let's assume adapter.From might return a full identity if it can,
		// OR we use the provider ID to look up the binding.

		// Pattern A: Adapter extracts provider ID, we look up binding.
		// Pattern B: Adapter does the lookup itself (less decoupled).

		// Let's stick to the interface definition: From(ctx, providerID) (*model.Identity, error)
		// If the adapter implementation is "stateless", it might not be able to return the full Identity
		// unless it has access to the store too.

		// To keep core simple, let's assume the adapter attempts to return a valid Identity.
		// However, typically we want to find the binding in our local DB.
		// So maybe we should ask the adapter to "Parse" the ID into a (Provider, ProviderID) tuple?
		// But the interface is `From`.

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
