package adapter

import (
	"context"
	"fmt"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/peers-labs/peers-touch/station/frame/core/identity/adapter"
	"github.com/peers-labs/peers-touch/station/frame/core/identity/model"
)

const ProviderLibp2p = "libp2p"

type Libp2pAdapter struct {
}

func NewLibp2pAdapter() *Libp2pAdapter {
	return &Libp2pAdapter{}
}

func (a *Libp2pAdapter) Name() string {
	return ProviderLibp2p
}

func (a *Libp2pAdapter) Issue(ctx context.Context, identity *model.Identity) (string, error) {
	// In a real implementation, this would derive a PeerID from the identity's public key
	// For now, we'll assume the fingerprint IS the PeerID if it's compatible, or return an error
	// This is a placeholder
	return "", fmt.Errorf("not implemented")
}

func (a *Libp2pAdapter) Verify(ctx context.Context, identity *model.Identity, providerID string) (bool, error) {
	// Verify if the providerID (PeerID) matches the identity
	return false, fmt.Errorf("not implemented")
}

func (a *Libp2pAdapter) To(ctx context.Context, identity *model.Identity) (string, error) {
	// Look up the PeerID for this identity
	return "", fmt.Errorf("not implemented")
}

func (a *Libp2pAdapter) From(ctx context.Context, providerID string) (*model.Identity, error) {
	// Look up the identity for this PeerID
	_, err := peer.Decode(providerID)
	if err != nil {
		return nil, fmt.Errorf("invalid peer ID: %w", err)
	}
	return nil, fmt.Errorf("not implemented")
}

func (a *Libp2pAdapter) Capabilities() map[string]interface{} {
	return map[string]interface{}{
		"version": "1.0.0",
		"type":    "p2p",
	}
}

// Ensure Libp2pAdapter implements adapter.Adapter
var _ adapter.Adapter = (*Libp2pAdapter)(nil)
