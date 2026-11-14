package infrastructure

import (
	"context"
	"errors"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type FeedThreadHead struct {
	AuthorPTID string `gorm:"column:author_ptid;primaryKey;size:255"`
	Cursor     uint64 `gorm:"not null"`
}

func (FeedThreadHead) TableName() string { return "social_feed_thread_heads" }

type FeedThreadRecord struct {
	AuthorPTID string `gorm:"column:author_ptid;primaryKey;size:255"`
	Cursor     uint64 `gorm:"primaryKey;autoIncrement:false"`
	ActorPTID  string `gorm:"column:actor_ptid;not null;size:255;uniqueIndex:feed_thread_receipt"`
	ChainID    string `gorm:"not null;size:128;uniqueIndex:feed_thread_receipt"`
	Sequence   uint64 `gorm:"not null;uniqueIndex:feed_thread_receipt"`
}

func (FeedThreadRecord) TableName() string { return "social_feed_thread_entries" }

// LockFeedThreadHead is also used by thread import, after its parent lock set.
func LockFeedThreadHead(ctx context.Context, tx *gorm.DB, author string) error {
	head := FeedThreadHead{AuthorPTID: author}
	if err := tx.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&head).Error; err != nil {
		return err
	}
	return tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("author_ptid = ?", author).Take(&head).Error
}

// Allocate under the author's thread-head lock. Cursor and receipt commit
// together; SQL sequence allocation alone could expose an uncommitted hole.
func indexThread(ctx context.Context, tx *gorm.DB, local, target string, row *FeedInteractionRecord) error {
	locks, err := feedProjectionLocksFromContext(ctx, tx)
	if err != nil {
		return err
	}
	post := locks.parents[target]
	if post == nil {
		return nil
	}
	if post.HomeStation != local || locks.threadLocal != local {
		return domain.ErrFeedInvalid
	}
	var head FeedThreadHead
	if err := tx.WithContext(ctx).Where("author_ptid = ?", post.ActorPTID).Take(&head).Error; err != nil {
		return err
	}
	var count int64
	if err := tx.Model(&FeedThreadRecord{}).Where("actor_ptid = ? AND chain_id = ? AND sequence = ?", row.ActorPTID, row.ChainID, row.Sequence).Count(&count).Error; err != nil {
		return err
	}
	if count != 0 {
		return nil
	}
	head.Cursor++
	if err := tx.Create(&FeedThreadRecord{AuthorPTID: post.ActorPTID, Cursor: head.Cursor, ActorPTID: row.ActorPTID, ChainID: row.ChainID, Sequence: row.Sequence}).Error; err != nil {
		return err
	}
	return tx.Save(&head).Error
}

func (s *FeedLogStore) readThread(ctx context.Context, tx *gorm.DB, request *model.ReadFeedRequest, response *model.ReadFeedResponse) error {
	var head FeedThreadHead
	err := tx.WithContext(ctx).Where("author_ptid = ?", request.ActorPtid).Take(&head).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if request.AfterThreadCursor != 0 {
			return domain.ErrFeedRollback
		}
		return nil
	}
	if err != nil {
		return err
	}
	if request.AfterThreadCursor > head.Cursor {
		return domain.ErrFeedRollback
	}
	response.ThreadCursor = request.AfterThreadCursor
	var rows []FeedThreadRecord
	if err := tx.Where("author_ptid = ? AND cursor > ? AND cursor <= ?", request.ActorPtid, request.AfterThreadCursor, head.Cursor).Order("cursor").Limit(32).Find(&rows).Error; err != nil {
		return err
	}
	for _, index := range rows {
		if index.Cursor != response.ThreadCursor+1 {
			return domain.ErrFeedGap
		}
		var row FeedInteractionRecord
		if err := tx.Where("actor_ptid = ? AND chain_id = ? AND sequence = ?", index.ActorPTID, index.ChainID, index.Sequence).Take(&row).Error; err != nil {
			return err
		}
		receipt, err := verifiedReceiptRow(&row)
		if err != nil {
			return err
		}
		entry := &model.FeedThreadEntry{Cursor: index.Cursor, InteractionHomeStation: row.HomeStation, Receipt: receipt}
		response.ThreadEntries = append(response.ThreadEntries, entry)
		if proto.Size(response) > signedlog.MaxMessageBytes {
			response.ThreadEntries = response.ThreadEntries[:len(response.ThreadEntries)-1]
			break
		}
		response.ThreadCursor = index.Cursor
	}
	response.ThreadHasMore = response.ThreadCursor < head.Cursor
	return nil
}

func (s *FeedLogStore) AdvanceThreadCursor(ctx context.Context, tx *gorm.DB, row FeedSubscriptionRecord, cursor uint64) error {
	if cursor < row.ThreadCursor {
		return domain.ErrFeedRollback
	}
	result := tx.WithContext(ctx).Model(&FeedSubscriptionRecord{}).
		Where("author_ptid = ? AND chain_id = ? AND subscriber_ptid = ? AND revision = ? AND enabled = ? AND thread_cursor = ?",
			row.AuthorPTID, row.ChainID, row.SubscriberPTID, row.Revision, true, row.ThreadCursor).
		Update("thread_cursor", cursor)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return domain.ErrFeedWriter
	}
	return nil
}
