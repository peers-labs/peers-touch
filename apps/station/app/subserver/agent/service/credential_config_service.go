package service

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

type CredentialConfigService struct{}

func NewCredentialConfigService() *CredentialConfigService {
	return &CredentialConfigService{}
}

type CredentialSetRequest struct {
	ActorID    string
	ProviderID string
	APIKey     string
}

type CredentialDeleteRequest struct {
	ActorID    string
	ProviderID string
	Version    int64
}

type CredentialStatusResponse struct {
	ProviderID string `json:"provider_id"`
	Configured bool   `json:"configured"`
	Status     string `json:"status"`
	Version    int64  `json:"version"`
}

// Set implements full-replacement upsert semantics for credentials.
// No version required on set (per architecture: user re-enters full key each time).
func (s *CredentialConfigService) Set(ctx context.Context, req CredentialSetRequest) (*CredentialStatusResponse, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	now := time.Now()

	cred := persistence.Credential{
		ID:       uuid.New().String(),
		ActorID:  req.ActorID,
		Provider: req.ProviderID,
		AuthType: "api_key",
		Source:   "auth_store",
		Status:   "active",
		Version:  1,
	}

	result := db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "actor_id"}, {Name: "provider"}},
			DoUpdates: clause.Assignments(map[string]interface{}{
				"status":     "active",
				"version":    gorm.Expr("agent_credential_pool.version + 1"),
				"updated_at": now,
			}),
		}).
		Create(&cred)

	if result.Error != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to set credential", result.Error)
	}

	var current persistence.Credential
	if err := db.WithContext(ctx).
		Where("actor_id = ? AND provider = ?", req.ActorID, req.ProviderID).
		First(&current).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to read credential after set", err)
	}

	logger.Infof(ctx, "credential set: actor=%s, provider=%s, version=%d", req.ActorID, req.ProviderID, current.Version)

	return &CredentialStatusResponse{
		ProviderID: req.ProviderID,
		Configured: true,
		Status:     current.Status,
		Version:    current.Version,
	}, nil
}

// Delete removes a credential with version check.
func (s *CredentialConfigService) Delete(ctx context.Context, req CredentialDeleteRequest) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	var cred persistence.Credential
	if err := db.WithContext(ctx).
		Where("actor_id = ? AND provider = ?", req.ActorID, req.ProviderID).
		First(&cred).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return errcode.New(errcode.AgentNotFound, http.StatusNotFound,
				fmt.Sprintf("no credential for provider %q", req.ProviderID), nil)
		}
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to query credential", err)
	}

	if cred.Version != req.Version {
		return errcode.New(errcode.AgentVersionConflict, http.StatusConflict,
			fmt.Sprintf("version conflict: current=%d, submitted=%d", cred.Version, req.Version), nil)
	}

	if err := db.WithContext(ctx).Delete(&cred).Error; err != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to delete credential", err)
	}

	logger.Infof(ctx, "credential deleted: actor=%s, provider=%s", req.ActorID, req.ProviderID)
	return nil
}

// Status returns credential status without exposing the actual key value.
func (s *CredentialConfigService) Status(ctx context.Context, actorID, providerID string) (*CredentialStatusResponse, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var cred persistence.Credential
	if err := db.WithContext(ctx).
		Where("actor_id = ? AND provider = ?", actorID, providerID).
		First(&cred).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return &CredentialStatusResponse{
				ProviderID: providerID,
				Configured: false,
				Status:     "",
				Version:    0,
			}, nil
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to query credential status", err)
	}

	return &CredentialStatusResponse{
		ProviderID: providerID,
		Configured: true,
		Status:     cred.Status,
		Version:    cred.Version,
	}, nil
}

func (s *CredentialConfigService) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"database unavailable", err)
	}
	return db, nil
}
