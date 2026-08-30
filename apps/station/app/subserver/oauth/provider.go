package oauth

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
)

const providerResponseLimit = 1 << 20

type providerRuntimeConfig struct {
	ID           string
	ClientID     string
	ClientSecret string
	AuthorizeURL string
	TokenURL     string
	UserinfoURL  string
	RedirectURI  string
	Scopes       []string
}

type providerExchange interface {
	AuthorizeURL(config providerRuntimeConfig, state, pkceChallenge string) (string, error)
	Exchange(
		ctx context.Context,
		config providerRuntimeConfig,
		code, pkceVerifier string,
	) (*coreauth.OAuth2Identity, error)
}

type httpProviderExchange struct {
	client *http.Client
}

func newHTTPProviderExchange() *httpProviderExchange {
	return &httpProviderExchange{
		client: &http.Client{Timeout: 15 * time.Second},
	}
}

func providerConfiguration(provider, redirectURI string) (providerRuntimeConfig, error) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	if provider != "github" && provider != "google" {
		return providerRuntimeConfig{}, fmt.Errorf("unsupported OAuth provider")
	}

	var configured *providerConfig
	for i := range oauthOptions.Peers.Node.Server.Subserver.OAuth.Providers {
		candidate := &oauthOptions.Peers.Node.Server.Subserver.OAuth.Providers[i]
		if strings.EqualFold(candidate.ID, provider) {
			configured = candidate
			break
		}
	}
	if configured == nil || !configured.Enabled || configured.Status != "active" {
		return providerRuntimeConfig{}, fmt.Errorf("OAuth provider is unavailable")
	}

	var environment *providerEnvironmentConfig
	for i := range configured.Environments {
		candidate := &configured.Environments[i]
		if candidate.Default {
			environment = candidate
			break
		}
	}
	if environment == nil && len(configured.Environments) > 0 {
		environment = &configured.Environments[0]
	}
	if environment == nil || environment.AuthorizeURL == "" || environment.TokenURL == "" {
		return providerRuntimeConfig{}, fmt.Errorf("OAuth provider endpoints are incomplete")
	}

	redirect, err := url.Parse(strings.TrimSpace(redirectURI))
	if err != nil || redirect.Scheme == "" || redirect.Fragment != "" || redirect.User != nil {
		return providerRuntimeConfig{}, fmt.Errorf("OAuth redirect URI is invalid")
	}

	envPrefix := "PEERS_OAUTH_" + strings.ToUpper(provider)
	allowedRedirects := splitConfiguredValues(os.Getenv(envPrefix + "_REDIRECT_URIS"))
	if len(allowedRedirects) == 0 && configured.CallbackURL != "" {
		allowedRedirects = []string{strings.TrimSpace(configured.CallbackURL)}
	}
	if !containsExactValue(allowedRedirects, redirect.String()) {
		return providerRuntimeConfig{}, fmt.Errorf("OAuth redirect URI is not configured")
	}

	clientID := strings.TrimSpace(os.Getenv(envPrefix + "_CLIENT_ID"))
	clientSecret := strings.TrimSpace(os.Getenv(envPrefix + "_CLIENT_SECRET"))
	if clientID == "" || clientSecret == "" {
		return providerRuntimeConfig{}, fmt.Errorf("OAuth provider credentials are unavailable")
	}

	userinfoURL := environment.UserinfoURL
	scopes := []string{"openid", "profile", "email"}
	if provider == "github" {
		scopes = []string{"read:user", "user:email"}
		if userinfoURL == "" {
			userinfoURL = "https://api.github.com/user"
		}
	}
	if userinfoURL == "" {
		return providerRuntimeConfig{}, fmt.Errorf("OAuth provider userinfo endpoint is unavailable")
	}

	return providerRuntimeConfig{
		ID:           provider,
		ClientID:     clientID,
		ClientSecret: clientSecret,
		AuthorizeURL: environment.AuthorizeURL,
		TokenURL:     environment.TokenURL,
		UserinfoURL:  userinfoURL,
		RedirectURI:  redirect.String(),
		Scopes:       scopes,
	}, nil
}

func splitConfiguredValues(raw string) []string {
	values := make([]string, 0)
	for _, value := range strings.Split(raw, ",") {
		value = strings.TrimSpace(value)
		if value != "" {
			values = append(values, value)
		}
	}
	return values
}

