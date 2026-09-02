package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
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
	ActorPTID   string
	ProviderID  string
	DisplayName string
	BaseURL     string
	Protocol    string
	ConfigJSON  []byte
}

type ProviderUpdateRequest struct {
	ActorPTID   string
	ProviderID  string
	Version     int64
	DisplayName *string
	BaseURL     *string
	Enabled     *bool
	ConfigJSON  []byte
}

type ProviderDeleteRequest struct {
	ActorPTID  string
	ProviderID string
	Version    int64
}

func (s *ProviderConfigService) List(ctx context.Context, actorPTID string) ([]persistence.AgentProvider, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var providers []persistence.AgentProvider
	if err := db.WithContext(ctx).
		Where("actor_ptid = ?", actorPTID).
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
	modelsCommand := ""

	cp := catalog.Find(req.ProviderID)
	if cp != nil {
		if cp.RuntimeKind != "" {
			runtimeKind = cp.RuntimeKind
		}
		cliCommand = cp.CliCommand
		modelsCommand = cp.ModelsCommand
	}
	if runtimeKind == "cli" && s.cliRegistry.IsRegistered(req.ProviderID) {
		spec, ok := s.cliRegistry.Resolve(req.ProviderID)
		if ok && cliCommand == "" {
			cliCommand = spec.BinaryPath
		}
	}

	provider := persistence.AgentProvider{
		ID:            uuid.New().String(),
		ActorPTID:     req.ActorPTID,
		Name:          req.ProviderID,
		DisplayName:   req.DisplayName,
		BaseURL:       req.BaseURL,
		Config:        req.ConfigJSON,
		SourceType:    "custom",
		RuntimeKind:   runtimeKind,
		CliCommand:    cliCommand,
		ModelsCommand: modelsCommand,
		Protocol:      req.Protocol,
		Enabled:       true,
		Version:       1,
	}

	if err := db.WithContext(ctx).Create(&provider).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to create provider", err)
	}

	logger.Infof(ctx, "provider created: actor_ptid=%s, provider=%s, runtime=%s", req.ActorPTID, req.ProviderID, runtimeKind)
	return &provider, nil
}

func (s *ProviderConfigService) Update(ctx context.Context, req ProviderUpdateRequest) (*persistence.AgentProvider, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var provider persistence.AgentProvider
	if err := db.WithContext(ctx).
		Where("actor_ptid = ? AND name = ?", req.ActorPTID, req.ProviderID).
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
		Where("actor_ptid = ? AND name = ?", req.ActorPTID, req.ProviderID).
		First(&provider).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to re-read provider after update", err)
	}

	logger.Infof(ctx, "provider updated: actor_ptid=%s, provider=%s, version=%d", req.ActorPTID, req.ProviderID, provider.Version)
	return &provider, nil
}

func (s *ProviderConfigService) Delete(ctx context.Context, req ProviderDeleteRequest) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var provider persistence.AgentProvider
		if err := tx.Where("actor_ptid = ? AND name = ?", req.ActorPTID, req.ProviderID).
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

		if err := tx.Where("actor_ptid = ? AND provider = ?", req.ActorPTID, req.ProviderID).
			Delete(&persistence.Credential{}).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"failed to cascade delete credentials", err)
		}

		if err := tx.Where("actor_ptid = ? AND provider_id = ?", req.ActorPTID, req.ProviderID).
			Delete(&persistence.AgentModel{}).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"failed to cascade delete models", err)
		}

		if err := tx.Delete(&provider).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"failed to delete provider", err)
		}

		logger.Infof(ctx, "provider deleted with cascade: actor_ptid=%s, provider=%s", req.ActorPTID, req.ProviderID)
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

// HideModel appends a model ID to the provider's hidden_models list.
func (s *ProviderConfigService) HideModel(ctx context.Context, actorPTID, providerID, modelID string) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	var provider persistence.AgentProvider
	if err := db.WithContext(ctx).
		Where("actor_ptid = ? AND name = ?", actorPTID, providerID).
		First(&provider).Error; err != nil {
		return errcode.New(errcode.AgentNotFound, http.StatusNotFound,
			fmt.Sprintf("provider %q not found", providerID), err)
	}

	hidden := parseHiddenModels(provider.HiddenModels)
	for _, h := range hidden {
		if h == modelID {
			return nil
		}
	}
	hidden = append(hidden, modelID)
	hiddenJSON, _ := json.Marshal(hidden)

	if err := db.WithContext(ctx).Model(&provider).
		Update("hidden_models", string(hiddenJSON)).Error; err != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to update hidden_models", err)
	}
	return nil
}

// UnhideModel removes a model ID from the provider's hidden_models list.
func (s *ProviderConfigService) UnhideModel(ctx context.Context, actorPTID, providerID, modelID string) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}

	var provider persistence.AgentProvider
	if err := db.WithContext(ctx).
		Where("actor_ptid = ? AND name = ?", actorPTID, providerID).
		First(&provider).Error; err != nil {
		return nil
	}

	hidden := parseHiddenModels(provider.HiddenModels)
	if len(hidden) == 0 {
		return nil
	}

	newHidden := make([]string, 0, len(hidden))
	for _, h := range hidden {
		if h != modelID {
			newHidden = append(newHidden, h)
		}
	}
	if len(newHidden) == len(hidden) {
		return nil
	}

	hiddenJSON, _ := json.Marshal(newHidden)
	if err := db.WithContext(ctx).Model(&provider).
		Update("hidden_models", string(hiddenJSON)).Error; err != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to update hidden_models", err)
	}
	return nil
}

// GetHiddenModels returns the list of hidden model IDs for a provider.
func (s *ProviderConfigService) GetHiddenModels(ctx context.Context, actorPTID, providerID string) ([]string, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var provider persistence.AgentProvider
	if err := db.WithContext(ctx).
		Where("actor_ptid = ? AND name = ?", actorPTID, providerID).
		First(&provider).Error; err != nil {
		return nil, nil
	}
	return parseHiddenModels(provider.HiddenModels), nil
}

func parseHiddenModels(raw string) []string {
	if raw == "" {
		return nil
	}
	var models []string
	_ = json.Unmarshal([]byte(raw), &models)
	return models
}
