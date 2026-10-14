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

type stationIdentityFixture struct {
	rootKey       crypto.PrivKey
	nodeKey       crypto.PrivKey
	authorization *peerpb.StationNodeAuthorization
	now           time.Time
}

func newStationIdentityFixture(t *testing.T) stationIdentityFixture {
	t.Helper()
	rootKey, _, err := crypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatalf("generate Station root key: %v", err)
	}
	nodeKey, nodePublicKey, err := crypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatalf("generate node key: %v", err)
	}
	now := time.Unix(1_800_000_000, 0).UTC()
	authorization, err := peerpb.SignStationNodeAuthorization(
		rootKey,
		nodePublicKey,
		7,
		stationNodeCapabilities,
		now,
		now.Add(peerpb.MaxNodeAuthorizationLifetime),
	)
	if err != nil {
		t.Fatalf("sign node authorization: %v", err)
	}
	return stationIdentityFixture{
		rootKey:       rootKey,
		nodeKey:       nodeKey,
		authorization: authorization,
		now:           now,
	}
}

func (fixture stationIdentityFixture) response(
	t *testing.T,
) *peerpb.StationIdentityResponse {
	t.Helper()
	response, err := peerpb.SignStationIdentityResponse(
		fixture.nodeKey,
		fixture.authorization,
		"https://station.example:443",
		bytes.Repeat([]byte{0x2a}, peerpb.StationIdentityChallengeSize),
		stationNodeCapabilities,
		fixture.now,
	)
	if err != nil {
		t.Fatalf("sign Station identity: %v", err)
	}
	return response
}

func TestStationIdentityTwoNodesRetainOneLogicalStation(t *testing.T) {
	fixture := newStationIdentityFixture(t)
	secondNodeKey, secondNodePublicKey, err := crypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatalf("generate second node key: %v", err)
	}
	secondAuthorization, err := peerpb.SignStationNodeAuthorization(
		fixture.rootKey,
		secondNodePublicKey,
		7,
		stationNodeCapabilities,
		fixture.now,
		fixture.now.Add(peerpb.MaxNodeAuthorizationLifetime),
	)
	if err != nil {
		t.Fatalf("authorize second node: %v", err)
	}

	firstVerified, err := peerpb.VerifyStationNodeAuthorization(
		fixture.authorization,
		fixture.now,
	)
	if err != nil {
		t.Fatalf("verify first authorization: %v", err)
	}
	secondVerified, err := peerpb.VerifyStationNodeAuthorization(
		secondAuthorization,
		fixture.now,
	)
	if err != nil {
		t.Fatalf("verify second authorization: %v", err)
	}
	if firstVerified.Statement.GetStationPeerId() !=
		secondVerified.Statement.GetStationPeerId() {
		t.Fatal("node authorizations changed the logical Station identity")
	}
	if firstVerified.Statement.GetNodePeerId() ==
		secondVerified.Statement.GetNodePeerId() {
		t.Fatal("independent nodes must have distinct PeerIDs")
	}

	response, err := peerpb.SignStationIdentityResponse(
		secondNodeKey,
		secondAuthorization,
		"https://station.example:443",
		bytes.Repeat([]byte{0x2a}, peerpb.StationIdentityChallengeSize),
		stationNodeCapabilities,
		fixture.now,
	)
	if err != nil {
		t.Fatalf("sign second node identity: %v", err)
	}
	identity, err := peerpb.VerifyStationIdentityResponse(
		response,
		bytes.Repeat([]byte{0x2a}, peerpb.StationIdentityChallengeSize),
		"https://station.example:443",
		[]string{"station-identity", "station-route"},
		fixture.now,
	)
	if err != nil {
		t.Fatalf("verify second node identity: %v", err)
	}
	if identity.Statement.GetStationPeerId() !=
		firstVerified.Statement.GetStationPeerId() {
		t.Fatal("challenge response did not retain the logical Station identity")
	}
}

func TestStationNodeAuthorizationAndIdentityAreDeterministic(t *testing.T) {
	fixture := newStationIdentityFixture(t)
	nodePublicKey := fixture.nodeKey.GetPublic()
	first, err := peerpb.SignStationNodeAuthorization(
		fixture.rootKey,
		nodePublicKey,
		9,
		stationNodeCapabilities,
		fixture.now,
		fixture.now.Add(time.Hour),
	)
	if err != nil {
		t.Fatalf("sign first authorization: %v", err)
	}
	second, err := peerpb.SignStationNodeAuthorization(
		fixture.rootKey,
		nodePublicKey,
		9,
		stationNodeCapabilities,
		fixture.now,
		fixture.now.Add(time.Hour),
	)
	if err != nil {
		t.Fatalf("sign second authorization: %v", err)
	}
	firstBytes, _ := proto.MarshalOptions{Deterministic: true}.Marshal(first)
	secondBytes, _ := proto.MarshalOptions{Deterministic: true}.Marshal(second)
	if !bytes.Equal(firstBytes, secondBytes) {
		t.Fatal("identical authorization input produced different bytes")
	}

	firstIdentity := fixture.response(t)
	secondIdentity := fixture.response(t)
	firstBytes, _ = proto.MarshalOptions{Deterministic: true}.
		Marshal(firstIdentity)
	secondBytes, _ = proto.MarshalOptions{Deterministic: true}.
		Marshal(secondIdentity)
	if !bytes.Equal(firstBytes, secondBytes) {
		t.Fatal("identical identity input produced different bytes")
	}
}

