package application

import (
	"context"
	"fmt"
	"strings"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type ModerationService struct {
	repos *infrastructure.Repos
}

func NewModerationService(repos *infrastructure.Repos) *ModerationService {
	return &ModerationService{repos: repos}
}

func (s *ModerationService) IsStationBlocked(ctx context.Context, stationDomain string, stationPeerID ...string) (bool, error) {
	if s == nil || s.repos == nil {
		return false, nil
	}
	peerID := ""
	if len(stationPeerID) > 0 {
		peerID = stationPeerID[0]
	}
	return stationModerationBlocksStation(ctx, s.repos.Moderation, stationDomain, peerID)
}

func (s *ModerationService) IsActorStationBlocked(ctx context.Context, actorID uint64) (bool, error) {
	if s == nil || s.repos == nil {
		return false, nil
	}
	return actorStationModerated(ctx, s.repos.Moderation, actorID)
}

func (s *ModerationService) IsPostAuthorStationBlocked(ctx context.Context, post *model.Post) (bool, error) {
	if s == nil || s.repos == nil {
		return false, nil
	}
	return postAuthorStationModerated(ctx, s.repos.Moderation, post)
}

func (s *ModerationService) UpsertStationPolicy(
	ctx context.Context,
	req *model.UpsertStationModerationPolicyRequest,
	actorID uint64,
) (*model.StationModerationPolicy, error) {
	if req == nil || req.GetPolicy() == nil {
		return nil, fmt.Errorf("policy is required")
	}
	policy := req.GetPolicy()
	stationDomain := strings.TrimSpace(policy.GetStationDomain())
	stationPeerID := strings.TrimSpace(policy.GetStationPeerId())
	if stationDomain == "" && stationPeerID == "" {
		return nil, fmt.Errorf("station_domain or station_peer_id is required")
	}
	kind := stationPolicyKindFromProto(policy.GetKind())
	if kind == "" {
		return nil, fmt.Errorf("unsupported station moderation policy kind")
	}
	row := &domain.StationModerationPolicy{
		StationDomain:    stationDomain,
		StationPeerID:    stationPeerID,
		Kind:             kind,
		Reason:           policy.GetReason(),
		CreatedByActorID: actorID,
	}
	if err := s.repos.Moderation.Upsert(ctx, row); err != nil {
		return nil, err
	}
	blocked, err := s.repos.Moderation.ListBlockedStations(ctx)
	if err != nil {
		return nil, err
	}
	if got := blocked[stationDomain]; got != nil {
		return stationPolicyToProto(got), nil
	}
	return stationPolicyToProto(row), nil
}

func (s *ModerationService) DeleteStationPolicy(
	ctx context.Context,
	req *model.DeleteStationModerationPolicyRequest,
) error {
	if req == nil {
		return fmt.Errorf("request is required")
	}
	kind := stationPolicyKindFromProto(req.GetKind())
	if kind == "" {
		kind = domain.StationModerationPolicyKindBlock
	}
	if strings.TrimSpace(req.GetStationDomain()) == "" && strings.TrimSpace(req.GetStationPeerId()) == "" {
		return fmt.Errorf("station_domain or station_peer_id is required")
	}
	return s.repos.Moderation.Delete(ctx, req.GetStationDomain(), req.GetStationPeerId(), kind)
}

func (s *ModerationService) ListStationPolicies(
	ctx context.Context,
	req *model.ListStationModerationPoliciesRequest,
) (*model.ListStationModerationPoliciesResponse, error) {
	if req == nil {
		req = &model.ListStationModerationPoliciesRequest{}
	}
	limit := int(req.GetLimit())
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	cursor, err := domain.DecodeCursor(req.GetCursor())
	if err != nil {
		return nil, fmt.Errorf("invalid cursor: %w", err)
	}
	kind := stationPolicyKindFromProto(req.GetKind())
	if kind == "" {
		kind = domain.StationModerationPolicyKindBlock
	}
	rows, err := s.repos.Moderation.List(ctx, kind, cursor, limit+1)
	if err != nil {
		return nil, err
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	out := make([]*model.StationModerationPolicy, 0, len(rows))
	for _, row := range rows {
		if row == nil {
			continue
		}
		out = append(out, stationPolicyToProto(row))
	}
	nextCursor := ""
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		nextCursor = domain.Cursor{LastID: last.ID, CreatedAt: last.CreatedAt}.Encode()
	}
	return &model.ListStationModerationPoliciesResponse{
		Policies:   out,
		NextCursor: nextCursor,
		HasMore:    hasMore,
	}, nil
}

func stationPolicyKindFromProto(kind model.StationModerationPolicy_Kind) domain.StationModerationPolicyKind {
	switch kind {
	case model.StationModerationPolicy_STATION_MODERATION_POLICY_BLOCK:
		return domain.StationModerationPolicyKindBlock
	default:
		return ""
	}
}

func stationPolicyKindToProto(kind domain.StationModerationPolicyKind) model.StationModerationPolicy_Kind {
	switch kind {
	case domain.StationModerationPolicyKindBlock:
		return model.StationModerationPolicy_STATION_MODERATION_POLICY_BLOCK
	default:
		return model.StationModerationPolicy_STATION_MODERATION_POLICY_UNSPECIFIED
	}
}

func stationPolicyToProto(policy *domain.StationModerationPolicy) *model.StationModerationPolicy {
	if policy == nil {
		return nil
	}
	return &model.StationModerationPolicy{
		StationDomain:    policy.StationDomain,
		StationPeerId:    policy.StationPeerID,
		Kind:             stationPolicyKindToProto(policy.Kind),
		Reason:           policy.Reason,
		CreatedByActorId: fmt.Sprintf("%d", policy.CreatedByActorID),
		CreatedAt:        timestamppb.New(policy.CreatedAt),
		UpdatedAt:        timestamppb.New(policy.UpdatedAt),
	}
}
