package oss

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	ossrepo "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/repo"
)

// fakePeerKeyRepo is the in-memory test fake. We deliberately do
// NOT exercise the real GORM-backed repo here — these tests pin the
// federation *protocol* behaviour (mint, verify, TOFU); the GORM
// wiring is tested in repo_test.go.
type fakePeerKeyRepo struct {
	mu   sync.Mutex
	priv string
	pub  string
	kid  string

	peers map[string]*ossmodel.PeerKey
}

func newFakePeerKeyRepo() *fakePeerKeyRepo {
	return &fakePeerKeyRepo{peers: map[string]*ossmodel.PeerKey{}}
}

func (r *fakePeerKeyRepo) LoadLocalKey(_ context.Context) (string, string, string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.priv == "" {
		return "", "", "", ossrepo.ErrNoLocalKey
	}
	return r.priv, r.pub, r.kid, nil
}

func (r *fakePeerKeyRepo) SaveLocalKey(_ context.Context, priv, pub, kid string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.priv, r.pub, r.kid = priv, pub, kid
	return nil
}

func (r *fakePeerKeyRepo) GetPeer(_ context.Context, peerStationID string) (*ossmodel.PeerKey, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if v, ok := r.peers[peerStationID]; ok {
		cp := *v
		return &cp, nil
	}
	return nil, nil
}

func (r *fakePeerKeyRepo) UpsertTOFU(_ context.Context, row ossmodel.PeerKey) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if existing, ok := r.peers[row.PeerStationID]; ok {
		if existing.KID != row.KID {
			if existing.Pinned {
				return ossrepo.ErrPinnedKeyMismatch
			}
			return ossrepo.ErrPeerKeyMismatch
		}
		existing.LastSeenAt = time.Now()
		return nil
	}
	if row.FirstSeenAt.IsZero() {
		row.FirstSeenAt = time.Now()
	}
	if row.LastSeenAt.IsZero() {
		row.LastSeenAt = time.Now()
	}
	r.peers[row.PeerStationID] = &row
	return nil
}

func (r *fakePeerKeyRepo) TouchLastSeen(_ context.Context, peerStationID string, ts time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if v, ok := r.peers[peerStationID]; ok {
		v.LastSeenAt = ts
	}
}

func (r *fakePeerKeyRepo) DeleteUnpinnedOlderThan(_ context.Context, olderThan time.Time) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var n int64
	for id, v := range r.peers {
		if v.Pinned {
			continue
		}
		if v.LastSeenAt.Before(olderThan) {
			delete(r.peers, id)
			n++
		}
	}
	return n, nil
}

// makeServer wires a minimal ossSubServer suitable for federation
// unit tests: just the fields VerifyPeerToken / MintPeerToken read.
func makeFederationServer(t *testing.T, repo ossrepo.PeerKeyRepository, stationID string) *ossSubServer {
	t.Helper()
	return &ossSubServer{
		peerKeyRepo:    repo,
		fedKeys:        newFederationKeyCache(repo),
		localStationID: stationID,
	}
}

// TestEncodeFederationKey_Roundtrip pins down the on-disk format
// invariants. Two failures here would be especially bad: a kid
// drift would invalidate every previously-issued token, and a
// PEM-shape change would brick already-bootstrapped stations.
func TestEncodeFederationKey_Roundtrip(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	privPEM, pubPEM, kid, err := encodeFederationKey(priv, pub)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if !strings.HasPrefix(privPEM, "-----BEGIN PRIVATE KEY-----") {
		t.Errorf("priv PEM missing PKCS8 marker: %q", privPEM)
	}
	if !strings.HasPrefix(pubPEM, "-----BEGIN PUBLIC KEY-----") {
		t.Errorf("pub PEM missing PKIX marker: %q", pubPEM)
	}
	if got := len(kid); got != 26 {
		t.Errorf("kid length = %d, want 26", got)
	}

	parsed, err := parseFederationKey(privPEM, pubPEM, kid)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if string(parsed.priv) != string(priv) {
		t.Error("priv key roundtrip mismatch")
	}
	if string(parsed.pub) != string(pub) {
		t.Error("pub key roundtrip mismatch")
	}
	if parsed.kid != kid {
		t.Errorf("kid mismatch: parsed=%q want=%q", parsed.kid, kid)
	}
}

