package repo

import (
    "context"

    "github.com/peers-touch/peers-touch/station/frame/core/store"
    m "github.com/peers-touch/peers-touch/station/frame/touch/model/db"
    "gorm.io/gorm"
)

type ConversationRepo struct{}

func NewConversationRepo() *ConversationRepo { return &ConversationRepo{} }

func (r *ConversationRepo) Create(ctx context.Context, c *m.Conversation) error {
    db, err := store.GetRDS(ctx)
    if err != nil { return err }
    return db.Create(c).Error
}

func (r *ConversationRepo) GetByConvID(ctx context.Context, convID string) (*m.Conversation, error) {
    db, err := store.GetRDS(ctx)
    if err != nil { return nil, err }
    var c m.Conversation
    if err := db.Where("conv_id = ?", convID).First(&c).Error; err != nil { return nil, err }
    return &c, nil
}

func (r *ConversationRepo) IncEpoch(ctx context.Context, convID string) error {
    db, err := store.GetRDS(ctx)
    if err != nil { return err }
    return db.Model(&m.Conversation{}).Where("conv_id = ?", convID).UpdateColumn("epoch", gorm.Expr("epoch + 1")).Error
}

type MemberRepo struct{}

func NewMemberRepo() *MemberRepo { return &MemberRepo{} }

func (r *MemberRepo) List(ctx context.Context, convID uint64) ([]*m.ConvMember, error) {
    db, err := store.GetRDS(ctx)
    if err != nil { return nil, err }
    var list []*m.ConvMember
    if err := db.Where("conv_id = ?", convID).Find(&list).Error; err != nil { return nil, err }
    return list, nil
}

func (r *MemberRepo) Add(ctx context.Context, convID uint64, did string, role m.Role) error {
    db, err := store.GetRDS(ctx)
    if err != nil { return err }
    mbr := &m.ConvMember{ConvID: convID, DID: did, Role: role}
    return db.Create(mbr).Error
}

func (r *MemberRepo) Remove(ctx context.Context, convID uint64, did string) error {
    db, err := store.GetRDS(ctx)
    if err != nil { return err }
    return db.Where("conv_id = ? AND did = ?", convID, did).Delete(&m.ConvMember{}).Error
}