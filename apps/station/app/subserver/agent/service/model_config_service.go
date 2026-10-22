package service

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

type ModelConfigService struct{}

func NewModelConfigService() *ModelConfigService {
	return &ModelConfigService{}
}

type ModelCreateRequest struct {
	ActorPTID     string
	ProviderID    string
	ModelID       string
	DisplayName   string
	Enabled       bool
	Capabilities  map[string]bool
	ContextWindow int
}

type ModelUpdateRequest struct {
	ActorPTID     string
	ProviderID    string
	ModelID       string
	Version       int64
	DisplayName   *string
	Enabled       *bool
	Capabilities  map[string]bool
	ContextWindow *int
}

type EffectiveProviderModel struct {
	ID             string
	DisplayName    string
	Type           string
	Enabled        bool
	ContextWindow  int
	Capabilities   map[string]bool
	PersistedModel *persistence.AgentModel
}

func ResolveEffectiveProviderModels(
	provider *catalog.CatalogProvider,
	persistedModels []persistence.AgentModel,
	hidden []string,
) ([]EffectiveProviderModel, error) {
	persistedByID := make(map[string]*persistence.AgentModel, len(persistedModels))
	for i := range persistedModels {
		persistedByID[persistedModels[i].ModelID] = &persistedModels[i]
	}

	catalogIDs := make(map[string]bool, len(provider.Models))
	result := make([]EffectiveProviderModel, 0, len(provider.Models)+len(persistedModels))
	for i := range provider.Models {
		catalogModel := &provider.Models[i]
		catalogIDs[catalogModel.ID] = true
		if containsModelID(hidden, catalogModel.ID) {
			continue
		}

		persistedModel := persistedByID[catalogModel.ID]
		capabilities, err := resolveModelCapabilityFacts(catalogModel, persistedModel)
		if err != nil {
			return nil, fmt.Errorf(
				"model %q capability metadata is invalid: %w",
				catalogModel.ID,
				err,
			)
		}
		displayName := catalogModel.DisplayName
		contextWindow := catalogModel.ContextWindow
		enabled := catalogModel.Enabled
		if persistedModel != nil {
			enabled = enabled && persistedModel.Enabled
			if strings.TrimSpace(persistedModel.DisplayName) != "" {
				displayName = persistedModel.DisplayName
			}
			if persistedModel.ContextWindow > 0 {
				contextWindow = persistedModel.ContextWindow
			}
		}
		result = append(result, EffectiveProviderModel{
			ID:             catalogModel.ID,
			DisplayName:    displayName,
			Type:           catalogModel.Type,
			Enabled:        enabled,
			ContextWindow:  contextWindow,
			Capabilities:   map[string]bool(capabilities),
			PersistedModel: persistedModel,
		})
	}
	for i := range persistedModels {
		persistedModel := &persistedModels[i]
		if catalogIDs[persistedModel.ModelID] ||
			containsModelID(hidden, persistedModel.ModelID) {
			continue
		}
		capabilities, err := resolveModelCapabilityFacts(nil, persistedModel)
		if err != nil {
			return nil, fmt.Errorf(
				"model %q capability metadata is invalid: %w",
				persistedModel.ModelID,
				err,
			)
		}
		result = append(result, EffectiveProviderModel{
			ID:             persistedModel.ModelID,
			DisplayName:    persistedModel.DisplayName,
			Type:           "chat",
			Enabled:        persistedModel.Enabled,
			ContextWindow:  persistedModel.ContextWindow,
			Capabilities:   map[string]bool(capabilities),
			PersistedModel: persistedModel,
		})
	}

	return result, nil
}

func containsModelID(modelIDs []string, modelID string) bool {
	for _, candidate := range modelIDs {
		if candidate == modelID {
			return true
		}
	}

	return false
}

func (s *ModelConfigService) List(ctx context.Context, actorPTID, providerID string) ([]persistence.AgentModel, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var models []persistence.AgentModel
	if err := db.WithContext(ctx).
		Where("actor_ptid = ? AND provider_id = ?", actorPTID, providerID).
		Order("created_at ASC").
		Find(&models).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to list models", err)
	}

	return models, nil
}

