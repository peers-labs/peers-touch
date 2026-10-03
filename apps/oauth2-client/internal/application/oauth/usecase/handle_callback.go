package usecase

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/url"
	"regexp"
	"strconv"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/port"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/repository"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
)

type HandleCallbackInput struct {
	Provider      valueobject.Provider
	State         string
	Code          string
	ProviderError string
}

type HandleCallbackOutput struct {
	RedirectURL string
}

type HandleCallbackUseCase struct {
	Sites         SiteRegistry
	Store         repository.OAuthStore
	Providers     map[valueobject.Provider]port.ProviderGateway
	Fingerprinter port.SecretFingerprinter
	Clock         Clock
}

func (u HandleCallbackUseCase) Execute(ctx context.Context, input HandleCallbackInput) (*HandleCallbackOutput, error) {
	session, err := u.Store.FindAuthorization(ctx, input.State)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return nil, errors.New("invalid_state")
	}
	site, ok := u.Sites.Get(session.SiteID)
	if !ok {
		return nil, errors.New("unknown_site")
	}
	codeFingerprint := u.Fingerprinter.Fingerprint(input.Code)
	if session.Provider != input.Provider {
		return u.fail(ctx, site, session, entity.AuthorizationFailure{
			State:           input.State,
			Provider:        input.Provider,
			CodeFingerprint: codeFingerprint,
			ErrorCode:       "provider_mismatch",
			OccurredAt:      u.Clock.Now(),
		}, errors.New("provider_mismatch"))
	}
	if session.IsConsumed() {
		return u.errorOutput(site, session, "state_consumed"), errors.New("state_consumed")
	}
	if session.IsExpired(u.Clock.Now()) {
		return u.fail(ctx, site, session, entity.AuthorizationFailure{
			State:           input.State,
			Provider:        input.Provider,
			CodeFingerprint: codeFingerprint,
			ErrorCode:       "state_expired",
			OccurredAt:      u.Clock.Now(),
		}, errors.New("state_expired"))
	}
	if input.ProviderError != "" {
		providerErr := normalizeProviderCallbackError(input.ProviderError)
		return u.fail(ctx, site, session, entity.AuthorizationFailure{
			State:      input.State,
			Provider:   input.Provider,
			ErrorCode:  providerErr.Error(),
			OccurredAt: u.Clock.Now(),
			Terminal:   true,
		}, providerErr)
	}
	cfg, ok := site.Providers[input.Provider]
	if !ok {
		return u.fail(ctx, site, session, entity.AuthorizationFailure{
			State:           input.State,
			Provider:        input.Provider,
			CodeFingerprint: codeFingerprint,
			ErrorCode:       "provider_not_enabled",
			OccurredAt:      u.Clock.Now(),
		}, errors.New("provider_not_enabled"))
	}
	gw, ok := u.Providers[input.Provider]
	if !ok {
		return u.fail(ctx, site, session, entity.AuthorizationFailure{
			State:           input.State,
			Provider:        input.Provider,
			CodeFingerprint: codeFingerprint,
			ErrorCode:       "provider_gateway_missing",
			OccurredAt:      u.Clock.Now(),
		}, errors.New("provider_gateway_missing"))
	}
	grant, err := gw.ExchangeCode(ctx, input.Code, session.Verifier, cfg)
	if err != nil {
		return u.fail(ctx, site, session, entity.AuthorizationFailure{
			State:           input.State,
			Provider:        input.Provider,
			CodeFingerprint: codeFingerprint,
			ErrorCode:       PublicErrorCode(err),
			OccurredAt:      u.Clock.Now(),
		}, err)
	}
	identity, err := u.Store.CompleteAuthorization(ctx, entity.AuthorizationCompletion{
		State:           input.State,
		CompletionID:    codeFingerprint,
		CodeFingerprint: codeFingerprint,
		Identity:        grant.Identity,
		Tokens:          grant.Tokens,
		CompletedAt:     u.Clock.Now(),
	})
	if err != nil {
		return u.errorOutput(site, session, PublicErrorCode(err)), err
	}
	return u.successOutput(site, session, identity)
}

