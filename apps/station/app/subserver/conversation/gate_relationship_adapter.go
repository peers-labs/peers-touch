package conversation

import (
	"context"
	"strconv"

	"gorm.io/gorm"
)

const blockStatusFriendship = 3

// ConversationRelationshipAdapter satisfies social_gate.RelationshipQuerier
// by composing conversation membership checks with social graph lookups.
// It bridges the ptid identity boundary: the gate operates on ptid, while the
// existing social infrastructure (follows/blocks) still uses uint64 actor_id
// internally. The adapter resolves ptid → actor_id via the touch_actor table.
type ConversationRelationshipAdapter struct {
	repo Repository
	db   *gorm.DB
}

func NewConversationRelationshipAdapter(repo Repository, db *gorm.DB) *ConversationRelationshipAdapter {
	return &ConversationRelationshipAdapter{repo: repo, db: db}
}

func (a *ConversationRelationshipAdapter) AreMutualFollowers(ctx context.Context, ptidA, ptidB string) (bool, error) {
	idA, idB, err := a.resolveActorPair(ctx, ptidA, ptidB)
	if err != nil || idA == 0 || idB == 0 {
		return false, err
	}

	var aFollowsB int
	if err := a.db.WithContext(ctx).
		Table("follows").
		Select("1").
		Where("follower_id = ? AND following_id = ?", idA, idB).
		Limit(1).
		Scan(&aFollowsB).Error; err != nil {
		return false, err
	}
	if aFollowsB == 0 {
		return false, nil
	}

	var bFollowsA int
	if err := a.db.WithContext(ctx).
		Table("follows").
		Select("1").
		Where("follower_id = ? AND following_id = ?", idB, idA).
		Limit(1).
		Scan(&bFollowsA).Error; err != nil {
		return false, err
	}

	return bFollowsA == 1, nil
}

func (a *ConversationRelationshipAdapter) IsBlocked(ctx context.Context, blockerPtid, blockedPtid string) (bool, error) {
	blockerID, blockedID, err := a.resolveActorPair(ctx, blockerPtid, blockedPtid)
	if err != nil || blockerID == 0 || blockedID == 0 {
		return false, err
	}

	var found int
	err = a.db.WithContext(ctx).
		Table("friend_chat_friendships").
		Select("1").
		Where("status = ? AND actor_ptid = ? AND peer_ptid = ?",
			blockStatusFriendship,
			strconv.FormatUint(blockerID, 10),
			strconv.FormatUint(blockedID, 10),
		).
		Limit(1).
		Scan(&found).Error

	return found == 1, err
}

func (a *ConversationRelationshipAdapter) HaveSharedConversation(ctx context.Context, ptidA, ptidB string) (bool, error) {
	return a.repo.HaveSharedConversation(ctx, ptidA, ptidB)
}

func (a *ConversationRelationshipAdapter) resolveActorPair(ctx context.Context, ptidA, ptidB string) (uint64, uint64, error) {
	type idRow struct {
		ID   uint64 `gorm:"column:id"`
		PTID string `gorm:"column:ptid"`
	}

	var rows []idRow
	if err := a.db.WithContext(ctx).
		Table("touch_actor").
		Select("id, ptid").
		Where("ptid IN ?", []string{ptidA, ptidB}).
		Find(&rows).Error; err != nil {
		return 0, 0, err
	}

	var idA, idB uint64
	for _, r := range rows {
		switch r.PTID {
		case ptidA:
			idA = r.ID
		case ptidB:
			idB = r.ID
		}
	}
	return idA, idB, nil
}
