package conversation

import (
	"testing"

	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

func TestDkxIdempotencyKeyDeduplicatesOnlyIdenticalHandshake(t *testing.T) {
	const sessionID = "direct-1"
	const senderPtid = "ptid:v1:actor:peers:p:alice"
	const senderDeviceID = "alice-device"
	const recipientPtid = "ptid:v1:actor:peers:p:bob"
	const recipientDeviceID = "bob-device"
	kind := chat.DirectKeyExchangeKind_DIRECT_KEY_EXCHANGE_KIND_INITIAL_MESSAGE

	first := dkxIdempotencyKey(
		sessionID,
		senderPtid,
		senderDeviceID,
		recipientPtid,
		recipientDeviceID,
		kind,
		[]byte("handshake-a"),
	)
	retry := dkxIdempotencyKey(
		sessionID,
		senderPtid,
		senderDeviceID,
		recipientPtid,
		recipientDeviceID,
		kind,
		[]byte("handshake-a"),
	)
	rekey := dkxIdempotencyKey(
		sessionID,
		senderPtid,
		senderDeviceID,
		recipientPtid,
		recipientDeviceID,
		kind,
		[]byte("handshake-b"),
	)
	otherDevice := dkxIdempotencyKey(
		sessionID,
		senderPtid,
		senderDeviceID,
		recipientPtid,
		"bob-device-2",
		kind,
		[]byte("handshake-a"),
	)

	if first != retry {
		t.Fatal("identical DKX retries must share an idempotency key")
	}
	if first == rekey {
		t.Fatal("distinct DKX material must produce a new idempotency key")
	}
	if first == otherDevice {
		t.Fatal("distinct endpoint tuples must produce different idempotency keys")
	}
}

func TestResolveDkxDeviceRouteRejectsMismatchedTargets(t *testing.T) {
	senderDevices := []touchactor.DeviceRecord{{
		Ptid:              "alice",
		DeviceID:          "alice-device",
		HomeStationPeerID: "station-a",
	}}
	recipientDevices := []touchactor.DeviceRecord{{
		Ptid:              "bob",
		DeviceID:          "bob-device",
		HomeStationPeerID: "station-b",
	}}
	if got, err := resolveDkxDeviceRoute(
		"alice",
		"alice-device",
		"bob",
		"bob-device",
		"station-b",
		senderDevices,
		recipientDevices,
	); err != nil || got != "station-b" {
		t.Fatalf("valid route = %q, err = %v", got, err)
	}
	for name, route := range map[string][3]string{
		"inactive sender":    {"other-device", "bob-device", "station-b"},
		"wrong recipient":    {"alice-device", "other-device", "station-b"},
		"wrong home station": {"alice-device", "bob-device", "station-c"},
		"blank home station": {"alice-device", "bob-device", ""},
	} {
		t.Run(name, func(t *testing.T) {
			devices := recipientDevices
			if name == "blank home station" {
				devices = []touchactor.DeviceRecord{{
					Ptid:     "bob",
					DeviceID: "bob-device",
				}}
			}
			if _, err := resolveDkxDeviceRoute(
				"alice",
				route[0],
				"bob",
				route[1],
				route[2],
				senderDevices,
				devices,
			); err == nil {
				t.Fatal("expected mismatched DKX route rejection")
			}
		})
	}
	if _, err := resolveDkxDeviceRoute(
		"alice",
		"alice-device",
		"alice",
		"alice-device",
		"station-a",
		senderDevices,
		senderDevices,
	); err == nil {
		t.Fatal("same sender and recipient endpoint must be rejected")
	}
}
