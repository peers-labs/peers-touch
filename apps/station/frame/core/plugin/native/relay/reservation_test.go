package relay

import (
	"testing"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
)

func TestCloneTargetPreservesControlPlaneConfiguration(t *testing.T) {
	relayPeerID, err := peer.Decode(
		"12D3KooWLpZy2EgZ6SC2pgJFHjM13j1ygz7DXCfm9HiPeNQZ1uaW",
	)
	if err != nil {
		t.Fatal(err)
	}
	original := Target{
		RelayPeerID: relayPeerID,
		Addresses: []string{
			"/ip4/10.37.118.48/tcp/4501/p2p/" + relayPeerID.String(),
		},
		ControlOrigin:  "https://10.37.118.48:18081",
		InviteToken:    "invite",
		CredentialFile: "/app/data/relay.json",
		TLSCAFile:      "/app/relay-ca/relay.crt",
		Label:          "one",
	}

	cloned := cloneTarget(original)

	if cloned.RelayPeerID != original.RelayPeerID ||
		cloned.ControlOrigin != original.ControlOrigin ||
		cloned.InviteToken != original.InviteToken ||
		cloned.CredentialFile != original.CredentialFile ||
		cloned.TLSCAFile != original.TLSCAFile ||
		cloned.Label != original.Label {
		t.Fatalf("cloned target lost control-plane fields: %#v", cloned)
	}
	cloned.Addresses[0] = "/ip4/127.0.0.1/tcp/1"
	if cloned.Addresses[0] == original.Addresses[0] {
		t.Fatal("cloned target shares its address slice")
	}
}

func TestCircuitDialMultiaddrsIncludeRelayTransportAddress(t *testing.T) {
	relayPeerID, err := peer.Decode(
		"12D3KooWLpZy2EgZ6SC2pgJFHjM13j1ygz7DXCfm9HiPeNQZ1uaW",
	)
	if err != nil {
		t.Fatal(err)
	}
	stationPeerID, err := peer.Decode(
		"12D3KooWGo2HxmjfSQZKTheDEbgDBpSuhUxTNsr8DnTkXCDzdaZL",
	)
	if err != nil {
		t.Fatal(err)
	}
	base := multiaddr.StringCast("/ip4/10.37.118.48/tcp/4501")

	addresses, err := circuitDialMultiaddrs(
		peer.AddrInfo{
			ID:    relayPeerID,
			Addrs: []multiaddr.Multiaddr{base},
		},
		stationPeerID,
	)
	if err != nil {
		t.Fatal(err)
	}

	expected := base.String() +
		"/p2p/" + relayPeerID.String() +
		"/p2p-circuit/p2p/" + stationPeerID.String()
	if len(addresses) != 1 || addresses[0].String() != expected {
		t.Fatalf("Circuit dial addresses = %v, want %s", addresses, expected)
	}
}
