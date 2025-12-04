package identity

import (
	"context"
)

// Adapter defines the interface for identity providers (e.g., ActivityPub, libp2p)
type Adapter interface {
	// Name returns the provider name (e.g., "activitypub", "libp2p")
	Name() string

	// Issue generates a provider-specific ID from the core identity
	Issue(ctx context.Context, identity *Identity) (string, error)

	// Verify verifies the consistency between the core identity and the provider ID
	Verify(ctx context.Context, identity *Identity, providerID string) (bool, error)

	// Parse parses and normalizes the input string to a provider ID if valid
	Parse(ctx context.Context, input string) (string, error)

	// To converts a core identity to a provider ID (lookup/generation)
	To(ctx context.Context, identity *Identity) (string, error)

	// From converts a provider ID to a core identity reference (lookup)
	// Returns the identity if found, or nil if not found/resolvable
	From(ctx context.Context, providerID string) (*Identity, error)

	// Capabilities returns the provider's capabilities
	Capabilities() map[string]interface{}
}

// Simple registry for adapters
var (
	adapters = make(map[string]Adapter)
)

// Register registers an adapter
func Register(adapter Adapter) {
	if adapter == nil {
		panic("identity: Register adapter is nil")
	}
	name := adapter.Name()
	if _, dup := adapters[name]; dup {
		panic("identity: Register called twice for adapter " + name)
	}
	adapters[name] = adapter
}

// Get returns an adapter by name
func Get(name string) (Adapter, bool) {
	a, ok := adapters[name]
	return a, ok
}

// List returns all registered adapters
func List() []Adapter {
	list := make([]Adapter, 0, len(adapters))
	for _, a := range adapters {
		list = append(list, a)
	}
	return list
}
