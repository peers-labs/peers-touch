package infrastructure

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

type ActorIdentity struct {
	db *gorm.DB
}

func NewActorIdentity(db *gorm.DB) *ActorIdentity {
	return &ActorIdentity{db: db}
}

func (r *ActorIdentity) ResolvePTIDs(ctx context.Context, actorPTIDs []string) ([]uint64, error) {
	ids := make([]uint64, len(actorPTIDs))
	if len(actorPTIDs) == 0 {
		return ids, nil
	}

	var actors []db.Actor
	if err := r.db.WithContext(ctx).
		Select("id", "ptid").
		Where("ptid IN ?", actorPTIDs).
		Find(&actors).Error; err != nil {
		return nil, fmt.Errorf("resolve actor PTIDs: %w", err)
	}

	byPTID := make(map[string]uint64, len(actors))
	for _, actor := range actors {
		byPTID[actor.PTID] = actor.ID
	}
	for index, actorPTID := range actorPTIDs {
		ids[index] = byPTID[actorPTID]
	}
	return ids, nil
}

func (r *ActorIdentity) ResolveID(ctx context.Context, actorID uint64) (string, error) {
	if actorID == 0 {
		return "", nil
	}

	var actor db.Actor
	if err := r.db.WithContext(ctx).
		Select("ptid").
		Where("id = ?", actorID).
		First(&actor).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return "", nil
		}
		return "", fmt.Errorf("resolve actor ID %d: %w", actorID, err)
	}
	return actor.PTID, nil
}

func (r *ActorIdentity) RequireID(ctx context.Context, actorPTID string) (uint64, error) {
	ids, err := r.ResolvePTIDs(ctx, []string{actorPTID})
	if err != nil {
		return 0, err
	}
	if len(ids) != 1 || ids[0] == 0 {
		return 0, fmt.Errorf("actor PTID %q is not registered locally", actorPTID)
	}
	return ids[0], nil
}

func (r *ActorIdentity) RequireIDs(ctx context.Context, actorPTIDs []string) ([]uint64, error) {
	ids, err := r.ResolvePTIDs(ctx, actorPTIDs)
	if err != nil {
		return nil, err
	}
	for index, actorID := range ids {
		if actorID == 0 {
			return nil, fmt.Errorf("actor PTID %q is not registered locally", actorPTIDs[index])
		}
	}
	return ids, nil
}
