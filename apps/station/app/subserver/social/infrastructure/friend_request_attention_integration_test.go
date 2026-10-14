package infrastructure_test

import (
	"context"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/application"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	notification "github.com/peers-labs/peers-touch/station/frame/touch/model/notification"
)

type committedAttentionRecord struct {
	recipient string
	actor     string
	kind      int32
}

type committedAttentionObserver struct {
	t       *testing.T
	station *friendRequestStation
	records []committedAttentionRecord
}

func (p *committedAttentionObserver) Produce(
	recipient, actor string, kind, category int32,
	_, target, _, _, _ string, _ map[string]string,
) error {
	projection, err := p.station.store.Projection(context.Background(), target)
	if err != nil || projection == nil || !projection.AuthorityConfirmed {
		p.t.Fatalf("attention escaped its committed authority: %+v, %v", projection, err)
	}
	if category != int32(notification.NotificationCategory_NOTIFICATION_CATEGORY_CHAT) {
		p.t.Fatalf("attention category = %d", category)
	}
	p.records = append(p.records, committedAttentionRecord{recipient, actor, kind})
	return nil
}

func TestFederatedFriendRequestAttentionUsesCommittedDeliveryTransaction(t *testing.T) {
	fixture := newFederatedFriendRequestFixture(t)
	sender := &committedAttentionObserver{t: t, station: fixture.a}
	receiver := &committedAttentionObserver{t: t, station: fixture.b}
	fixture.a.service.WithAttentionPublisher(application.NewFriendRequestAttentionPublisher(sender))
	fixture.b.service.WithAttentionPublisher(application.NewFriendRequestAttentionPublisher(receiver))
	send := fixture.command(
		t, model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
		"attention-send", "attention-request", stationA, stationB, fixture.clock.Now(),
	)
	if _, err := fixture.a.service.SubmitFriendRequestCommand(context.Background(), send); err != nil {
		t.Fatal(err)
	}
	if len(sender.records) != 0 || len(receiver.records) != 0 {
		t.Fatal("an unconfirmed outgoing request produced attention")
	}
	fixture.dispatchOnce(t, fixture.a)
	if len(receiver.records) != 1 || receiver.records[0] != (committedAttentionRecord{
		bobPTID, alicePTID, int32(notification.NotificationType_NOTIFICATION_TYPE_FRIEND_REQUEST),
	}) {
		t.Fatalf("receiver attention = %+v", receiver.records)
	}
	fixture.dispatchOnce(t, fixture.b)
	if len(sender.records) != 0 {
		t.Fatal("SEND result produced attention on the sender Station")
	}

	fixture.clock.Advance(time.Minute)
	accept := fixture.command(
		t, model.FriendRequestAction_FRIEND_REQUEST_ACTION_ACCEPT,
		"attention-accept", "attention-request", stationA, stationB, fixture.clock.Now(),
	)
	if _, err := fixture.b.service.SubmitFriendRequestCommand(context.Background(), accept); err != nil {
		t.Fatal(err)
	}
	fixture.dispatchOnce(t, fixture.b)
	fixture.dispatchOnce(t, fixture.b)
	if len(sender.records) != 1 || sender.records[0] != (committedAttentionRecord{
		alicePTID, bobPTID, int32(notification.NotificationType_NOTIFICATION_TYPE_FRIEND_ACCEPTED),
	}) {
		t.Fatalf("sender acceptance attention = %+v", sender.records)
	}
	if len(receiver.records) != 1 {
		t.Fatalf("acceptance duplicated receiver attention: %+v", receiver.records)
	}
}