func TestStationIdentityRejectsRootNodeEpochExpiryAndCapabilityMismatch(
	t *testing.T,
) {
	fixture := newStationIdentityFixture(t)
	challenge := bytes.Repeat(
		[]byte{0x2a},
		peerpb.StationIdentityChallengeSize,
	)

	t.Run("root substitution", func(t *testing.T) {
		response := proto.Clone(fixture.response(t)).(*peerpb.StationIdentityResponse)
		_, attackerRootPublicKey, err := crypto.GenerateEd25519Key(rand.Reader)
		if err != nil {
			t.Fatalf("generate attacker root key: %v", err)
		}
		response.NodeAuthorization.StationRootPublicKey, err =
			crypto.MarshalPublicKey(attackerRootPublicKey)
		if err != nil {
			t.Fatalf("marshal attacker root key: %v", err)
		}
		if _, err := peerpb.VerifyStationIdentityResponse(
			response,
			challenge,
			"https://station.example:443",
			[]string{"station-identity"},
			fixture.now,
		); err == nil {
			t.Fatal("root substitution was accepted")
		}
	})

	t.Run("node mismatch", func(t *testing.T) {
		otherNodeKey, _, err := crypto.GenerateEd25519Key(rand.Reader)
		if err != nil {
			t.Fatalf("generate other node key: %v", err)
		}
		if _, err := peerpb.SignStationIdentityResponse(
			otherNodeKey,
			fixture.authorization,
			"https://station.example:443",
			challenge,
			stationNodeCapabilities,
			fixture.now,
		); err == nil {
			t.Fatal("unauthorized node key was accepted")
		}
	})

	t.Run("zero epoch", func(t *testing.T) {
		authorization := proto.Clone(fixture.authorization).(*peerpb.StationNodeAuthorization)
		statement := &peerpb.StationNodeAuthorizationStatement{}
		if err := proto.Unmarshal(
			authorization.GetStatementBytes(),
			statement,
		); err != nil {
			t.Fatalf("decode authorization statement: %v", err)
		}
		statement.AuthorizationEpoch = 0
		authorization.StatementBytes, _ =
			proto.MarshalOptions{Deterministic: true}.Marshal(statement)
		authorization.RootSignature, _ = fixture.rootKey.Sign(
			append(
				[]byte(peerpb.StationNodeAuthorizationDomain),
				authorization.GetStatementBytes()...,
			),
		)
		if _, err := peerpb.VerifyStationNodeAuthorization(
			authorization,
			fixture.now,
		); err == nil {
			t.Fatal("zero authorization epoch was accepted")
		}
	})

	t.Run("expired authorization", func(t *testing.T) {
		if _, err := peerpb.VerifyStationIdentityResponse(
			fixture.response(t),
			challenge,
			"https://station.example:443",
			[]string{"station-identity"},
			fixture.now.Add(peerpb.MaxNodeAuthorizationLifetime),
		); err == nil {
			t.Fatal("expired authorization was accepted")
		}
	})

	t.Run("capability mismatch", func(t *testing.T) {
		if _, err := peerpb.VerifyStationIdentityResponse(
			fixture.response(t),
			challenge,
			"https://station.example:443",
			[]string{"not-authorized"},
			fixture.now,
		); err == nil {
			t.Fatal("missing required capability was accepted")
		}
	})
}

func TestStationIdentityRejectsOversizedControlMessage(t *testing.T) {
	fixture := newStationIdentityFixture(t)
	response := fixture.response(t)
	response.StatementBytes = make([]byte, peerpb.MaxSignedControlBytes+1)
	if _, err := peerpb.VerifyStationIdentityResponse(
		response,
		bytes.Repeat([]byte{0x2a}, peerpb.StationIdentityChallengeSize),
		"https://station.example:443",
		[]string{"station-identity"},
		fixture.now,
	); err == nil {
		t.Fatal("oversized identity response was accepted")
	}
}

func TestStationRootAndNodePeerIDsAreDifferent(t *testing.T) {
	fixture := newStationIdentityFixture(t)
	rootID, err := peer.IDFromPrivateKey(fixture.rootKey)
	if err != nil {
		t.Fatalf("derive root PeerID: %v", err)
	}
	nodeID, err := peer.IDFromPrivateKey(fixture.nodeKey)
	if err != nil {
		t.Fatalf("derive node PeerID: %v", err)
	}
	if rootID == nodeID {
		t.Fatal("logical Station root and physical node share a PeerID")
	}
}
