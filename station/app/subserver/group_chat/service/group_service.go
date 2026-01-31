package service

import (
	"context"
	"time"

	"github.com/oklog/ulid/v2"
	"github.com/peers-labs/peers-touch/station/app/subserver/group_chat/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

type GroupService interface {
	CreateGroup(ctx context.Context, ownerDID, name, description string, groupType, visibility int) (*model.Group, error)
	GetGroup(ctx context.Context, groupULID string) (*model.Group, error)
	UpdateGroup(ctx context.Context, groupULID string, name, description, avatarCID *string, groupType, visibility *int, muted *bool) (*model.Group, error)
	DeleteGroup(ctx context.Context, groupULID string) error
	ListGroupsByMember(ctx context.Context, actorDID string, limit, offset int) ([]model.Group, int, error)
	CreateInvitation(ctx context.Context, groupULID, inviterDID, inviteeDID string) (*model.GroupInvitation, error)
	AcceptInvitation(ctx context.Context, invitationULID, actorDID string) error
	CleanupExpiredInvitations(ctx context.Context) error
	IncrementMemberCount(ctx context.Context, groupULID string, delta int) error
}

type groupService struct {
	dbName string
}

func NewGroupService(dbName string) GroupService {
	return &groupService{dbName: dbName}
}

func (s *groupService) getDB(ctx context.Context) (*gorm.DB, error) {
	return store.GetRDS(ctx, store.WithRDSDBName(s.dbName))
}

func (s *groupService) CreateGroup(ctx context.Context, ownerDID, name, description string, groupType, visibility int) (*model.Group, error) {
	rds, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	// Auto-migrate table
	if err := rds.AutoMigrate(&model.Group{}, &model.GroupInvitation{}); err != nil {
		return nil, err
	}

	if groupType == 0 {
		groupType = model.GroupTypeNormal
	}
	if visibility == 0 {
		visibility = model.GroupVisibilityPublic
	}

	group := &model.Group{
		ULID:        ulid.Make().String(),
		Name:        name,
		Description: description,
		OwnerDID:    ownerDID,
		Type:        groupType,
		Visibility:  visibility,
		MemberCount: 0, // Will be incremented when owner is added as member
		MaxMembers:  500,
	}

	if err := rds.Create(group).Error; err != nil {
		return nil, err
	}

	return group, nil
}

func (s *groupService) GetGroup(ctx context.Context, groupULID string) (*model.Group, error) {
	rds, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var group model.Group
	if err := rds.Where("ul_id = ?", groupULID).First(&group).Error; err != nil {
		return nil, err
	}

	return &group, nil
}

func (s *groupService) UpdateGroup(ctx context.Context, groupULID string, name, description, avatarCID *string, groupType, visibility *int, muted *bool) (*model.Group, error) {
	rds, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	updates := make(map[string]interface{})
	if name != nil {
		updates["name"] = *name
	}
	if description != nil {
		updates["description"] = *description
	}
	if avatarCID != nil {
		updates["avatar_cid"] = *avatarCID
	}
	if groupType != nil {
		updates["type"] = *groupType
	}
	if visibility != nil {
		updates["visibility"] = *visibility
	}
	if muted != nil {
		updates["muted"] = *muted
	}

	if err := rds.Model(&model.Group{}).Where("ul_id = ?", groupULID).Updates(updates).Error; err != nil {
		return nil, err
	}

	return s.GetGroup(ctx, groupULID)
}

func (s *groupService) DeleteGroup(ctx context.Context, groupULID string) error {
	rds, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	return rds.Where("ul_id = ?", groupULID).Delete(&model.Group{}).Error
}

func (s *groupService) ListGroupsByMember(ctx context.Context, actorDID string, limit, offset int) ([]model.Group, int, error) {
	rds, err := s.getDB(ctx)
	if err != nil {
		return nil, 0, err
	}

	// Ensure tables exist
	if err := rds.AutoMigrate(&model.Group{}, &model.GroupMember{}); err != nil {
		return nil, 0, err
	}

	var groups []model.Group
	var total int64

	// Get group ULIDs where user is a member
	subQuery := rds.Model(&model.GroupMember{}).Select("group_ul_id").Where("actor_did = ?", actorDID)

	if err := rds.Model(&model.Group{}).Where("ul_id IN (?)", subQuery).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if err := rds.Where("ul_id IN (?)", subQuery).
		Order("updated_at DESC").
		Limit(limit).Offset(offset).
		Find(&groups).Error; err != nil {
		return nil, 0, err
	}

	return groups, int(total), nil
}

func (s *groupService) CreateInvitation(ctx context.Context, groupULID, inviterDID, inviteeDID string) (*model.GroupInvitation, error) {
	rds, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	invitation := &model.GroupInvitation{
		ULID:       ulid.Make().String(),
		GroupULID:  groupULID,
		InviterDID: inviterDID,
		InviteeDID: inviteeDID,
		Status:     model.InvitationStatusPending,
		ExpireAt:   time.Now().Add(7 * 24 * time.Hour), // 7 days expiry
	}

	if err := rds.Create(invitation).Error; err != nil {
		return nil, err
	}

	return invitation, nil
}

func (s *groupService) AcceptInvitation(ctx context.Context, invitationULID, actorDID string) error {
	rds, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	var invitation model.GroupInvitation
	if err := rds.Where("ul_id = ? AND invitee_did = ? AND status = ?", invitationULID, actorDID, model.InvitationStatusPending).First(&invitation).Error; err != nil {
		return err
	}

	if time.Now().After(invitation.ExpireAt) {
		return rds.Model(&invitation).Update("status", model.InvitationStatusExpired).Error
	}

	return rds.Model(&invitation).Update("status", model.InvitationStatusAccepted).Error
}

func (s *groupService) CleanupExpiredInvitations(ctx context.Context) error {
	rds, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	return rds.Model(&model.GroupInvitation{}).
		Where("status = ? AND expire_at < ?", model.InvitationStatusPending, time.Now()).
		Update("status", model.InvitationStatusExpired).Error
}

func (s *groupService) IncrementMemberCount(ctx context.Context, groupULID string, delta int) error {
	rds, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	return rds.Model(&model.Group{}).Where("ul_id = ?", groupULID).
		UpdateColumn("member_count", gorm.Expr("member_count + ?", delta)).Error
}
