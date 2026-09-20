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

type ModelConfigService struct{}
func NewModelConfigService() *ModelConfigService {
	return &ModelConfigService{}
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

	if err := db.WithContext(ctx).Create(&model).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to create model", err)
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
