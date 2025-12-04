package libp2p

import (
	"context"
	"fmt"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/peers-labs/peers-touch/station/frame/touch/activitypub/identity"
)

const ProviderLibp2p = "libp2p"

type Adapter struct{}

func NewAdapter() *Adapter { return &Adapter{} }

func (a *Adapter) Name() string { return ProviderLibp2p }

func (a *Adapter) Issue(ctx context.Context, identityModel *identity.Identity) (string, error) {
	return "", fmt.Errorf("not implemented")
}

func (a *Adapter) Verify(ctx context.Context, identityModel *identity.Identity, providerID string) (bool, error) {
	return false, fmt.Errorf("not implemented")
}

func (a *Adapter) Parse(ctx context.Context, input string) (string, error) {
	pid, err := peer.Decode(input)
	if err != nil {
		return "", err
	}
	return pid.String(), nil
}

func (a *Adapter) To(ctx context.Context, identityModel *identity.Identity) (string, error) {
	return "", fmt.Errorf("not implemented")
}

func (a *Adapter) From(ctx context.Context, providerID string) (*identity.Identity, error) {
	if _, err := peer.Decode(providerID); err != nil {
		return nil, fmt.Errorf("invalid peer ID: %w", err)
	}
	return nil, fmt.Errorf("not implemented")
}

func (a *Adapter) Capabilities() map[string]interface{} {
	return map[string]interface{}{
		"version": "1.0.0",
		"type":    "p2p",
	}
}

var _ identity.Adapter = (*Adapter)(nil)
