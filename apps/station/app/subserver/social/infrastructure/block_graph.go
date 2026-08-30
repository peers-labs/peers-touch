package infrastructure

import (
	"context"

	"gorm.io/gorm"
)

const friendshipStatusBlocked = 3

type BlockGraphRepository interface {
	IsBlockedBetween(ctx context.Context, actorPTID, peerPTID string) (bool, error)
	BlockedActorPTIDs(ctx context.Context, actorPTID string, peerPTIDs []string) (map[string]bool, error)
	BlockedActorIDs(ctx context.Context, actorID uint64, peerIDs []uint64) (map[uint64]bool, error)
}

type blockGraphRepository struct {
	db       *gorm.DB
	identity *ActorIdentity
}

func NewBlockGraphRepository(gdb *gorm.DB) BlockGraphRepository {
	return &blockGraphRepository{db: gdb, identity: NewActorIdentity(gdb)}
}

func (r *blockGraphRepository) IsBlockedBetween(ctx context.Context, actorPTID, peerPTID string) (bool, error) {
	if actorPTID == "" || peerPTID == "" {
		return false, nil
	}
	var found int
	err := r.db.WithContext(ctx).
		Table("friend_chat_friendships").
		Select("1").
		Where("status = ? AND ((actor_ptid = ? AND peer_ptid = ?) OR (actor_ptid = ? AND peer_ptid = ?))",
			friendshipStatusBlocked,
			actorPTID,
			peerPTID,
			peerPTID,
			actorPTID,
		).
		Limit(1).
		Scan(&found).Error
	return found == 1, err
}

func (r *blockGraphRepository) BlockedActorPTIDs(ctx context.Context, actorPTID string, peerPTIDs []string) (map[string]bool, error) {
	out := make(map[string]bool)
	if actorPTID == "" || len(peerPTIDs) == 0 {
		return out, nil
	}
	peerSet := make(map[string]struct{}, len(peerPTIDs))
	peerValues := make([]string, 0, len(peerPTIDs))
	for _, peerPTID := range peerPTIDs {
		if peerPTID == "" {
			continue
		}
		if _, ok := peerSet[peerPTID]; ok {
			continue
		}
		peerSet[peerPTID] = struct{}{}
		peerValues = append(peerValues, peerPTID)
	}
	if len(peerValues) == 0 {
		return out, nil
	}
	var rows []struct {
		ActorPtid string `gorm:"column:actor_ptid"`
		PeerPtid  string `gorm:"column:peer_ptid"`
	}
	if err := r.db.WithContext(ctx).
		Table("friend_chat_friendships").
		Select("actor_ptid, peer_ptid").
		Where("status = ? AND ((actor_ptid = ? AND peer_ptid IN ?) OR (peer_ptid = ? AND actor_ptid IN ?))",
			friendshipStatusBlocked,
			actorPTID,
			peerValues,
			actorPTID,
			peerValues,
		).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		peer := row.PeerPtid
		if row.PeerPtid == actorPTID {
			peer = row.ActorPtid
		}
		if _, ok := peerSet[peer]; !ok {
			continue
		}
		out[peer] = true
	}
	return out, nil
}

func (r *blockGraphRepository) BlockedActorIDs(ctx context.Context, actorID uint64, peerIDs []uint64) (map[uint64]bool, error) {
	actorPTID, err := r.identity.ResolveID(ctx, actorID)
	if err != nil || actorPTID == "" {
		return map[uint64]bool{}, err
	}
	peerPTIDs := make([]string, 0, len(peerIDs))
	idByPTID := make(map[string]uint64, len(peerIDs))
	for _, peerID := range peerIDs {
		peerPTID, resolveErr := r.identity.ResolveID(ctx, peerID)
		if resolveErr != nil {
			return nil, resolveErr
		}
		if peerPTID != "" {
			peerPTIDs = append(peerPTIDs, peerPTID)
			idByPTID[peerPTID] = peerID
		}
	}
	blockedPTIDs, err := r.BlockedActorPTIDs(ctx, actorPTID, peerPTIDs)
	if err != nil {
		return nil, err
	}
	blockedIDs := make(map[uint64]bool, len(blockedPTIDs))
	for peerPTID, blocked := range blockedPTIDs {
		blockedIDs[idByPTID[peerPTID]] = blocked
	}
	return blockedIDs, nil
}
