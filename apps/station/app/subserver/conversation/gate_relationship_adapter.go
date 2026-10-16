package conversation

import (
	"context"
	"strconv"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/query"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	"gorm.io/gorm"
)

const blockStatusFriendship = 3

// ConversationRelationshipAdapter satisfies social_gate.RelationshipQuerier
// by composing conversation membership checks with social graph lookups.
// It bridges the ptid identity boundary: the gate operates on ptid, while the
// existing social infrastructure (follows/blocks) still uses uint64 actor_id
// internally. The adapter resolves ptid → actor_id via the touch_actor table.
type ConversationRelationshipAdapter struct {
	db            *gorm.DB
	conversations *query.Service
}

func NewConversationRelationshipAdapter(
	db *gorm.DB,
	conversations *query.Service,
) *ConversationRelationshipAdapter {
	return &ConversationRelationshipAdapter{
		db:            db,
		conversations: conversations,
	}
}

func (a *ConversationRelationshipAdapter) AreMutualFollowers(ctx context.Context, ptidA, ptidB string) (bool, error) {
	_, mutual, err := a.FriendshipProofID(ctx, ptidA, ptidB)
	return mutual, err
}

// FriendshipProofID reads canonical Social acceptance truth without copying it
// into Conversation. Both actor-local projections must point at the same
// accepted request; that request identity fences every admission grant.
func (a *ConversationRelationshipAdapter) FriendshipProofID(
	ctx context.Context,
	ptidA string,
	ptidB string,
) (string, bool, error) {
	type relationshipRow struct {
		OwnerPTID string `gorm:"column:owner_ptid"`
		PeerPTID  string `gorm:"column:peer_ptid"`
		RequestID string `gorm:"column:request_id"`
	}
	var rows []relationshipRow
	if err := a.db.WithContext(ctx).
		Table("social_relationship_projections").
		Select("owner_ptid, peer_ptid, request_id").
		Where(
			"(owner_ptid = ? AND peer_ptid = ?) OR "+
				"(owner_ptid = ? AND peer_ptid = ?)",
			ptidA,
			ptidB,
			ptidB,
			ptidA,
		).
		Find(&rows).Error; err != nil {
		return "", false, err
	}
	if len(rows) != 2 {
		return "", false, nil
	}
	requestID := rows[0].RequestID
	if requestID == "" || rows[1].RequestID != requestID {
		return "", false, nil
	}
	return requestID, true, nil
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
	if a.conversations == nil {
		return false, nil
	}
	conversations, err := a.conversations.List(ctx, valueobject.PTID(ptidA))
	if err != nil {
		return false, err
	}
	for _, conversation := range conversations {
		if conversation.Conversation.Status != valueobject.ConversationStatusActive {
			continue
		}
		for _, member := range conversation.Conversation.Members {
			if member.Active() && member.Actor == valueobject.PTID(ptidB) {
				return true, nil
			}
		}
	}
	return false, nil
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
