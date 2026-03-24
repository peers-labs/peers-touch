package port

import (
	"context"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
)

type ProviderConfig struct {
	ClientID     string
	ClientSecret string
	RedirectURI  string
	Scope        string
}

type ProviderIdentity struct {
	ProviderUserID string
	UnionID        string
	Username       string
	DisplayName    string
	AvatarURL      string
	Email          string
	EmailVerified  bool
	Raw            map[string]any
}

type ProviderGateway interface {
	Provider() valueobject.Provider
	AuthorizeURL(state, verifier string, cfg ProviderConfig) (string, error)
	ExchangeCode(ctx context.Context, code string, cfg ProviderConfig) (*ProviderIdentity, error)
}
