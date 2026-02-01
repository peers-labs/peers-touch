package service

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/group_chat/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

type MemberService interface {
	AddMember(ctx context.Context, groupULID, actorDID string, role int, invitedBy string) error
	GetMember(ctx context.Context, groupULID, actorDID string) (*model.GroupMember, error)
	UpdateMember(ctx context.Context, groupULID, actorDID string, role *int, muted *bool, mutedUntil *time.Time) (*model.GroupMember, error)
	RemoveMember(ctx context.Context, groupULID, actorDID string) error
	ListMembers(ctx context.Context, groupULID string, limit, offset int) ([]model.GroupMember, int, error)
	IsMember(ctx context.Context, groupULID, actorDID string) bool
}

type memberService struct {
	dbName string
}

func NewMemberService(dbName string) MemberService {
	return &memberService{dbName: dbName}
}

func (s *memberService) getDB(ctx context.Context) (*gorm.DB, error) {
	return store.GetRDS(ctx, store.WithRDSDBName(s.dbName))
}

func (s *memberService) AddMember(ctx context.Context, groupULID, actorDID string, role int, invitedBy string) error {
	rds, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	// Auto-migrate table
	if err := rds.AutoMigrate(&model.GroupMember{}); err != nil {
		return err
	}

	if role == 0 {
		role = model.GroupRoleMember
	}

	member := &model.GroupMember{
		GroupULID: groupULID,
		ActorDID:  actorDID,
		Role:      role,
		InvitedBy: invitedBy,
	}

	if err := rds.Create(member).Error; err != nil {
		return err
	}

	// Increment member count
	return rds.Model(&model.Group{}).Where("ul_id = ?", groupULID).
		UpdateColumn("member_count", gorm.Expr("member_count + 1")).Error
}

func (s *memberService) GetMember(ctx context.Context, groupULID, actorDID string) (*model.GroupMember, error) {
	rds, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	// Ensure table exists
	if err := rds.AutoMigrate(&model.GroupMember{}); err != nil {
		return nil, err
	}

	var member model.GroupMember
	if err := rds.Where("group_ul_id = ? AND actor_did = ?", groupULID, actorDID).First(&member).Error; err != nil {
		return nil, err
	}

	return &member, nil
}

func (s *memberService) UpdateMember(ctx context.Context, groupULID, actorDID string, role *int, muted *bool, mutedUntil *time.Time) (*model.GroupMember, error) {
	rds, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	updates := make(map[string]interface{})
	if role != nil {
		updates["role"] = *role
	}
	if muted != nil {
		updates["muted"] = *muted
	}
	if mutedUntil != nil {
		updates["muted_until"] = *mutedUntil
	}

	if err := rds.Model(&model.GroupMember{}).
		Where("group_ul_id = ? AND actor_did = ?", groupULID, actorDID).
		Updates(updates).Error; err != nil {
		return nil, err
	}

	return s.GetMember(ctx, groupULID, actorDID)
}

func (s *memberService) RemoveMember(ctx context.Context, groupULID, actorDID string) error {
	rds, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	if err := rds.Where("group_ul_id = ? AND actor_did = ?", groupULID, actorDID).Delete(&model.GroupMember{}).Error; err != nil {
		return err
	}

	// Decrement member count
	return rds.Model(&model.Group{}).Where("ul_id = ?", groupULID).
		UpdateColumn("member_count", gorm.Expr("member_count - 1")).Error
}

func (s *memberService) ListMembers(ctx context.Context, groupULID string, limit, offset int) ([]model.GroupMember, int, error) {
	rds, err := s.getDB(ctx)
	if err != nil {
		return nil, 0, err
	}

	var members []model.GroupMember
	var total int64

	if err := rds.Model(&model.GroupMember{}).Where("group_ul_id = ?", groupULID).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// Order by role (owner first, then admin, then member), then by join time
	if err := rds.Where("group_ul_id = ?", groupULID).
		Order("role DESC, joined_at ASC").
		Limit(limit).Offset(offset).
		Find(&members).Error; err != nil {
		return nil, 0, err
	}

	return members, int(total), nil
}

func (s *memberService) IsMember(ctx context.Context, groupULID, actorDID string) bool {
	_, err := s.GetMember(ctx, groupULID, actorDID)
	return err == nil
}
