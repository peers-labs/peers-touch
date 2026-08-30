package bootstrap

import (
	"bytes"
	"crypto/rand"
	"testing"
	"time"

	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

func TestSignStationIdentity(t *testing.T) {
	privateKey, publicKey, err := crypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	stationPeerID, err := peer.IDFromPublicKey(publicKey)
	if err != nil {
		t.Fatalf("derive peer ID: %v", err)
	}
	challenge := bytes.Repeat([]byte{0x2a}, stationIdentityChallengeSize)
	now := time.Unix(1_800_000_000, 0).UTC()

	response, err := signStationIdentity(
		privateKey,
		stationPeerID,
		"https://station.example:443",
		challenge,
		now,
	)
	if err != nil {
		t.Fatalf("sign identity: %v", err)
	}
	statement := &peerpb.StationIdentityStatement{}
	if err := proto.Unmarshal(response.GetStatementBytes(), statement); err != nil {
		t.Fatalf("decode statement: %v", err)
	}
	if statement.GetStationPeerId() != stationPeerID.String() {
		t.Fatalf("unexpected peer ID: %s", statement.GetStationPeerId())
	}
	if statement.GetExpiresAtUnixMs()-statement.GetIssuedAtUnixMs() != 60_000 {
		t.Fatal("signed identity lifetime must be 60 seconds")
	}
	if !bytes.Equal(statement.GetChallenge(), challenge) {
		t.Fatal("signed challenge does not match request")
	}
	if !sortIsStable(statement.GetCapabilities()) {
		t.Fatal("capabilities are not sorted")
	}

	ok, err := publicKey.Verify(
		append([]byte(stationIdentityDomain), response.GetStatementBytes()...),
		response.GetSignature(),
	)
	if err != nil {
		t.Fatalf("verify signature: %v", err)
	}
	if !ok {
		t.Fatal("signature verification failed")
	}
}

func TestSignStationIdentityRejectsInvalidChallenge(t *testing.T) {
	privateKey, publicKey, err := crypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	stationPeerID, err := peer.IDFromPublicKey(publicKey)
	if err != nil {
		t.Fatalf("derive peer ID: %v", err)
	}
	if _, err := signStationIdentity(
		privateKey,
		stationPeerID,
		"https://station.example:443",
		[]byte("short"),
		time.Now(),
	); err == nil {
		t.Fatal("expected invalid challenge to fail")
	}
}

func TestSignStationIdentityRejectsPeerIDMismatch(t *testing.T) {
	privateKey, _, err := crypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatalf("generate signing key: %v", err)
	}
	_, otherPublicKey, err := crypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatalf("generate other key: %v", err)
	}
	otherPeerID, err := peer.IDFromPublicKey(otherPublicKey)
	if err != nil {
		t.Fatalf("derive other peer ID: %v", err)
	}
	if _, err := signStationIdentity(
		privateKey,
		otherPeerID,
		"https://station.example:443",
		bytes.Repeat([]byte{0x11}, stationIdentityChallengeSize),
		time.Now(),
	); err == nil {
		t.Fatal("expected peer ID mismatch to fail")
	}
}

func sortIsStable(values []string) bool {
	for index := 1; index < len(values); index++ {
		if values[index-1] > values[index] {
			return false
		}
	}
	return true
}
