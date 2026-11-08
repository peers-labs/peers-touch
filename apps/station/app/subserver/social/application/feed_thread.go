package application

import (
	"context"
	"errors"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm/clause"
)

func (s *FeedLogService) verifyThreadResponse(ctx context.Context, tx delivery.Transaction, response *model.ReadFeedResponse) error {
	for _, entry := range response.ThreadEntries {
		if err := s.verifyStoredInteraction(ctx, tx, entry.Receipt, entry.InteractionHomeStation); err != nil {
			return err
		}
	}
	return nil
}

func (s *FeedLogService) importThread(ctx context.Context, subscription infrastructure.FeedSubscriptionRecord, response *model.ReadFeedResponse) error {
	if len(response.ThreadEntries) > 32 || proto.Size(response) > signedlog.MaxMessageBytes {
		return domain.ErrFeedInvalid
	}
	var conflictingActor, conflictingChain string
	err := s.store.Execute(ctx, func(tx delivery.Transaction) error {
		cursor := subscription.ThreadCursor
		for _, entry := range response.ThreadEntries {
			if entry == nil || entry.Cursor != cursor+1 || entry.Receipt == nil {
				return domain.ErrFeedGap
			}
			if err := s.verifyStoredInteraction(ctx, tx, entry.Receipt, entry.InteractionHomeStation); err != nil {
				return err
			}
			payload := &model.FeedPayload{}
			if err := signedlog.Decode(entry.Receipt.Event.Payload, payload); err != nil {
				return err
			}
			target := payload.GetReaction().GetTargetPostRef()
			if payload.GetComment() != nil {
				target = payload.GetComment().TargetPostRef
			}
			home, id, err := domain.FeedTargetPost(target)
			if err != nil || home != subscription.AuthorStation {
				return domain.ErrFeedWriter
			}
			var post infrastructure.FeedObjectRecord
			if err := tx.DB().Where("home_station = ? AND object_kind = 'post' AND object_id = ? AND actor_ptid = ?", home, id, subscription.AuthorPTID).Take(&post).Error; err != nil {
				return domain.ErrFeedGap
			}
			if _, err := s.projector.StoreInteraction(infrastructure.FeedTransactionContext(ctx, tx), tx.DB(), entry.Receipt, entry.InteractionHomeStation, true); err != nil {
				if errors.Is(err, domain.ErrFeedFork) {
					conflictingActor = entry.Receipt.Event.Statement.ActorPtid
					conflictingChain = entry.Receipt.Event.Statement.ChainId
				}
				return err
			}
			statement := entry.Receipt.Event.Statement
			index := infrastructure.FeedThreadRecord{AuthorPTID: subscription.AuthorPTID, Cursor: entry.Cursor,
				ActorPTID: statement.ActorPtid, ChainID: statement.ChainId, Sequence: statement.Sequence}
			if err := tx.DB().Clauses(clause.OnConflict{DoNothing: true}).Create(&index).Error; err != nil {
				return err
			}
			var existing infrastructure.FeedThreadRecord
			if err := tx.DB().Where("author_ptid = ? AND cursor = ?", subscription.AuthorPTID, entry.Cursor).Take(&existing).Error; err != nil {
				return err
			}
			if existing.ActorPTID != index.ActorPTID || existing.ChainID != index.ChainID || existing.Sequence != index.Sequence {
				return domain.ErrFeedInvalid
			}
			cursor = entry.Cursor
		}
		if response.ThreadCursor != cursor {
			return domain.ErrFeedGap
		}
		head := infrastructure.FeedThreadHead{AuthorPTID: subscription.AuthorPTID, Cursor: cursor}
		if err := tx.DB().Clauses(clause.OnConflict{DoNothing: true}).Create(&head).Error; err != nil {
			return err
		}
		if err := tx.DB().Model(&head).Where("cursor < ?", cursor).Update("cursor", cursor).Error; err != nil {
			return err
		}
		return s.store.AdvanceThreadCursor(ctx, tx.DB(), subscription, cursor)
	})
	if errors.Is(err, domain.ErrFeedFork) && conflictingActor != "" {
		if quarantine := s.store.Execute(ctx, func(tx delivery.Transaction) error {
			return s.store.QuarantineInteraction(ctx, tx.DB(), conflictingActor, conflictingChain)
		}); quarantine != nil {
			return quarantine
		}
	}
	return err
}
