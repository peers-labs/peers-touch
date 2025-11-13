package repo

import (
    "context"

    "github.com/peers-touch/peers-touch/station/frame/core/store"
    m "github.com/peers-touch/peers-touch/station/frame/touch/model/db"
)

type AttachmentRepo struct{}

func NewAttachmentRepo() *AttachmentRepo { return &AttachmentRepo{} }

func (r *AttachmentRepo) Save(ctx context.Context, a *m.Attachment) error {
    db, err := store.GetRDS(ctx)
    if err != nil { return err }
    return db.Create(a).Error
}

func (r *AttachmentRepo) Get(ctx context.Context, cid string) (*m.Attachment, error) {
    db, err := store.GetRDS(ctx)
    if err != nil { return nil, err }
    var a m.Attachment
    if err := db.Where("cid = ?", cid).First(&a).Error; err != nil { return nil, err }
    return &a, nil
}