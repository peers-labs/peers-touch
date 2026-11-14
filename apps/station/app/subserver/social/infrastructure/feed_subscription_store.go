package infrastructure

import (
	"context"
	"errors"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (s *FeedLogStore) SetSubscriptionTx(ctx context.Context, tx *gorm.DB,
	author, subscriber, authorStation, subscriberStation string, enabled bool,
	remoteRevision uint64) (*FeedSubscriptionRecord, bool, error) {
	key := FeedSubscriptionRecord{AuthorPTID: author, ChainID: domain.PublicFeedChainID,
		SubscriberPTID: subscriber, AuthorStation: authorStation, SubscriberStation: subscriberStation,
		NextSyncAt: time.Now().UTC()}
	if author == "" || subscriber == "" || author == subscriber || authorStation == "" || subscriberStation == "" {
		return nil, false, domain.ErrFeedInvalid
	}
	if err := tx.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&key).Error; err != nil {
		return nil, false, err
	}
	var row FeedSubscriptionRecord
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("author_ptid = ? AND chain_id = ? AND subscriber_ptid = ?", author, key.ChainID, subscriber).
		Take(&row).Error; err != nil {
		return nil, false, err
	}
	if row.AuthorStation != authorStation || row.SubscriberStation != subscriberStation {
		return nil, false, domain.ErrFeedWriter
	}
	if remoteRevision != 0 && remoteRevision <= row.Revision {
		if remoteRevision == row.Revision && row.Enabled != enabled {
			return nil, false, domain.ErrFeedInvalid
		}
		return &row, true, nil
	}
	if remoteRevision == 0 && row.Revision != 0 && row.Enabled == enabled {
		return &row, true, nil
	}
	row.Revision++
	if remoteRevision != 0 {
		row.Revision = remoteRevision
	}
	row.Enabled, row.Dirty = enabled, enabled
	row.DirtyRevision++
	row.NextSyncAt = time.Now().UTC()
	if err := tx.Save(&row).Error; err != nil {
		return nil, false, err
	}
	return &row, false, nil
}

func (s *FeedLogStore) AuthorizeSubscription(ctx context.Context, tx *gorm.DB,
	author, subscriber, station string) error {
	var count int64
	if err := tx.WithContext(ctx).Model(&FeedSubscriptionRecord{}).
		Where("author_ptid = ? AND chain_id = ? AND subscriber_ptid = ? AND subscriber_station = ? AND enabled = ?",
			author, domain.PublicFeedChainID, subscriber, station, true).Count(&count).Error; err != nil {
		return err
	}
	if count != 1 {
		return domain.ErrFeedWriter
	}
	return nil
}

func (s *FeedLogStore) MarkFeedDirty(ctx context.Context, tx *gorm.DB,
	head *model.FeedHead, source, local string) error {
	if head == nil || head.ActorPtid == "" || head.ChainId != domain.PublicFeedChainID || len(head.EventHash) != 32 {
		return domain.ErrFeedInvalid
	}
	return tx.WithContext(ctx).Model(&FeedSubscriptionRecord{}).
		Where("author_ptid = ? AND chain_id = ? AND author_station = ? AND subscriber_station = ? AND enabled = ?",
			head.ActorPtid, head.ChainId, source, local, true).
		Updates(map[string]interface{}{"dirty": true, "dirty_revision": gorm.Expr("dirty_revision + 1"),
			"next_sync_at": time.Now().UTC()}).Error
}

func (s *FeedLogStore) PendingSync(ctx context.Context, local string, now time.Time) ([]FeedSubscriptionRecord, error) {
	var rows []FeedSubscriptionRecord
	err := s.database.WithContext(ctx).Where("subscriber_station = ? AND author_station <> ? AND enabled = ? AND next_sync_at <= ?",
		local, local, true, now).Order("next_sync_at ASC, author_ptid ASC").Limit(32).Find(&rows).Error
	return rows, err
}

func (s *FeedLogStore) FinishSync(ctx context.Context, row FeedSubscriptionRecord, successful, more bool) error {
	delay := time.Minute
	if successful && more {
		delay = time.Second
	}
	return s.database.WithContext(ctx).Model(&FeedSubscriptionRecord{}).
		Where("author_ptid = ? AND chain_id = ? AND subscriber_ptid = ? AND revision = ? AND dirty_revision = ?",
			row.AuthorPTID, row.ChainID, row.SubscriberPTID, row.Revision, row.DirtyRevision).
		Updates(map[string]interface{}{"dirty": !successful || more, "next_sync_at": time.Now().UTC().Add(delay)}).Error
}

func (s *FeedLogStore) LocalSequence(ctx context.Context, actor string) (uint64, error) {
	var row FeedChainRecord
	err := s.database.WithContext(ctx).Where("actor_ptid = ? AND chain_id = ?", actor, domain.PublicFeedChainID).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, nil
	}
	if err == nil && row.Forked {
		return 0, domain.ErrFeedFork
	}
	return row.Sequence, err
}

