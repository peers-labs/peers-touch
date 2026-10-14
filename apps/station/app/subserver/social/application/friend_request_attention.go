package application

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	notification "github.com/peers-labs/peers-touch/station/frame/touch/model/notification"
)

// FriendRequestNotificationProducer keeps derived attention outside Social authority.
type FriendRequestNotificationProducer interface {
	Produce(recipientPTID, actorPTID string, notifType, category int32, targetType, targetID, title, body, groupKey string, metadata map[string]string) error
}

type FriendRequestAttentionPublisher struct {
	notifications FriendRequestNotificationProducer
	events        *SocialGraphEventPublisher
}

func NewFriendRequestAttentionPublisher(producer FriendRequestNotificationProducer) *FriendRequestAttentionPublisher {
	return &FriendRequestAttentionPublisher{
		notifications: producer,
		events:        NewSocialGraphEventPublisher(),
	}
}

// afterCommit publishes only newly committed local recipient transitions.
// Notification failures never change the already committed Social outcome.
func (p *FriendRequestAttentionPublisher) afterCommit(
	ctx context.Context,
	transaction infrastructure.FederatedFriendRequestTransaction,
	projection domain.FriendRequestProjection,
	localStationID string,
) {
	if p == nil {
		return
	}
	sender, receiver := projection.Sender.GetPtid(), projection.Receiver.GetPtid()
	if sender == "" || receiver == "" || sender == receiver {
		return
	}
	pending := projection.State == model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING &&
		projection.ReceiverHomeStationPeerID == localStationID
	accepted := projection.State == model.FriendRequestState_FRIEND_REQUEST_STATE_ACCEPTED &&
		projection.SenderHomeStationPeerID == localStationID
	if !pending && !accepted {
		return
	}
	registrar, ok := transaction.(delivery.AfterCommitRegistrar)
	if !ok {
		logger.Warn(ctx, "social.attention: transaction has no post-commit owner")
		return
	}
	if err := registrar.AfterCommit(func(callbackContext context.Context) error {
		recipient, actor := receiver, sender
		kind := notification.NotificationType_NOTIFICATION_TYPE_FRIEND_REQUEST
		body := projection.Message
		if accepted {
			recipient, actor = sender, receiver
			kind = notification.NotificationType_NOTIFICATION_TYPE_FRIEND_ACCEPTED
			body = ""
		}
		if p.notifications != nil {
			if err := p.notifications.Produce(
				recipient, actor, int32(kind),
				int32(notification.NotificationCategory_NOTIFICATION_CATEGORY_CHAT),
				"friend_request", projection.RequestID, "", body,
				"friend_request:"+projection.RequestID, nil,
			); err != nil {
				logger.Warn(callbackContext, "social.attention: notification failed",
					"request_id", projection.RequestID, "error", err)
			}
		}
		if pending {
			p.events.PublishFriendRequestReceived(callbackContext, sender, receiver, projection.RequestID)
		} else {
			p.events.PublishFriendRequestAccepted(callbackContext, receiver, sender, projection.RequestID, "")
		}
		return nil
	}); err != nil {
		logger.Warn(ctx, "social.attention: post-commit registration failed", "error", err)
	}
}