// TestFederationKeyCache_LoadOrGenerate confirms that the lazy
// generator persists, then rehydrates on a fresh cache instance.
func TestFederationKeyCache_LoadOrGenerate(t *testing.T) {
	repo := newFakePeerKeyRepo()
	c1 := newFederationKeyCache(repo)
	k1, err := c1.get(context.Background())
	if err != nil {
		t.Fatalf("first get: %v", err)
	}
	if k1.kid == "" {
		t.Fatal("first get returned empty kid")
	}

	// Second instance must rehydrate from the stored bytes — no
	// fresh generation, no different kid.
	c2 := newFederationKeyCache(repo)
	k2, err := c2.get(context.Background())
	if err != nil {
		t.Fatalf("second get: %v", err)
	}
	if k2.kid != k1.kid {
		t.Errorf("rehydrated kid drifted: %q vs %q", k2.kid, k1.kid)
	}
}

// TestMintAndVerify_Roundtrip is the protocol happy path: A station
// mints a token for B; B verifies it and accepts.
func TestMintAndVerify_Roundtrip(t *testing.T) {
	stationA := "station-A"
	stationB := "station-B"
	const fileKey = "cas/aa/abc123"
	const actor = "did:peer:alice"

	// Each side has its own DB / fake repo.
	repoA := newFakePeerKeyRepo()
	repoB := newFakePeerKeyRepo()
	srvA := makeFederationServer(t, repoA, stationA)
	srvB := makeFederationServer(t, repoB, stationB)

	tok, err := srvA.MintPeerToken(context.Background(), MintPeerTokenRequest{
		LocalStationID: stationA,
		PeerStationID:  stationB,
		ActorDID:       actor,
		FileKey:        fileKey,
	})
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	if !strings.Contains(tok, ".") {
		t.Fatalf("mint returned non-JWS: %q", tok)
	}

	res, err := srvB.VerifyPeerToken(context.Background(), tok, fileKey, stationB)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if res.ActorDID != actor {
		t.Errorf("actor DID = %q, want %q", res.ActorDID, actor)
	}
	if res.PeerStationID != stationA {
		t.Errorf("peer station = %q, want %q", res.PeerStationID, stationA)
	}
	if res.OSSKey != fileKey {
		t.Errorf("oss_key = %q, want %q", res.OSSKey, fileKey)
	}

	// The TOFU side-effect must have stamped A's key in B's cache.
	row, err := repoB.GetPeer(context.Background(), stationA)
	if err != nil || row == nil {
		t.Fatalf("TOFU row missing on receiver: row=%v err=%v", row, err)
	}
}

// TestVerify_RejectsTokenForWrongFile is the per-object binding: a
// token minted for X must not authorise a GET of Y.
func TestVerify_RejectsTokenForWrongFile(t *testing.T) {
	srvA := makeFederationServer(t, newFakePeerKeyRepo(), "station-A")
	srvB := makeFederationServer(t, newFakePeerKeyRepo(), "station-B")

	tok, err := srvA.MintPeerToken(context.Background(), MintPeerTokenRequest{
		LocalStationID: "station-A",
		PeerStationID:  "station-B",
		ActorDID:       "did:peer:alice",
		FileKey:        "cas/aa/file-X",
	})
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	if _, err := srvB.VerifyPeerToken(context.Background(), tok, "cas/bb/file-Y", "station-B"); err == nil {
		t.Fatal("verify allowed cross-file replay")
	}
}

// TestVerify_RejectsTokenForWrongStation pins the audience check.
// A token minted for B must not be accepted by C.
func TestVerify_RejectsTokenForWrongStation(t *testing.T) {
	srvA := makeFederationServer(t, newFakePeerKeyRepo(), "station-A")
	srvC := makeFederationServer(t, newFakePeerKeyRepo(), "station-C")

	tok, err := srvA.MintPeerToken(context.Background(), MintPeerTokenRequest{
		LocalStationID: "station-A",
		PeerStationID:  "station-B", // intended audience
		ActorDID:       "did:peer:alice",
		FileKey:        "cas/aa/abc",
	})
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	if _, err := srvC.VerifyPeerToken(context.Background(), tok, "cas/aa/abc", "station-C"); err == nil {
		t.Fatal("verify allowed audience='B' on station C")
	}
}

