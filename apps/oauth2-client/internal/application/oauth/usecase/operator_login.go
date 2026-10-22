package usecase

import (
	"context"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/port"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/repository"
	"github.com/peers-labs/peers-touch/oauth2-client/model/operatorlogin"
	"google.golang.org/protobuf/proto"
)

const (
	operatorAssertionSchemaVersion = uint32(1)
	operatorHandoffLifetime        = 2 * time.Minute
	operatorAssertionDomain        = "peers-touch/operator-login/v1\x00"
)

var operatorAttemptIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{16,128}$`)

type OperatorLoginService struct {
	Store         repository.OAuthStore
	Fingerprinter port.SecretFingerprinter
	Clock         Clock
	Random        io.Reader
}

type RedeemOperatorLoginInput struct {
	SiteID           string
	Audience         string
	HandoffCode      string
	ReceiverVerifier []byte
}

func (s OperatorLoginService) Issue(
	ctx context.Context,
	config *OperatorLoginSiteConfig,
	session *entity.AuthSession,
	identity *entity.OAuthIdentity,
) (string, string, error) {
	if config == nil ||
		session == nil ||
		identity == nil ||
		s.Store == nil ||
		s.Fingerprinter == nil ||
		s.Clock == nil {
		return "", "", errors.New("operator_login_unavailable")
	}
	receiverChallenge, loginAttemptID, err := operatorReceiverBinding(
		session.ReturnTo,
		config.CallbackURL,
	)
	if err != nil {
		return "", "", err
	}
	random := s.Random
	if random == nil {
		random = rand.Reader
	}
	codeBytes := make([]byte, 32)
	if _, err := io.ReadFull(random, codeBytes); err != nil {
		return "", "", errors.New("operator_login_unavailable")
	}
	code := base64.RawURLEncoding.EncodeToString(codeBytes)
	now := s.Clock.Now().UTC()
	handoff := entity.OperatorLoginHandoff{
		SchemaVersion:     1,
		CodeFingerprint:   s.Fingerprinter.Fingerprint("operator-handoff\x00" + code),
		AssertionID:       s.Fingerprinter.Fingerprint("operator-assertion\x00" + session.State),
		SiteID:            session.SiteID,
		Audience:          config.Audience,
		LoginAttemptID:    loginAttemptID,
		Provider:          identity.Provider,
		ProviderSubject:   identity.ProviderUserID,
		ReceiverChallenge: receiverChallenge,
		CreatedAt:         now,
		ExpiresAt:         now.Add(operatorHandoffLifetime),
	}
	if err := s.Store.CreateOperatorLoginHandoff(ctx, handoff); err != nil {
		return "", "", err
	}
	return code, loginAttemptID, nil
}

func (s OperatorLoginService) Redeem(
	ctx context.Context,
	config *OperatorLoginSiteConfig,
	input RedeemOperatorLoginInput,
) (*operatorlogin.SignedOperatorLoginAssertion, error) {
	if config == nil ||
		s.Store == nil ||
		s.Fingerprinter == nil ||
		s.Clock == nil ||
		input.SiteID != configSiteID(input.SiteID) ||
		input.Audience != config.Audience ||
		len(input.ReceiverVerifier) < 32 ||
		len(input.ReceiverVerifier) > 128 ||
		strings.TrimSpace(input.HandoffCode) == "" {
		return nil, repository.ErrOperatorHandoffBinding
	}
	now := s.Clock.Now().UTC()
	receiverChallenge := sha256.Sum256(input.ReceiverVerifier)
	handoff, err := s.Store.ConsumeOperatorLoginHandoff(
		ctx,
		s.Fingerprinter.Fingerprint(
			"operator-handoff\x00"+input.HandoffCode,
		),
		input.SiteID,
		input.Audience,
		receiverChallenge[:],
		now,
	)
	if err != nil {
		return nil, err
	}
	if handoff.ProviderSubject == "" ||
		handoff.AssertionID == "" ||
		len(config.SigningPrivateKey) != ed25519.PrivateKeySize ||
		strings.TrimSpace(config.SigningKeyID) == "" {
		return nil, errors.New("operator_login_unavailable")
	}
	expiresAt := now.Add(operatorHandoffLifetime)
	if handoff.ExpiresAt.Before(expiresAt) {
		expiresAt = handoff.ExpiresAt
	}
	statement := &operatorlogin.OperatorLoginAssertionStatement{
		SchemaVersion:     operatorAssertionSchemaVersion,
		Purpose:           operatorlogin.OperatorLoginPurpose_OPERATOR_LOGIN_PURPOSE_OPERATOR_LOGIN,
		Audience:          handoff.Audience,
		SiteId:            handoff.SiteID,
		AssertionId:       handoff.AssertionID,
		Provider:          string(handoff.Provider),
		ProviderSubject:   handoff.ProviderSubject,
		ReceiverChallenge: append([]byte(nil), handoff.ReceiverChallenge...),
		IssuedAtUnixMs:    now.UnixMilli(),
		ExpiresAtUnixMs:   expiresAt.UnixMilli(),
	}
	statementBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(statement)
	if err != nil {
		return nil, errors.New("operator_login_unavailable")
	}
	signed := make([]byte, 0, len(operatorAssertionDomain)+len(statementBytes))
	signed = append(signed, operatorAssertionDomain...)
	signed = append(signed, statementBytes...)
	return &operatorlogin.SignedOperatorLoginAssertion{
		SigningKeyId:     config.SigningKeyID,
		StatementBytes:   statementBytes,
		Ed25519Signature: ed25519.Sign(config.SigningPrivateKey, signed),
	}, nil
}

func AuthenticateOperatorSite(config *OperatorLoginSiteConfig, secret []byte) bool {
	return config != nil &&
		len(config.RedeemSecret) >= 32 &&
		len(secret) == len(config.RedeemSecret) &&
		hmac.Equal(secret, config.RedeemSecret)
}

func operatorReceiverBinding(
	returnTo string,
	callbackURL string,
) ([]byte, string, error) {
	target, err := url.Parse(returnTo)
	if err != nil {
		return nil, "", repository.ErrOperatorHandoffBinding
	}
	callback, err := url.Parse(callbackURL)
	if err != nil ||
		target.Scheme != callback.Scheme ||
		target.Host != callback.Host ||
		target.EscapedPath() != callback.EscapedPath() ||
		target.Fragment != "" {
		return nil, "", repository.ErrOperatorHandoffBinding
	}
	query := target.Query()
	if len(query) != 2 ||
		len(query["receiver_challenge"]) != 1 ||
		len(query["login_attempt_id"]) != 1 {
		return nil, "", repository.ErrOperatorHandoffBinding
	}
	challenge, err := base64.RawURLEncoding.DecodeString(
		query.Get("receiver_challenge"),
	)
	if err != nil || len(challenge) != sha256.Size {
		return nil, "", repository.ErrOperatorHandoffBinding
	}
	attemptID := query.Get("login_attempt_id")
	if !operatorAttemptIDPattern.MatchString(attemptID) {
		return nil, "", repository.ErrOperatorHandoffBinding
	}
	return challenge, attemptID, nil
}

func configSiteID(value string) string {
	return strings.TrimSpace(value)
}
