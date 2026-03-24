package github

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/port"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/provider/common"
)

type Provider struct{}

func New() *Provider { return &Provider{} }

func (p *Provider) Provider() valueobject.Provider { return valueobject.ProviderGitHub }

func (p *Provider) AuthorizeURL(state, _ string, cfg port.ProviderConfig) (string, error) {
	q := url.Values{}
	q.Set("client_id", cfg.ClientID)
	q.Set("redirect_uri", cfg.RedirectURI)
	q.Set("state", state)
	if cfg.Scope != "" {
		q.Set("scope", cfg.Scope)
	}
	return "https://github.com/login/oauth/authorize?" + q.Encode(), nil
}

func (p *Provider) ExchangeCode(ctx context.Context, code string, cfg port.ProviderConfig) (*port.ProviderIdentity, error) {
	form := url.Values{}
	form.Set("client_id", cfg.ClientID)
	form.Set("client_secret", cfg.ClientSecret)
	form.Set("code", code)
	form.Set("redirect_uri", cfg.RedirectURI)

	tokenResp, err := common.PostForm(ctx, "https://github.com/login/oauth/access_token", form, map[string]string{"Accept": "application/json"})
	if err != nil {
		return nil, err
	}
	if tokenResp.StatusCode >= http.StatusBadRequest {
		return nil, errors.New("github_token_failed")
	}
	var tokenBody struct {
		AccessToken string `json:"access_token"`
	}
	if err := common.DecodeJSON(tokenResp, &tokenBody); err != nil {
		return nil, err
	}
	if tokenBody.AccessToken == "" {
		return nil, errors.New("github_token_empty")
	}
	userResp, err := common.Get(ctx, "https://api.github.com/user", map[string]string{
		"Accept":        "application/vnd.github+json",
		"Authorization": fmt.Sprintf("Bearer %s", tokenBody.AccessToken),
	})
	if err != nil {
		return nil, err
	}
	if userResp.StatusCode >= http.StatusBadRequest {
		return nil, errors.New("github_userinfo_failed")
	}
	var userBody map[string]any
	if err := common.DecodeJSON(userResp, &userBody); err != nil {
		return nil, err
	}
	id, _ := userBody["id"].(float64)
	login, _ := userBody["login"].(string)
	name, _ := userBody["name"].(string)
	email, _ := userBody["email"].(string)
	avatar, _ := userBody["avatar_url"].(string)
	displayName := name
	if displayName == "" {
		displayName = login
	}
	return &port.ProviderIdentity{
		ProviderUserID: fmt.Sprintf("%.0f", id),
		Username:       login,
		DisplayName:    displayName,
		AvatarURL:      avatar,
		Email:          email,
		Raw:            userBody,
	}, nil
}
