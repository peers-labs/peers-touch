package infrastructure

import (
	"context"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ReadCursorModel is the persistence representation of an actor's read position
// within a conversation. The composite key is (conversation_id, reader_ptid).
type ReadCursorModel struct {
	ConversationID   string    `gorm:"column:conversation_id;size:255;primaryKey"`
	ReaderPTID       string    `gorm:"column:reader_ptid;size:255;primaryKey"`
	LastReadSequence int64     `gorm:"column:last_read_sequence;not null"`
	UpdatedAt        time.Time `gorm:"column:updated_at;not null"`
}

func (*ReadCursorModel) TableName() string {
	return "messaging_read_cursors"
}

// ReadCursorRepository implements domain.ReadCursorRepository using GORM.
type ReadCursorRepository struct {
	db *gorm.DB
}

func NewReadCursorRepository(db *gorm.DB) (*ReadCursorRepository, error) {
	if db == nil {
		return nil, messaging.ErrNotFound
	}
	return &ReadCursorRepository{db: db}, nil
}

// AutoMigrate creates or updates the read cursor table schema.
func (r *ReadCursorRepository) AutoMigrate() error {
	return r.db.AutoMigrate(&ReadCursorModel{})
}

// UpsertReadCursor persists or advances a read cursor. The cursor only advances;
// if the submitted sequence is not greater than the persisted value, the write
// is effectively a no-op (the persisted value remains unchanged).
func (r *ReadCursorRepository) UpsertReadCursor(
	ctx context.Context,
	cursor *chat.ActorReadCursor,
) error {
	if cursor == nil || cursor.ConversationId == "" || cursor.ReaderPtid == "" {
		return messaging.ErrNotFound
	}
	now := time.Now().UTC()
	if cursor.UpdatedAt != nil {
		now = cursor.UpdatedAt.AsTime()
	}

	model := &ReadCursorModel{
		ConversationID:   cursor.ConversationId,
		ReaderPTID:       cursor.ReaderPtid,
		LastReadSequence: cursor.LastReadSequence,
		UpdatedAt:        now,
	}

	// Upsert with monotonic advance: only update if new sequence > existing.
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{
				{Name: "conversation_id"},
				{Name: "reader_ptid"},
			},
			DoUpdates: clause.Assignments(map[string]interface{}{
				"last_read_sequence": gorm.Expr(
					"CASE WHEN excluded.last_read_sequence > messaging_read_cursors.last_read_sequence " +
						"THEN excluded.last_read_sequence ELSE messaging_read_cursors.last_read_sequence END",
				),
				"updated_at": gorm.Expr(
					"CASE WHEN excluded.last_read_sequence > messaging_read_cursors.last_read_sequence " +
						"THEN excluded.updated_at ELSE messaging_read_cursors.updated_at END",
				),
			}),
		}).
		Create(model).Error
}

// GetReadCursor returns the persisted read cursor for a specific actor in a
// conversation.
func (r *ReadCursorRepository) GetReadCursor(
	ctx context.Context,
	conversationID string,
	readerPTID string,
) (*chat.ActorReadCursor, error) {
	var model ReadCursorModel
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ? AND reader_ptid = ?", conversationID, readerPTID).
		First(&model).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, messaging.ErrNotFound
		}
		return nil, err
	}
	return modelToReadCursor(&model), nil
}

// ListReadCursors returns all read cursors for a conversation.
func (r *ReadCursorRepository) ListReadCursors(
	ctx context.Context,
	conversationID string,
) ([]*chat.ActorReadCursor, error) {
	var models []ReadCursorModel
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ?", conversationID).
		Find(&models).Error; err != nil {
		return nil, err
	}
	cursors := make([]*chat.ActorReadCursor, 0, len(models))
	for i := range models {
		cursors = append(cursors, modelToReadCursor(&models[i]))
	}
	return cursors, nil
}

func modelToReadCursor(model *ReadCursorModel) *chat.ActorReadCursor {
	return &chat.ActorReadCursor{
		ConversationId:   model.ConversationID,
		ReaderPtid:       model.ReaderPTID,
		LastReadSequence: model.LastReadSequence,
		UpdatedAt:        timestamppb.New(model.UpdatedAt),
	}
}

// Compile-time interface compliance.
var _ messaging.ReadCursorRepository = (*ReadCursorRepository)(nil)
