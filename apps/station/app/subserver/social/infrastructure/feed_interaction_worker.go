package infrastructure

import (
	"bytes"
	"context"
	"errors"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (s *FeedLogStore) ProcessInteractions(ctx context.Context, projector *FeedProjector,
	verify func(context.Context, delivery.Transaction, *model.FeedInteraction, string) error,
	send func(context.Context, delivery.Transaction, string, *model.FeedInteraction) error,
	returnAdmission func(context.Context, delivery.Transaction, string, *model.FeedInteraction) error) error {
	const pending = "(forwarded = ? OR projected = ? OR (admission_return_required = ? AND admission_returned = ?))"
	var rows []FeedInteractionRecord
	if err := s.database.WithContext(ctx).
		Where(pending+" AND next_attempt_at <= ?", false, false, true, false, time.Now().UTC()).
		Order("next_attempt_at ASC, actor_ptid ASC, sequence ASC").Limit(32).Find(&rows).Error; err != nil {
		return err
	}
	var firstError error
	for _, selected := range rows {
		err := s.Execute(ctx, func(tx delivery.Transaction) error {
			candidate, err := verifiedReceiptRow(&selected)
			if err != nil {
				return err
			}
			payload := &model.FeedPayload{}
			if err := signedlog.Decode(candidate.Event.Payload, payload); err != nil {
				return err
			}
			target, err := domain.FeedInteractionTarget(payload)
			if err != nil {
				return err
			}
			// Match delivery's post -> receipt -> thread order. A busy or
			// absent parent leaves the receipt for the next bounded pass.
			locked, err := lockFeedInteractionPost(ctx, tx.DB(), target, true)
			if err != nil || !locked {
				return err
			}
			var row FeedInteractionRecord
			err = tx.DB().Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
				Where(pending, false, false, true, false).
				Where("actor_ptid = ? AND chain_id = ? AND sequence = ? AND next_attempt_at <= ?",
					selected.ActorPTID, selected.ChainID, selected.Sequence, time.Now().UTC()).Take(&row).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			if err != nil {
				return err
			}
			receipt, err := verifiedReceiptRow(&row)
			if err != nil {
				return err
			}
			if err := verify(ctx, tx, receipt, row.HomeStation); err != nil {
				return err
			}
			if !row.Forwarded {
				if err := send(ctx, tx, row.TargetStation, receipt); err != nil {
					return err
				}
			}
			if !row.Projected {
				if _, err := projector.StoreInteraction(FeedTransactionContext(ctx, tx), tx.DB(), receipt, row.HomeStation, true); err != nil {
					return err
				}
				if err := tx.DB().Where("actor_ptid = ? AND chain_id = ? AND sequence = ?",
					row.ActorPTID, row.ChainID, row.Sequence).Take(&row).Error; err != nil {
					return err
				}
			}
			if row.AdmissionReturnRequired && !row.AdmissionReturned {
				if returnAdmission == nil {
					return domain.ErrFeedInvalid
				}
				receipt, err = verifiedReceiptRow(&row)
				if err != nil {
					return err
				}
				if err := verify(FeedTransactionContext(ctx, tx), tx, receipt, row.HomeStation); err != nil {
					return err
				}
				if err := returnAdmission(ctx, tx, row.HomeStation, receipt); err != nil {
					return err
				}
			}
			return tx.DB().Model(&row).Update("next_attempt_at", time.Now().UTC().Add(30*time.Second)).Error
		})
		if err != nil {
			if errors.Is(err, domain.ErrFeedFork) {
				if quarantine := s.QuarantineInteraction(ctx, s.database, selected.ActorPTID, selected.ChainID); quarantine != nil {
					return quarantine
				}
			}
			// A bad receipt or temporary identity/network failure must neither
			// commit partial work nor prevent later valid receipts from running.
			if delayErr := s.database.WithContext(ctx).Model(&FeedInteractionRecord{}).
				Where("actor_ptid = ? AND chain_id = ? AND sequence = ?", selected.ActorPTID, selected.ChainID, selected.Sequence).
				Update("next_attempt_at", time.Now().UTC().Add(30*time.Second)).Error; delayErr != nil {
				return delayErr
			}
			if firstError == nil {
				firstError = err
			}
		}
	}
	return firstError
}

func verifiedReceiptRow(row *FeedInteractionRecord) (*model.FeedInteraction, error) {
	receipt := &model.FeedInteraction{}
	if err := signedlog.Decode(row.Interaction, receipt); err != nil {
		return nil, err
	}
	if receipt.Event == nil || receipt.Event.Statement == nil {
		return nil, domain.ErrFeedInvalid
	}
	event := receipt.Event
	hash, err := domain.FeedEventHash(event)
	if err != nil {
		return nil, err
	}
	statement := event.Statement
	if statement.ActorPtid != row.ActorPTID || statement.ChainId != row.ChainID ||
		statement.Sequence != row.Sequence || !bytes.Equal(hash, row.EventHash) {
		return nil, domain.ErrFeedInvalid
	}
	payload := &model.FeedPayload{}
	if err := signedlog.Decode(event.Payload, payload); err != nil {
		return nil, err
	}
	target, err := domain.FeedInteractionTarget(payload)
	if err != nil {
		return nil, err
	}
	home, _, err := domain.FeedTargetPost(target)
	if err != nil || home != row.TargetStation {
		return nil, domain.ErrFeedInvalid
	}
	if receipt.PollAdmission != nil {
		return nil, domain.ErrFeedInvalid
	}
	if len(row.PollAdmission) != 0 {
		if payload.GetPollBallot() == nil {
			return nil, domain.ErrFeedInvalid
		}
		receipt.PollAdmission = &model.FeedPollAdmission{}
		if err := signedlog.Decode(row.PollAdmission, receipt.PollAdmission); err != nil {
			return nil, err
		}
	}
	return receipt, nil
}

func (s *FeedLogStore) FanoutInteractionOne(ctx context.Context, local string,
	verify func(context.Context, delivery.Transaction, *model.FeedInteraction, string) error,
	send func(context.Context, delivery.Transaction, string, *model.FeedInteraction) error) error {
	var intent FeedInteractionFanout
	err := s.Execute(ctx, func(tx delivery.Transaction) error {
		err := tx.DB().Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Where("completed = ? AND next_attempt_at <= ?", false, time.Now().UTC()).
			Order("next_attempt_at ASC, actor_ptid ASC, sequence ASC").Take(&intent).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		station, postID, err := domain.FeedTargetPost(intent.PostRef)
		if err != nil || station != local {
			return domain.ErrFeedInvalid
		}
		var post FeedObjectRecord
		err = tx.DB().Where("home_station = ? AND object_kind = 'post' AND object_id = ?", local, postID).Take(&post).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return tx.DB().Model(&intent).Update("next_attempt_at", time.Now().UTC().Add(30*time.Second)).Error
		}
		if err != nil {
			return err
		}
		var row FeedInteractionRecord
		if err := tx.DB().Where("actor_ptid = ? AND chain_id = ? AND sequence = ?",
			intent.ActorPTID, intent.ChainID, intent.Sequence).Take(&row).Error; err != nil {
			return err
		}
		receipt, err := verifiedReceiptRow(&row)
		if err != nil {
			return err
		}
		if err := verify(ctx, tx, receipt, row.HomeStation); err != nil {
			return err
		}
		var stations []string
		if err := tx.DB().Model(&FeedSubscriptionRecord{}).Distinct("subscriber_station").
			Where("author_ptid = ? AND chain_id = ? AND enabled = ? AND subscriber_station > ? AND subscriber_station <> ?",
				post.ActorPTID, domain.PublicFeedChainID, true, intent.AfterStation, local).
			Order("subscriber_station ASC").Limit(32).Pluck("subscriber_station", &stations).Error; err != nil {
			return err
		}
		for _, station := range stations {
			if err := send(ctx, tx, station, receipt); err != nil {
				return err
			}
			intent.AfterStation = station
		}
		intent.Completed = len(stations) < 32
		return tx.DB().Save(&intent).Error
	})
	if err != nil && intent.ActorPTID != "" {
		// Retry outside the rolled-back transaction so a poisoned intent
		// cannot monopolize the front of the shared worker queue.
		if delayErr := s.database.WithContext(ctx).Model(&FeedInteractionFanout{}).
			Where("actor_ptid = ? AND chain_id = ? AND sequence = ?", intent.ActorPTID, intent.ChainID, intent.Sequence).
			Update("next_attempt_at", time.Now().UTC().Add(30*time.Second)).Error; delayErr != nil {
			return delayErr
		}
	}
	return err
}
