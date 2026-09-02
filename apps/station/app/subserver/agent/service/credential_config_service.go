package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
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
	ActorPTID  string
	ProviderID string
	APIKey     string
}

type CredentialDeleteRequest struct {
	ActorPTID  string
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
// Stores the key in agent_providers.key_vaults (used by provider_service for LLM calls)
// and creates/updates metadata in agent_credential_pool.
func (s *CredentialConfigService) Set(ctx context.Context, req CredentialSetRequest) (*CredentialStatusResponse, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	if strings.TrimSpace(req.ActorPTID) == "" || strings.TrimSpace(req.ProviderID) == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			"actor_id and provider_id are required", nil)
	}
	if strings.TrimSpace(req.APIKey) == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			"api_key is required", nil)
	}

	status, err := s.setWithDB(ctx, db, req)
	if err != nil {
		return nil, err
	}
	logger.Infof(ctx, "credential set: actor_ptid=%s, provider=%s, version=%d", req.ActorPTID, req.ProviderID, status.Version)
	return status, nil
}

func (s *CredentialConfigService) setWithDB(
	ctx context.Context,
	db *gorm.DB,
	req CredentialSetRequest,
) (*CredentialStatusResponse, error) {
	var result *CredentialStatusResponse

	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := time.Now()

		var providerRecord persistence.AgentProvider
		query := tx.Where("actor_ptid = ? AND name = ?", req.ActorPTID, req.ProviderID).
			First(&providerRecord)
		if query.Error != nil {
			if query.Error != gorm.ErrRecordNotFound {
				return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
					"failed to query provider for credential registration", query.Error)
			}

			providerRecord = *newProviderRecord(ProviderCreateRequest{
				ActorPTID: req.ActorPTID,
				ProviderID: req.ProviderID,
			})
			if providerRecord.SourceType != "catalog" {
				return errcode.New(errcode.AgentNotFound, http.StatusNotFound,
					fmt.Sprintf("provider %q not found", req.ProviderID), nil)
			}
			if err := tx.Create(&providerRecord).Error; err != nil {
				return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
					"failed to materialize catalog provider", err)
			}
		}

		keyVaultsJSON, err := json.Marshal(map[string]string{"api_key": req.APIKey})
		if err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"failed to encode provider credential", err)
		}
		if err := tx.Model(&providerRecord).Updates(map[string]interface{}{
			"key_vaults": string(keyVaultsJSON),
			"updated_at": now,
		}).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"failed to update provider credential", err)
		}

		poolID := providerRecord.ID
		if poolID == "" {
			poolID = uuid.New().String()
		}
		cred := persistence.Credential{
			ID:       poolID,
			ActorPTID: req.ActorPTID,
			Provider: req.ProviderID,
			AuthType: "api_key",
			Source:   "auth_store",
			Status:   "active",
			Version:  1,
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "actor_ptid"}, {Name: "provider"}},
			DoUpdates: clause.Assignments(map[string]interface{}{
				"id":         poolID,
				"status":     "active",
				"version":    gorm.Expr("agent_credential_pool.version + 1"),
				"updated_at": now,
			}),
		}).Create(&cred).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"failed to register credential", err)
		}

		var current persistence.Credential
		if err := tx.Where("actor_ptid = ? AND provider = ?", req.ActorPTID, req.ProviderID).
			First(&current).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"failed to read credential after set", err)
		}

		result = &CredentialStatusResponse{
			ProviderID: req.ProviderID,
			Configured: true,
			Status:     current.Status,
			Version:    current.Version,
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

// Delete removes a credential with version check.
func (s *CredentialConfigService) Delete(ctx context.Context, req CredentialDeleteRequest) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	var cred persistence.Credential
	if err := db.WithContext(ctx).
		Where("actor_ptid = ? AND provider = ?", req.ActorPTID, req.ProviderID).
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

	logger.Infof(ctx, "credential deleted: actor_ptid=%s, provider=%s", req.ActorPTID, req.ProviderID)
	return nil
}

// Status returns credential status without exposing the actual key value.
func (s *CredentialConfigService) Status(ctx context.Context, actorPTID, providerID string) (*CredentialStatusResponse, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var cred persistence.Credential
	if err := db.WithContext(ctx).
		Where("actor_ptid = ? AND provider = ?", actorPTID, providerID).
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

type CredentialResolveResponse struct {
	ProviderID string `json:"provider_id"`
	APIKey     string `json:"api_key"`
	BaseURL    string `json:"base_url"`
	Protocol   string `json:"protocol"`
}

// Resolve returns the actual credentials for an authenticated actor's provider.
// Only the owning actor can resolve their own credentials.
func (s *CredentialConfigService) Resolve(ctx context.Context, actorPTID, providerID string) (*CredentialResolveResponse, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var provider persistence.AgentProvider
	if err := db.WithContext(ctx).
		Where("actor_ptid = ? AND name = ?", actorPTID, providerID).
		First(&provider).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound,
				fmt.Sprintf("provider %q not found", providerID), nil)
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to query provider", err)
	}

	var kv map[string]interface{}
	_ = json.Unmarshal([]byte(provider.KeyVaults), &kv)
	apiKey := ""
	if v, ok := kv["api_key"]; ok {
		if s, ok := v.(string); ok {
			apiKey = s
		}
	}

	return &CredentialResolveResponse{
		ProviderID: providerID,
		APIKey:     apiKey,
		BaseURL:    provider.BaseURL,
		Protocol:   provider.Protocol,
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
