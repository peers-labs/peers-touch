package usecase

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/url"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/repository"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/persistence/memory"
	"github.com/peers-labs/peers-touch/oauth2-client/model/operatorlogin"
	"google.golang.org/protobuf/proto"
)

func TestOperatorLoginHandoffIsAudienceReceiverAndReplayBound(t *testing.T) {
	now := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)
	receiverVerifier := bytes.Repeat([]byte{0x42}, 32)
	receiverChallenge := sha256.Sum256(receiverVerifier)
	callbackURL := "https://control.example.test/api/auth/callback"
	returnTo, err := appendQuery(callbackURL, map[string]string{
		"receiver_challenge": base64.RawURLEncoding.EncodeToString(
			receiverChallenge[:],
		),
		"login_attempt_id": "attempt-123456789",
	})
	if err != nil {
		t.Fatal(err)
	}
	privateKey := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x11}, 32))
	config := &OperatorLoginSiteConfig{
		Audience:          "x-config-admin",
		CallbackURL:       callbackURL,
		SigningKeyID:      "operator-login-2026-01",
		SigningPrivateKey: privateKey,
		RedeemSecret:      bytes.Repeat([]byte{0x22}, 32),
	}
	store := memory.NewStore()
	service := OperatorLoginService{
		Store:         store,
		Fingerprinter: deterministicFingerprinter{},
		Clock:         fixedClock{now: now},
		Random:        bytes.NewReader(bytes.Repeat([]byte{0x33}, 32)),
	}
	session := &entity.AuthSession{
		State:     "oauth-state",
		SiteID:    "x-config",
		Provider:  valueobject.ProviderGitHub,
		ReturnTo:  returnTo,
		CreatedAt: now.Add(-time.Minute),
		ExpiresAt: now.Add(time.Minute),
	}
	identity := &entity.OAuthIdentity{
		Provider:       valueobject.ProviderGitHub,
		ProviderUserID: "github-subject-42",
	}
	code, attemptID, err := service.Issue(
		context.Background(),
		config,
		session,
		identity,
	)
	if err != nil {
		t.Fatalf("issue operator handoff: %v", err)
	}
	if code == "" || attemptID != "attempt-123456789" {
		t.Fatalf("unexpected handoff output: code=%q attempt=%q", code, attemptID)
	}

	_, err = service.Redeem(
		context.Background(),
		config,
		RedeemOperatorLoginInput{
			SiteID:           "x-config",
			Audience:         "different-audience",
			HandoffCode:      code,
			ReceiverVerifier: receiverVerifier,
		},
	)
	if !errors.Is(err, repository.ErrOperatorHandoffBinding) {
		t.Fatalf("cross-audience replay was not rejected: %v", err)
	}
	assertion, err := service.Redeem(
		context.Background(),
		config,
		RedeemOperatorLoginInput{
			SiteID:           "x-config",
			Audience:         config.Audience,
			HandoffCode:      code,
			ReceiverVerifier: receiverVerifier,
		},
	)
	if err != nil {
		t.Fatalf("redeem operator handoff: %v", err)
	}
	statement := &operatorlogin.OperatorLoginAssertionStatement{}
	if err := proto.Unmarshal(assertion.GetStatementBytes(), statement); err != nil {
		t.Fatalf("decode assertion statement: %v", err)
	}
	if canonical, _ := (proto.MarshalOptions{Deterministic: true}).Marshal(statement); !bytes.Equal(
		canonical,
		assertion.GetStatementBytes(),
	) {
		t.Fatal("operator assertion statement was not canonical")
	}
	if statement.GetPurpose() !=
		operatorlogin.OperatorLoginPurpose_OPERATOR_LOGIN_PURPOSE_OPERATOR_LOGIN ||
		statement.GetAudience() != config.Audience ||
		statement.GetProviderSubject() != identity.ProviderUserID ||
		!bytes.Equal(statement.GetReceiverChallenge(), receiverChallenge[:]) {
		t.Fatalf("unexpected operator assertion statement: %+v", statement)
	}
	signed := append(
		[]byte(operatorAssertionDomain),
		assertion.GetStatementBytes()...,
	)
	if !ed25519.Verify(
		privateKey.Public().(ed25519.PublicKey),
		signed,
		assertion.GetEd25519Signature(),
	) {
		t.Fatal("operator assertion signature is invalid")
	}
	_, err = service.Redeem(
		context.Background(),
		config,
		RedeemOperatorLoginInput{
			SiteID:           "x-config",
			Audience:         config.Audience,
			HandoffCode:      code,
			ReceiverVerifier: receiverVerifier,
		},
	)
	if !errors.Is(err, repository.ErrOperatorHandoffConsumed) {
		t.Fatalf("operator handoff replay was not rejected: %v", err)
	}
}

func TestSanitizeOperatorReturnToRequiresExactCallbackAndBinding(t *testing.T) {
	challenge := base64.RawURLEncoding.EncodeToString(
		bytes.Repeat([]byte{0x44}, sha256.Size),
	)
	valid := "https://control.example.test/api/auth/callback" +
		"?login_attempt_id=attempt-123456789" +
		"&receiver_challenge=" + url.QueryEscape(challenge)
	if got := sanitizeOperatorReturnTo(
		valid,
		"https://control.example.test/api/auth/callback",
	); got == "" {
		t.Fatal("exact operator callback was rejected")
	}
	for _, candidate := range []string{
		"https://other.example.test/api/auth/callback?login_attempt_id=attempt-123456789&receiver_challenge=" + challenge,
		"https://control.example.test/api/auth/callback?login_attempt_id=short&receiver_challenge=" + challenge,
		"https://control.example.test/api/auth/callback?login_attempt_id=attempt-123456789&receiver_challenge=" + challenge + "&audience=override",
	} {
		if got := sanitizeOperatorReturnTo(
			candidate,
			"https://control.example.test/api/auth/callback",
		); got != "" {
			t.Fatalf("unsafe operator callback was accepted: %s", got)
		}
	}
}

type deterministicFingerprinter struct{}

func (deterministicFingerprinter) Fingerprint(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}
