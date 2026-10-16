package social

import (
	"testing"

	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
)

func TestPrivateContentEndpointIdentityIgnoresMutableActorPresentation(t *testing.T) {
	manifestEndpoint := &actormodel.ActorDeviceRef{
		Actor: &actormodel.ActorRef{
			Ptid: "ptid:bob",
			Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
		},
		DeviceId: "bob-device",
	}
	requestEndpoint := &actormodel.ActorDeviceRef{
		Actor: &actormodel.ActorRef{
			Ptid: "ptid:bob",
			Acct: "bob@station.test",
			Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
		},
		DeviceId: "bob-device",
	}

	if !sameActorEndpointIdentity(manifestEndpoint, requestEndpoint) {
		t.Fatal("mutable ActorRef presentation changed endpoint identity")
	}
	requestEndpoint.DeviceId = "other-device"
	if sameActorEndpointIdentity(manifestEndpoint, requestEndpoint) {
		t.Fatal("different device was accepted as the same endpoint")
	}
}
