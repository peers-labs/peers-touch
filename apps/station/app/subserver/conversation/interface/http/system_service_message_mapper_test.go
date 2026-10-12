package http_test

import (
	"testing"
	"time"

	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	conversationhttp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/interface/http"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

// G-BOT-03: a system service message maps onto the ordinary committed-message
// wire arm, but with the explicit service-plaintext security marker and SYSTEM
// content kind so clients suppress the E2EE lock instead of guessing.
func TestMapEventSystemServiceMessageSecurityMarker(t *testing.T) {
	at := time.Date(2026, time.October, 12, 9, 0, 0, 0, time.UTC)
	record := domainevent.Record{
		ID:             valueobject.EventID("evt-bot-1"),
		ConversationID: valueobject.ConversationID("conv-bot"),
		Sequence:       valueobject.Sequence(2),
		CommandID:      valueobject.CommandID("cmd-bot-1"),
		Actor: valueobject.Endpoint{
			Actor:  valueobject.PTID("ptid:v1:actor:peers:b:claude:fp"),
			Device: valueobject.SystemStationDeviceID,
		},
		CommittedAt: at,
		Fact:        domainevent.NewSystemServiceMessageFact(valueobject.MessageID("msg-bot-1"), []byte("peers-touch.bot-event.v1")),
	}

	wire, err := conversationhttp.MapEvent(record)
	if err != nil {
		t.Fatalf("MapEvent: %v", err)
	}
	committed := wire.GetMessageCommitted()
	if committed == nil {
		t.Fatalf("payload = %T, want message_committed", wire.Payload)
	}
	if committed.MessageId != "msg-bot-1" {
		t.Fatalf("message_id = %q, want msg-bot-1", committed.MessageId)
	}
	if committed.ContentKind != chat.MessagingContentKind_MESSAGING_CONTENT_KIND_SYSTEM {
		t.Fatalf("content_kind = %v, want SYSTEM", committed.ContentKind)
	}
	if committed.DeliverySecurity != chat.MessageDeliverySecurity_MESSAGE_DELIVERY_SECURITY_SERVICE_PLAINTEXT {
		t.Fatalf("delivery_security = %v, want SERVICE_PLAINTEXT", committed.DeliverySecurity)
	}
	if committed.Sender.GetDeviceId() != string(valueobject.SystemStationDeviceID) {
		t.Fatalf("sender device = %q, want station-system", committed.Sender.GetDeviceId())
	}
}

// G-BOT-03: the system author is keyless; device delivery encoding must
// accept an empty sender identity key for the reserved station-system device
// while still binding the delivery commitment and payload kind.
func TestEncodeDeviceEventKeylessSystemAuthor(t *testing.T) {
	record := domainevent.Record{
		ID:             valueobject.EventID("evt-bot-2"),
		ConversationID: valueobject.ConversationID("conv-bot"),
		Sequence:       valueobject.Sequence(2),
		CommandID:      valueobject.CommandID("cmd-bot-2"),
		Actor: valueobject.Endpoint{
			Actor:  valueobject.PTID("ptid:v1:actor:peers:b:claude:fp"),
			Device: valueobject.SystemStationDeviceID,
		},
		CommittedAt: time.Date(2026, time.October, 12, 9, 0, 0, 0, time.UTC),
		Fact:        domainevent.NewSystemServiceMessageFact(valueobject.MessageID("msg-bot-2"), []byte("payload")),
	}
	recipient := valueobject.Endpoint{
		Actor:  valueobject.PTID("ptid:v1:actor:peers:p:alice:aaa"),
		Device: valueobject.DeviceID("owner-device"),
	}
	delivery, err := valueobject.NewPreparedDelivery(
		recipient,
		valueobject.StationID("station-a"),
		valueobject.DeliveryKindDirectServicePlaintext,
		[]byte("peers-touch.bot-event.v1"),
	)
	if err != nil {
		t.Fatalf("NewPreparedDelivery: %v", err)
	}
	var commitment valueobject.Hash
	copy(commitment[:], []byte("0123456789abcdef0123456789abcdef"))

	encoded, err := (conversationhttp.ProtobufDeviceEventEncoder{}).EncodeDeviceEvent(
		record,
		delivery,
		commitment,
		nil,
	)
	if err != nil {
		t.Fatalf("EncodeDeviceEvent with empty system key: %v", err)
	}
	wire := chat.DeviceEventDelivery{}
	if err := proto.Unmarshal(encoded, &wire); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if wire.PayloadKind !=
		chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_DIRECT_SERVICE_PLAINTEXT {
		t.Fatalf("payload kind = %v, want DIRECT_SERVICE_PLAINTEXT", wire.PayloadKind)
	}
	if len(wire.SenderActorIdentityPublicKey) != 0 {
		t.Fatal("system delivery must not carry a sender identity key")
	}
}