type FeedGraphChange struct {
	AuthorPTID     string `gorm:"column:author_pt_id"`
	SubscriberPTID string `gorm:"column:subscriber_pt_id"`
	Enabled        bool
}

// The candidate scan is only a scheduling hint. Re-read under the original
// relationship owner's lock so a concurrent unfollow cannot be overwritten
// by an older enable candidate.
func (s *FeedLogStore) ReconcileGraphChange(ctx context.Context, tx delivery.Transaction,
	change FeedGraphChange, apply func(bool) error) error {
	if err := lockSocialRelationshipAuthority(tx.DB(), change.AuthorPTID); err != nil {
		return err
	}
	enabled, err := NewFollowRepository(tx.DB()).IsFollowing(ctx, change.SubscriberPTID, change.AuthorPTID)
	if err != nil {
		return err
	}
	return apply(enabled)
}

// Reconcile the original durable follow graph, including mutations performed
// by federated friendship and block owners. No caller callback is required for
// correctness; callbacks only reduce propagation latency.
func (s *FeedLogStore) PendingGraphChanges(ctx context.Context, local string) ([]FeedGraphChange, error) {
	var changes []FeedGraphChange
	err := s.database.WithContext(ctx).Raw(`
SELECT author.ptid AS author_pt_id, subscriber.ptid AS subscriber_pt_id, TRUE AS enabled
FROM follows AS f
JOIN touch_actor AS author ON author.id = f.following_id
JOIN touch_actor AS subscriber ON subscriber.id = f.follower_id
LEFT JOIN social_feed_subscriptions AS subscription ON
  subscription.author_ptid = author.ptid AND subscription.subscriber_ptid = subscriber.ptid AND subscription.chain_id = ?
WHERE subscriber.home_station_peer_id = ? AND
  (subscription.author_ptid IS NULL OR subscription.enabled = FALSE)
UNION ALL
SELECT subscription.author_ptid AS author_pt_id, subscription.subscriber_ptid AS subscriber_pt_id, FALSE AS enabled
FROM social_feed_subscriptions AS subscription
WHERE subscription.subscriber_station = ? AND subscription.enabled = TRUE AND NOT EXISTS (
  SELECT 1 FROM follows AS f
  JOIN touch_actor AS author ON author.id = f.following_id
  JOIN touch_actor AS subscriber ON subscriber.id = f.follower_id
  WHERE author.ptid = subscription.author_ptid AND subscriber.ptid = subscription.subscriber_ptid
)
ORDER BY author_pt_id, subscriber_pt_id LIMIT 32`, domain.PublicFeedChainID, local, local).Scan(&changes).Error
	return changes, err
}

// FanoutOne locks one intent and enumerates at most 32 distinct Station
// recipients. Outbox insertion and cursor advancement commit together.
func (s *FeedLogStore) FanoutOne(ctx context.Context, local string,
	send func(context.Context, delivery.Transaction, string, *model.FeedNotification) error) (bool, error) {
	processed := false
	var intent FeedFanoutRecord
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
		processed = true
		var event FeedEventRecord
		if err := tx.DB().Where("actor_ptid = ? AND chain_id = ? AND sequence = ?",
			intent.ActorPTID, intent.ChainID, intent.Sequence).Take(&event).Error; err != nil {
			return err
		}
		if intent.Sequence == 0 {
			return domain.ErrFeedInvalid
		}
		if _, err := s.Read(ctx, tx.DB(), &model.ReadFeedRequest{ActorPtid: intent.ActorPTID,
			ChainId: intent.ChainID, AfterSequence: intent.Sequence - 1, Limit: 1}); err != nil {
			return err
		}
		var stations []string
		if err := tx.DB().Model(&FeedSubscriptionRecord{}).Distinct("subscriber_station").
			Where("author_ptid = ? AND chain_id = ? AND enabled = ? AND subscriber_station > ? AND subscriber_station <> ?",
				intent.ActorPTID, intent.ChainID, true, intent.AfterStation, local).
			Order("subscriber_station ASC").Limit(32).Pluck("subscriber_station", &stations).Error; err != nil {
			return err
		}
		notification := &model.FeedNotification{Head: &model.FeedHead{ActorPtid: intent.ActorPTID,
			ChainId: intent.ChainID, Sequence: intent.Sequence, EventHash: event.EventHash}}
		for _, station := range stations {
			if err := send(ctx, tx, station, notification); err != nil {
				return err
			}
			intent.AfterStation = station
		}
		intent.Completed = len(stations) < 32
		return tx.DB().Save(&intent).Error
	})
	if err != nil && intent.ActorPTID != "" {
		if delayErr := s.database.WithContext(ctx).Model(&FeedFanoutRecord{}).
			Where("actor_ptid = ? AND chain_id = ? AND sequence = ?", intent.ActorPTID, intent.ChainID, intent.Sequence).
			Update("next_attempt_at", time.Now().UTC().Add(30*time.Second)).Error; delayErr != nil {
			return processed, delayErr
		}
	}
	return processed, err
}
