package activitypub

import (
	"context"
	"fmt"
	"strings"

	"github.com/peers-labs/peers-touch/station/frame/touch/activitypub/identity"
)

const ProviderName = "activitypub"

type Adapter struct {
	domain string
}

func NewAdapter(domain string) *Adapter {
	return &Adapter{domain: domain}
}

func (a *Adapter) Name() string { return ProviderName }

func (a *Adapter) Issue(ctx context.Context, identityModel *identity.Identity) (string, error) {
	if identityModel.Username == "" {
		return "", fmt.Errorf("username is required for ActivityPub identity")
	}
	return fmt.Sprintf("https://%s/activitypub/%s/actor", a.domain, identityModel.Username), nil
}

func (a *Adapter) Verify(ctx context.Context, identityModel *identity.Identity, providerID string) (bool, error) {
	expected, err := a.Issue(ctx, identityModel)
	if err != nil {
		return false, err
	}
	return expected == providerID, nil
}

func (a *Adapter) Parse(ctx context.Context, input string) (string, error) {
	prefix := fmt.Sprintf("https://%s/activitypub/", a.domain)
	if !strings.HasPrefix(input, prefix) {
		return "", fmt.Errorf("invalid actor URI for this domain")
	}
	return input, nil
}

func (a *Adapter) To(ctx context.Context, identityModel *identity.Identity) (string, error) {
	return a.Issue(ctx, identityModel)
}

func (a *Adapter) From(ctx context.Context, providerID string) (*identity.Identity, error) {
	prefix := fmt.Sprintf("https://%s/activitypub/", a.domain)
	if !strings.HasPrefix(providerID, prefix) {
		return nil, fmt.Errorf("invalid actor URI for this domain")
	}
	remainder := strings.TrimPrefix(providerID, prefix)
	parts := strings.Split(remainder, "/")
	if len(parts) < 1 {
		return nil, fmt.Errorf("cannot extract username from actor URI")
	}
	username := parts[0]
	return nil, fmt.Errorf("lookup by username %s not implemented", username)
}

func (a *Adapter) Capabilities() map[string]interface{} {
	return map[string]interface{}{
		"version":   "1.0.0",
		"type":      "federated",
		"protocols": []string{"activitypub"},
	}
}

var _ identity.Adapter = (*Adapter)(nil)
