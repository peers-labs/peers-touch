// Changelog:
// 2026-04-11 — Initial implementation: CredentialPoolService providing credential
//              leasing with rotation strategies (fill_first, round_robin, random,
//              least_used), exhaustion/error marking, cooldown recovery, and
//              per-provider listing. Uses sync.Mutex for in-process lease safety.

package service

import (
	"context"
	"fmt"
	"math/rand"
	"net/http"
	"sync"
	"time"

	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

// ---------------------------------------------------------------------------
// CredentialPoolService
// ---------------------------------------------------------------------------

type CredentialPoolService struct {
	mu sync.Mutex
}

func NewCredentialPoolService() *CredentialPoolService {
	return &CredentialPoolService{}
}

// ---------------------------------------------------------------------------
// Lease — select an available credential using the given rotation strategy
// and atomically increment its request count.
// ---------------------------------------------------------------------------

func (s *CredentialPoolService) Lease(
	ctx context.Context,
	provider string,
	strategy domain.RotationStrategy,
) (*domain.CredentialEntry, error) {

	s.mu.Lock()
	defer s.mu.Unlock()

	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var rows []persistence.Credential
	if err := db.WithContext(ctx).
		Where("provider = ?", provider).
		Find(&rows).Error; err != nil {
		logger.Errorf(ctx, "credential pool query failed: provider=%s, err=%v", provider, err)
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to query credential pool", err)
	}

	if len(rows) == 0 {
		return nil, errcode.New(errcode.AgentCredentialFailed, http.StatusNotFound,
			fmt.Sprintf("no credentials registered for provider %q", provider), nil)
	}

	now := time.Now()
	selected := s.selectByStrategy(rows, strategy, now)
	if selected == nil {
		return nil, errcode.New(errcode.AgentCredentialFailed, http.StatusServiceUnavailable,
			fmt.Sprintf("no available credentials for provider %q (all exhausted or in error)", provider), nil)
	}

	if err := db.WithContext(ctx).
		Model(&persistence.Credential{}).
		Where("id = ?", selected.ID).
		Updates(map[string]interface{}{
			"request_count": gorm.Expr("request_count + 1"),
			"updated_at":    now,
		}).Error; err != nil {
		logger.Errorf(ctx, "credential lease increment failed: id=%s, err=%v", selected.ID, err)
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to increment credential request count", err)
	}

	selected.RequestCount++
	selected.UpdatedAt = now
	entry := s.toDomain(selected)

	logger.Infof(ctx, "credential leased: id=%s, provider=%s, strategy=%s, request_count=%d",
		entry.CredentialID, provider, strategy, entry.RequestCount)

	return &entry, nil
}

// ---------------------------------------------------------------------------
// Release — placeholder for future distributed lock release.
// ---------------------------------------------------------------------------

func (s *CredentialPoolService) Release(ctx context.Context, credentialID string) error {
	logger.Infof(ctx, "credential released (no-op): id=%s", credentialID)
	return nil
}

// ---------------------------------------------------------------------------
// MarkExhausted — set status to exhausted with cooldown window.
// ---------------------------------------------------------------------------

func (s *CredentialPoolService) MarkExhausted(ctx context.Context, credentialID string, httpStatus int) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	now := time.Now()
	cooldownUntil := now.Add(domain.ExhaustedCooldownDuration)

	result := db.WithContext(ctx).
		Model(&persistence.Credential{}).
		Where("id = ?", credentialID).
		Updates(map[string]interface{}{
			"status":         string(domain.CredentialStatusExhausted),
			"exhausted_at":   now,
			"cooldown_until": cooldownUntil,
			"updated_at":     now,
		})

	if result.Error != nil {
		logger.Errorf(ctx, "credential mark exhausted failed: id=%s, err=%v", credentialID, result.Error)
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to mark credential exhausted", result.Error)
	}

	if result.RowsAffected == 0 {
		return errcode.New(errcode.AgentNotFound, http.StatusNotFound,
			fmt.Sprintf("credential %q not found", credentialID), nil)
	}

	logger.Infof(ctx, "credential marked exhausted: id=%s, http_status=%d, cooldown_until=%s",
		credentialID, httpStatus, cooldownUntil.Format(time.RFC3339))

	return nil
}

// ---------------------------------------------------------------------------
// MarkError — set status to error (permanent until manual intervention).
// ---------------------------------------------------------------------------

func (s *CredentialPoolService) MarkError(ctx context.Context, credentialID string) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	now := time.Now()

	result := db.WithContext(ctx).
		Model(&persistence.Credential{}).
		Where("id = ?", credentialID).
		Updates(map[string]interface{}{
			"status":     string(domain.CredentialStatusError),
			"updated_at": now,
		})

	if result.Error != nil {
		logger.Errorf(ctx, "credential mark error failed: id=%s, err=%v", credentialID, result.Error)
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to mark credential error", result.Error)
	}

	if result.RowsAffected == 0 {
		return errcode.New(errcode.AgentNotFound, http.StatusNotFound,
			fmt.Sprintf("credential %q not found", credentialID), nil)
	}

	logger.Infof(ctx, "credential marked error: id=%s", credentialID)

	return nil
}

// ---------------------------------------------------------------------------
// RecoverCooledDown — reset exhausted credentials past their cooldown window
// back to active. Returns the number of credentials recovered.
// ---------------------------------------------------------------------------

