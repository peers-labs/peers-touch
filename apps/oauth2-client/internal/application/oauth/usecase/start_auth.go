package usecase

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/url"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/port"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/repository"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
)

type StartAuthInput struct {
	SiteID   string
	Provider valueobject.Provider
	ReturnTo string
}

type StartAuthUseCase struct {
	Sites     SiteRegistry
	Sessions  repository.SessionRepository
	Providers map[valueobject.Provider]port.ProviderGateway
	Clock     Clock
}

func (u StartAuthUseCase) Execute(ctx context.Context, input StartAuthInput) (string, error) {
	site, ok := u.Sites.Get(input.SiteID)
	if !ok {
		return "", errors.New("unknown_site")
	}
	providerCfg, ok := site.Providers[input.Provider]
	if !ok {
		return "", errors.New("provider_not_enabled")
	}
	gw, ok := u.Providers[input.Provider]
	if !ok {
		return "", errors.New("provider_gateway_missing")
	}
	state, err := randomURLSafe(32)
	if err != nil {
		return "", err
	}
	verifier, err := randomURLSafe(48)
	if err != nil {
		return "", err
	}
	now := u.Clock.Now()
	session := entity.AuthSession{
		State:     state,
		SiteID:    input.SiteID,
		Provider:  input.Provider,
		ReturnTo:  sanitizeReturnTo(input.ReturnTo),
		Verifier:  verifier,
		CreatedAt: now,
		ExpiresAt: now.Add(10 * time.Minute),
	}
	if err := u.Sessions.Save(ctx, session); err != nil {
		return "", err
	}
	return gw.AuthorizeURL(state, verifier, providerCfg)
}

func randomURLSafe(size int) (string, error) {
	buf := make([]byte, size)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return strings.TrimRight(base64.RawURLEncoding.EncodeToString(buf), "="), nil
}

func sanitizeReturnTo(raw string) string {
	v := strings.TrimSpace(raw)
	if v == "" {
		return ""
	}
	u, err := url.Parse(v)
	if err != nil {
		return ""
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		if u.Scheme != "peers-touch" {
			return ""
		}
	}
	return u.String()
}
