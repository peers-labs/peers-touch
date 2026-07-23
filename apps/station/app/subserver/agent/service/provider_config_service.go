package service

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

type ProviderConfigService struct {
	cliRegistry *CLIAdapterRegistry
}

func NewProviderConfigService(cliRegistry *CLIAdapterRegistry) *ProviderConfigService {
	return &ProviderConfigService{cliRegistry: cliRegistry}
}

type ProviderCreateRequest struct {
	ActorID     string
	ProviderID  string
	DisplayName string
	BaseURL     string
	Protocol    string
	ConfigJSON  []byte
}

type ProviderUpdateRequest struct {
	ActorID     string
	ProviderID  string
	Version     int64
	DisplayName *string
	BaseURL     *string
	Enabled     *bool
	ConfigJSON  []byte
}

type ProviderDeleteRequest struct {
	ActorID    string
	ProviderID string
	Version    int64
}

func (s *ProviderConfigService) List(ctx context.Context, actorID string) ([]persistence.AgentProvider, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var providers []persistence.AgentProvider
	if err := db.WithContext(ctx).
		Where("actor_id = ?", actorID).
		Order("created_at ASC").
		Find(&providers).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to list providers", err)
	}

	return providers, nil
}

func (s *ProviderConfigService) Create(ctx context.Context, req ProviderCreateRequest) (*persistence.AgentProvider, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	runtimeKind := "http"
	cliCommand := ""
	if s.cliRegistry.IsRegistered(req.ProviderID) {
		runtimeKind = "cli"
		spec, _ := s.cliRegistry.Resolve(req.ProviderID)
		cliCommand = spec.BinaryPath
	}

	provider := persistence.AgentProvider{
		ID:          uuid.New().String(),
		ActorID:     req.ActorID,
		Name:        req.ProviderID,
		DisplayName: req.DisplayName,
		BaseURL:     req.BaseURL,
		Config:      req.ConfigJSON,
		SourceType:  "custom",
		RuntimeKind: runtimeKind,
		CliCommand:  cliCommand,
		Protocol:    req.Protocol,
		Enabled:     true,
		Version:     1,
	}

	if err := db.WithContext(ctx).Create(&provider).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to create provider", err)
	}

	logger.Infof(ctx, "provider created: actor=%s, provider=%s, runtime=%s", req.ActorID, req.ProviderID, runtimeKind)
	return &provider, nil
}

func (s *ProviderConfigService) Update(ctx context.Context, req ProviderUpdateRequest) (*persistence.AgentProvider, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var provider persistence.AgentProvider
	if err := db.WithContext(ctx).
		Where("actor_id = ? AND name = ?", req.ActorID, req.ProviderID).
		First(&provider).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound,
				fmt.Sprintf("provider %q not found", req.ProviderID), nil)
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to query provider", err)
	}

	if provider.Version != req.Version {
		return nil, errcode.New(errcode.AgentVersionConflict, http.StatusConflict,
			fmt.Sprintf("version conflict: current=%d, submitted=%d", provider.Version, req.Version), nil)
	}

	newVersion := provider.Version + 1
	updates := map[string]interface{}{
		"version":    newVersion,
		"updated_at": time.Now(),
	}
	if req.DisplayName != nil {
		updates["display_name"] = *req.DisplayName
	}
	if req.BaseURL != nil {
		updates["base_url"] = *req.BaseURL
	}
	if req.Enabled != nil {
		updates["enabled"] = *req.Enabled
	}
	if req.ConfigJSON != nil {
		updates["config"] = req.ConfigJSON
	}

	if err := db.WithContext(ctx).
		Model(&provider).
		Updates(updates).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to update provider", err)
	}

	// Re-read to return authoritative state
	if err := db.WithContext(ctx).
		Where("actor_id = ? AND name = ?", req.ActorID, req.ProviderID).
		First(&provider).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to re-read provider after update", err)
	}

	logger.Infof(ctx, "provider updated: actor=%s, provider=%s, version=%d", req.ActorID, req.ProviderID, provider.Version)
	return &provider, nil
}

func (s *ProviderConfigService) Delete(ctx context.Context, req ProviderDeleteRequest) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var provider persistence.AgentProvider
		if err := tx.Where("actor_id = ? AND name = ?", req.ActorID, req.ProviderID).
			First(&provider).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return errcode.New(errcode.AgentNotFound, http.StatusNotFound,
					fmt.Sprintf("provider %q not found", req.ProviderID), nil)
			}
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"failed to query provider", err)
		}

		if provider.Version != req.Version {
			return errcode.New(errcode.AgentVersionConflict, http.StatusConflict,
				fmt.Sprintf("version conflict: current=%d, submitted=%d", provider.Version, req.Version), nil)
		}

		if err := tx.Where("actor_id = ? AND provider = ?", req.ActorID, req.ProviderID).
			Delete(&persistence.Credential{}).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"failed to cascade delete credentials", err)
		}

		if err := tx.Where("actor_id = ? AND provider_id = ?", req.ActorID, req.ProviderID).
			Delete(&persistence.AgentModel{}).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"failed to cascade delete models", err)
		}

		if err := tx.Delete(&provider).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"failed to delete provider", err)
		}

		logger.Infof(ctx, "provider deleted with cascade: actor=%s, provider=%s", req.ActorID, req.ProviderID)
		return nil
	})
}

func (s *ProviderConfigService) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"database unavailable", err)
	}
	return db, nil
}
