package actor

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

func GetActorByEmail(ctx context.Context, email string) (*db.Actor, error) {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		logger.Errorf(ctx, "Failed to get database connection: %v", err)
		return nil, fmt.Errorf("database connection failed: %w", err)
	}

	var actor db.Actor
	if err := rds.Where("email = ?", email).First(&actor).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			logger.Warnf(ctx, "Actor not found for email: %s", email)
			return nil, fmt.Errorf("actor not found: %s", email)
		}
		logger.Errorf(ctx, "Failed to query actor: %v", err)
		return nil, fmt.Errorf("query actor failed: %w", err)
	}

	return &actor, nil
}

func ListActors(ctx context.Context, excludeActorID uint64) ([]*db.Actor, error) {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		logger.Errorf(ctx, "Failed to get database connection: %v", err)
		return nil, fmt.Errorf("database connection failed: %w", err)
	}

	var actors []*db.Actor
	query := rds.Where("id != ?", excludeActorID)
	if err := query.Find(&actors).Error; err != nil {
		logger.Errorf(ctx, "Failed to list actors: %v", err)
		return nil, fmt.Errorf("list actors failed: %w", err)
	}

	return actors, nil
}

func SearchActors(ctx context.Context, query string, excludeActorID uint64) ([]*db.Actor, error) {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		logger.Errorf(ctx, "Failed to get database connection: %v", err)
		return nil, fmt.Errorf("database connection failed: %w", err)
	}

	var actors []*db.Actor
	searchQuery := "%" + query + "%"
	dbQuery := rds.Where("id != ?", excludeActorID).
		Where("preferred_username LIKE ? OR name LIKE ?", searchQuery, searchQuery)
	
	if err := dbQuery.Find(&actors).Error; err != nil {
		logger.Errorf(ctx, "Failed to search actors: %v", err)
		return nil, fmt.Errorf("search actors failed: %w", err)
	}

	return actors, nil
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
