package application

import (
	"context"
	"errors"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	notification "github.com/peers-labs/peers-touch/station/frame/touch/model/notification"
)

type attentionTransaction struct {
	infrastructure.FederatedFriendRequestTransaction
	callbacks []delivery.AfterCommitFunc
}

func (t *attentionTransaction) AfterCommit(callback delivery.AfterCommitFunc) error {
	t.callbacks = append(t.callbacks, callback)
	return nil
}

type attentionRecord struct {
	recipient, actor, target string
	kind, category           int32
}

type attentionProducer struct {
	records []attentionRecord
	err     error
}

func (p *attentionProducer) Produce(recipient, actor string, kind, category int32, _, target, _, _, _ string, _ map[string]string) error {
	p.records = append(p.records, attentionRecord{recipient, actor, target, kind, category})
	return p.err
}

func attentionProjection(state model.FriendRequestState) domain.FriendRequestProjection {
	return domain.FriendRequestProjection{
		RequestID:                 "request",
		Sender:                    &model.ActorRef{Ptid: "ptid:sender"},
		Receiver:                  &model.ActorRef{Ptid: "ptid:receiver"},
		SenderHomeStationPeerID:   "sender-station",
		ReceiverHomeStationPeerID: "receiver-station",
		State:                     state,
	}
}

func TestFriendRequestAttentionWaitsForCommitAndPreservesRecipientAuthority(t *testing.T) {
	producer := &attentionProducer{}
	publisher := NewFriendRequestAttentionPublisher(producer)
	transaction := &attentionTransaction{}
	pending := attentionProjection(model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING)
	publisher.afterCommit(context.Background(), transaction, pending, "sender-station")
	if len(transaction.callbacks) != 0 {
		t.Fatal("outgoing unconfirmed request produced a notification")
	}
	publisher.afterCommit(context.Background(), transaction, pending, "receiver-station")
	if len(producer.records) != 0 || len(transaction.callbacks) != 1 {
		t.Fatal("notification escaped the post-commit owner")
	}
	if err := transaction.callbacks[0](context.Background()); err != nil {
		t.Fatal(err)
	}
	want := attentionRecord{
		recipient: "ptid:receiver", actor: "ptid:sender", target: "request",
		kind:     int32(notification.NotificationType_NOTIFICATION_TYPE_FRIEND_REQUEST),
		category: int32(notification.NotificationCategory_NOTIFICATION_CATEGORY_CHAT),
	}
	if producer.records[0] != want {
		t.Fatalf("notification = %+v, want %+v", producer.records[0], want)
	}
}

func TestFriendRequestAcceptanceAttentionIsFailureTransparent(t *testing.T) {
	producer := &attentionProducer{err: errors.New("notification unavailable")}
	publisher := NewFriendRequestAttentionPublisher(producer)
	transaction := &attentionTransaction{}
	accepted := attentionProjection(model.FriendRequestState_FRIEND_REQUEST_STATE_ACCEPTED)
	publisher.afterCommit(context.Background(), transaction, accepted, "receiver-station")
	if len(transaction.callbacks) != 0 {
		t.Fatal("remote sender notification was produced on receiver Station")
	}
	publisher.afterCommit(context.Background(), transaction, accepted, "sender-station")
	if len(transaction.callbacks) != 1 {
		t.Fatal("local sender notification was not deferred")
	}
	if err := transaction.callbacks[0](context.Background()); err != nil {
		t.Fatalf("derived notification failure changed the Social outcome: %v", err)
	}
	if len(producer.records) != 1 || producer.records[0].recipient != "ptid:sender" ||
		producer.records[0].actor != "ptid:receiver" ||
		producer.records[0].kind != int32(notification.NotificationType_NOTIFICATION_TYPE_FRIEND_ACCEPTED) {
		t.Fatalf("acceptance notification = %+v", producer.records)
	}
}
