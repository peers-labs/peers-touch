package port

import (
	"context"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
)

type ProviderConfig struct {
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
	RedirectURI  string `json:"redirect_uri"`
	Scope        string `json:"scope"`
}

type ProviderGateway interface {
	Provider() valueobject.Provider
	AuthorizeURL(state, verifier string, cfg ProviderConfig) (string, error)
	ExchangeCode(ctx context.Context, code, verifier string, cfg ProviderConfig) (*entity.AuthorizationGrant, error)
	RefreshToken(ctx context.Context, refreshToken string, cfg ProviderConfig) (*entity.TokenSet, error)
}

type SecretFingerprinter interface {
	Fingerprint(value string) string
}
