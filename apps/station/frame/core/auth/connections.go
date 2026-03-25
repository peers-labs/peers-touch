package auth

import "context"

type ConnectionProviderStatus string

const (
	ConnectionProviderStatusReady      ConnectionProviderStatus = "ready"
	ConnectionProviderStatusDisabled   ConnectionProviderStatus = "disabled"
	ConnectionProviderStatusDeveloping ConnectionProviderStatus = "developing"
	ConnectionProviderStatusError      ConnectionProviderStatus = "error"
)

type ConnectionProvider struct {
	ProviderID          OAuth2ProviderID
	Name                string
	Category            string
	Status              ConnectionProviderStatus
	HasCredentials      bool
	CredentialSource    string
	LastError           string
	LastValidatedAtUnix int64
}

type ConnectionProviderStore interface {
	ListProviders(ctx context.Context) ([]*ConnectionProvider, error)
	GetProvider(ctx context.Context, providerID OAuth2ProviderID) (*ConnectionProvider, error)
	UpsertProvider(ctx context.Context, provider *ConnectionProvider) error
}

type ConnectionsService struct {
	store ConnectionProviderStore
}

func NewConnectionsService(store ConnectionProviderStore) *ConnectionsService {
	return &ConnectionsService{store: store}
}

func (s *ConnectionsService) ListProviders(ctx context.Context) ([]*ConnectionProvider, error) {
	return s.store.ListProviders(ctx)
}

func (s *ConnectionsService) UpsertProvider(ctx context.Context, provider *ConnectionProvider) error {
	return s.store.UpsertProvider(ctx, provider)
}
