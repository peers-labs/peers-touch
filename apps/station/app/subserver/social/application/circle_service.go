package application

import (
	"context"
	"fmt"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

// CircleService handles publisher-private audience labels. Circles are
// owner-scoped — every operation asserts `circle.OwnerID == callerID`
// before touching the repo. Members do NOT receive a notification on
// add/remove (architecture invariant: circles are publisher-private
// metadata, not a shared social object).
type CircleService struct {
	repos *infrastructure.Repos
	conv  *domain.PostConverter
}

func NewCircleService(repos *infrastructure.Repos) *CircleService {
	return &CircleService{repos: repos, conv: domain.NewPostConverter()}
}

func (s *CircleService) Create(ctx context.Context, req *model.CreateCircleRequest, ownerPTID string) (*model.Circle, error) {
	if ownerPTID == "" {
		return nil, fmt.Errorf("authentication required")
	}
	if req == nil {
		return nil, fmt.Errorf("CreateCircleRequest is nil")
	}
	c := &domain.Circle{
		OwnerPTID:   ownerPTID,
		Name:        req.Name,
		Description: req.Description,
	}
	if err := domain.ValidateCircle(c); err != nil {
		return nil, err
	}
	if err := s.repos.Circles.Create(ctx, c); err != nil {
		return nil, fmt.Errorf("create circle: %w", err)
	}
	if len(req.MemberPtids) > 0 {
		added, total, err := s.repos.Circles.AddMembers(ctx, c.ID, req.MemberPtids)
		if err != nil {
			logger.Warn(ctx, "circle.create: initial member add partial", "circle_id", c.ID, "error", err)
		}
		c.MemberCount = total
		_ = added
	}
	logger.Info(ctx, "circle.created", "circle_id", c.ID, "owner_ptid", ownerPTID)
	return s.conv.CircleToProto(c), nil
}

func (s *CircleService) Rename(ctx context.Context, req *model.RenameCircleRequest, ownerPTID string) (*model.Circle, error) {
	if ownerPTID == "" {
		return nil, fmt.Errorf("authentication required")
	}
	c, err := s.assertOwner(ctx, req.CircleId, ownerPTID)
	if err != nil {
		return nil, err
	}
	c.Name = req.Name
	if req.Description != nil {
		c.Description = *req.Description
	}
	if err := domain.ValidateCircle(c); err != nil {
		return nil, err
	}
	if err := s.repos.Circles.Update(ctx, c); err != nil {
		return nil, err
	}
	return s.conv.CircleToProto(c), nil
}

func (s *CircleService) Delete(ctx context.Context, circleID uint64, ownerPTID string) error {
	if ownerPTID == "" {
		return fmt.Errorf("authentication required")
	}
	if _, err := s.assertOwner(ctx, circleID, ownerPTID); err != nil {
		return err
	}
	if err := s.repos.Circles.Delete(ctx, circleID, ownerPTID); err != nil {
		return err
	}
	logger.Info(ctx, "circle.deleted", "circle_id", circleID, "owner_ptid", ownerPTID)
	return nil
}

func (s *CircleService) AddMembers(ctx context.Context, req *model.AddCircleMemberRequest, ownerPTID string) (added int32, total int64, err error) {
	if ownerPTID == "" {
		return 0, 0, fmt.Errorf("authentication required")
	}
	if _, err = s.assertOwner(ctx, req.CircleId, ownerPTID); err != nil {
		return 0, 0, err
	}
	return s.repos.Circles.AddMembers(ctx, req.CircleId, req.MemberPtids)
}

func (s *CircleService) RemoveMembers(ctx context.Context, req *model.RemoveCircleMemberRequest, ownerPTID string) (removed int32, total int64, err error) {
	if ownerPTID == "" {
		return 0, 0, fmt.Errorf("authentication required")
	}
	if _, err = s.assertOwner(ctx, req.CircleId, ownerPTID); err != nil {
		return 0, 0, err
	}
	return s.repos.Circles.RemoveMembers(ctx, req.CircleId, req.MemberPtids)
}

func (s *CircleService) ListMine(ctx context.Context, ownerPTID string, cursor string, limit int) (*model.ListMyCirclesResponse, error) {
	if ownerPTID == "" {
		return nil, fmt.Errorf("authentication required")
	}
	c, err := domain.DecodeCursor(cursor)
	if err != nil {
		return nil, fmt.Errorf("invalid cursor: %w", err)
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := s.repos.Circles.ListByOwner(ctx, ownerPTID, c, limit+1)
	if err != nil {
		return nil, err
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	out := make([]*model.Circle, 0, len(rows))
	for _, row := range rows {
		out = append(out, s.conv.CircleToProto(row))
	}
	var nextCursor string
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		nextCursor = domain.Cursor{LastID: last.ID, CreatedAt: last.CreatedAt}.Encode()
	}
	return &model.ListMyCirclesResponse{Circles: out, NextCursor: nextCursor, HasMore: hasMore}, nil
}

func (s *CircleService) ListMembers(ctx context.Context, req *model.ListCircleMembersRequest, ownerPTID string) (*model.ListCircleMembersResponse, error) {
	if ownerPTID == "" {
		return nil, fmt.Errorf("authentication required")
	}
	if _, err := s.assertOwner(ctx, req.CircleId, ownerPTID); err != nil {
		return nil, err
	}
	c, err := domain.DecodeCursor(req.Cursor)
	if err != nil {
		return nil, fmt.Errorf("invalid cursor: %w", err)
	}
	limit := int(req.Limit)
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := s.repos.Circles.ListMembers(ctx, req.CircleId, c, limit+1)
	if err != nil {
		return nil, err
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	out := make([]*model.CircleMember, 0, len(rows))
	for _, row := range rows {
		out = append(out, s.conv.CircleMemberToProto(row))
	}
	var nextCursor string
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		nextCursor = domain.Cursor{CreatedAt: last.AddedAt}.Encode()
	}
	return &model.ListCircleMembersResponse{Members: out, NextCursor: nextCursor, HasMore: hasMore}, nil
}

func (s *CircleService) assertOwner(ctx context.Context, circleID uint64, ownerPTID string) (*domain.Circle, error) {
	c, err := s.repos.Circles.GetByID(ctx, circleID)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, fmt.Errorf("circle %d not found", circleID)
	}
	if c.OwnerPTID != ownerPTID {
		return nil, fmt.Errorf("circle %d is not owned by caller", circleID)
	}
	return c, nil
}