func (u HandleCallbackUseCase) successOutput(site SiteConfig, session *entity.AuthSession, identity *entity.OAuthIdentity) (*HandleCallbackOutput, error) {
	target := site.SuccessURL
	if session.ReturnTo != "" {
		target = session.ReturnTo
	}

	ts := u.Clock.Now().UTC().Format(time.RFC3339)
	receiverID := bridgeReceiverID(session.ReturnTo)
	receiverChallenge := bridgeReceiverChallenge(session.ReturnTo)

	params := map[string]string{
		"bridge_version":   "v1",
		"site_id":          session.SiteID,
		"purpose":          bridgePurpose(session.ReturnTo),
		"assertion_id":     u.Fingerprinter.Fingerprint("bridge\x00" + session.State),
		"provider":         string(session.Provider),
		"provider_user_id": identity.ProviderUserID,
		"union_id":         identity.UnionID,
		"username":         identity.Username,
		"display_name":     identity.DisplayName,
		"avatar_url":       identity.AvatarURL,
		"email_verified":   strconv.FormatBool(identity.EmailVerified),
		"ts":               ts,
	}
	if receiverID != "" {
		params["receiver_id"] = receiverID
	}
	if receiverChallenge != "" {
		params["receiver_challenge"] = receiverChallenge
	}
	if identity.EmailVerified {
		params["email"] = identity.Email
	}

	// Compute HMAC-SHA256 signature when bridge secret is configured.
	if site.BridgeSecret != "" {
		message := canonicalBridgePayload(params)
		mac := hmac.New(sha256.New, []byte(site.BridgeSecret))
		mac.Write([]byte(message))
		params["sig"] = hex.EncodeToString(mac.Sum(nil))
	}

	redirectURL, err := appendQuery(target, params)
	if err != nil {
		return nil, err
	}
	return &HandleCallbackOutput{RedirectURL: redirectURL}, nil
}

func bridgeReceiverID(returnTo string) string {
	parsed, err := url.Parse(returnTo)
	if err != nil {
		return ""
	}
	return parsed.Query().Get("session_id")
}

func bridgeReceiverChallenge(returnTo string) string {
	parsed, err := url.Parse(returnTo)
	if err != nil {
		return ""
	}
	return parsed.Query().Get("receiver_challenge")
}

func bridgePurpose(returnTo string) string {
	parsed, err := url.Parse(returnTo)
	if err == nil && parsed.Query().Get("purpose") == "connector_link" {
		return "connector_link"
	}
	return "account_login"
}

func canonicalBridgePayload(values map[string]string) string {
	canonical := url.Values{}
	for key, value := range values {
		if value != "" {
			canonical.Set(key, value)
		}
	}
	return canonical.Encode()
}

func (u HandleCallbackUseCase) fail(
	ctx context.Context,
	site SiteConfig,
	session *entity.AuthSession,
	failure entity.AuthorizationFailure,
	cause error,
) (*HandleCallbackOutput, error) {
	if err := u.Store.RecordAuthorizationFailure(ctx, failure); err != nil {
		return u.errorOutput(site, session, PublicErrorCode(err)), err
	}
	return u.errorOutput(site, session, PublicErrorCode(cause)), cause
}

func (u HandleCallbackUseCase) errorOutput(
	site SiteConfig,
	session *entity.AuthSession,
	code string,
) *HandleCallbackOutput {
	target := site.ErrorURL
	if session != nil && session.ReturnTo != "" {
		target = session.ReturnTo
	}
	redirectURL, err := appendQuery(target, map[string]string{"error": code})
	if err != nil {
		return nil
	}
	return &HandleCallbackOutput{RedirectURL: redirectURL}
}

var safeErrorCode = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)

func normalizeProviderCallbackError(code string) error {
	if code == "access_denied" {
		return errors.New("provider_access_denied")
	}
	return errors.New("provider_authorization_failed")
}

func PublicErrorCode(err error) string {
	if err == nil {
		return ""
	}
	code := err.Error()
	if safeErrorCode.MatchString(code) {
		return code
	}
	return "oauth_request_failed"
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
