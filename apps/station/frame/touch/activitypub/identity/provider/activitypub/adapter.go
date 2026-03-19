package activitypub

import (
	"context"
	"fmt"
	"strings"

	"github.com/peers-labs/peers-touch/station/frame/touch/activitypub/identity"
)

const ProviderName = "activitypub"

// Adapter implements identity.Adapter for ActivityPub actor URIs.
type Adapter struct {
	domain string
}

// NewAdapter constructs an ActivityPub provider adapter for a domain.
func NewAdapter(domain string) *Adapter {
	return &Adapter{domain: domain}
}

// Name returns the provider name.
func (a *Adapter) Name() string {

	return ProviderName
}

// Issue issues a provider ID (actor IRI) for the identity.
func (a *Adapter) Issue(ctx context.Context, identityModel *identity.Identity) (string, error) {
	if identityModel.Username == "" {
		return "", fmt.Errorf("username is required for ActivityPub identity")
	}
	return fmt.Sprintf("https://%s/activitypub/%s/actor", a.domain, identityModel.Username), nil
}

// Verify checks whether providerID matches the identity for this domain.
func (a *Adapter) Verify(ctx context.Context, identityModel *identity.Identity, providerID string) (bool, error) {
	expected, err := a.Issue(ctx, identityModel)
	if err != nil {
		return false, err
	}
	return expected == providerID, nil
}

// Parse validates an actor IRI for this domain and returns it.
func (a *Adapter) Parse(ctx context.Context, input string) (string, error) {
	prefix := fmt.Sprintf("https://%s/activitypub/", a.domain)
	if !strings.HasPrefix(input, prefix) {
		return "", fmt.Errorf("invalid actor URI for this domain")
	}
	return input, nil
}

// To converts an identity into a provider ID.
func (a *Adapter) To(ctx context.Context, identityModel *identity.Identity) (string, error) {
	return a.Issue(ctx, identityModel)
}

// From parses a provider ID into an identity reference (lookup not implemented).
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

// Capabilities reports adapter capabilities.
func (a *Adapter) Capabilities() map[string]interface{} {
	return map[string]interface{}{
		"version":   "1.0.0",
		"type":      "federated",
		"protocols": []string{"activitypub"},
	}
}

var _ identity.Adapter = (*Adapter)(nil)
