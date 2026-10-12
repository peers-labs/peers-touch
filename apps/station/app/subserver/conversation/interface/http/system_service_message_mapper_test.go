package http_test

import (
	"testing"
	"time"

	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	conversationhttp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/interface/http"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
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
