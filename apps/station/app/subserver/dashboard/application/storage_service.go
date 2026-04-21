// Package application — StorageService surfaces real database metadata to
// the dashboard "Storage" page (driver, connection pool, per-table counts).
//
// Created: 2026-04-21 — replaces the placeholder Storage page.
package application

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/infrastructure"
)

// StorageService composes the Storage page payload from real DB sources.
type StorageService struct {
	storageRepo infrastructure.StorageRepository
}

// NewStorageService constructs a StorageService.
func NewStorageService(storageRepo infrastructure.StorageRepository) *StorageService {
	return &StorageService{storageRepo: storageRepo}
}

// GetStorageInfo returns a snapshot of the database driver, connection
// pool, and per-table row counts.
func (s *StorageService) GetStorageInfo(ctx context.Context) (*domain.StorageInfo, error) {
	info := &domain.StorageInfo{
		Driver: s.storageRepo.Driver(),
	}

	if raw := s.storageRepo.PoolStats(); raw != nil {
		info.Pool = &domain.StoragePoolStats{
			MaxOpenConnections: raw.MaxOpenConnections,
			OpenConnections:    raw.OpenConnections,
			InUse:              raw.InUse,
			Idle:               raw.Idle,
			WaitCount:          raw.WaitCount,
			WaitDurationMillis: raw.WaitDuration.Milliseconds(),
			MaxIdleClosed:      raw.MaxIdleClosed,
			MaxIdleTimeClosed:  raw.MaxIdleTimeClosed,
			MaxLifetimeClosed:  raw.MaxLifetimeClosed,
		}
	}

	tables, err := s.storageRepo.TableCounts(ctx)
	if err != nil {
		return nil, err
	}
	info.Tables = tables

	return info, nil
}
