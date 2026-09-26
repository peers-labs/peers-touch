package command

import (
	"reflect"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

func TestForwardableCommandKindIncludesMemberAuthority(t *testing.T) {
	if !forwardableCommandKind(domainevent.KindMemberAuthority) {
		t.Fatal("member-authority command is not admitted by SubmitForwarded")
	}
}

func TestCanonicalizeMembershipChangesExpandsActorLevelAddActor(t *testing.T) {
	actor := valueobject.PTID("ptid:member")
	changes, err := canonicalizeMembershipChanges(
		aggregate.Snapshot{},
		[]entity.MembershipChange{{
			Action: entity.MembershipActionAddActor,
			Actor:  actor,
			Role:   valueobject.MemberRoleMember,
		}},
		[]ports.EndpointRoute{
			{
				Endpoint:    valueobject.Endpoint{Actor: actor, Device: "device-b"},
				HomeStation: "station-b",
			},
			{
				Endpoint:    valueobject.Endpoint{Actor: actor, Device: "device-a"},
				HomeStation: "station-b",
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	expected := []entity.MembershipChange{
		{
			Action:      entity.MembershipActionAddActor,
			Actor:       actor,
			Device:      "device-a",
			HomeStation: "station-b",
			Role:        valueobject.MemberRoleMember,
		},
		{
			Action:      entity.MembershipActionAddDevice,
			Actor:       actor,
			Device:      "device-b",
			HomeStation: "station-b",
		},
	}
	if !reflect.DeepEqual(changes, expected) {
		t.Fatalf("canonical changes = %+v, want %+v", changes, expected)
	}
}

func TestCanonicalizeMembershipChangesUsesDeterministicRouteOrder(t *testing.T) {
	actor := valueobject.PTID("ptid:member")
	requested := []entity.MembershipChange{{
		Action: entity.MembershipActionAddActor,
		Actor:  actor,
		Role:   valueobject.MemberRoleMember,
	}}
	routes := []ports.EndpointRoute{
		{
			Endpoint:    valueobject.Endpoint{Actor: actor, Device: "device-c"},
			HomeStation: "station-b",
		},
		{
			Endpoint:    valueobject.Endpoint{Actor: actor, Device: "device-a"},
			HomeStation: "station-b",
		},
		{
			Endpoint:    valueobject.Endpoint{Actor: actor, Device: "device-b"},
			HomeStation: "station-b",
		},
	}
	reversed := append([]ports.EndpointRoute(nil), routes...)
	for left, right := 0, len(reversed)-1; left < right; left, right = left+1, right-1 {
		reversed[left], reversed[right] = reversed[right], reversed[left]
	}

	first, err := canonicalizeMembershipChanges(aggregate.Snapshot{}, requested, routes)
	if err != nil {
		t.Fatal(err)
	}
	second, err := canonicalizeMembershipChanges(aggregate.Snapshot{}, requested, reversed)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("route order changed canonical plan: first=%+v second=%+v", first, second)
	}
	for index, device := range []valueobject.DeviceID{"device-a", "device-b", "device-c"} {
		if first[index].Device != device {
			t.Fatalf("canonical device %d = %q, want %q", index, first[index].Device, device)
		}
	}
}

func TestCanonicalizeMembershipChangesPreservesExplicitAddActorDevice(t *testing.T) {
	actor := valueobject.PTID("ptid:member")
	requested := entity.MembershipChange{
		Action: entity.MembershipActionAddActor,
		Actor:  actor,
		Device: "device-b",
		Role:   valueobject.MemberRoleMember,
	}
	changes, err := canonicalizeMembershipChanges(
		aggregate.Snapshot{},
		[]entity.MembershipChange{requested},
		[]ports.EndpointRoute{
			{
				Endpoint:    valueobject.Endpoint{Actor: actor, Device: "device-a"},
				HomeStation: "station-b",
			},
			{
				Endpoint:    valueobject.Endpoint{Actor: actor, Device: "device-b"},
				HomeStation: "station-b",
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 1 ||
		changes[0].Action != entity.MembershipActionAddActor ||
		changes[0].Device != requested.Device ||
		changes[0].HomeStation != "station-b" ||
		changes[0].Role != requested.Role {
		t.Fatalf("explicit-device AddActor changed shape: %+v", changes)
	}
}
