package operatorauth

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"errors"
	"net/url"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/model/operatorlogin"
	"github.com/peers-labs/peers-touch/x-config/internal/domain/operator"
	"github.com/peers-labs/peers-touch/x-config/internal/infrastructure/operatorstore"
	"google.golang.org/protobuf/proto"
)

func TestOperatorLoginCreatesCSRFBoundRevocableSession(t *testing.T) {
	now := time.Date(2026, 10, 18, 16, 0, 0, 0, time.UTC)
	privateKey := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x11}, 32))
	redeemer := &signingRedeemer{
		privateKey: privateKey,
		keyID:      "operator-login-1",
		now:        now,
		provider:   "github",
		subject:    "subject-42",
	}
	service := Service{
		Config: Config{
			SiteID:         "x-config",
			Audience:       "x-config-admin",
			BrokerStartURL: "https://oauth.example.test/api/oauth/github/start",
			CallbackURL:    "https://control.example.test/api/admin/auth/callback",
			ConsoleURL:     "https://control.example.test/",
			Provider:       "github",
			SigningKeys: map[string]ed25519.PublicKey{
				redeemer.keyID: privateKey.Public().(ed25519.PublicKey),
			},
			AllowedSubjects: map[string]struct{}{
				subjectKey("github", "subject-42"): {},
			},
		},
		Store:    operatorstore.NewMemoryStore(),
		Redeemer: redeemer,
		Clock:    fixedClock{now: now},
		Random:   bytes.NewReader(bytes.Repeat([]byte{0x33}, 256)),
	}

	started, err := service.Start(context.Background())
	if err != nil {
		t.Fatalf("start operator login: %v", err)
	}
	authorizeURL, err := url.Parse(started.AuthorizeURL)
	if err != nil {
		t.Fatalf("parse authorize URL: %v", err)
	}
	if authorizeURL.Query().Get("site_id") != service.Config.SiteID {
		t.Fatalf("operator site not bound: %s", started.AuthorizeURL)
	}
	returnTo, err := url.Parse(authorizeURL.Query().Get("return_to"))
	if err != nil {
		t.Fatalf("parse return URL: %v", err)
	}
	if returnTo.Query().Get("login_attempt_id") != started.AttemptID ||
		returnTo.Query().Get("receiver_challenge") == "" {
		t.Fatalf("receiver binding missing: %s", returnTo.String())
	}

	if _, err := service.Complete(
		context.Background(),
		"wrong-cookie",
		started.AttemptID,
		"one-use-code",
	); !errors.Is(err, operator.ErrAttemptNotFound) {
		t.Fatalf("cross-browser callback was accepted: %v", err)
	}
	completed, err := service.Complete(
		context.Background(),
		started.AttemptID,
		started.AttemptID,
		"one-use-code",
	)
	if err != nil {
		t.Fatalf("complete operator login: %v", err)
	}
	if completed.Provider != "github" ||
		completed.Subject != "subject-42" ||
		completed.RedirectURL != service.Config.ConsoleURL {
		t.Fatalf("unexpected completion: %+v", completed)
	}
	if _, err := service.Authenticate(
		context.Background(),
		completed.SessionToken,
		"wrong-csrf",
		true,
	); !errors.Is(err, operator.ErrCSRFInvalid) {
		t.Fatalf("wrong CSRF was accepted: %v", err)
	}
	if _, err := service.Authenticate(
		context.Background(),
		completed.SessionToken,
		completed.CSRFToken,
		true,
	); err != nil {
		t.Fatalf("authenticate operator session: %v", err)
	}
	if err := service.Revoke(
		context.Background(),
		completed.SessionToken,
		completed.CSRFToken,
	); err != nil {
		t.Fatalf("revoke operator session: %v", err)
	}
	if _, err := service.Authenticate(
		context.Background(),
		completed.SessionToken,
		"",
		false,
	); !errors.Is(err, operator.ErrSessionRevoked) {
		t.Fatalf("revoked session remained active: %v", err)
	}
	if _, err := service.Complete(
		context.Background(),
		started.AttemptID,
		started.AttemptID,
		"one-use-code",
	); !errors.Is(err, operator.ErrAttemptConsumed) {
		t.Fatalf("login callback replay was not rejected: %v", err)
	}
}

