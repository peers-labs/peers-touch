package application

import (
	"context"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
)

func TestMomentEventPublisherPublishesCreatedSelfEcho(t *testing.T) {
	ctx := context.Background()
	bus := events.NewEventBus(
		events.WithIDGenerator(func() string { return "ev-1" }),
		events.WithClock(func() time.Time { return time.UnixMilli(1234) }),
	)
	defer bus.Close()

	sub, cancel, err := bus.Subscribe(ctx, "42", "device-a", "")
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	defer cancel()

	publisher := NewMomentEventPublisher()
	publisher.bus = func() events.EventBus { return bus }
	publisher.now = func() time.Time { return time.UnixMilli(4321) }

	publisher.PublishCreated(ctx, 1001, 42, &model.Audience{Kind: model.Audience_FOLLOWERS})

	select {
	case ev := <-sub.Events:
		moment := ev.GetMoment()
		if moment == nil {
			t.Fatalf("expected MomentEvent, got %T", ev.GetKind())
		}
		if moment.Kind != realtime.MomentEvent_CREATED {
			t.Fatalf("kind = %v, want CREATED", moment.Kind)
		}
		if moment.PostId != "1001" {
			t.Fatalf("post_id = %q, want 1001", moment.PostId)
		}
		if moment.ActorId != "42" || moment.AuthorActorId != "42" {
			t.Fatalf("actor ids = actor:%q author:%q, want 42", moment.ActorId, moment.AuthorActorId)
		}
		if moment.Audience != model.Audience_FOLLOWERS.String() {
			t.Fatalf("audience = %q, want %q", moment.Audience, model.Audience_FOLLOWERS.String())
		}
		if moment.OccurredTsUnixMs != 4321 {
			t.Fatalf("occurred_ts_unix_ms = %d, want 4321", moment.OccurredTsUnixMs)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for moment event")
	}
}
