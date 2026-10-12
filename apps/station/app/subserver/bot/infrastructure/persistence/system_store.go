package persistence

import (
	"context"
	"errors"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/bot/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// InboundIdempotencyWindow bounds replay deduplication; older records may be
// pruned. It matches domain.IdempotencyWindow.
const InboundIdempotencyWindow = 24 * time.Hour

// SystemStore is the transaction-bound store for system delivery grants and
// the webhook ingestion idempotency bucket. Every method runs on the exact
// GORM transaction supplied at construction, so it shares atomicity with the
// Conversation authority write.
type SystemStore struct {
	db *gorm.DB
}

// NewSystemStore binds the store to a transaction (or the process DB).
func NewSystemStore(db *gorm.DB) *SystemStore { return &SystemStore{db: db} }

// AutoMigrateSystemTables installs the grant and ingestion tables. Called
// once from the sub-server migration entry point.
func (r *GormRepo) AutoMigrateSystemTables() error {
	return r.db.AutoMigrate(&BotSystemGrantModel{}, &BotInboundEventModel{})
}

// EnsureActiveGrant records the explicit {bot, owner, conversation} grant if
// absent. It fails closed when the bot is not an ACTIVE registry row owned by
// owner, so the grant can never authorize a foreign or disabled bot.
func (s *SystemStore) EnsureActiveGrant(
	ctx context.Context,
	botPtid, ownerPtid, conversationID string,
	at time.Time,
) error {
	var bot BotRegistrationModel
	err := s.db.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("bot_ptid = ?", botPtid).
		First(&bot).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.NewError(domain.CodeUnauthenticated, "bot is not registered: %s", botPtid)
	}
	if err != nil {
		return err
	}
	if bot.OwnerPtid != ownerPtid || bot.State != int32(domain.StateActive) {
		return domain.NewError(
			domain.CodeUnauthenticated,
			"bot is not an active bot owned by the request owner",
		)
	}
	grant := BotSystemGrantModel{
		BotPtid:        botPtid,
		OwnerPtid:      ownerPtid,
		ConversationID: conversationID,
		CreatedAt:      at,
	}
	// Concurrent first events must collapse to one grant row.
	return s.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&grant).Error
}

// Authorize verifies the grant exists and the bot remains active and owned by
// owner. Used as the transaction-scoped Conversation system-sender
// authorization port.
func (s *SystemStore) Authorize(
	ctx context.Context,
	botPtid, ownerPtid, conversationID string,
) error {
	var count int64
	if err := s.db.WithContext(ctx).Model(&BotSystemGrantModel{}).
		Where(
			"bot_ptid = ? AND owner_ptid = ? AND conversation_id = ?",
			botPtid, ownerPtid, conversationID,
		).
		Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return domain.NewError(
			domain.CodeUnauthenticated,
			"system delivery grant is missing for bot/owner/conversation",
		)
	}
	var bot BotRegistrationModel
	err := s.db.WithContext(ctx).Where("bot_ptid = ?", botPtid).First(&bot).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.NewError(domain.CodeNotFound, "bot is not registered: %s", botPtid)
	}
	if err != nil {
		return err
	}
	if bot.OwnerPtid != ownerPtid || bot.State != int32(domain.StateActive) {
		return domain.NewError(domain.CodeStateConflict, "bot is not an active bot owned by the request owner")
	}
	return nil
}

// LoadIngestion returns the event id recorded for (bot, request) within the
// idempotency window. found=false means the request must be processed.
func (s *SystemStore) LoadIngestion(
	ctx context.Context,
	botPtid, requestID string,
	now time.Time,
) (eventID string, found bool, err error) {
	var record BotInboundEventModel
	err = s.db.WithContext(ctx).
		Where("bot_ptid = ? AND request_id = ? AND created_at > ?",
			botPtid, requestID, now.Add(-InboundIdempotencyWindow)).
		First(&record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return record.EventID, true, nil
}

// RecordIngestion stores the (bot, request) → event mapping. A duplicate
// (replayed) insert returns found=true with the existing event id.
func (s *SystemStore) RecordIngestion(
	ctx context.Context,
	botPtid, requestID, eventID string,
	at time.Time,
) error {
	return s.db.WithContext(ctx).Create(&BotInboundEventModel{
		BotPtid:   botPtid,
		RequestID: requestID,
		EventID:   eventID,
		CreatedAt: at,
	}).Error
}

// PruneExpiredIngestion deletes records outside the replay window.
func (s *SystemStore) PruneExpiredIngestion(ctx context.Context, now time.Time) error {
	return s.db.WithContext(ctx).
		Where("created_at <= ?", now.Add(-InboundIdempotencyWindow)).
		Delete(&BotInboundEventModel{}).Error
}