func containsExactValue(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func (e *httpProviderExchange) AuthorizeURL(
	config providerRuntimeConfig,
	state, pkceChallenge string,
) (string, error) {
	authorizeURL, err := url.Parse(config.AuthorizeURL)
	if err != nil {
		return "", fmt.Errorf("parse provider authorize URL: %w", err)
	}
	query := authorizeURL.Query()
	query.Set("client_id", config.ClientID)
	query.Set("redirect_uri", config.RedirectURI)
	query.Set("response_type", "code")
	query.Set("scope", strings.Join(config.Scopes, " "))
	query.Set("state", state)
	query.Set("code_challenge", pkceChallenge)
	query.Set("code_challenge_method", "S256")
	authorizeURL.RawQuery = query.Encode()
	return authorizeURL.String(), nil
}

func (e *httpProviderExchange) Exchange(
	ctx context.Context,
	config providerRuntimeConfig,
	code, pkceVerifier string,
) (*coreauth.OAuth2Identity, error) {
	token, err := e.exchangeToken(ctx, config, code, pkceVerifier)
	if err != nil {
		return nil, err
	}
	return e.fetchIdentity(ctx, config, token)
}

func (e *httpProviderExchange) exchangeToken(
	ctx context.Context,
	config providerRuntimeConfig,
	code, pkceVerifier string,
) (string, error) {
	form := url.Values{
		"client_id":     {config.ClientID},
		"client_secret": {config.ClientSecret},
		"code":          {code},
		"redirect_uri":  {config.RedirectURI},
		"grant_type":    {"authorization_code"},
		"code_verifier": {pkceVerifier},
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, config.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("build provider token request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	response, err := e.client.Do(request)
	if err != nil {
		return "", fmt.Errorf("exchange provider code: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, providerResponseLimit))
	if err != nil {
		return "", fmt.Errorf("read provider token response: %w", err)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return "", fmt.Errorf("provider token exchange returned status %d", response.StatusCode)
	}

	var payload struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		values, parseErr := url.ParseQuery(string(body))
		if parseErr != nil {
			return "", fmt.Errorf("decode provider token response: %w", err)
		}
		payload.AccessToken = values.Get("access_token")
		payload.Error = values.Get("error")
	}
	if payload.Error != "" || payload.AccessToken == "" {
		return "", fmt.Errorf("provider rejected authorization code")
	}
	return payload.AccessToken, nil
}

func (e *httpProviderExchange) fetchIdentity(
	ctx context.Context,
	config providerRuntimeConfig,
	accessToken string,
) (*coreauth.OAuth2Identity, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, config.UserinfoURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build provider identity request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+accessToken)
	request.Header.Set("Accept", "application/json")

	response, err := e.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("fetch provider identity: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("provider identity request returned status %d", response.StatusCode)
	}

	var payload struct {
		ID        json.RawMessage `json:"id"`
		Sub       string          `json:"sub"`
		Login     string          `json:"login"`
		Name      string          `json:"name"`
		Picture   string          `json:"picture"`
		AvatarURL string          `json:"avatar_url"`
		Email     string          `json:"email"`
		Verified  *bool           `json:"email_verified"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, providerResponseLimit)).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode provider identity: %w", err)
	}

	providerUserID := strings.TrimSpace(payload.Sub)
	if providerUserID == "" && len(payload.ID) > 0 {
		if err := json.Unmarshal(payload.ID, &providerUserID); err != nil {
			var numericID int64
			if numericErr := json.Unmarshal(payload.ID, &numericID); numericErr == nil {
				providerUserID = strconv.FormatInt(numericID, 10)
			}
		}
	}
	if config.ID == "google" && (payload.Verified == nil || !*payload.Verified) {
		return nil, fmt.Errorf("provider email is not verified")
	}
	if config.ID == "github" && strings.TrimSpace(payload.Email) == "" {
		email, err := e.fetchGitHubEmail(ctx, accessToken)
		if err != nil {
			return nil, err
		}
		payload.Email = email
	}
	username := strings.TrimSpace(payload.Login)
	if username == "" {
		username = strings.TrimSpace(payload.Email)
		if at := strings.IndexByte(username, '@'); at > 0 {
			username = username[:at]
		}
	}
	if providerUserID == "" || username == "" || strings.TrimSpace(payload.Email) == "" {
		return nil, fmt.Errorf("provider identity is incomplete")
	}

	avatarURL := strings.TrimSpace(payload.AvatarURL)
	if avatarURL == "" {
		avatarURL = strings.TrimSpace(payload.Picture)
	}
	return &coreauth.OAuth2Identity{
		ProviderID:     coreauth.OAuth2ProviderID(config.ID),
		ProviderUserID: providerUserID,
		Username:       username,
		DisplayName:    strings.TrimSpace(payload.Name),
		AvatarURL:      avatarURL,
		Email:          strings.TrimSpace(payload.Email),
	}, nil
}

func (e *httpProviderExchange) fetchGitHubEmail(ctx context.Context, accessToken string) (string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/user/emails", nil)
	if err != nil {
		return "", fmt.Errorf("build GitHub email request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+accessToken)
	request.Header.Set("Accept", "application/vnd.github+json")

	response, err := e.client.Do(request)
	if err != nil {
		return "", fmt.Errorf("fetch GitHub email: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return "", fmt.Errorf("GitHub email request returned status %d", response.StatusCode)
	}
	var emails []struct {
		Email    string `json:"email"`
		Primary  bool   `json:"primary"`
		Verified bool   `json:"verified"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, providerResponseLimit)).Decode(&emails); err != nil {
		return "", fmt.Errorf("decode GitHub email response: %w", err)
	}
	for _, email := range emails {
		if email.Primary && email.Verified && strings.TrimSpace(email.Email) != "" {
			return strings.TrimSpace(email.Email), nil
		}
	}
	return "", fmt.Errorf("provider identity has no verified primary email")
}
