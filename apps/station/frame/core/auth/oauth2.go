package auth

import "context"

type OAuth2ProviderID string

type OAuth2ProviderConfig struct {
	ProviderID  OAuth2ProviderID
	ClientID    string
	RedirectURI string
	Scopes      []string
}

type OAuth2Identity struct {
	ProviderID     OAuth2ProviderID
	ProviderUserID string
	ProviderUnion  string
	Username       string
	DisplayName    string
	AvatarURL      string
	Email          string
	Raw            map[string]any
}

type OAuth2TokenState struct {
	ProviderID        OAuth2ProviderID
	AccessToken       string
	RefreshToken      string
	TokenType         string
	Scope             string
	ExpiresAtUnix     int64
	RefreshExpiresAt  int64
	Status            string
	LastRefreshAtUnix int64
	LastError         string
}

const (
	OAuth2TokenStatusActive         = "active"
	OAuth2TokenStatusExpired        = "expired"
	OAuth2TokenStatusReauthRequired = "reauth_required"
	OAuth2TokenStatusError          = "error"
)

type OAuth2Adapter interface {
	ProviderID() OAuth2ProviderID
	BuildAuthorizeURL(ctx context.Context, cfg OAuth2ProviderConfig, state string) (string, error)
	ExchangeCode(ctx context.Context, cfg OAuth2ProviderConfig, code string) (*OAuth2TokenState, error)
	RefreshToken(ctx context.Context, cfg OAuth2ProviderConfig, refreshToken string) (*OAuth2TokenState, error)
	FetchIdentity(ctx context.Context, token *OAuth2TokenState) (*OAuth2Identity, error)
}

type OAuth2IdentityStore interface {
	GetByProviderUser(ctx context.Context, providerID OAuth2ProviderID, providerUserID string) (*OAuth2Identity, uint64, error)
	ListByActor(ctx context.Context, actorID uint64) ([]*OAuth2Identity, error)
	BindActor(ctx context.Context, actorID uint64, identity *OAuth2Identity, primary bool) error
}

type OAuth2TokenStore interface {
	GetByActorProvider(ctx context.Context, actorID uint64, providerID OAuth2ProviderID) (*OAuth2TokenState, error)
	SaveByActorProvider(ctx context.Context, actorID uint64, token *OAuth2TokenState) error
	MarkReauthRequired(ctx context.Context, actorID uint64, providerID OAuth2ProviderID, reason string) error
}

type OAuth2ConfigSource interface {
	ListEnabledProviders(ctx context.Context) ([]OAuth2ProviderConfig, error)
	GetProviderConfig(ctx context.Context, providerID OAuth2ProviderID) (*OAuth2ProviderConfig, error)
}

type OAuth2Service struct {
	adapters map[OAuth2ProviderID]OAuth2Adapter
}

func NewOAuth2Service(adapters []OAuth2Adapter) *OAuth2Service {
	m := make(map[OAuth2ProviderID]OAuth2Adapter, len(adapters))
	for _, adapter := range adapters {
		m[adapter.ProviderID()] = adapter
	}
	return &OAuth2Service{adapters: m}
}

func (s *OAuth2Service) Adapter(providerID OAuth2ProviderID) OAuth2Adapter {
	return s.adapters[providerID]
}
