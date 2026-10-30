package service

import (
	"context"
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
	Scope      string
	ActorPTID  string
	ProviderID string
	APIKey     string
}

type CredentialDeleteRequest struct {
	Scope      string
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
// Seals the key in agent_providers.key_vaults and updates pool metadata and the
// Provider revision in the same transaction.
func (s *CredentialConfigService) Set(ctx context.Context, req CredentialSetRequest) (*CredentialStatusResponse, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	if err := NewProviderConfigService().validateManagementOwner(ctx, requestProviderOwner(req.Scope, req.ActorPTID)); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.ProviderID) == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			"provider_id is required", nil)
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
	owner := requestProviderOwner(req.Scope, req.ActorPTID)
	if err := owner.Validate(); err != nil {
		return nil, err
	}
	var result *CredentialStatusResponse

	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := time.Now()

		var providerRecord persistence.AgentProvider
		query := owner.Query(tx).Clauses(clause.Locking{Strength: "UPDATE"}).Where("name = ?", req.ProviderID).
			First(&providerRecord)
		if query.Error != nil {
			if query.Error != gorm.ErrRecordNotFound {
				return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
					"failed to query provider for credential registration", query.Error)
			}

			providerRecord = *newProviderRecord(ProviderCreateRequest{
				Scope:      owner.Scope,
				ActorPTID:  req.ActorPTID,
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

		keyVaultsJSON, err := sealProviderCredential(&providerRecord, req.APIKey)
		if err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"failed to encode provider credential", err)
		}
		if err := tx.Model(&providerRecord).Updates(map[string]interface{}{
			"key_vaults": keyVaultsJSON,
			"version":    gorm.Expr("version + 1"),
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
			ID:        poolID,
			Scope:     owner.Scope,
			ActorPTID: req.ActorPTID,
			Provider:  req.ProviderID,
			AuthType:  "api_key",
			Source:    "auth_store",
			Status:    "active",
			Version:   1,
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "scope"}, {Name: "actor_ptid"}, {Name: "provider"}},
			DoUpdates: clause.Assignments(map[string]interface{}{
				"id":             poolID,
				"scope":          owner.Scope,
				"status":         "active",
				"exhausted_at":   nil,
				"cooldown_until": nil,
				"version":        gorm.Expr("agent_credential_pool.version + 1"),
				"updated_at":     now,
			}),
		}).Create(&cred).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"failed to register credential", err)
		}

		var current persistence.Credential
		if err := owner.Query(tx).Where("provider = ?", req.ProviderID).
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
	owner := requestProviderOwner(req.Scope, req.ActorPTID)
	if err := NewProviderConfigService().validateManagementOwner(ctx, owner); err != nil {
		return err
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var provider persistence.AgentProvider
		if err := owner.Query(tx).Clauses(clause.Locking{Strength: "UPDATE"}).
			First(&provider, "name = ?", req.ProviderID).Error; err != nil {
			return err
		}
		var cred persistence.Credential
		if err := owner.Query(tx).
			Where("provider = ?", req.ProviderID).
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

		if err := tx.Delete(&cred).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"failed to delete credential", err)
		}

		return tx.Model(&provider).Updates(map[string]any{
			"key_vaults": "",
			"version":    gorm.Expr("version + 1"),
		}).Error
	})
}

// Status returns credential status without exposing the actual key value.
func (s *CredentialConfigService) Status(ctx context.Context, actorPTID, providerID string) (*CredentialStatusResponse, error) {
	if err := NewProviderConfigService().RequirePersonal(ctx, actorPTID); err != nil {
		return nil, err
	}
	return s.StatusOwned(ctx, ActorProviderOwner(actorPTID), providerID)
}

func (s *CredentialConfigService) StatusOwned(ctx context.Context, owner ProviderOwner, providerID string) (*CredentialStatusResponse, error) {
	if err := owner.Validate(); err != nil {
		return nil, err
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var cred persistence.Credential
	if err := owner.Query(db.WithContext(ctx)).
		Where("provider = ?", providerID).
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
	if err := NewProviderConfigService().RequirePersonal(ctx, actorPTID); err != nil {
		return nil, err
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var provider persistence.AgentProvider
	if err := ActorProviderOwner(actorPTID).Query(db.WithContext(ctx)).
		Where("name = ?", providerID).
		First(&provider).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound,
				fmt.Sprintf("provider %q not found", providerID), nil)
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to query provider", err)
	}

	apiKey, err := providerCredentialAPIKey(&provider)
	if err != nil {
		return nil, err
	}

	return &CredentialResolveResponse{
		ProviderID: providerID,
		APIKey:     apiKey,
		BaseURL:    provider.BaseURL,
		Protocol:   provider.Protocol,
	}, nil
}

// MigrateSecrets replaces legacy plaintext in place before the Agent accepts
// work. A missing KEK fails closed, and no plaintext is logged or projected.
func (s *CredentialConfigService) MigrateSecrets(ctx context.Context) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	var providers []persistence.AgentProvider
	if err := db.WithContext(ctx).Where("key_vaults <> ''").Find(&providers).Error; err != nil {
		return err
	}
	for i := range providers {
		provider := &providers[i]
		if ProviderCredentialConfigured(provider) {
			continue
		}
		key := legacyProviderAPIKey(provider.KeyVaults)
		if key == "" {
			continue
		}
		sealed, err := sealProviderCredential(provider, key)
		if err != nil {
			return err
		}
		if err := db.WithContext(ctx).Model(provider).
			Where("key_vaults = ?", provider.KeyVaults).Updates(map[string]any{
			"key_vaults": sealed, "version": gorm.Expr("version + 1"),
		}).Error; err != nil {
			return err
		}
	}
	return nil
}

func (s *CredentialConfigService) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"database unavailable", err)
	}
	return db, nil
}
