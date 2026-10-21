package operatorauth

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"net/url"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/model/operatorlogin"
	"github.com/peers-labs/peers-touch/x-config/internal/domain/operator"
	"google.golang.org/protobuf/proto"
)

const (
	assertionDomain        = "peers-touch/operator-login/v1\x00"
	assertionSchema        = uint32(1)
	maxAssertionLifetime   = 2 * time.Minute
	defaultAttemptLifetime = 10 * time.Minute
	defaultSessionLifetime = time.Hour
	clockSkew              = time.Minute
)

type Clock interface {
	Now() time.Time
}

type RealClock struct{}

func (RealClock) Now() time.Time { return time.Now().UTC() }

type RedeemRequest struct {
	SiteID           string
	Audience         string
	HandoffCode      string
	ReceiverVerifier []byte
}

type HandoffRedeemer interface {
	Redeem(
		ctx context.Context,
		request RedeemRequest,
	) (*operatorlogin.SignedOperatorLoginAssertion, error)
}

type Config struct {
	SiteID          string
	Audience        string
	BrokerStartURL  string
	CallbackURL     string
	ConsoleURL      string
	Provider        string
	SigningKeys     map[string]ed25519.PublicKey
	AllowedSubjects map[string]struct{}
	AttemptLifetime time.Duration
	SessionLifetime time.Duration
}

type Service struct {
	Config   Config
	Store    operator.Store
	Redeemer HandoffRedeemer
	Clock    Clock
	Random   io.Reader
}

type StartResult struct {
	AuthorizeURL         string
	AttemptID            string
	ExpiresAt            time.Time
	AttemptStoreDuration time.Duration
}

type CompleteResult struct {
	RedirectURL           string
	SessionToken          string
	CSRFToken             string
	ExpiresAt             time.Time
	Provider              string
	Subject               string
	AttemptReadDuration   time.Duration
	RedeemDuration        time.Duration
	SessionCommitDuration time.Duration
}

func (s Service) Start(ctx context.Context) (*StartResult, error) {
	if err := validateConfig(s.Config); err != nil ||
		s.Store == nil ||
		s.Clock == nil {
		return nil, operator.ErrUnavailable
	}
	attemptID, err := s.randomToken(24)
	if err != nil {
		return nil, operator.ErrUnavailable
	}
	receiverVerifier, err := s.randomBytes(32)
	if err != nil {
		return nil, operator.ErrUnavailable
	}
	now := s.Clock.Now().UTC()
	expiresAt := now.Add(durationOrDefault(
		s.Config.AttemptLifetime,
		defaultAttemptLifetime,
	))
	attemptStoreStartedAt := time.Now()
	if err := s.Store.CreateAttempt(ctx, operator.LoginAttempt{
		SchemaVersion:    1,
		AttemptID:        attemptID,
		ReceiverVerifier: receiverVerifier,
		CreatedAt:        now,
		ExpiresAt:        expiresAt,
	}); err != nil {
		return nil, err
	}
	challenge := sha256.Sum256(receiverVerifier)
	returnTo, err := addQuery(s.Config.CallbackURL, map[string]string{
		"login_attempt_id": attemptID,
		"receiver_challenge": base64.RawURLEncoding.EncodeToString(
			challenge[:],
		),
	})
	if err != nil {
		return nil, operator.ErrUnavailable
	}
	authorizeURL, err := addQuery(s.Config.BrokerStartURL, map[string]string{
		"site_id":   s.Config.SiteID,
		"return_to": returnTo,
	})
	if err != nil {
		return nil, operator.ErrUnavailable
	}
	return &StartResult{
		AuthorizeURL:         authorizeURL,
		AttemptID:            attemptID,
		ExpiresAt:            expiresAt,
		AttemptStoreDuration: time.Since(attemptStoreStartedAt),
	}, nil
}

