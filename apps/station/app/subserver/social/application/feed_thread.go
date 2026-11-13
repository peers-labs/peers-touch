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

func (s *FeedLogService) importThread(ctx context.Context, author, authorStation string, after uint64,
	response *model.ReadFeedResponse, complete func(context.Context, delivery.Transaction, uint64) error) error {
	if author == "" || authorStation == "" || response == nil ||
		len(response.ThreadEntries) > 32 || proto.Size(response) > signedlog.MaxMessageBytes {
		return domain.ErrFeedInvalid
	}
	var conflictingActor, conflictingChain string
	err := s.store.Execute(ctx, func(tx delivery.Transaction) error {
		cursor := after
		events := make([]*model.FeedEvent, 0, len(response.ThreadEntries))
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
			target, err := domain.FeedInteractionTarget(payload)
			if err != nil {
				return err
			}
			home, id, err := domain.FeedTargetPost(target)
			if err != nil || home != authorStation {
				return domain.ErrFeedWriter
			}
			var post infrastructure.FeedObjectRecord
			if err := tx.DB().Where("home_station = ? AND object_kind = 'post' AND object_id = ? AND actor_ptid = ?", home, id, author).Take(&post).Error; err != nil {
				return domain.ErrFeedGap
			}
			events = append(events, entry.Receipt.Event)
			cursor = entry.Cursor
		}
		if response.ThreadCursor != cursor {
			return domain.ErrFeedGap
		}
		bound, err := s.projector.LockInteractions(infrastructure.FeedTransactionContext(ctx, tx), tx.DB(), events)
		if err != nil {
			return err
		}
		if err := infrastructure.LockFeedThreadHead(bound, tx.DB(), author); err != nil {
			return err
		}
		for _, entry := range response.ThreadEntries {
			if _, err := s.projector.StoreInteraction(bound, tx.DB(), entry.Receipt, entry.InteractionHomeStation, true); err != nil {
				if errors.Is(err, domain.ErrFeedFork) {
					conflictingActor = entry.Receipt.Event.Statement.ActorPtid
					conflictingChain = entry.Receipt.Event.Statement.ChainId
				}
				return err
			}
			statement := entry.Receipt.Event.Statement
			index := infrastructure.FeedThreadRecord{AuthorPTID: author, Cursor: entry.Cursor,
				ActorPTID: statement.ActorPtid, ChainID: statement.ChainId, Sequence: statement.Sequence}
			if err := tx.DB().Clauses(clause.OnConflict{DoNothing: true}).Create(&index).Error; err != nil {
				return err
			}
			var existing infrastructure.FeedThreadRecord
			if err := tx.DB().Where("author_ptid = ? AND cursor = ?", author, entry.Cursor).Take(&existing).Error; err != nil {
				return err
			}
			if existing.ActorPTID != index.ActorPTID || existing.ChainID != index.ChainID || existing.Sequence != index.Sequence {
				return domain.ErrFeedInvalid
			}
		}
		head := infrastructure.FeedThreadHead{AuthorPTID: author, Cursor: cursor}
		if err := tx.DB().Clauses(clause.OnConflict{DoNothing: true}).Create(&head).Error; err != nil {
			return err
		}
		if err := tx.DB().Model(&head).Where("cursor < ?", cursor).Update("cursor", cursor).Error; err != nil {
			return err
		}
		if complete != nil {
			return complete(ctx, tx, cursor)
		}
		return nil
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
