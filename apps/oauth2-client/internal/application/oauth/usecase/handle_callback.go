package usecase

import (
	"context"
	"errors"
	"net/url"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/port"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/repository"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
)

type HandleCallbackInput struct {
	Provider valueobject.Provider
	State    string
	Code     string
}

type HandleCallbackOutput struct {
	RedirectURL string
}

type HandleCallbackUseCase struct {
	Sites     SiteRegistry
	Sessions  repository.SessionRepository
	Providers map[valueobject.Provider]port.ProviderGateway
	Clock     Clock
}

func (u HandleCallbackUseCase) Execute(ctx context.Context, input HandleCallbackInput) (*HandleCallbackOutput, error) {
	gw, ok := u.Providers[input.Provider]
	if !ok {
		return nil, errors.New("provider_gateway_missing")
	}
	session, err := u.Sessions.FindByState(ctx, input.State)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return nil, errors.New("invalid_state")
	}
	if session.Provider != input.Provider {
		return nil, errors.New("provider_mismatch")
	}
	if session.IsConsumed() {
		return nil, errors.New("state_consumed")
	}
	if session.IsExpired(u.Clock.Now()) {
		return nil, errors.New("state_expired")
	}
	site, ok := u.Sites.Get(session.SiteID)
	if !ok {
		return nil, errors.New("unknown_site")
	}
	cfg, ok := site.Providers[input.Provider]
	if !ok {
		return nil, errors.New("provider_not_enabled")
	}
	identity, err := gw.ExchangeCode(ctx, input.Code, cfg)
	if err != nil {
		return nil, err
	}
	if err := u.Sessions.MarkConsumed(ctx, session.State); err != nil {
		return nil, err
	}
	target := site.SuccessURL
	if session.ReturnTo != "" {
		target = session.ReturnTo
	}
	redirectURL, err := appendQuery(target, map[string]string{
		"site_id":          session.SiteID,
		"provider":         string(input.Provider),
		"provider_user_id": identity.ProviderUserID,
		"union_id":         identity.UnionID,
		"username":         identity.Username,
		"display_name":     identity.DisplayName,
		"avatar_url":       identity.AvatarURL,
		"email":            identity.Email,
		"ts":               time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		return nil, err
	}
	return &HandleCallbackOutput{RedirectURL: redirectURL}, nil
}

func appendQuery(raw string, values map[string]string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	q := u.Query()
	for k, v := range values {
		if v == "" {
			continue
		}
		q.Set(k, v)
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}
