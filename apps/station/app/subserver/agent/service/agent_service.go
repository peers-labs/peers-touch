package service

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

type AgentService struct{}

func NewAgentService() *AgentService {
	return &AgentService{}
}

func (s *AgentService) ListAgents(ctx context.Context, options domain.AgentListOptions) ([]domain.Agent, int64, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, 0, err
	}
	actorID := strings.TrimSpace(options.ActorID)
	if actorID == "" {
		return nil, 0, errcode.New(errcode.AgentUnauthorized, http.StatusUnauthorized, "actor_id is required", nil)
	}
	page, pageSize := normalizePage(options.Page, options.PageSize)
	query := db.WithContext(ctx).Model(&persistence.Agent{}).
		Where("owner_actor_id = ? OR visibility = ?", actorID, string(domain.AgentVisibilityWorkspace))
	if options.Visibility != "" {
		query = query.Where("visibility = ?", string(normalizeAgentVisibility(options.Visibility)))
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		logger.Errorf(ctx, "failed to count agents: actor_id=%s err=%v", actorID, err)
		return nil, 0, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to count agents", err)
	}

	var records []persistence.Agent
	if err := query.Order("updated_at DESC").Limit(pageSize).Offset((page - 1) * pageSize).Find(&records).Error; err != nil {
		logger.Errorf(ctx, "failed to list agents: actor_id=%s err=%v", actorID, err)
		return nil, 0, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list agents", err)
	}
	agents := make([]domain.Agent, 0, len(records))
	for i := range records {
		agents = append(agents, persistenceAgentToDomain(&records[i]))
	}
	return agents, total, nil
}

func (s *AgentService) GetAgent(ctx context.Context, actorID, agentID string) (*domain.Agent, error) {
	record, err := s.getVisibleAgent(ctx, actorID, agentID)
	if err != nil {
		return nil, err
	}
	agent := persistenceAgentToDomain(record)
	return &agent, nil
}

func (s *AgentService) CreateAgent(ctx context.Context, options domain.AgentUpsertOptions) (*domain.Agent, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	actorID := strings.TrimSpace(options.ActorID)
	if actorID == "" {
		return nil, errcode.New(errcode.AgentUnauthorized, http.StatusUnauthorized, "actor_id is required", nil)
	}
	name := strings.TrimSpace(options.Name)
	if name == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "name is required", nil)
	}
	thinkingMode, err := normalizeThinkingMode(options.ThinkingMode)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	record := persistence.Agent{
		ID:           generateID("agent"),
		Name:         name,
		Title:        strings.TrimSpace(options.Title),
		Description:  strings.TrimSpace(options.Description),
		ProviderID:   strings.TrimSpace(options.ProviderID),
		ModelName:    strings.TrimSpace(options.ModelName),
		Effort:       strings.TrimSpace(options.Effort),
		ThinkingMode: string(thinkingMode),
		Visibility:   string(normalizeAgentVisibility(options.Visibility)),
		OwnerActorID: actorID,
		ConfigJSON:   options.ConfigJSON,
		Version:      1,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := db.WithContext(ctx).Create(&record).Error; err != nil {
		logger.Errorf(ctx, "failed to create agent: actor_id=%s err=%v", actorID, err)
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to create agent", err)
	}
	agent := persistenceAgentToDomain(&record)
	return &agent, nil
}

func (s *AgentService) UpdateAgent(ctx context.Context, options domain.AgentUpsertOptions) (*domain.Agent, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	record, err := s.getOwnedAgent(ctx, options.ActorID, options.AgentID)
	if err != nil {
		return nil, err
	}
	if options.Version <= 0 || record.Version != options.Version {
		return nil, errcode.New(
			errcode.AgentVersionConflict,
			http.StatusConflict,
			fmt.Sprintf("version conflict: current=%d, submitted=%d", record.Version, options.Version),
			nil,
		)
	}
	requestedThinkingMode := options.ThinkingMode
	if strings.TrimSpace(string(requestedThinkingMode)) == "" {
		requestedThinkingMode = domain.ThinkingMode(record.ThinkingMode)
	}
	thinkingMode, err := normalizeThinkingMode(requestedThinkingMode)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(options.Name) != "" {
		record.Name = strings.TrimSpace(options.Name)
	}
	record.Title = strings.TrimSpace(options.Title)
	record.Description = strings.TrimSpace(options.Description)
	record.ProviderID = strings.TrimSpace(options.ProviderID)
	record.ModelName = strings.TrimSpace(options.ModelName)
	record.Effort = strings.TrimSpace(options.Effort)
	record.ThinkingMode = string(thinkingMode)
	record.Visibility = string(normalizeAgentVisibility(options.Visibility))
	record.ConfigJSON = options.ConfigJSON
	nextVersion := record.Version + 1
	updates := map[string]interface{}{
		"name":          record.Name,
		"title":         record.Title,
		"description":   record.Description,
		"provider_id":   record.ProviderID,
		"model_name":    record.ModelName,
		"effort":        record.Effort,
		"thinking_mode": record.ThinkingMode,
		"visibility":    record.Visibility,
		"config_json":   record.ConfigJSON,
		"version":       nextVersion,
		"updated_at":    time.Now(),
	}
	result := db.WithContext(ctx).
		Model(&persistence.Agent{}).
		Where("id = ? AND owner_actor_id = ? AND version = ?", record.ID, options.ActorID, record.Version).
		Updates(updates)
	if result.Error != nil {
		logger.Errorf(ctx, "failed to update agent: actor_id=%s agent_id=%s err=%v", options.ActorID, options.AgentID, result.Error)
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to update agent", result.Error)
	}
	if result.RowsAffected != 1 {
		return nil, errcode.New(errcode.AgentVersionConflict, http.StatusConflict, "agent changed during update", nil)
	}
	if err := db.WithContext(ctx).
		Where("id = ? AND owner_actor_id = ?", record.ID, options.ActorID).
		First(record).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to re-read agent after update", err)
	}
	agent := persistenceAgentToDomain(record)
	return &agent, nil
}

