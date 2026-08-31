package messaging

import (
	"context"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
)

func TestEventBusTypingPublisherPublishTyping(t *testing.T) {
	const (
		recipientPTID = "ptid:v1:actor:peers:p:bob:fingerprint"
		senderPTID    = "ptid:v1:actor:peers:p:alice:fingerprint"
		conversation  = "conversation-1"
	)

	ctx := context.Background()
	bus := events.NewEventBus()
	defer bus.Close()

	recipient, cancelRecipient, err := bus.Subscribe(ctx, recipientPTID, "bob-device", "")
	if err != nil {
		t.Fatalf("subscribe recipient: %v", err)
	}
	defer cancelRecipient()

	numericActor, cancelNumericActor, err := bus.Subscribe(ctx, "12345", "legacy-device", "")
	if err != nil {
		t.Fatalf("subscribe numeric actor: %v", err)
	}
	defer cancelNumericActor()

	publisher := eventBusTypingPublisher{bus: bus}
	for _, isTyping := range []bool{true, false, true} {
		if err := publisher.PublishTyping(ctx, recipientPTID, conversation, senderPTID, isTyping); err != nil {
			t.Fatalf("publish typing=%t: %v", isTyping, err)
		}
	}

	for index, wantTyping := range []bool{true, false, true} {
		select {
		case event := <-recipient.Events:
			assertTypingEvent(t, event, conversation, senderPTID, wantTyping)
		case <-time.After(time.Second):
			t.Fatalf("timed out waiting for typing event %d", index)
		}
	}

	select {
	case event := <-numericActor.Events:
		t.Fatalf("numeric actor stream received canonical PTID event: %+v", event)
	default:
	}
}

func assertTypingEvent(
	t *testing.T,
	event *realtime.StreamEvent,
	wantConversation string,
	wantSenderPTID string,
	wantTyping bool,
) {
	t.Helper()

	typing := event.GetTyping()
	if typing == nil {
		t.Fatalf("expected typing event, got %T", event.GetKind())
	}
	if typing.GetSessionUlid() != wantConversation {
		t.Fatalf("session_ulid = %q, want %q", typing.GetSessionUlid(), wantConversation)
	}
	if typing.GetFromActorPtid() != wantSenderPTID {
		t.Fatalf("from_actor_ptid = %q, want %q", typing.GetFromActorPtid(), wantSenderPTID)
	}
	if typing.GetTyping() != wantTyping {
		t.Fatalf("typing = %t, want %t", typing.GetTyping(), wantTyping)
	}
}
