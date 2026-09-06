package infrastructure

import (
	"bytes"
	"context"
	"errors"
	"fmt"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

type FollowerReplayRepository struct {
	db *gorm.DB
}

func NewFollowerReplayRepository(db *gorm.DB) (*FollowerReplayRepository, error) {
	if db == nil {
		return nil, fmt.Errorf("messaging: follower replay repository is not configured")
	}
	return &FollowerReplayRepository{db: db}, nil
}

func (r *FollowerReplayRepository) ReadGrantedFollowerEvents(
	ctx context.Context,
	request *chat.GetMessagingFollowerEventsRequest,
) ([]messaging.GrantedFollowerEvent, int64, bool, error) {
	if request == nil ||
		request.ConversationId == "" ||
		request.TargetHomeStationId == "" ||
		request.AfterSequence < 0 ||
		request.PageLimit == 0 {
		return nil, 0, false, messaging.ErrFollowerReplayInvalid
	}
	var conversation AuthorityConversationModel
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ?", request.ConversationId).
		First(&conversation).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, 0, false, messaging.ErrFollowerReplayUnavailable
		}
		return nil, 0, false, err
	}
	if request.AfterSequence > conversation.CurrentSequence {
		return nil, 0, false, messaging.ErrFollowerReplayInvalid
	}
	if err := r.validateObservedHead(ctx, request); err != nil {
		return nil, 0, false, err
	}
	if err := r.rejectOrphanedGrants(ctx, request); err != nil {
		return nil, 0, false, err
	}

	limit := int(request.PageLimit)
	var grants []EventProjectionGrantModel
	if err := r.db.WithContext(ctx).
		Table("messaging_event_projection_targets AS grants").
		Select("grants.*").
		Joins(
			"JOIN messaging_events AS events "+
				"ON events.conversation_id = grants.conversation_id "+
				"AND events.event_id = grants.event_id",
		).
		Where(
			"grants.conversation_id = ? AND grants.target_home_station_id = ? "+
				"AND events.sequence > ?",
			request.ConversationId,
			request.TargetHomeStationId,
			request.AfterSequence,
		).
		Order("events.sequence ASC").
		Limit(limit + 1).
		Find(&grants).Error; err != nil {
		return nil, 0, false, err
	}
	if len(grants) == 0 {
		var grantedCount int64
		if err := r.db.WithContext(ctx).
			Model(&EventProjectionGrantModel{}).
			Where(
				"conversation_id = ? AND target_home_station_id = ?",
				request.ConversationId,
				request.TargetHomeStationId,
			).
			Count(&grantedCount).Error; err != nil {
			return nil, 0, false, err
		}
		if grantedCount == 0 ||
			request.AfterSequence < conversation.CurrentSequence {
			return nil, 0, false, messaging.ErrFollowerReplayNotGranted
		}
		return nil, request.AfterSequence, false, nil
	}

	hasMore := len(grants) > limit
	if hasMore {
		grants = grants[:limit]
	}
	result := make([]messaging.GrantedFollowerEvent, 0, len(grants))
	nextSequence := request.AfterSequence
	for _, grant := range grants {
		var eventModel AuthorityEventModel
		if err := r.db.WithContext(ctx).
			Where(
				"conversation_id = ? AND event_id = ?",
				request.ConversationId,
				grant.EventID,
			).
			First(&eventModel).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, 0, false, messaging.ErrFollowerReplayUnavailable
			}
			return nil, 0, false, err
		}
		event := &chat.ConversationEvent{}
		if err := proto.Unmarshal(eventModel.EventBytes, event); err != nil {
			return nil, 0, false, messaging.ErrFollowerReplayUnavailable
		}
		if event.ConversationId != request.ConversationId ||
			event.EventId != grant.EventID ||
			event.Sequence != eventModel.Sequence ||
			event.Sequence <= nextSequence {
			return nil, 0, false, messaging.ErrFollowerReplayUnavailable
		}
		if request.AfterSequence > 0 && len(result) == 0 &&
			event.Sequence != request.AfterSequence+1 {
			return nil, 0, false, messaging.ErrFollowerReplayNotGranted
		}
		result = append(result, messaging.GrantedFollowerEvent{
			Event: event,
			Grant: messaging.EventProjectionGrant{
				ConversationID:      grant.ConversationID,
				EventID:             grant.EventID,
				TargetHomeStationID: grant.TargetHomeStationID,
				EntitlementReason:   grant.EntitlementReason,
			},
		})
		nextSequence = event.Sequence
	}
	return result, nextSequence, hasMore, nil
}

func (r *FollowerReplayRepository) validateObservedHead(
	ctx context.Context,
	request *chat.GetMessagingFollowerEventsRequest,
) error {
	if request.AfterSequence == 0 {
		if len(request.AfterEventHash) != 0 {
			return messaging.ErrFollowerReplayInvalid
		}
		return nil
	}
	var event AuthorityEventModel
	if err := r.db.WithContext(ctx).
		Where(
			"conversation_id = ? AND sequence = ?",
			request.ConversationId,
			request.AfterSequence,
		).
		First(&event).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return messaging.ErrFollowerReplayUnavailable
		}
		return err
	}
	if !bytes.Equal(event.EventHash, request.AfterEventHash) {
		return messaging.ErrFollowerReplayInvalid
	}
	var grantCount int64
	if err := r.db.WithContext(ctx).
		Model(&EventProjectionGrantModel{}).
		Where(
			"conversation_id = ? AND event_id = ? AND target_home_station_id = ?",
			request.ConversationId,
			event.EventID,
			request.TargetHomeStationId,
		).
		Count(&grantCount).Error; err != nil {
		return err
	}
	if grantCount != 1 {
		return messaging.ErrFollowerReplayNotGranted
	}
	return nil
}

func (r *FollowerReplayRepository) rejectOrphanedGrants(
	ctx context.Context,
	request *chat.GetMessagingFollowerEventsRequest,
) error {
	var count int64
	if err := r.db.WithContext(ctx).
		Table("messaging_event_projection_targets AS grants").
		Joins(
			"LEFT JOIN messaging_events AS events "+
				"ON events.conversation_id = grants.conversation_id "+
				"AND events.event_id = grants.event_id",
		).
		Where(
			"grants.conversation_id = ? AND grants.target_home_station_id = ? "+
				"AND events.event_id IS NULL",
			request.ConversationId,
			request.TargetHomeStationId,
		).
		Count(&count).Error; err != nil {
		return err
	}
	if count != 0 {
		return messaging.ErrFollowerReplayUnavailable
	}
	return nil
}

var _ messaging.FollowerReplaySource = (*FollowerReplayRepository)(nil)
