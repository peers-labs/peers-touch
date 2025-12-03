package adapter

import (
	"context"

	"github.com/peers-labs/peers-touch/station/frame/core/identity/model"
)

// Adapter defines the interface for identity providers (e.g., ActivityPub, libp2p)
type Adapter interface {
	// Name returns the provider name (e.g., "activitypub", "libp2p")
	Name() string

	// Issue generates a provider-specific ID from the core identity
	Issue(ctx context.Context, identity *model.Identity) (string, error)

	// Verify verifies the consistency between the core identity and the provider ID
	Verify(ctx context.Context, identity *model.Identity, providerID string) (bool, error)

	// To converts a core identity to a provider ID (lookup/generation)
	To(ctx context.Context, identity *model.Identity) (string, error)

	// From converts a provider ID to a core identity reference (lookup)
	// Returns the identity if found, or nil if not found/resolvable
	From(ctx context.Context, providerID string) (*model.Identity, error)

	// Capabilities returns the provider's capabilities
	Capabilities() map[string]interface{}
}
