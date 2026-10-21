package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/infrastructure/persistence"
	"gorm.io/gorm"
)

const (
	AccessModeOwner     = "owner"
	AccessModeApproval  = "approval"
	AccessModeAllowlist = "allowlist"
	AccessModeOpen      = "open"
)

type MemberAccessView struct {
	ID             string
	BindingID      string
	ProviderUserID string
	DisplayName    string
	Status         string
	RequestedAt    time.Time
	DecidedAt      *time.Time
}

func (s *ManagementService) AuthorizeSender(
	ctx context.Context,
	binding *persistence.ChannelBinding,
	providerUserID, displayName string,
) (bool, string, error) {
	if binding == nil {
		return false, "binding_missing", ErrBindingNotFound
	}
	providerUserID = strings.TrimSpace(providerUserID)
	if providerUserID == "" {
		return false, "sender_identity_missing", nil
	}
	if binding.AccessMode == AccessModeOpen ||
		(strings.TrimSpace(binding.OwnerProviderUserID) != "" &&
			binding.OwnerProviderUserID == providerUserID) {
		return true, "", nil
	}
	var member persistence.ChannelMemberAccess
	err := s.db.WithContext(ctx).
		Where("binding_id = ? AND provider_user_id = ?", binding.ID, providerUserID).
		First(&member).Error
	if err == nil {
		return member.Status == "allowed", member.Status, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return false, "lookup_failed", fmt.Errorf("load channel member access: %w", err)
	}
	if binding.AccessMode == AccessModeOwner || binding.AccessMode == AccessModeAllowlist {
		return false, "not_allowed", nil
	}
	now := time.Now().UTC()
	member = persistence.ChannelMemberAccess{
		ID: newBindingID(), BindingID: binding.ID, ProviderUserID: providerUserID,
		DisplayName: strings.TrimSpace(displayName), Status: "pending",
		RequestedAt: now, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.db.WithContext(ctx).Create(&member).Error; err != nil {
		var raced persistence.ChannelMemberAccess
		if getErr := s.db.WithContext(ctx).
			Where("binding_id = ? AND provider_user_id = ?", binding.ID, providerUserID).
			First(&raced).Error; getErr == nil {
			return raced.Status == "allowed", raced.Status, nil
		}
		return false, "request_failed", fmt.Errorf("create channel access request: %w", err)
	}
	return false, "pending", nil
}

func (s *ManagementService) ListMemberAccess(
	ctx context.Context,
	actorPTID, bindingID string,
) ([]MemberAccessView, error) {
	if _, err := s.bindings.loadForActor(actorPTID, bindingID); err != nil {
		return nil, err
	}
	var records []persistence.ChannelMemberAccess
	if err := s.db.WithContext(ctx).Where("binding_id = ?", bindingID).
		Order("requested_at DESC").Find(&records).Error; err != nil {
		return nil, fmt.Errorf("list channel member access: %w", err)
	}
	views := make([]MemberAccessView, 0, len(records))
	for _, record := range records {
		views = append(views, memberAccessView(record))
	}
	return views, nil
}

func (s *ManagementService) DecideMemberAccess(
	ctx context.Context,
	actorPTID, bindingID, accessID, decision, idempotencyKey string,
) (MemberAccessView, error) {
	if _, err := s.bindings.loadForActor(actorPTID, bindingID); err != nil {
		return MemberAccessView{}, err
	}
	decision = strings.TrimSpace(decision)
	if decision != "allow" && decision != "deny" {
		return MemberAccessView{}, fmt.Errorf("%w: decision must be allow or deny", ErrInvalidBinding)
	}
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if idempotencyKey == "" {
		return MemberAccessView{}, fmt.Errorf("%w: idempotency key is required", ErrInvalidBinding)
	}
	var record persistence.ChannelMemberAccess
	if err := s.db.WithContext(ctx).
		Where("id = ? AND binding_id = ?", accessID, bindingID).
		First(&record).Error; err != nil {
		return MemberAccessView{}, ErrBindingNotFound
	}
	status := "denied"
	if decision == "allow" {
		status = "allowed"
	}
	if record.DecisionKey != "" {
		if record.DecisionKey != idempotencyKey || record.Status != status {
			return MemberAccessView{}, fmt.Errorf("%w: member decision conflict", ErrInvalidBinding)
		}
		return memberAccessView(record), nil
	}
	now := time.Now().UTC()
	result := s.db.WithContext(ctx).Model(&persistence.ChannelMemberAccess{}).
		Where("id = ? AND binding_id = ? AND decision_key = ''", accessID, bindingID).
		Updates(map[string]any{
			"status": status, "decision_key": idempotencyKey,
			"decided_at": now, "updated_at": now,
		})
	if result.Error != nil {
		return MemberAccessView{}, fmt.Errorf("decide channel member access: %w", result.Error)
	}
	if result.RowsAffected != 1 {
		return MemberAccessView{}, fmt.Errorf("%w: member decision changed concurrently", ErrInvalidBinding)
	}
	if err := s.db.WithContext(ctx).First(&record, "id = ?", accessID).Error; err != nil {
		return MemberAccessView{}, err
	}
	return memberAccessView(record), nil
}

func memberAccessView(record persistence.ChannelMemberAccess) MemberAccessView {
	return MemberAccessView{
		ID: record.ID, BindingID: record.BindingID,
		ProviderUserID: record.ProviderUserID, DisplayName: record.DisplayName,
		Status: record.Status, RequestedAt: record.RequestedAt, DecidedAt: record.DecidedAt,
	}
}
