package application

import (
	"bytes"
	"testing"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

func TestEndpointManifestRoutingStateIgnoresOnlyPublicMaterialAdvance(t *testing.T) {
	previous := routingManifest()
	current := proto.Clone(previous).(*chat.FederatedEndpointManifest)
	current.DirectoryVersion = previous.DirectoryVersion + 1
	current.ActiveEndpoints[0].PublicMaterialSha256 = append(
		current.ActiveEndpoints[0].PublicMaterialSha256,
		bytes.Repeat([]byte{3}, 32),
	)
	if !SameEndpointManifestRoutingState(previous, current) {
		t.Fatal("public material advance changed routing state")
	}
	if SameEndpointManifestState(previous, current) {
		t.Fatal("public material advance preserved complete manifest state")
	}

	mutations := []func(*chat.FederatedEndpointManifest){
		func(value *chat.FederatedEndpointManifest) {
			value.HomeStationId = "station-other"
		},
		func(value *chat.FederatedEndpointManifest) {
			value.ActorIdentityPublicKey[0] ^= 1
		},
		func(value *chat.FederatedEndpointManifest) {
			value.ActorProfileVersion++
		},
		func(value *chat.FederatedEndpointManifest) {
			value.ActiveEndpoints[0].Endpoint.DeviceId = "bob-2"
		},
		func(value *chat.FederatedEndpointManifest) {
			value.ActiveEndpoints[0].SigningKeyId = "key:bob-2"
		},
		func(value *chat.FederatedEndpointManifest) {
			value.ActiveEndpoints = append(
				value.ActiveEndpoints,
				&chat.FederatedEndpointManifestEntry{
					Endpoint: &chat.CryptoEndpoint{
						Ptid:     "bob",
						DeviceId: "bob-2",
					},
					SigningKeyId:         "key:bob-2",
					PublicMaterialSha256: [][]byte{bytes.Repeat([]byte{4}, 32)},
				},
			)
		},
	}
	for index, mutate := range mutations {
		changed := proto.Clone(current).(*chat.FederatedEndpointManifest)
		mutate(changed)
		if SameEndpointManifestRoutingState(previous, changed) {
			t.Fatalf("routing mutation %d was accepted", index)
		}
	}
}

func routingManifest() *chat.FederatedEndpointManifest {
	return &chat.FederatedEndpointManifest{
		FormatVersion:          EndpointManifestFormatVersion,
		ActorPtid:              "bob",
		HomeStationId:          "station-home",
		DirectoryVersion:       2,
		ActorIdentityPublicKey: bytes.Repeat([]byte{1}, 32),
		ActorProfileVersion:    1,
		ActiveEndpoints: []*chat.FederatedEndpointManifestEntry{{
			Endpoint: &chat.CryptoEndpoint{
				Ptid:     "bob",
				DeviceId: "bob-1",
			},
			SigningKeyId: "key:bob-1",
			PublicMaterialSha256: [][]byte{
				bytes.Repeat([]byte{1}, 32),
				bytes.Repeat([]byte{2}, 32),
			},
		}},
	}
}
