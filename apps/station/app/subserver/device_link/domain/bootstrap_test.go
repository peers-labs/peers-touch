package domain

import (
	"crypto/ed25519"
	"encoding/hex"
	"testing"
	"time"

	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/devicelink"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
)

func testReference(secret byte) *pb.DeviceLinkLocator {
	root := []byte(ed25519.NewKeyFromSeed(bytesN(2)).Public().(ed25519.PublicKey))
	return &pb.DeviceLinkLocator{
		ProtocolVersion:          1,
		OfferDigest:              bytesN(1),
		ExpiresAtUnixMs:          time.UnixMilli(1_800_000_300_000).UnixMilli(),
		StationRootEd25519:       root,
		BootstrapSecret:          bytesN(secret),
		CanonicalDiscoveryOrigin: "https://station.example",
		EndpointRole:             peerpb.AccessEndpointRole_ACCESS_ENDPOINT_ROLE_DIRECT_STATION,
	}
}

func bytesN(value byte) []byte {
	raw := make([]byte, 32)
	for i := range raw {
		raw[i] = value
	}
	return raw
}

func TestBootstrapKeysAreDomainSeparatedAndContextBound(t *testing.T) {
	reference := testReference(3)
	lookup, unseal, err := BootstrapKeys(reference)
	if err != nil {
		t.Fatal(err)
	}
	if len(lookup) != 32 || len(unseal) != 32 {
		t.Fatal("HKDF outputs must be 32 bytes")
	}
	if string(lookup) == string(unseal) {
		t.Fatal("lookup and unseal must use distinct HKDF info")
	}
	if actual := hex.EncodeToString(lookup); actual != "d5d5d38c804904ae70ab3ff7e808e7586e68b598c22a0a2fe634e94fea5f7f65" {
		t.Fatalf("lookup vector mismatch: %s", actual)
	}
	if actual := hex.EncodeToString(unseal); actual != "611c8b8de6a70a075018a5a2396e23c14a662e41374857dde35437dfb93358de" {
		t.Fatalf("unseal vector mismatch: %s", actual)
	}

	for _, mutate := range []func(*pb.DeviceLinkLocator){
		func(value *pb.DeviceLinkLocator) { value.OfferDigest[0] = 9 },
		func(value *pb.DeviceLinkLocator) { value.StationRootEd25519[0] = 9 },
		func(value *pb.DeviceLinkLocator) { value.BootstrapSecret[0] = 9 },
		func(value *pb.DeviceLinkLocator) { value.CanonicalDiscoveryOrigin = "https://relay.example" },
		func(value *pb.DeviceLinkLocator) { value.ExpiresAtUnixMs++ },
	} {
		changed := *reference
		mutate(&changed)
		changedLookup, changedUnseal, err := BootstrapKeys(&changed)
		if err != nil {
			t.Fatal(err)
		}
		if string(changedLookup) == string(lookup) || string(changedUnseal) == string(unseal) {
			t.Fatal("HKDF outputs must bind every public and private context field")
		}
	}
}

func TestBootstrapKeysRejectRoleKeyMismatch(t *testing.T) {
	direct := testReference(3)
	if _, _, err := BootstrapKeys(direct); err != nil {
		t.Fatal(err)
	}
	relay := *direct
	relay.EndpointRole = peerpb.AccessEndpointRole_ACCESS_ENDPOINT_ROLE_RELAY
	if _, _, err := BootstrapKeys(&relay); err == nil {
		t.Fatal("Relay reference requires an independent Relay key")
	}
	relay.RelayEd25519 = direct.StationRootEd25519
	if _, _, err := BootstrapKeys(&relay); err == nil {
		t.Fatal("Relay key must not reuse the Station root")
	}
	relay.RelayEd25519 = bytesN(4)
	if _, _, err := BootstrapKeys(&relay); err != nil {
		t.Fatal(err)
	}
	direct.RelayEd25519 = bytesN(4)
	if _, _, err := BootstrapKeys(direct); err == nil {
		t.Fatal("Direct reference must omit Relay key material")
	}
}
