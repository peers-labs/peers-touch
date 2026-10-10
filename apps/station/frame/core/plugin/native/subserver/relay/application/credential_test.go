package application

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
)

func TestMountCredentialUsesRelayEdDSAClaims(t *testing.T) {
	authority, err := NewCredentialAuthority(
		[]byte("relay-signing-material-for-credential-test"),
	)
	if err != nil {
		t.Fatalf("create credential authority: %v", err)
	}
	mount := &domain.Mount{
		ID:            42,
		StationPeerID: "station-peer",
		Generation:    7,
	}
	credential, err := authority.IssueMountCredential(mount, "credential-jti")
	if err != nil {
		t.Fatalf("issue mount credential: %v", err)
	}

	claims := &credentialClaims{}
	token, _, err := jwt.NewParser().ParseUnverified(
		credential.Token,
		claims,
	)
	if err != nil {
		t.Fatalf("parse mount credential: %v", err)
	}
	if token.Method.Alg() != jwt.SigningMethodEdDSA.Alg() {
		t.Fatalf("algorithm = %q, want EdDSA", token.Method.Alg())
	}
	if claims.Issuer != authority.RelayPeerID() {
		t.Fatalf("issuer = %q, want %q", claims.Issuer, authority.RelayPeerID())
	}
	if len(claims.Audience) != 1 ||
		claims.Audience[0] != domain.MountCredentialAudience {
		t.Fatalf("audience = %v", claims.Audience)
	}
	if claims.ID != "credential-jti" ||
		claims.StationPeerID != mount.StationPeerID ||
		claims.MountID != mount.ID ||
		claims.Generation != mount.Generation {
		t.Fatalf("mount claims were not preserved: %+v", claims)
	}
	for _, required := range []string{
		domain.ScopeMountConnect,
		domain.ScopeMountRotate,
		domain.ScopeRoutePublish,
		domain.ScopePeerTunnel,
	} {
		if !containsScope(claims.Scopes, required) {
			t.Fatalf("scope %q missing from %v", required, claims.Scopes)
		}
	}

	identity, err := authority.ValidateCredential(
		credential.Token,
		domain.MountCredentialAudience,
		domain.ScopeMountRotate,
	)
	if err != nil {
		t.Fatalf("validate mount credential: %v", err)
	}
	if identity.JTI != "credential-jti" ||
		!identity.ExpiresAt.After(time.Now()) {
		t.Fatalf("unexpected validated identity: %+v", identity)
	}
	if _, err := authority.ValidateCredential(
		credential.Token,
		domain.MountCredentialAudience,
		"relay.unknown",
	); err == nil {
		t.Fatal("mount credential was accepted for an unknown scope")
	}
}

func TestInviteDigestIsKeyedAndDoesNotEqualSecret(t *testing.T) {
	first, err := NewCredentialAuthority([]byte("first-relay-signing-material-32-bytes"))
	if err != nil {
		t.Fatalf("create first authority: %v", err)
	}
	second, err := NewCredentialAuthority([]byte("second-relay-signing-material-32-bytes"))
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
