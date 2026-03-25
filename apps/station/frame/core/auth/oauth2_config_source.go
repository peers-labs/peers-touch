package auth

import (
	"context"
	"sync"
)

type InMemoryOAuth2ConfigSource struct {
	mu        sync.RWMutex
	providers map[OAuth2ProviderID]OAuth2ProviderConfig
}

func NewInMemoryOAuth2ConfigSource(configs []OAuth2ProviderConfig) *InMemoryOAuth2ConfigSource {
	m := make(map[OAuth2ProviderID]OAuth2ProviderConfig, len(configs))
	for _, cfg := range configs {
		m[cfg.ProviderID] = cfg
	}
	return &InMemoryOAuth2ConfigSource{providers: m}
}

func (s *InMemoryOAuth2ConfigSource) ListEnabledProviders(ctx context.Context) ([]OAuth2ProviderConfig, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]OAuth2ProviderConfig, 0, len(s.providers))
	for _, cfg := range s.providers {
		out = append(out, cfg)
	}
	return out, nil
}

func (s *InMemoryOAuth2ConfigSource) GetProviderConfig(ctx context.Context, providerID OAuth2ProviderID) (*OAuth2ProviderConfig, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	cfg, ok := s.providers[providerID]
	if !ok {
		return nil, nil
	}
	return &cfg, nil
}

func (s *InMemoryOAuth2ConfigSource) UpsertProviderConfig(cfg OAuth2ProviderConfig) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.providers[cfg.ProviderID] = cfg
}
