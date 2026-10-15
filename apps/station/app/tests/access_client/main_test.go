package main

import (
	"strings"
	"testing"

	authpb "github.com/peers-labs/peers-touch/station/frame/touch/model"
)

func activeDevice(
	ptid string,
	fingerprint byte,
) *authpb.ActorDevice {
	return &authpb.ActorDevice{
		Ref: &authpb.ActorDeviceRef{
			Actor: &authpb.ActorRef{Ptid: ptid},
		},
		Status: authpb.ActorDeviceStatus_ACTOR_DEVICE_STATUS_ACTIVE,
		ActorIdentityKeyFingerprint: []byte(
			strings.Repeat(string(fingerprint), 32),
		),
	}
}

func TestActiveActorIdentityFingerprintAcceptsOneAuthority(t *testing.T) {
	response := &authpb.ListActorDevicesResponse{
		Devices: []*authpb.ActorDevice{
			activeDevice("ptid:alice", 'a'),
			activeDevice("ptid:alice", 'a'),
			{
				Ref: &authpb.ActorDeviceRef{
					Actor: &authpb.ActorRef{Ptid: "ptid:alice"},
				},
				Status: authpb.ActorDeviceStatus_ACTOR_DEVICE_STATUS_REVOKED,
				ActorIdentityKeyFingerprint: []byte(
					strings.Repeat("b", 32),
				),
			},
		},
	}

	fingerprint, err := activeActorIdentityFingerprint(
		response,
		"ptid:alice",
	)
	if err != nil {
		t.Fatal(err)
	}
	if fingerprint != strings.Repeat("61", 32) {
		t.Fatalf("fingerprint = %q", fingerprint)
	}
}

func TestActiveActorIdentityFingerprintRejectsAmbiguity(t *testing.T) {
	response := &authpb.ListActorDevicesResponse{
		Devices: []*authpb.ActorDevice{
			activeDevice("ptid:alice", 'a'),
			activeDevice("ptid:alice", 'b'),
		},
	}

	if _, err := activeActorIdentityFingerprint(
		response,
		"ptid:alice",
	); err == nil || !strings.Contains(err.Error(), "ambiguous") {
		t.Fatalf("error = %v", err)
	}
}

func TestActiveActorIdentityFingerprintRejectsActorMismatch(t *testing.T) {
	response := &authpb.ListActorDevicesResponse{
		Devices: []*authpb.ActorDevice{
			activeDevice("ptid:bob", 'a'),
		},
	}

	if _, err := activeActorIdentityFingerprint(
		response,
		"ptid:alice",
	); err == nil || !strings.Contains(err.Error(), "another actor") {
		t.Fatalf("error = %v", err)
	}
}
