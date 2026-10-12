package delivery

import (
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

// G-BOT-03 (BOT-A21): the device receipt contract must admit the new
// direct_service_plaintext payload kind (8) once the aggregate can produce it,
// while still failing closed on genuinely unknown kinds.
func TestDeliveryKindFromProtoServicePlaintext(t *testing.T) {
	got, err := deliveryKindFromProto(
		chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_DIRECT_SERVICE_PLAINTEXT,
	)
	if err != nil {
		t.Fatalf("direct_service_plaintext must be admitted: %v", err)
	}
	if got != valueobject.DeliveryKindDirectServicePlaintext {
		t.Fatalf("got %q, want direct_service_plaintext", got)
	}

	// Fail-closed: a future/higher unknown kind is still rejected, not mapped.
	if _, err := deliveryKindFromProto(chat.PreparedEndpointPayloadKind(99)); err == nil {
		t.Fatal("unknown payload kind must remain a receipt integrity error")
	}
}
