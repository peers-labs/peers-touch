package githubstore

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/repository"
)

type AppAuthenticator struct {
	apiBase        string
	appID          string
	installationID int64
	privateKey     *rsa.PrivateKey
	client         *http.Client
	now            func() time.Time

	mu        sync.Mutex
	token     string
	expiresAt time.Time
}

func NewAppAuthenticator(apiBase, appID string, installationID int64, privateKeyPEM []byte, client *http.Client) (*AppAuthenticator, error) {
	key, err := parseRSAPrivateKey(privateKeyPEM)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(appID) == "" || installationID <= 0 {
		return nil, errors.New("invalid_github_app_configuration")
	}
	if client == nil {
		client = http.DefaultClient
	}
	return &AppAuthenticator{
		apiBase:        strings.TrimRight(apiBase, "/"),
		appID:          appID,
		installationID: installationID,
		privateKey:     key,
		client:         client,
		now:            func() time.Time { return time.Now().UTC() },
	}, nil
}

func (a *AppAuthenticator) InstallationToken(ctx context.Context) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	now := a.now()
	if a.token != "" && now.Add(time.Minute).Before(a.expiresAt) {
		return a.token, nil
	}
	jwt, err := a.signJWT(now)
	if err != nil {
		return "", err
	}
	endpoint := fmt.Sprintf("%s/app/installations/%d/access_tokens", a.apiBase, a.installationID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader([]byte("{}")))
	if err != nil {
		return "", repository.ErrStorageUnavailable
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Authorization", "Bearer "+jwt)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "peers-touch-oauth-login-broker")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	resp, err := a.client.Do(req)
	if err != nil {
		return "", repository.ErrStorageUnavailable
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		_, _ = io.Copy(io.Discard, resp.Body)
		return "", repository.ErrStorageUnavailable
	}
	var payload struct {
		Token     string    `json:"token"`
		ExpiresAt time.Time `json:"expires_at"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&payload); err != nil {
		return "", repository.ErrStorageUnavailable
	}
	if payload.Token == "" || payload.ExpiresAt.IsZero() {
		return "", repository.ErrStorageUnavailable
	}
	a.token = payload.Token
	a.expiresAt = payload.ExpiresAt
	return payload.Token, nil
}

func (a *AppAuthenticator) Invalidate() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.token = ""
	a.expiresAt = time.Time{}
}

func (a *AppAuthenticator) signJWT(now time.Time) (string, error) {
	header, _ := json.Marshal(map[string]string{"alg": "RS256", "typ": "JWT"})
	claims, _ := json.Marshal(map[string]any{
		"iat": now.Add(-time.Minute).Unix(),
		"exp": now.Add(9 * time.Minute).Unix(),
		"iss": a.appID,
	})
	unsigned := base64.RawURLEncoding.EncodeToString(header) + "." +
		base64.RawURLEncoding.EncodeToString(claims)
	digest := sha256.Sum256([]byte(unsigned))
	signature, err := rsa.SignPKCS1v15(rand.Reader, a.privateKey, crypto.SHA256, digest[:])
	if err != nil {
		return "", repository.ErrStorageUnavailable
	}
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}

func parseRSAPrivateKey(value []byte) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode(value)
	if block == nil {
		return nil, errors.New("invalid_github_app_private_key")
	}
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, nil
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, errors.New("invalid_github_app_private_key")
	}
	key, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("invalid_github_app_private_key")
	}
	return key, nil
}
