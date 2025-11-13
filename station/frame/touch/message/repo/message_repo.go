package repo

import (
    "context"

    "github.com/peers-touch/peers-touch/station/frame/core/store"
    m "github.com/peers-touch/peers-touch/station/frame/touch/model/db"
)

type MessageRepo struct{}

func NewMessageRepo() *MessageRepo { return &MessageRepo{} }

func (r *MessageRepo) Append(ctx context.Context, msg *m.Message) error {
    db, err := store.GetRDS(ctx)
    if err != nil { return err }
    return db.Create(msg).Error
}

func (r *MessageRepo) List(ctx context.Context, convID string, afterTS int64, limit int) ([]*m.Message, error) {
    db, err := store.GetRDS(ctx)
    if err != nil { return nil, err }
    var list []*m.Message
    q := db.Where("conv_id = ? AND ts > ?", convID, afterTS).Order("ts ASC")
    if limit > 0 { q = q.Limit(limit) }
    if err := q.Find(&list).Error; err != nil { return nil, err }
    return list, nil
}