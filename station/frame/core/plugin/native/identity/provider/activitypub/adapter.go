package activitypub

import (
	"context"
	"fmt"
	"strings"

	"github.com/peers-labs/peers-touch/station/frame/core/identity/adapter"
	"github.com/peers-labs/peers-touch/station/frame/core/identity/model"
)

const ProviderName = "activitypub"

type Adapter struct {
	domain string
}

func NewAdapter(domain string) *Adapter {
	return &Adapter{
		domain: domain,
	}
}

func (a *Adapter) Name() string {
	return ProviderName
}

// Issue generates an ActivityPub Actor URI from the identity
// Format: https://<domain>/activitypub/<username>/actor
func (a *Adapter) Issue(ctx context.Context, identity *model.Identity) (string, error) {
	if identity.Username == "" {
		return "", fmt.Errorf("username is required for ActivityPub identity")
	}
	return fmt.Sprintf("https://%s/activitypub/%s/actor", a.domain, identity.Username), nil
}

func (a *Adapter) Verify(ctx context.Context, identity *model.Identity, providerID string) (bool, error) {
	expected, err := a.Issue(ctx, identity)
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

func (a *Adapter) To(ctx context.Context, identity *model.Identity) (string, error) {
	return a.Issue(ctx, identity)
}

func (a *Adapter) From(ctx context.Context, providerID string) (*model.Identity, error) {
	// Parse the providerID (Actor URI) to extract username
	// Format: https://<domain>/activitypub/<username>/actor
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

	// In a real implementation, we would look up the identity by username
	// For now, we return a placeholder or error if we can't look it up without a DB
	return nil, fmt.Errorf("lookup by username %s not implemented", username)
}

func (a *Adapter) Capabilities() map[string]interface{} {
	return map[string]interface{}{
		"version":   "1.0.0",
		"type":      "federated",
		"protocols": []string{"activitypub"},
	}
}

// Ensure Adapter implements adapter.Adapter
var _ adapter.Adapter = (*Adapter)(nil)
