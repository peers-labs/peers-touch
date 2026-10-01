package google

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/port"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/provider/common"
)

type Endpoints struct {
	Authorize string
	Token     string
	UserInfo  string
}

type Provider struct {
	client    *http.Client
	endpoints Endpoints
	now       func() time.Time
}

func New() *Provider {
	return NewWithEndpoints(common.DefaultHTTPClient, Endpoints{
		Authorize: "https://accounts.google.com/o/oauth2/v2/auth",
		Token:     "https://oauth2.googleapis.com/token",
		UserInfo:  "https://openidconnect.googleapis.com/v1/userinfo",
	})
}

func NewWithEndpoints(client *http.Client, endpoints Endpoints) *Provider {
	return &Provider{
		client:    client,
		endpoints: endpoints,
		now:       func() time.Time { return time.Now().UTC() },
	}
}

func (p *Provider) Provider() valueobject.Provider { return valueobject.ProviderGoogle }

func (p *Provider) AuthorizeURL(state, verifier string, cfg port.ProviderConfig) (string, error) {
	q := url.Values{}
	q.Set("client_id", cfg.ClientID)
	q.Set("redirect_uri", cfg.RedirectURI)
	q.Set("response_type", "code")
	q.Set("state", state)
	q.Set("access_type", "offline")
	q.Set("code_challenge", common.PKCEChallenge(verifier))
	q.Set("code_challenge_method", "S256")
	if cfg.Scope != "" {
		q.Set("scope", cfg.Scope)
	} else {
		q.Set("scope", "openid profile email")
	}
	return p.endpoints.Authorize + "?" + q.Encode(), nil
}

func (p *Provider) ExchangeCode(ctx context.Context, code, verifier string, cfg port.ProviderConfig) (*entity.AuthorizationGrant, error) {
	form := url.Values{}
	form.Set("client_id", cfg.ClientID)
	form.Set("client_secret", cfg.ClientSecret)
	form.Set("code", code)
	form.Set("code_verifier", verifier)
	form.Set("grant_type", "authorization_code")
	form.Set("redirect_uri", cfg.RedirectURI)
	tokens, err := p.exchangeToken(ctx, form)
	if err != nil {
		return nil, err
	}
	userResp, err := common.Get(ctx, p.client, p.endpoints.UserInfo, map[string]string{
		"Authorization": fmt.Sprintf("Bearer %s", tokens.AccessToken),
	})
	if err != nil {
		return nil, errors.New("google_userinfo_failed")
	}
	if userResp.StatusCode >= http.StatusBadRequest {
		_ = userResp.Body.Close()
		return nil, errors.New("google_userinfo_failed")
	}
	var userBody map[string]any
	if err := common.DecodeJSON(userResp, &userBody); err != nil {
		return nil, errors.New("google_userinfo_failed")
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
	if sub == "" {
		return nil, errors.New("google_userinfo_invalid")
	}
	return &entity.AuthorizationGrant{
		Identity: entity.ProviderIdentity{
			ProviderUserID: sub,
			Username:       username,
			DisplayName:    name,
			AvatarURL:      picture,
			Email:          email,
			EmailVerified:  emailVerified,
		},
		Tokens: *tokens,
	}, nil
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
	tokenResp, err := common.PostForm(ctx, p.client, p.endpoints.Token, form, nil)
	if err != nil {
		return nil, errors.New("google_token_failed")
	}
	if tokenResp.StatusCode >= http.StatusBadRequest {
		_ = tokenResp.Body.Close()
		return nil, errors.New("google_token_failed")
	}
	var tokenBody struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		TokenType    string `json:"token_type"`
		Scope        string `json:"scope"`
		ExpiresIn    int64  `json:"expires_in"`
		Error        string `json:"error"`
	}
	if err := common.DecodeJSON(tokenResp, &tokenBody); err != nil {
		return nil, errors.New("google_token_failed")
	}
	if tokenBody.Error != "" || tokenBody.AccessToken == "" {
		return nil, errors.New("google_token_failed")
	}
	now := p.now()
	return &entity.TokenSet{
		AccessToken:     tokenBody.AccessToken,
		RefreshToken:    tokenBody.RefreshToken,
		TokenType:       tokenBody.TokenType,
		Scope:           tokenBody.Scope,
		ObtainedAt:      now,
		AccessExpiresAt: expiry(now, tokenBody.ExpiresIn),
	}, nil
}

func expiry(now time.Time, seconds int64) *time.Time {
	if seconds <= 0 {
		return nil
	}
	value := now.Add(time.Duration(seconds) * time.Second)
	return &value
}