func (s *AgentService) DeleteAgent(ctx context.Context, actorID, agentID string) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	record, err := s.getOwnedAgent(ctx, actorID, agentID)
	if err != nil {
		return err
	}
	if err := db.WithContext(ctx).Delete(record).Error; err != nil {
		logger.Errorf(ctx, "failed to delete agent: actor_id=%s agent_id=%s err=%v", actorID, agentID, err)
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to delete agent", err)
	}
	return nil
}

func (s *AgentService) getVisibleAgent(ctx context.Context, actorID, agentID string) (*persistence.Agent, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	actorID = strings.TrimSpace(actorID)
	agentID = strings.TrimSpace(agentID)
	if actorID == "" || agentID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "actor_id and agent_id are required", nil)
	}
	var record persistence.Agent
	err = db.WithContext(ctx).
		Where("id = ? AND (owner_actor_id = ? OR visibility = ?)", agentID, actorID, string(domain.AgentVisibilityWorkspace)).
		First(&record).Error
	if err == gorm.ErrRecordNotFound {
		return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "agent not found", err)
	}
	if err != nil {
		logger.Errorf(ctx, "failed to get visible agent: actor_id=%s agent_id=%s err=%v", actorID, agentID, err)
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to get agent", err)
	}
	return &record, nil
}

func (s *AgentService) getOwnedAgent(ctx context.Context, actorID, agentID string) (*persistence.Agent, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	actorID = strings.TrimSpace(actorID)
	agentID = strings.TrimSpace(agentID)
	if actorID == "" || agentID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "actor_id and agent_id are required", nil)
	}
	var record persistence.Agent
	err = db.WithContext(ctx).Where("id = ?", agentID).First(&record).Error
	if err == gorm.ErrRecordNotFound {
		return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "agent not found", err)
	}
	if err != nil {
		logger.Errorf(ctx, "failed to get owned agent: actor_id=%s agent_id=%s err=%v", actorID, agentID, err)
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to get agent", err)
	}
	if record.OwnerActorID != actorID {
		return nil, errcode.New(errcode.AgentSecurityViolation, http.StatusForbidden, "agent mutation requires owner", nil)
	}
	return &record, nil
}

func (s *AgentService) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to open agent db", err)
	}
	return db, nil
}

func normalizePage(page, pageSize int) (int, int) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	return page, pageSize
}

func normalizeAgentVisibility(visibility domain.AgentVisibility) domain.AgentVisibility {
	if visibility == domain.AgentVisibilityWorkspace {
		return domain.AgentVisibilityWorkspace
	}
	return domain.AgentVisibilityPrivate
}

func normalizeThinkingMode(mode domain.ThinkingMode) (domain.ThinkingMode, error) {
	switch domain.ThinkingMode(strings.ToLower(strings.TrimSpace(string(mode)))) {
	case "", domain.ThinkingModeAuto:
		return domain.ThinkingModeAuto, nil
	case domain.ThinkingModeEnabled:
		return domain.ThinkingModeEnabled, nil
	case domain.ThinkingModeDisabled:
		return domain.ThinkingModeDisabled, nil
	default:
		return "", errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"thinking_mode must be auto, enabled, or disabled",
			nil,
		)
	}
}

func persistenceAgentToDomain(record *persistence.Agent) domain.Agent {
	thinkingMode := domain.ThinkingMode(strings.ToLower(strings.TrimSpace(record.ThinkingMode)))
	if thinkingMode == "" {
		thinkingMode = domain.ThinkingModeAuto
	}
	return domain.Agent{
		AgentID:      record.ID,
		Name:         record.Name,
		Title:        record.Title,
		Description:  record.Description,
		ProviderID:   record.ProviderID,
		ModelName:    record.ModelName,
		Effort:       record.Effort,
		ThinkingMode: thinkingMode,
		Visibility:   domain.AgentVisibility(record.Visibility),
		OwnerActorID: record.OwnerActorID,
		ConfigJSON:   record.ConfigJSON,
		Version:      record.Version,
		CreatedAt:    record.CreatedAt,
		UpdatedAt:    record.UpdatedAt,
	}
}
