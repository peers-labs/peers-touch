package google

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

func (p *Provider) Provider() valueobject.Provider { return valueobject.ProviderGoogle }

func (p *Provider) AuthorizeURL(state, _ string, cfg port.ProviderConfig) (string, error) {
	q := url.Values{}
	q.Set("client_id", cfg.ClientID)
	q.Set("redirect_uri", cfg.RedirectURI)
	q.Set("response_type", "code")
	q.Set("state", state)
	q.Set("access_type", "offline")
	if cfg.Scope != "" {
		q.Set("scope", cfg.Scope)
	} else {
		q.Set("scope", "openid profile email")
	}
	return "https://accounts.google.com/o/oauth2/v2/auth?" + q.Encode(), nil
}

func (p *Provider) ExchangeCode(ctx context.Context, code string, cfg port.ProviderConfig) (*port.ProviderIdentity, error) {
	form := url.Values{}
	form.Set("client_id", cfg.ClientID)
	form.Set("client_secret", cfg.ClientSecret)
	form.Set("code", code)
	form.Set("grant_type", "authorization_code")
	form.Set("redirect_uri", cfg.RedirectURI)
	tokenResp, err := common.PostForm(ctx, "https://oauth2.googleapis.com/token", form, nil)
	if err != nil {
		return nil, err
	}
	if tokenResp.StatusCode >= http.StatusBadRequest {
		return nil, errors.New("google_token_failed")
	}
	var tokenBody struct {
		AccessToken string `json:"access_token"`
	}
	if err := common.DecodeJSON(tokenResp, &tokenBody); err != nil {
		return nil, err
	}
	if tokenBody.AccessToken == "" {
		return nil, errors.New("google_token_empty")
	}
	userResp, err := common.Get(ctx, "https://openidconnect.googleapis.com/v1/userinfo", map[string]string{
		"Authorization": fmt.Sprintf("Bearer %s", tokenBody.AccessToken),
	})
	if err != nil {
		return nil, err
	}
	if userResp.StatusCode >= http.StatusBadRequest {
		return nil, errors.New("google_userinfo_failed")
	}
	var userBody map[string]any
	if err := common.DecodeJSON(userResp, &userBody); err != nil {
		return nil, err
	}
	sub, _ := userBody["sub"].(string)
	name, _ := userBody["name"].(string)
	givenName, _ := userBody["given_name"].(string)
	email, _ := userBody["email"].(string)
	emailVerified, _ := userBody["email_verified"].(bool)
	picture, _ := userBody["picture"].(string)
	username := givenName
	if username == "" {
		username = name
	}
	return &port.ProviderIdentity{
		ProviderUserID: sub,
		Username:       username,
		DisplayName:    name,
		AvatarURL:      picture,
		Email:          email,
		EmailVerified:  emailVerified,
		Raw:            userBody,
	}, nil
}