func TestOperatorAssertionRejectsWrongAudienceAndUnauthorizedSubject(t *testing.T) {
	now := time.Date(2026, 10, 18, 16, 0, 0, 0, time.UTC)
	privateKey := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x22}, 32))
	service := Service{
		Config: Config{
			SiteID:         "x-config",
			Audience:       "x-config-admin",
			BrokerStartURL: "https://oauth.example.test/api/oauth/github/start",
			CallbackURL:    "https://control.example.test/api/admin/auth/callback",
			ConsoleURL:     "https://control.example.test/",
			Provider:       "github",
			SigningKeys: map[string]ed25519.PublicKey{
				"operator-login-1": privateKey.Public().(ed25519.PublicKey),
			},
			AllowedSubjects: map[string]struct{}{
				subjectKey("github", "allowed"): {},
			},
		},
		Store: operatorstore.NewMemoryStore(),
		Redeemer: &signingRedeemer{
			privateKey: privateKey,
			keyID:      "operator-login-1",
			now:        now,
			audience:   "wrong-audience",
			provider:   "github",
			subject:    "allowed",
		},
		Clock:  fixedClock{now: now},
		Random: bytes.NewReader(bytes.Repeat([]byte{0x44}, 256)),
	}
	started, err := service.Start(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Complete(
		context.Background(),
		started.AttemptID,
		started.AttemptID,
		"wrong-audience-code",
	); !errors.Is(err, operator.ErrCorrupt) {
		t.Fatalf("wrong audience assertion was accepted: %v", err)
	}

	service.Store = operatorstore.NewMemoryStore()
	service.Redeemer = &signingRedeemer{
		privateKey: privateKey,
		keyID:      "operator-login-1",
		now:        now,
		provider:   "github",
		subject:    "not-allowed",
	}
	service.Random = bytes.NewReader(bytes.Repeat([]byte{0x55}, 256))
	started, err = service.Start(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Complete(
		context.Background(),
		started.AttemptID,
		started.AttemptID,
		"unauthorized-subject-code",
	); !errors.Is(err, operator.ErrUnauthorizedSubject) {
		t.Fatalf("unauthorized provider subject was accepted: %v", err)
	}
}

func TestOperatorRedeemFailureDoesNotConsumeAttempt(t *testing.T) {
	now := time.Date(2026, 10, 20, 16, 0, 0, 0, time.UTC)
	privateKey := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x27}, 32))
	store := operatorstore.NewMemoryStore()
	service := Service{
		Config: Config{
			SiteID:         "x-config",
			Audience:       "x-config-admin",
			BrokerStartURL: "https://oauth.example.test/api/oauth/github/start",
			CallbackURL:    "https://control.example.test/api/admin/auth/callback",
			ConsoleURL:     "https://control.example.test/",
			Provider:       "github",
			SigningKeys: map[string]ed25519.PublicKey{
				"operator-login-1": privateKey.Public().(ed25519.PublicKey),
			},
			AllowedSubjects: map[string]struct{}{
				subjectKey("github", "subject-42"): {},
			},
		},
		Store:    store,
		Redeemer: errorRedeemer{},
		Clock:    fixedClock{now: now},
		Random:   bytes.NewReader(bytes.Repeat([]byte{0x28}, 512)),
	}
	started, err := service.Start(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Complete(
		context.Background(),
		started.AttemptID,
		started.AttemptID,
		"transient-code",
	); err == nil {
		t.Fatal("redeem failure was accepted")
	}
	if _, err := store.FindAttempt(
		context.Background(),
		started.AttemptID,
		now,
	); err != nil {
		t.Fatalf("redeem failure consumed attempt: %v", err)
	}
	service.Redeemer = &signingRedeemer{
		privateKey: privateKey,
		keyID:      "operator-login-1",
		now:        now,
		provider:   "github",
		subject:    "subject-42",
	}
	if _, err := service.Complete(
		context.Background(),
		started.AttemptID,
		started.AttemptID,
		"retry-code",
	); err != nil {
		t.Fatalf("retry after redeem failure was rejected: %v", err)
	}
}

type fixedClock struct {
	now time.Time
}

func (c fixedClock) Now() time.Time {
	return c.now
}

type signingRedeemer struct {
	privateKey ed25519.PrivateKey
	keyID      string
	now        time.Time
	audience   string
	provider   string
	subject    string
}

type errorRedeemer struct{}

func (errorRedeemer) Redeem(
	context.Context,
	RedeemRequest,
) (*operatorlogin.SignedOperatorLoginAssertion, error) {
	return nil, errors.New("oauth_redeem_unavailable")
}

func (r *signingRedeemer) Redeem(
	_ context.Context,
	request RedeemRequest,
) (*operatorlogin.SignedOperatorLoginAssertion, error) {
	audience := r.audience
	if audience == "" {
		audience = request.Audience
	}
	challenge := sha256.Sum256(request.ReceiverVerifier)
	statement := &operatorlogin.OperatorLoginAssertionStatement{
		SchemaVersion:     assertionSchema,
		Purpose:           operatorlogin.OperatorLoginPurpose_OPERATOR_LOGIN_PURPOSE_OPERATOR_LOGIN,
		Audience:          audience,
		SiteId:            request.SiteID,
		AssertionId:       "assertion-123",
		Provider:          r.provider,
		ProviderSubject:   r.subject,
		ReceiverChallenge: challenge[:],
		IssuedAtUnixMs:    r.now.UnixMilli(),
		ExpiresAtUnixMs:   r.now.Add(time.Minute).UnixMilli(),
	}
	statementBytes, _ := (proto.MarshalOptions{Deterministic: true}).Marshal(
		statement,
	)
	signed := append([]byte(assertionDomain), statementBytes...)
	return &operatorlogin.SignedOperatorLoginAssertion{
		SigningKeyId:     r.keyID,
		StatementBytes:   statementBytes,
		Ed25519Signature: ed25519.Sign(r.privateKey, signed),
	}, nil
}
