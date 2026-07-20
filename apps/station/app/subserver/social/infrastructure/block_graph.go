package infrastructure

import (
	"context"
	"strconv"

	"gorm.io/gorm"
)

const friendshipStatusBlocked = 3

type BlockGraphRepository interface {
	IsBlockedBetween(ctx context.Context, actorID, peerID uint64) (bool, error)
	BlockedActorIDs(ctx context.Context, actorID uint64, peerIDs []uint64) (map[uint64]bool, error)
}

type blockGraphRepository struct {
	db *gorm.DB
}

func NewBlockGraphRepository(gdb *gorm.DB) BlockGraphRepository {
	return &blockGraphRepository{db: gdb}
}

func (r *blockGraphRepository) IsBlockedBetween(ctx context.Context, actorID, peerID uint64) (bool, error) {
	if actorID == 0 || peerID == 0 {
		return false, nil
	}
	var found int
	err := r.db.WithContext(ctx).
		Table("friend_chat_friendships").
		Select("1").
		Where("status = ? AND ((actor_did = ? AND peer_did = ?) OR (actor_did = ? AND peer_did = ?))",
			friendshipStatusBlocked,
			strconv.FormatUint(actorID, 10),
			strconv.FormatUint(peerID, 10),
			strconv.FormatUint(peerID, 10),
			strconv.FormatUint(actorID, 10),
		).
		Limit(1).
		Scan(&found).Error
	return found == 1, err
}

func (r *blockGraphRepository) BlockedActorIDs(ctx context.Context, actorID uint64, peerIDs []uint64) (map[uint64]bool, error) {
	out := make(map[uint64]bool)
	if actorID == 0 || len(peerIDs) == 0 {
		return out, nil
	}
	peerSet := make(map[string]struct{}, len(peerIDs))
	peerValues := make([]string, 0, len(peerIDs))
	for _, peerID := range peerIDs {
		if peerID == 0 {
			continue
		}
		value := strconv.FormatUint(peerID, 10)
		if _, ok := peerSet[value]; ok {
			continue
		}
		peerSet[value] = struct{}{}
		peerValues = append(peerValues, value)
	}
	if len(peerValues) == 0 {
		return out, nil
	}
	actorValue := strconv.FormatUint(actorID, 10)
	var rows []struct {
		ActorDID string `gorm:"column:actor_did"`
		PeerDID  string `gorm:"column:peer_did"`
	}
	if err := r.db.WithContext(ctx).
		Table("friend_chat_friendships").
		Select("actor_did, peer_did").
		Where("status = ? AND ((actor_did = ? AND peer_did IN ?) OR (peer_did = ? AND actor_did IN ?))",
			friendshipStatusBlocked,
			actorValue,
			peerValues,
			actorValue,
			peerValues,
		).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		peer := row.PeerDID
		if row.PeerDID == actorValue {
			peer = row.ActorDID
		}
		if _, ok := peerSet[peer]; !ok {
			continue
		}
		peerID, err := strconv.ParseUint(peer, 10, 64)
		if err == nil {
			out[peerID] = true
		}
	}
	return out, nil
}
