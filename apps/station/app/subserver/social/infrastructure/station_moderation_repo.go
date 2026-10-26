package infrastructure

import (
	"context"
	"strings"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

type stationModerationRepository struct {
	db       *gorm.DB
	identity *ActorIdentity
}

func NewStationModerationRepository(gdb *gorm.DB) domain.StationModerationRepository {
	return &stationModerationRepository{db: gdb, identity: NewActorIdentity(gdb)}
}

func (r *stationModerationRepository) Upsert(ctx context.Context, policy *domain.StationModerationPolicy) error {
	if policy == nil {
		return nil
	}
	var creatorID uint64
	if policy.CreatedByActorPTID != "" {
		resolvedID, err := r.identity.RequireID(ctx, policy.CreatedByActorPTID)
		if err != nil {
			return err
		}
		creatorID = resolvedID
	}
	row := moderationDomainToDB(policy, creatorID)
	q := r.db.WithContext(ctx).Where("kind = ?", row.Kind)
	if row.StationDomain != "" {
		q = q.Where("station_domain = ?", row.StationDomain)
	} else {
		q = q.Where("station_peer_id = ?", row.StationPeerID)
	}
	var existing db.SocialStationModerationPolicy
	if err := q.First(&existing).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return r.db.WithContext(ctx).Create(row).Error
		}
		return err
	}
	existing.StationDomain = row.StationDomain
	existing.StationPeerID = row.StationPeerID
	existing.Reason = row.Reason
	existing.CreatedByActorID = row.CreatedByActorID
	return r.db.WithContext(ctx).Save(&existing).Error
}

func (r *stationModerationRepository) Delete(
	ctx context.Context,
	stationDomain string,
	stationPeerID string,
	kind domain.StationModerationPolicyKind,
) error {
	q := r.db.WithContext(ctx).Where("kind = ?", string(kind))
	if trimmed := strings.TrimSpace(stationDomain); trimmed != "" {
		q = q.Where("station_domain = ?", trimmed)
	} else {
		q = q.Where("station_peer_id = ?", strings.TrimSpace(stationPeerID))
	}
	return q.Delete(&db.SocialStationModerationPolicy{}).Error
}

func (r *stationModerationRepository) List(
	ctx context.Context,
	kind domain.StationModerationPolicyKind,
	c domain.Cursor,
	limit int,
) ([]*domain.StationModerationPolicy, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	var rows []db.SocialStationModerationPolicy
	q := r.db.WithContext(ctx).
		Where("kind = ?", string(kind)).
		Order("created_at DESC, id DESC").
		Limit(limit)
	if !c.IsZero() {
		q = q.Where("(created_at < ?) OR (created_at = ? AND id < ?)", c.CreatedAt, c.CreatedAt, c.LastID)
	}
	if err := q.Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]*domain.StationModerationPolicy, 0, len(rows))
	for i := range rows {
		policy, err := r.moderationDBToDomain(ctx, &rows[i])
		if err != nil {
			return nil, err
		}
		out = append(out, policy)
	}
	return out, nil
}

func (r *stationModerationRepository) IsBlockedStation(
	ctx context.Context,
	stationDomain string,
	stationPeerID string,
) (bool, error) {
	stationDomain = strings.TrimSpace(stationDomain)
	stationPeerID = strings.TrimSpace(stationPeerID)
	domains, peers, err := r.BlockedStations(ctx, []string{stationDomain}, []string{stationPeerID})
	return domains[stationDomain] || peers[stationPeerID], err
}

func (r *stationModerationRepository) BlockedStations(
	ctx context.Context, domains, peerIDs []string,
) (map[string]bool, map[string]bool, error) {
	blockedDomains, blockedPeers := make(map[string]bool), make(map[string]bool)
	domains, peerIDs = nonemptyStationKeys(domains), nonemptyStationKeys(peerIDs)
	if len(domains)+len(peerIDs) == 0 {
		return blockedDomains, blockedPeers, nil
	}
	q := r.db.WithContext(ctx).
		Model(&db.SocialStationModerationPolicy{}).
		Where("kind = ?", string(domain.StationModerationPolicyKindBlock))
	if len(domains) > 0 && len(peerIDs) > 0 {
		q = q.Where("station_domain IN ? OR station_peer_id IN ?", domains, peerIDs)
	} else if len(domains) > 0 {
		q = q.Where("station_domain IN ?", domains)
	} else {
		q = q.Where("station_peer_id IN ?", peerIDs)
	}
	var rows []db.SocialStationModerationPolicy
	if err := q.Select("station_domain", "station_peer_id").Find(&rows).Error; err != nil {
		return nil, nil, err
	}
	for _, row := range rows {
		if row.StationDomain != "" {
			blockedDomains[row.StationDomain] = true
		}
		if row.StationPeerID != "" {
			blockedPeers[row.StationPeerID] = true
		}
	}
	return blockedDomains, blockedPeers, nil
}

func nonemptyStationKeys(keys []string) []string {
	out := make([]string, 0, len(keys))
	seen := make(map[string]bool)
	for _, key := range keys {
		if key = strings.TrimSpace(key); key != "" && !seen[key] {
			seen[key] = true
			out = append(out, key)
		}
	}
	return out
}

func (r *stationModerationRepository) ListBlockedStations(ctx context.Context) (map[string]*domain.StationModerationPolicy, error) {
	var rows []db.SocialStationModerationPolicy
	if err := r.db.WithContext(ctx).
		Where("kind = ?", string(domain.StationModerationPolicyKindBlock)).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make(map[string]*domain.StationModerationPolicy, len(rows))
	for i := range rows {
		policy, err := r.moderationDBToDomain(ctx, &rows[i])
		if err != nil {
			return nil, err
		}
		if policy.StationDomain == "" {
			continue
		}
		out[policy.StationDomain] = policy
	}
	return out, nil
}

func moderationDomainToDB(policy *domain.StationModerationPolicy, creatorID uint64) *db.SocialStationModerationPolicy {
	return &db.SocialStationModerationPolicy{
		ID:               policy.ID,
		StationDomain:    strings.TrimSpace(policy.StationDomain),
		StationPeerID:    strings.TrimSpace(policy.StationPeerID),
		Kind:             string(policy.Kind),
		Reason:           policy.Reason,
		CreatedByActorID: creatorID,
	}
}

func (r *stationModerationRepository) moderationDBToDomain(ctx context.Context, row *db.SocialStationModerationPolicy) (*domain.StationModerationPolicy, error) {
	if row == nil {
		return nil, nil
	}
	creatorPTID, err := r.identity.ResolveID(ctx, row.CreatedByActorID)
	if err != nil {
		return nil, err
	}
	return &domain.StationModerationPolicy{
		ID:                 row.ID,
		StationDomain:      row.StationDomain,
		StationPeerID:      row.StationPeerID,
		Kind:               domain.StationModerationPolicyKind(row.Kind),
		Reason:             row.Reason,
		CreatedByActorPTID: creatorPTID,
		CreatedAt:          row.CreatedAt,
		UpdatedAt:          row.UpdatedAt,
	}, nil
}