func (s *ModelConfigService) Create(ctx context.Context, req ModelCreateRequest) (*persistence.AgentModel, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	capabilitiesJSON, err := EncodeModelCapabilityFlags(req.Capabilities)
	if err != nil {
		return nil, errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"invalid model capabilities",
			err,
		)
	}

	var existing persistence.AgentModel
	if err := db.WithContext(ctx).
		Where("actor_ptid = ? AND provider_id = ? AND model_id = ?", req.ActorPTID, req.ProviderID, req.ModelID).
		First(&existing).Error; err == nil {
		return &existing, nil
	}

	model := persistence.AgentModel{
		ID:               uuid.New().String(),
		ActorPTID:        req.ActorPTID,
		ProviderID:       req.ProviderID,
		ModelID:          req.ModelID,
		DisplayName:      req.DisplayName,
		Enabled:          req.Enabled,
		CapabilitiesJSON: capabilitiesJSON,
		ContextWindow:    req.ContextWindow,
		Version:          1,
	}

	now := time.Now()
	if err := db.WithContext(ctx).
		Table(model.TableName()).
		Create(map[string]interface{}{
			"id":                model.ID,
			"actor_ptid":        model.ActorPTID,
			"provider_id":       model.ProviderID,
			"model_id":          model.ModelID,
			"display_name":      model.DisplayName,
			"enabled":           model.Enabled,
			"capabilities_json": model.CapabilitiesJSON,
			"context_window":    model.ContextWindow,
			"version":           model.Version,
			"created_at":        now,
			"updated_at":        now,
		}).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to create model", err)
	}
	if err := db.WithContext(ctx).
		Where("id = ?", model.ID).
		First(&model).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to reload created model", err)
	}

	logger.Infof(ctx, "model created: actor_ptid=%s, provider=%s, model=%s", req.ActorPTID, req.ProviderID, req.ModelID)
	return &model, nil
}

func (s *ModelConfigService) Update(ctx context.Context, req ModelUpdateRequest) (*persistence.AgentModel, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var model persistence.AgentModel
	if err := db.WithContext(ctx).
		Where("actor_ptid = ? AND provider_id = ? AND model_id = ?", req.ActorPTID, req.ProviderID, req.ModelID).
		First(&model).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound,
				fmt.Sprintf("model %q not found for provider %q", req.ModelID, req.ProviderID), nil)
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to query model", err)
	}

	if model.Version != req.Version {
		return nil, errcode.New(errcode.AgentVersionConflict, http.StatusConflict,
			fmt.Sprintf("version conflict: current=%d, submitted=%d", model.Version, req.Version), nil)
	}

	updates := map[string]interface{}{
		"version":    model.Version + 1,
		"updated_at": time.Now(),
	}
	if req.DisplayName != nil {
		updates["display_name"] = *req.DisplayName
	}
	if req.Enabled != nil {
		updates["enabled"] = *req.Enabled
	}
	if req.Capabilities != nil {
		capabilitiesJSON, encodeErr := EncodeModelCapabilityFlags(req.Capabilities)
		if encodeErr != nil {
			return nil, errcode.New(
				errcode.AgentInvalidRequest,
				http.StatusBadRequest,
				"invalid model capabilities",
				encodeErr,
			)
		}
		updates["capabilities_json"] = capabilitiesJSON
	}
	if req.ContextWindow != nil {
		updates["context_window"] = *req.ContextWindow
	}

	if err := db.WithContext(ctx).
		Model(&model).
		Updates(updates).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to update model", err)
	}

	if err := db.WithContext(ctx).
		Where("id = ?", model.ID).
		First(&model).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to reload updated model", err)
	}
	logger.Infof(ctx, "model updated: actor=%s, provider=%s, model=%s, version=%d",
		req.ActorPTID, req.ProviderID, req.ModelID, model.Version)
	return &model, nil
}

func (s *ModelConfigService) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"database unavailable", err)
	}
	return db, nil
}
