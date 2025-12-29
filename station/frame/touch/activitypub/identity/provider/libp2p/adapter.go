package libp2p

import (
	"context"
	"fmt"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/peers-labs/peers-touch/station/frame/touch/activitypub/identity"
)

const ProviderLibp2p = "libp2p"

// Adapter implements identity.Adapter for libp2p peer IDs.
type Adapter struct{}

// NewAdapter constructs a libp2p provider adapter.
func NewAdapter() *Adapter { return &Adapter{} }

// Name returns the provider name.
func (a *Adapter) Name() string {

	return ProviderLibp2p
}

// Issue issues a provider ID (peer ID) for the identity.
func (a *Adapter) Issue(ctx context.Context, identityModel *identity.Identity) (string, error) {
	return "", fmt.Errorf("not implemented")
}

// Verify checks whether providerID matches the identity.
func (a *Adapter) Verify(ctx context.Context, identityModel *identity.Identity, providerID string) (bool, error) {
	return false, fmt.Errorf("not implemented")
}

// Parse validates a libp2p peer ID string and returns it.
func (a *Adapter) Parse(ctx context.Context, input string) (string, error) {
	pid, err := peer.Decode(input)
	if err != nil {
		return "", err
	}
	return pid.String(), nil
}

// To converts an identity into a provider ID.
func (a *Adapter) To(ctx context.Context, identityModel *identity.Identity) (string, error) {
	return "", fmt.Errorf("not implemented")
}

// From parses a provider ID into an identity reference (lookup not implemented).
func (a *Adapter) From(ctx context.Context, providerID string) (*identity.Identity, error) {
	if _, err := peer.Decode(providerID); err != nil {
		return nil, fmt.Errorf("invalid peer ID: %w", err)
	}
	return nil, fmt.Errorf("not implemented")
}

// Capabilities reports adapter capabilities.
func (a *Adapter) Capabilities() map[string]interface{} {
	return map[string]interface{}{
		"version": "1.0.0",
		"type":    "p2p",
	}
}

var _ identity.Adapter = (*Adapter)(nil)
