package infrastructure

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/notification/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// TxInput is the transaction-bound production instruction from internal
// producers (bot webhook ingestion). The caller owns the GORM transaction so
// the notification row commits atomically with its cause.
type TxInput struct {
	RecipientPTID  string
	ActorPTID      string
	Type           int32
	Category       int32
	TargetType     string
	TargetID       string
	Title          string
	Body           string
	GroupKey       string
	IdempotencyKey string
	Metadata       map[string]string
}

// TxResult reports the outcome of an in-transaction production. Produced is
// false for a muted preference or an idempotency replay; NotificationID is the
// stable id callers use to fire the post-commit realtime wake only when a new
// row actually committed.
type TxResult struct {
	Produced       bool
	NotificationID string
}

// TxProducer writes notifications inside an existing transaction.
type TxProducer struct {
	db *gorm.DB
}

// NewTxProducer binds the producer to a transaction handle.
func NewTxProducer(db *gorm.DB) *TxProducer { return &TxProducer{db: db} }

// ProduceInTx inserts one notification and bumps the unread counter in the
// bound transaction. It honors the recipient's category preference (silent
// tasks skip the row while the causing message is still produced, BOT-A05B)
// and collapses replays through the partial unique idempotency index
// (BOT-A28). A zero Produced means either muted preference or replay.
func (p *TxProducer) ProduceInTx(
	ctx context.Context,
	input TxInput,
	at time.Time,
) (TxResult, error) {
	if input.IdempotencyKey != "" {
		var existing int64
		if err := p.db.WithContext(ctx).Model(&NotificationModel{}).
			Where(
				"recipient_ptid = ? AND idempotency_key = ?",
				input.RecipientPTID,
				input.IdempotencyKey,
			).
			Count(&existing).Error; err != nil {
			return TxResult{}, err
		}
		if existing > 0 {
			return TxResult{}, nil
		}
	}

	var preference PreferenceModel
	lookup := p.db.WithContext(ctx).
		Where("actor_ptid = ? AND category = ?", input.RecipientPTID, input.Category).
		First(&preference)
	if lookup.Error == nil && !preference.Enabled {
		return TxResult{}, nil
	}
	if lookup.Error != nil && !errors.Is(lookup.Error, gorm.ErrRecordNotFound) {
		return TxResult{}, lookup.Error
	}

	metaJSON := "{}"
	if len(input.Metadata) > 0 {
		encoded, marshalErr := json.Marshal(input.Metadata)
		if marshalErr != nil {
			return TxResult{}, fmt.Errorf("notification tx producer: encode metadata: %w", marshalErr)
		}
		metaJSON = string(encoded)
	}
	record := NotificationModel{
		NotifID:        notificationID(input.IdempotencyKey, at),
		RecipientPTID:  input.RecipientPTID,
		ActorPTID:      input.ActorPTID,
		Type:           input.Type,
		Category:       input.Category,
		Status:         domain.StatusUnread,
		TargetType:     input.TargetType,
		TargetID:       input.TargetID,
		Title:          input.Title,
		Body:           input.Body,
		Metadata:       metaJSON,
		GroupKey:       input.GroupKey,
		IdempotencyKey: input.IdempotencyKey,
		CreatedAt:      at,
		UpdatedAt:      at,
	}
	create := p.db.WithContext(ctx)
	if input.IdempotencyKey != "" {
		// The partial unique index uidx_notification_idempotency protects the
		// row; a target-less DO NOTHING is portable across PostgreSQL/SQLite
		// (column-target inference cannot name a partial index).
		create = create.Clauses(clause.OnConflict{DoNothing: true})
	}
	if err := create.Create(&record).Error; err != nil {
		return TxResult{}, err
	}
	if record.ID == 0 {
		// OnConflict DoNothing leaves the zero id on replay.
		return TxResult{}, nil
	}

	if err := p.db.WithContext(ctx).Exec(`
		INSERT INTO notification_unread_counts (recipient_ptid, category, count, updated_at)
		VALUES (?, ?, 1, ?)
		ON CONFLICT (recipient_ptid, category) DO UPDATE
		SET count = notification_unread_counts.count + 1, updated_at = ?
	`, input.RecipientPTID, input.Category, at, at).Error; err != nil {
		return TxResult{}, err
	}
	return TxResult{Produced: true, NotificationID: record.NotifID}, nil
}

func notificationID(idempotencyKey string, at time.Time) string {
	if idempotencyKey == "" {
		return fmt.Sprintf("ntf-%d", at.UnixNano())
	}
	const prefix = "ntf-"
	if len(prefix)+len(idempotencyKey) <= 64 {
		return prefix + idempotencyKey
	}
	sum := sha256.Sum256([]byte(idempotencyKey))
	return "ntf-sha256-" + base64.RawURLEncoding.EncodeToString(sum[:])
}
