package github

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/port"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/provider/common"
)

type Endpoints struct {
	Authorize string
	Token     string
	User      string
	Emails    string
}

type Provider struct {
	client    *http.Client
	endpoints Endpoints
	now       func() time.Time
}

func New() *Provider {
	return NewWithEndpoints(common.DefaultHTTPClient, Endpoints{
		Authorize: "https://github.com/login/oauth/authorize",
		Token:     "https://github.com/login/oauth/access_token",
		User:      "https://api.github.com/user",
		Emails:    "https://api.github.com/user/emails",
	})
}

func NewWithEndpoints(client *http.Client, endpoints Endpoints) *Provider {
	return &Provider{
		client:    client,
		endpoints: endpoints,
		now:       func() time.Time { return time.Now().UTC() },
	}
}

func (p *Provider) Provider() valueobject.Provider { return valueobject.ProviderGitHub }

func (p *Provider) AuthorizeURL(state, verifier string, cfg port.ProviderConfig) (string, error) {
	q := url.Values{}
	q.Set("client_id", cfg.ClientID)
	q.Set("redirect_uri", cfg.RedirectURI)
	q.Set("state", state)
	q.Set("code_challenge", common.PKCEChallenge(verifier))
	q.Set("code_challenge_method", "S256")
	if cfg.Scope != "" {
		q.Set("scope", cfg.Scope)
	}
	return p.endpoints.Authorize + "?" + q.Encode(), nil
}

func (p *Provider) ExchangeCode(ctx context.Context, code, verifier string, cfg port.ProviderConfig) (*entity.AuthorizationGrant, error) {
	form := url.Values{}
	form.Set("client_id", cfg.ClientID)
	form.Set("client_secret", cfg.ClientSecret)
	form.Set("code", code)
	form.Set("code_verifier", verifier)
	form.Set("redirect_uri", cfg.RedirectURI)

	tokens, err := p.exchangeToken(ctx, form)
	if err != nil {
		return nil, err
	}
	userResp, err := common.Get(ctx, p.client, p.endpoints.User, map[string]string{
		"Accept":        "application/vnd.github+json",
		"Authorization": fmt.Sprintf("Bearer %s", tokens.AccessToken),
	})
	if err != nil {
		return nil, errors.New("github_userinfo_failed")
	}
	if userResp.StatusCode >= http.StatusBadRequest {
		_ = userResp.Body.Close()
		return nil, errors.New("github_userinfo_failed")
	}
	var userBody struct {
		ID        uint64  `json:"id"`
		Login     string  `json:"login"`
		Name      string  `json:"name"`
		Email     *string `json:"email"`
		AvatarURL string  `json:"avatar_url"`
	}
	if err := common.DecodeJSON(userResp, &userBody); err != nil {
		return nil, errors.New("github_userinfo_failed")
	}
	profileEmail := ""
	if userBody.Email != nil {
		profileEmail = *userBody.Email
	}
	email, emailVerified := p.verifiedEmail(ctx, tokens.AccessToken, profileEmail)
	displayName := userBody.Name
	if displayName == "" {
		displayName = userBody.Login
	}
	if userBody.ID == 0 {
		return nil, errors.New("github_userinfo_invalid")
	}
	return &entity.AuthorizationGrant{
		Identity: entity.ProviderIdentity{
			ProviderUserID: fmt.Sprintf("%d", userBody.ID),
			Username:       userBody.Login,
			DisplayName:    displayName,
			AvatarURL:      userBody.AvatarURL,
			Email:          email,
			EmailVerified:  emailVerified,
		},
		Tokens: *tokens,
	}, nil
}

func (p *Provider) verifiedEmail(
	ctx context.Context,
	accessToken, profileEmail string,
) (string, bool) {
	if p.endpoints.Emails == "" {
		return "", false
	}
	response, err := common.Get(ctx, p.client, p.endpoints.Emails, map[string]string{
		"Accept":        "application/vnd.github+json",
		"Authorization": fmt.Sprintf("Bearer %s", accessToken),
	})
	if err != nil {
		return "", false
	}
	if response.StatusCode >= http.StatusBadRequest {
		_ = response.Body.Close()
		return "", false
	}
	var emails []struct {
		Email    string `json:"email"`
		Primary  bool   `json:"primary"`
		Verified bool   `json:"verified"`
	}
	if err := common.DecodeJSON(response, &emails); err != nil {
		return "", false
	}
	var firstVerified string
	for _, candidate := range emails {
		email := strings.TrimSpace(candidate.Email)
		if !candidate.Verified || email == "" {
			continue
		}
		if candidate.Primary {
			return email, true
		}
		if firstVerified == "" ||
			strings.EqualFold(email, strings.TrimSpace(profileEmail)) {
			firstVerified = email
		}
	}
	if firstVerified == "" {
		return "", false
	}
	return firstVerified, true
}

func (p *Provider) RefreshToken(ctx context.Context, refreshToken string, cfg port.ProviderConfig) (*entity.TokenSet, error) {
	if refreshToken == "" {
		return nil, errors.New("credential_not_refreshable")
	}
	form := url.Values{}
	form.Set("client_id", cfg.ClientID)
	form.Set("client_secret", cfg.ClientSecret)
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", refreshToken)
	return p.exchangeToken(ctx, form)
}

func (p *Provider) exchangeToken(ctx context.Context, form url.Values) (*entity.TokenSet, error) {
	tokenResp, err := common.PostForm(ctx, p.client, p.endpoints.Token, form, map[string]string{"Accept": "application/json"})
	if err != nil {
		return nil, errors.New("github_token_failed")
	}
	if tokenResp.StatusCode >= http.StatusBadRequest {
		_ = tokenResp.Body.Close()
		return nil, errors.New("github_token_failed")
	}
	var tokenBody struct {
		AccessToken           string `json:"access_token"`
		RefreshToken          string `json:"refresh_token"`
		TokenType             string `json:"token_type"`
		Scope                 string `json:"scope"`
		ExpiresIn             int64  `json:"expires_in"`
		RefreshTokenExpiresIn int64  `json:"refresh_token_expires_in"`
		Error                 string `json:"error"`
	}
	if err := common.DecodeJSON(tokenResp, &tokenBody); err != nil {
		return nil, errors.New("github_token_failed")
	}
	if tokenBody.Error != "" || tokenBody.AccessToken == "" {
		return nil, errors.New("github_token_failed")
	}
	now := p.now()
	return &entity.TokenSet{
		AccessToken:      tokenBody.AccessToken,
		RefreshToken:     tokenBody.RefreshToken,
		TokenType:        tokenBody.TokenType,
		Scope:            tokenBody.Scope,
		ObtainedAt:       now,
		AccessExpiresAt:  expiry(now, tokenBody.ExpiresIn),
		RefreshExpiresAt: expiry(now, tokenBody.RefreshTokenExpiresIn),
	}, nil
}

func expiry(now time.Time, seconds int64) *time.Time {
	if seconds <= 0 {
		return nil
	}
	value := now.Add(time.Duration(seconds) * time.Second)
	return &value
}
