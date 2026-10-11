package peer

import "testing"

func TestRouteAddressesMatchKindRequiresDialableCircuitPrefix(t *testing.T) {
	statement := &StationRouteStatement{
		NodePeerId:  "12D3KooWGo2HxmjfSQZKTheDEbgDBpSuhUxTNsr8DnTkXCDzdaZL",
		RelayPeerId: "12D3KooWLpZy2EgZ6SC2pgJFHjM13j1ygz7DXCfm9HiPeNQZ1uaW",
		Kind:        StationRouteKind_STATION_ROUTE_KIND_CIRCUIT,
		Addresses: []string{
			"/ip4/10.37.118.48/tcp/4501/p2p/" +
				"12D3KooWLpZy2EgZ6SC2pgJFHjM13j1ygz7DXCfm9HiPeNQZ1uaW" +
				"/p2p-circuit/p2p/" +
				"12D3KooWGo2HxmjfSQZKTheDEbgDBpSuhUxTNsr8DnTkXCDzdaZL",
		},
	}

	if !routeAddressesMatchKind(statement) {
		t.Fatal("full Circuit address was rejected")
	}

	statement.Addresses = []string{
		"/p2p/" + statement.RelayPeerId +
			"/p2p-circuit/p2p/" + statement.NodePeerId,
	}
	if routeAddressesMatchKind(statement) {
		t.Fatal("Circuit address without a Relay dial prefix was accepted")
	}
}

func TestRouteAddressesMatchKindRejectsCircuitIdentityMismatch(t *testing.T) {
	statement := &StationRouteStatement{
		NodePeerId:  "12D3KooWGo2HxmjfSQZKTheDEbgDBpSuhUxTNsr8DnTkXCDzdaZL",
		RelayPeerId: "12D3KooWLpZy2EgZ6SC2pgJFHjM13j1ygz7DXCfm9HiPeNQZ1uaW",
		Kind:        StationRouteKind_STATION_ROUTE_KIND_CIRCUIT,
		Addresses: []string{
			"/ip4/10.37.118.48/tcp/4501/p2p/" +
				"12D3KooWRQ2Tc85YxU3gAnP4vbTaWLDtAz6JU6PURsHcspAun6ag" +
				"/p2p-circuit/p2p/" +
				"12D3KooWGo2HxmjfSQZKTheDEbgDBpSuhUxTNsr8DnTkXCDzdaZL",
		},
	}

	if routeAddressesMatchKind(statement) {
		t.Fatal("Circuit address for a different Relay identity was accepted")
	}
}
