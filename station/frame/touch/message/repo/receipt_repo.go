package repo

import (
    "context"
    "time"

    "github.com/peers-touch/peers-touch/station/frame/core/store"
    m "github.com/peers-touch/peers-touch/station/frame/touch/model/db"
)

type ReceiptRepo struct{}

func NewReceiptRepo() *ReceiptRepo { return &ReceiptRepo{} }

func (r *ReceiptRepo) Add(ctx context.Context, rcpt *m.Receipt) error {
    db, err := store.GetRDS(ctx)
    if err != nil { return err }
    return db.Create(rcpt).Error
}

func (r *ReceiptRepo) ListAfter(ctx context.Context, convID string, after int64) ([]*m.Receipt, error) {
    db, err := store.GetRDS(ctx)
    if err != nil { return nil, err }
    var list []*m.Receipt
    t := time.UnixMilli(after)
    if err := db.Table("touch_receipt r").Joins("JOIN touch_message m ON m.ulid = r.msg_ulid").Where("m.conv_id = ? AND r.delivered_at > ?", convID, t).Find(&list).Error; err != nil { return nil, err }
    return list, nil
}