func (s *CredentialPoolService) RecoverCooledDown(ctx context.Context) (int, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return 0, err
	}

	now := time.Now()

	result := db.WithContext(ctx).
		Model(&persistence.Credential{}).
		Where("status = ? AND cooldown_until IS NOT NULL AND cooldown_until <= ?",
			string(domain.CredentialStatusExhausted), now).
		Updates(map[string]interface{}{
			"status":         string(domain.CredentialStatusActive),
			"exhausted_at":   nil,
			"cooldown_until": nil,
			"updated_at":     now,
		})

	if result.Error != nil {
		logger.Errorf(ctx, "credential cooldown recovery failed: err=%v", result.Error)
		return 0, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to recover cooled-down credentials", result.Error)
	}

	recovered := int(result.RowsAffected)
	if recovered > 0 {
		logger.Infof(ctx, "credential cooldown recovery: %d credentials restored to active", recovered)
	}

	return recovered, nil
}

// ---------------------------------------------------------------------------
// ListByProvider — return all credentials for a provider as domain objects.
// ---------------------------------------------------------------------------

func (s *CredentialPoolService) ListByProvider(
	ctx context.Context,
	provider string,
) ([]domain.CredentialEntry, error) {

	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var rows []persistence.Credential
	if err := db.WithContext(ctx).
		Where("provider = ?", provider).
		Order("priority ASC, created_at ASC").
		Find(&rows).Error; err != nil {
		logger.Errorf(ctx, "credential list query failed: provider=%s, err=%v", provider, err)
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to list credentials", err)
	}

	entries := make([]domain.CredentialEntry, 0, len(rows))
	for i := range rows {
		entries = append(entries, s.toDomain(&rows[i]))
	}

	return entries, nil
}

// ---------------------------------------------------------------------------
// Rotation strategy selection
// ---------------------------------------------------------------------------

func (s *CredentialPoolService) selectByStrategy(
	rows []persistence.Credential,
	strategy domain.RotationStrategy,
	now time.Time,
) *persistence.Credential {

	switch strategy {
	case domain.RotationFillFirst:
		return s.fillFirst(rows, now)
	case domain.RotationRoundRobin:
		return s.roundRobin(rows, now)
	case domain.RotationRandom:
		return s.randomPick(rows, now)
	case domain.RotationLeastUsed:
		return s.leastUsed(rows, now)
	default:
		return s.fillFirst(rows, now)
	}
}

// fillFirst picks the first available credential sorted by priority ASC.
func (s *CredentialPoolService) fillFirst(
	rows []persistence.Credential,
	now time.Time,
) *persistence.Credential {

	sorted := s.copyAndSort(rows, func(a, b persistence.Credential) bool {
		return a.Priority < b.Priority
	})

	for i := range sorted {
		entry := s.toDomain(&sorted[i])
		if entry.IsAvailable(now) {
			return &sorted[i]
		}
	}

	return nil
}

// roundRobin picks the available credential with the lowest request count,
// distributing load evenly across the pool.
func (s *CredentialPoolService) roundRobin(
	rows []persistence.Credential,
	now time.Time,
) *persistence.Credential {

	sorted := s.copyAndSort(rows, func(a, b persistence.Credential) bool {
		return a.RequestCount < b.RequestCount
	})

	for i := range sorted {
		entry := s.toDomain(&sorted[i])
		if entry.IsAvailable(now) {
			return &sorted[i]
		}
	}

	return nil
}

// randomPick selects a random available credential from the pool.
func (s *CredentialPoolService) randomPick(
	rows []persistence.Credential,
	now time.Time,
) *persistence.Credential {

	var available []int
	for i := range rows {
		entry := s.toDomain(&rows[i])
		if entry.IsAvailable(now) {
			available = append(available, i)
		}
	}

	if len(available) == 0 {
		return nil
	}

	idx := available[rand.Intn(len(available))]
	return &rows[idx]
}

// leastUsed picks the available credential with the lowest request count.
// Conceptually distinct from roundRobin for future weighted algorithm expansion.
func (s *CredentialPoolService) leastUsed(
	rows []persistence.Credential,
	now time.Time,
) *persistence.Credential {

	sorted := s.copyAndSort(rows, func(a, b persistence.Credential) bool {
		return a.RequestCount < b.RequestCount
	})

	for i := range sorted {
		entry := s.toDomain(&sorted[i])
		if entry.IsAvailable(now) {
			return &sorted[i]
		}
	}

	return nil
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

func (s *CredentialPoolService) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		logger.Errorf(ctx, "agent database not available: %v", err)
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"database unavailable", err)
	}
	return db, nil
}

func (s *CredentialPoolService) toDomain(row *persistence.Credential) domain.CredentialEntry {
	entry := domain.CredentialEntry{
		CredentialID: row.ID,
		Provider:     row.Provider,
		AuthType:     domain.AuthType(row.AuthType),
		Priority:     row.Priority,
		Source:       domain.CredentialSource(row.Source),
		Status:       domain.CredentialStatus(row.Status),
		RequestCount: row.RequestCount,
		ExhaustedAt:  row.ExhaustedAt,
		CooldownUntil: row.CooldownUntil,
		CreatedAt:    row.CreatedAt,
		UpdatedAt:    row.UpdatedAt,
	}

	if row.Label != nil {
		entry.Label = *row.Label
	}

	return entry
}

func (s *CredentialPoolService) copyAndSort(
	rows []persistence.Credential,
	less func(a, b persistence.Credential) bool,
) []persistence.Credential {

	cp := make([]persistence.Credential, len(rows))
	copy(cp, rows)

	for i := 1; i < len(cp); i++ {
		for j := i; j > 0 && less(cp[j], cp[j-1]); j-- {
			cp[j], cp[j-1] = cp[j-1], cp[j]
		}
	}

	return cp
}