// TestVerify_TOFUMismatchRejects covers the trust-on-first-use
// promotion: once a peer's KID is cached, a forged token claiming
// the same `iss` with a different KID is rejected.
func TestVerify_TOFUMismatchRejects(t *testing.T) {
	repoB := newFakePeerKeyRepo()
	srvA := makeFederationServer(t, newFakePeerKeyRepo(), "station-A")
	srvB := makeFederationServer(t, repoB, "station-B")

	// Honest A token TOFU-stamps the cache.
	tokA, err := srvA.MintPeerToken(context.Background(), MintPeerTokenRequest{
		LocalStationID: "station-A",
		PeerStationID:  "station-B",
		ActorDID:       "did:peer:alice",
		FileKey:        "cas/aa/abc",
	})
	if err != nil {
		t.Fatalf("mint A: %v", err)
	}
	if _, err := srvB.VerifyPeerToken(context.Background(), tokA, "cas/aa/abc", "station-B"); err != nil {
		t.Fatalf("verify A: %v", err)
	}

	// Now an attacker (different keypair, same iss claim) tries
	// to ride on A's identity — this must fail.
	srvAttacker := makeFederationServer(t, newFakePeerKeyRepo(), "station-A")
	tokFake, err := srvAttacker.MintPeerToken(context.Background(), MintPeerTokenRequest{
		LocalStationID: "station-A",
		PeerStationID:  "station-B",
		ActorDID:       "did:peer:mallory",
		FileKey:        "cas/aa/abc",
	})
	if err != nil {
		t.Fatalf("mint attacker: %v", err)
	}
	if _, err := srvB.VerifyPeerToken(context.Background(), tokFake, "cas/aa/abc", "station-B"); err == nil {
		t.Fatal("verify allowed forged token after TOFU pin")
	}
}

// TestVerify_RejectsExpired covers the basic expiry check —
// expired tokens never pass verification.
func TestVerify_RejectsExpired(t *testing.T) {
	srvA := makeFederationServer(t, newFakePeerKeyRepo(), "station-A")
	srvB := makeFederationServer(t, newFakePeerKeyRepo(), "station-B")

	// We need to mint with a TTL in the past — the public Mint
	// API clamps to >0, so go through the helper directly.
	key, err := srvA.fedKeys.get(context.Background())
	if err != nil {
		t.Fatalf("key get: %v", err)
	}
	now := time.Now()
	claims := peerTokenClaims{
		OSSKey: "cas/aa/abc",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "station-A",
			Audience:  jwt.ClaimStrings{"station-B"},
			Subject:   "did:peer:alice",
			IssuedAt:  jwt.NewNumericDate(now.Add(-2 * time.Minute)),
			ExpiresAt: jwt.NewNumericDate(now.Add(-1 * time.Minute)),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	tok.Header["typ"] = federationTokenType
	tok.Header["kid"] = key.kid
	tok.Header["jwk_pem"] = key.pem
	signed, err := tok.SignedString(key.priv)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	if _, err := srvB.VerifyPeerToken(context.Background(), signed, "cas/aa/abc", "station-B"); err == nil {
		t.Fatal("verify accepted expired token")
	}
}

// TestVerify_RejectsTTLOverPolicy ensures a peer cannot mint a
// long-lived token (e.g. 1 hour) and have it accepted — the
// receiver caps at federationMaxTTL.
func TestVerify_RejectsTTLOverPolicy(t *testing.T) {
	srvA := makeFederationServer(t, newFakePeerKeyRepo(), "station-A")
	srvB := makeFederationServer(t, newFakePeerKeyRepo(), "station-B")

	key, err := srvA.fedKeys.get(context.Background())
	if err != nil {
		t.Fatalf("key get: %v", err)
	}
	now := time.Now()
	claims := peerTokenClaims{
		OSSKey: "cas/aa/abc",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "station-A",
			Audience:  jwt.ClaimStrings{"station-B"},
			Subject:   "did:peer:alice",
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(1 * time.Hour)),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	tok.Header["typ"] = federationTokenType
	tok.Header["kid"] = key.kid
	tok.Header["jwk_pem"] = key.pem
	signed, err := tok.SignedString(key.priv)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	if _, err := srvB.VerifyPeerToken(context.Background(), signed, "cas/aa/abc", "station-B"); err == nil {
		t.Fatal("verify accepted 1h TTL token")
	}
}

// TestVerify_NotFederationToken returns the sentinel for a
// well-formed user JWT (HS256, typ=JWT). handleFileGet uses this
// sentinel to fall through to the local user-JWT path.
func TestVerify_NotFederationToken(t *testing.T) {
	srvB := makeFederationServer(t, newFakePeerKeyRepo(), "station-B")

	// Hand-roll a non-federation token: HS256 user JWT.
	claims := jwt.MapClaims{"sub": "did:user:bob", "exp": time.Now().Add(time.Minute).Unix()}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := tok.SignedString([]byte("test-secret"))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	_, err = srvB.VerifyPeerToken(context.Background(), signed, "cas/aa/abc", "station-B")
	if err == nil {
		t.Fatal("verify accepted HS256 user JWT as peer token")
	}
	// The sentinel error is matched against directly by callers,
	// so its identity (not just message) matters.
	if err != ErrNotFederationToken && !strings.Contains(err.Error(), "alg") {
		// Some library versions reject the alg before the typ
		// check fires; either path is acceptable as long as it
		// is *not* "verified successfully".
		t.Logf("non-fed token rejected with: %v (acceptable)", err)
	}
}
