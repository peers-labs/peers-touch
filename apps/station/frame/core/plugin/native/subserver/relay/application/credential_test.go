package application

import (
	"bytes"
	"crypto/ed25519"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
)

func TestCredentialAuthorityPreservesBinaryHostKeyWhitespace(t *testing.T) {
	seed := bytes.Repeat([]byte{1}, ed25519.SeedSize)
	seed[0], seed[len(seed)-1] = '\n', ' '
	key := ed25519.NewKeyFromSeed(seed)
	for _, material := range [][]byte{seed, key} {
		authority, err := NewCredentialAuthority(material)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(authority.privateKey, key) {
			t.Fatal("binary Host key bytes were changed by text normalization")
		}
	}
}

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
		NodePeerID:    "node-peer",
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
		claims.NodePeerID != enrollment.NodePeerID ||
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
		identity.NodePeerID != enrollment.NodePeerID ||
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

func TestRotationLocatorOnlyExemptsCredentialExpiration(t *testing.T) {
	authority, err := NewCredentialAuthority([]byte("rotation-locator-test-material-32-bytes"))
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	authority.now = func() time.Time { return now.Add(-time.Hour) }
	credential, err := authority.IssueNodeCredential(&domain.Enrollment{
		ID: 42, StationPeerID: "station", NodePeerID: "node", Generation: 2,
	}, "current-jti")
	if err != nil {
		t.Fatal(err)
	}
	authority.now = func() time.Time { return now }
	if _, err := authority.ValidateCredential(credential.Token,
		domain.NodeCredentialAudience, domain.ScopeRoutePublish); err == nil {
		t.Fatal("expired token authorized transport")
	}
	if _, err := authority.ValidateRotationLocator(credential.Token); err != nil {
		t.Fatalf("expired locator rejected: %v", err)
	}
	for _, test := range []struct {
		name   string
		mutate func(*credentialClaims)
	}{
		{"missing-expiration", func(c *credentialClaims) { c.ExpiresAt = nil }},
		{"future-not-before", func(c *credentialClaims) { c.NotBefore = jwt.NewNumericDate(now.Add(time.Hour)) }},
		{"future-issued-at", func(c *credentialClaims) { c.IssuedAt = jwt.NewNumericDate(now.Add(time.Hour)) }},
		{"wrong-audience", func(c *credentialClaims) { c.Audience = jwt.ClaimStrings{"operator"} }},
		{"wrong-issuer", func(c *credentialClaims) { c.Issuer = "another-relay" }},
		{"wrong-scope", func(c *credentialClaims) { c.Scopes = []string{domain.ScopeRoutePublish} }},
		{"wrong-type", func(c *credentialClaims) { c.CredentialType = "operator" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			claims := &credentialClaims{}
			if _, _, err := jwt.NewParser().ParseUnverified(credential.Token, claims); err != nil {
				t.Fatal(err)
			}
			test.mutate(claims)
			token, err := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims).SignedString(authority.privateKey)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := authority.ValidateRotationLocator(token); err == nil {
				t.Fatal("invalid rotation locator accepted")
			}
		})
	}
	tampered := credential.Token[:len(credential.Token)-10] + "tampered00"
	if _, err := authority.ValidateRotationLocator(tampered); err == nil {
		t.Fatal("tampered locator accepted")
	}
}
