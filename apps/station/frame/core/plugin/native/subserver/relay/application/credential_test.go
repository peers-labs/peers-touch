package application

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
)

func TestNodeCredentialUsesRelayEdDSAClaims(t *testing.T) {
	authority, err := NewCredentialAuthority(
		[]byte("relay-host-material-for-credential-test"),
	)
	if err != nil {
		t.Fatalf("create credential authority: %v", err)
	}
	enrollment := &domain.Enrollment{
		ID:            42,
		StationPeerID: "station-peer",
		Generation:    7,
	}
	credential, err := authority.IssueNodeCredential(enrollment, "credential-jti")
	if err != nil {
		t.Fatalf("issue enrollment credential: %v", err)
	}

	claims := &credentialClaims{}
	token, _, err := jwt.NewParser().ParseUnverified(
		credential.Token,
		claims,
	)
	if err != nil {
		t.Fatalf("parse enrollment credential: %v", err)
	}
	if token.Method.Alg() != jwt.SigningMethodEdDSA.Alg() {
		t.Fatalf("algorithm = %q, want EdDSA", token.Method.Alg())
	}
	if claims.Issuer != authority.RelayPeerID() {
		t.Fatalf("issuer = %q, want %q", claims.Issuer, authority.RelayPeerID())
	}
	if len(claims.Audience) != 1 ||
		claims.Audience[0] != domain.NodeCredentialAudience {
		t.Fatalf("audience = %v", claims.Audience)
	}
	if claims.ID != "credential-jti" ||
		claims.StationPeerID != enrollment.StationPeerID ||
		claims.EnrollmentID != enrollment.ID ||
		claims.Generation != enrollment.Generation {
		t.Fatalf("enrollment claims were not preserved: %+v", claims)
	}
	for _, required := range []string{
		domain.ScopeNodeRotate,
		domain.ScopeRoutePublish,
	} {
		if !containsScope(claims.Scopes, required) {
			t.Fatalf("scope %q missing from %v", required, claims.Scopes)
		}
	}

	identity, err := authority.ValidateCredential(
		credential.Token,
		domain.NodeCredentialAudience,
		domain.ScopeNodeRotate,
	)
	if err != nil {
		t.Fatalf("validate enrollment credential: %v", err)
	}
	if identity.JTI != "credential-jti" ||
		!identity.ExpiresAt.After(time.Now()) {
		t.Fatalf("unexpected validated identity: %+v", identity)
	}
	if _, err := authority.ValidateCredential(
		credential.Token,
		domain.NodeCredentialAudience,
		"relay.unknown",
	); err == nil {
		t.Fatal("enrollment credential was accepted for an unknown scope")
	}
}

func TestInviteDigestIsKeyedAndDoesNotEqualSecret(t *testing.T) {
	first, err := NewCredentialAuthority([]byte("first-relay-host-material-32-bytes"))
	if err != nil {
		t.Fatalf("create first authority: %v", err)
	}
	second, err := NewCredentialAuthority([]byte("second-relay-host-material-32-bytes"))
	if err != nil {
		t.Fatalf("create second authority: %v", err)
	}
	secret := "sensitive-one-time-invite"
	firstDigest := first.DigestInvite(secret)
	secondDigest := second.DigestInvite(secret)
	if firstDigest == secret {
		t.Fatal("invite secret was persisted without hashing")
	}
	if firstDigest == secondDigest {
		t.Fatal("invite digest is not bound to the Relay issuer")
	}
}
