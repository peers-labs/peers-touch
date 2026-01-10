package activitypub

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

func GetActorByID(ctx context.Context, actorID uint64) (*db.Actor, error) {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		logger.Errorf(ctx, "Failed to get database connection: %v", err)
		return nil, fmt.Errorf("database connection failed: %w", err)
	}

	var actor db.Actor
	if err := rds.Where("id = ?", actorID).First(&actor).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			logger.Warnf(ctx, "Actor not found for ID: %d", actorID)
			return nil, fmt.Errorf("actor not found: %d", actorID)
		}
		logger.Errorf(ctx, "Failed to query actor: %v", err)
		return nil, fmt.Errorf("query actor failed: %w", err)
	}

	return &actor, nil
}

func GetActorByUsername(ctx context.Context, username string) (*db.Actor, error) {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		logger.Errorf(ctx, "Failed to get database connection: %v", err)
		return nil, fmt.Errorf("database connection failed: %w", err)
	}

	var actor db.Actor
	if err := rds.Where("preferred_username = ?", username).First(&actor).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			logger.Warnf(ctx, "Actor not found for username: %s", username)
			return nil, fmt.Errorf("actor not found: %s", username)
		}
		logger.Errorf(ctx, "Failed to query actor: %v", err)
		return nil, fmt.Errorf("query actor failed: %w", err)
	}

	return &actor, nil
}

func ValidateActorOwnership(ctx context.Context, actorID uint64, username string) error {
	actor, err := GetActorByID(ctx, actorID)
	if err != nil {
		return err
	}

	if actor.PreferredUsername != username {
		logger.Warnf(ctx, "Actor ownership mismatch: ID=%d has username=%s, expected=%s",
			actorID, actor.PreferredUsername, username)
		return fmt.Errorf("actor ownership mismatch")
	}

	return nil
}