func (s Service) Complete(
	ctx context.Context,
	attemptCookie string,
	attemptID string,
	handoffCode string,
) (*CompleteResult, error) {
	if s.Redeemer == nil ||
		attemptCookie == "" ||
		attemptCookie != attemptID ||
		strings.TrimSpace(handoffCode) == "" {
		return nil, operator.ErrAttemptNotFound
	}
	attemptReadStartedAt := time.Now()
	attempt, err := s.Store.FindAttempt(
		ctx,
		attemptID,
		s.Clock.Now().UTC(),
	)
	if err != nil {
		return nil, err
	}
	attemptReadDuration := time.Since(attemptReadStartedAt)
	redeemStartedAt := time.Now()
	assertion, err := s.Redeemer.Redeem(ctx, RedeemRequest{
		SiteID:           s.Config.SiteID,
		Audience:         s.Config.Audience,
		HandoffCode:      handoffCode,
		ReceiverVerifier: append([]byte(nil), attempt.ReceiverVerifier...),
	})
	if err != nil {
		return nil, err
	}
	redeemDuration := time.Since(redeemStartedAt)
	now := s.Clock.Now().UTC()
	verified, assertionBytes, err := s.verifyAssertion(
		assertion,
		attempt.ReceiverVerifier,
		now,
	)
	if err != nil {
		return nil, err
	}
	if _, ok := s.Config.AllowedSubjects[subjectKey(verified.GetProvider(), verified.GetProviderSubject())]; !ok {
		return nil, operator.ErrUnauthorizedSubject
	}
	sessionToken, err := s.randomToken(32)
	if err != nil {
		return nil, operator.ErrUnavailable
	}
	csrfToken, err := s.randomToken(32)
	if err != nil {
		return nil, operator.ErrUnavailable
	}
	sessionID, err := s.randomToken(16)
	if err != nil {
		return nil, operator.ErrUnavailable
	}
	tokenDigest := sha256.Sum256([]byte(sessionToken))
	csrfDigest := sha256.Sum256([]byte(csrfToken))
	assertionDigest := sha256.Sum256(assertionBytes)
	expiresAt := now.Add(durationOrDefault(
		s.Config.SessionLifetime,
		defaultSessionLifetime,
	))
	if expiresAt.Sub(now) > defaultSessionLifetime {
		return nil, operator.ErrUnavailable
	}
	sessionCommitStartedAt := time.Now()
	if err := s.Store.CompleteLogin(
		ctx,
		attemptID,
		assertionDigest[:],
		operator.Session{
			SchemaVersion:   1,
			SessionID:       sessionID,
			TokenDigest:     tokenDigest[:],
			CSRFDigest:      csrfDigest[:],
			Provider:        verified.GetProvider(),
			ProviderSubject: verified.GetProviderSubject(),
			AssertionID:     verified.GetAssertionId(),
			IssuedAt:        now,
			ExpiresAt:       expiresAt,
		},
	); err != nil {
		return nil, err
	}
	return &CompleteResult{
		RedirectURL:           s.Config.ConsoleURL,
		SessionToken:          sessionToken,
		CSRFToken:             csrfToken,
		ExpiresAt:             expiresAt,
		Provider:              verified.GetProvider(),
		Subject:               verified.GetProviderSubject(),
		AttemptReadDuration:   attemptReadDuration,
		RedeemDuration:        redeemDuration,
		SessionCommitDuration: time.Since(sessionCommitStartedAt),
	}, nil
}

func (s Service) Authenticate(
	ctx context.Context,
	sessionToken string,
	csrfToken string,
	requireCSRF bool,
) (*operator.Session, error) {
	if sessionToken == "" {
		return nil, operator.ErrSessionNotFound
	}
	tokenDigest := sha256.Sum256([]byte(sessionToken))
	session, err := s.Store.FindSession(
		ctx,
		tokenDigest[:],
		s.Clock.Now().UTC(),
	)
	if err != nil {
		return nil, err
	}
	if requireCSRF {
		csrfDigest := sha256.Sum256([]byte(csrfToken))
		if !bytes.Equal(csrfDigest[:], session.CSRFDigest) {
			return nil, operator.ErrCSRFInvalid
		}
	}
	return session, nil
}

func (s Service) Revoke(
	ctx context.Context,
	sessionToken string,
	csrfToken string,
) error {
	if _, err := s.Authenticate(
		ctx,
		sessionToken,
		csrfToken,
		true,
	); err != nil {
		return err
	}
	digest := sha256.Sum256([]byte(sessionToken))
	return s.Store.RevokeSession(ctx, digest[:], s.Clock.Now().UTC())
}

func (s Service) verifyAssertion(
	assertion *operatorlogin.SignedOperatorLoginAssertion,
	receiverVerifier []byte,
	now time.Time,
) (*operatorlogin.OperatorLoginAssertionStatement, []byte, error) {
	if assertion == nil {
		return nil, nil, operator.ErrCorrupt
	}
	key := s.Config.SigningKeys[assertion.GetSigningKeyId()]
	if len(key) != ed25519.PublicKeySize {
		return nil, nil, operator.ErrCorrupt
	}
	statement := &operatorlogin.OperatorLoginAssertionStatement{}
	if err := proto.Unmarshal(assertion.GetStatementBytes(), statement); err != nil {
		return nil, nil, operator.ErrCorrupt
	}
	canonicalStatement, err := (proto.MarshalOptions{Deterministic: true}).Marshal(
		statement,
	)
	if err != nil ||
		!bytes.Equal(canonicalStatement, assertion.GetStatementBytes()) {
		return nil, nil, operator.ErrCorrupt
	}
	receiverChallenge := sha256.Sum256(receiverVerifier)
	issuedAt := time.UnixMilli(statement.GetIssuedAtUnixMs()).UTC()
	expiresAt := time.UnixMilli(statement.GetExpiresAtUnixMs()).UTC()
	if statement.GetSchemaVersion() != assertionSchema ||
		statement.GetPurpose() !=
			operatorlogin.OperatorLoginPurpose_OPERATOR_LOGIN_PURPOSE_OPERATOR_LOGIN ||
		statement.GetAudience() != s.Config.Audience ||
		statement.GetSiteId() != s.Config.SiteID ||
		statement.GetAssertionId() == "" ||
		len(statement.GetAssertionId()) > 128 ||
		statement.GetProvider() == "" ||
		statement.GetProviderSubject() == "" ||
		!bytes.Equal(statement.GetReceiverChallenge(), receiverChallenge[:]) ||
		issuedAt.After(now.Add(clockSkew)) ||
		!expiresAt.After(now) ||
		!expiresAt.After(issuedAt) ||
		expiresAt.Sub(issuedAt) > maxAssertionLifetime {
		return nil, nil, operator.ErrCorrupt
	}
	signed := append(
		[]byte(assertionDomain),
		assertion.GetStatementBytes()...,
	)
	if !ed25519.Verify(key, signed, assertion.GetEd25519Signature()) {
		return nil, nil, operator.ErrCorrupt
	}
	assertionBytes, err := (proto.MarshalOptions{Deterministic: true}).Marshal(
		assertion,
	)
	if err != nil {
		return nil, nil, operator.ErrCorrupt
	}
	return statement, assertionBytes, nil
}

func (s Service) randomToken(size int) (string, error) {
	value, err := s.randomBytes(size)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func (s Service) randomBytes(size int) ([]byte, error) {
	random := s.Random
	if random == nil {
		random = rand.Reader
	}
	value := make([]byte, size)
	if _, err := io.ReadFull(random, value); err != nil {
		return nil, err
	}
	return value, nil
}

func validateConfig(config Config) error {
	if config.SiteID == "" ||
		config.Audience == "" ||
		config.Provider == "" ||
		len(config.SigningKeys) == 0 ||
		len(config.AllowedSubjects) == 0 {
		return errors.New("invalid_operator_auth_config")
	}
	for _, raw := range []string{
		config.BrokerStartURL,
		config.CallbackURL,
		config.ConsoleURL,
	} {
		parsed, err := url.Parse(raw)
		if err != nil ||
			parsed.Scheme != "https" ||
			parsed.Host == "" ||
			parsed.User != nil ||
			parsed.Fragment != "" {
			return errors.New("invalid_operator_auth_config")
		}
	}
	return nil
}

func subjectKey(provider string, subject string) string {
	return strings.TrimSpace(provider) + "\x00" + strings.TrimSpace(subject)
}

func durationOrDefault(value time.Duration, fallback time.Duration) time.Duration {
	if value <= 0 {
		return fallback
	}
	return value
}

func addQuery(raw string, values map[string]string) (string, error) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	query := parsed.Query()
	for key, value := range values {
		query.Set(key, value)
	}
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}
