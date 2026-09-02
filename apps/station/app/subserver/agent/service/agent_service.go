package service

import (
	"context"
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

type AgentService struct {
	eventBus domain.EventBus
}

func NewAgentService() *AgentService {
	return &AgentService{}
}

func (s *AgentService) SetEventBus(eventBus domain.EventBus) {
	s.eventBus = eventBus
}

func (s *AgentService) ListAgents(ctx context.Context, options domain.AgentListOptions) ([]domain.Agent, int64, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, 0, err
	}
	actorPTID := strings.TrimSpace(options.ActorPTID)
	if actorPTID == "" {
		return nil, 0, errcode.New(errcode.AgentUnauthorized, http.StatusUnauthorized, "actor_ptid is required", nil)
	}
	page, pageSize := normalizePage(options.Page, options.PageSize)
	query := db.WithContext(ctx).Model(&persistence.Agent{}).
		Where("owner_actor_ptid = ? OR visibility = ?", actorPTID, string(domain.AgentVisibilityWorkspace))
	if options.Visibility != "" {
		query = query.Where("visibility = ?", string(normalizeAgentVisibility(options.Visibility)))
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		logger.Errorf(ctx, "failed to count agents: actor_ptid=%s err=%v", actorPTID, err)
		return nil, 0, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to count agents", err)
	}

	var records []persistence.Agent
	if err := query.Order("updated_at DESC").Limit(pageSize).Offset((page - 1) * pageSize).Find(&records).Error; err != nil {
		logger.Errorf(ctx, "failed to list agents: actor_ptid=%s err=%v", actorPTID, err)
		return nil, 0, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list agents", err)
	}
	agents := make([]domain.Agent, 0, len(records))
	for i := range records {
		agents = append(agents, persistenceAgentToDomain(&records[i]))
	}
	return agents, total, nil
}

func (s *AgentService) GetAgent(ctx context.Context, actorPTID, agentID string) (*domain.Agent, error) {
	record, err := s.getVisibleAgent(ctx, actorPTID, agentID)
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
	return s.createAgentTx(ctx, db.WithContext(ctx), options)
}

func (s *AgentService) createAgentTx(
	ctx context.Context,
	tx *gorm.DB,
	options domain.AgentUpsertOptions,
) (*domain.Agent, error) {
	actorID := strings.TrimSpace(options.ActorPTID)
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
		OwnerActorPTID: actorID,
		ConfigJSON:   options.ConfigJSON,
		Version:      1,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := tx.WithContext(ctx).Create(&record).Error; err != nil {
		logger.Errorf(ctx, "failed to create agent: actor_ptid=%s err=%v", actorID, err)
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
	var updatedAgent domain.Agent
	var casLostResourceID string
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		record, loadErr := getOwnedAgentWithDB(ctx, tx, options.ActorPTID, options.AgentID)
		if loadErr != nil {
			return loadErr
		}
		if options.Version <= 0 || record.Version != options.Version {
			return errcode.NewActiveMutationConflict(record.ID, options.Version, record.Version)
		}
		requestedThinkingMode := options.ThinkingMode
		if strings.TrimSpace(string(requestedThinkingMode)) == "" {
			requestedThinkingMode = domain.ThinkingMode(record.ThinkingMode)
		}
		thinkingMode, normalizeErr := normalizeThinkingMode(requestedThinkingMode)
		if normalizeErr != nil {
			return normalizeErr
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
		now := time.Now()
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
			"updated_at":    now,
		}
		result := tx.Model(&persistence.Agent{}).
			Where("id = ? AND owner_actor_ptid = ? AND version = ?", record.ID, options.ActorPTID, record.Version).
			Updates(updates)
		if result.Error != nil {
			logger.Errorf(ctx, "failed to update agent: actor_ptid=%s agent_id=%s err=%v", options.ActorPTID, options.AgentID, result.Error)
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to update agent", result.Error)
		}
		if result.RowsAffected != 1 {
			// No mutation precedes the CAS write, so ending this read-only loser
			// transaction allows an authoritative revision read after the winner commits.
			casLostResourceID = record.ID
			return nil
		}
		rebase := tx.Model(&persistence.AgentCapabilityBinding{}).
			Where("ptid = ? AND agent_id = ? AND tombstoned_at IS NULL", options.ActorPTID, record.ID).
			Updates(map[string]interface{}{
				"agent_version": nextVersion,
				"revision":      gorm.Expr("revision + 1"),
				"updated_at":    now,
			})
		if rebase.Error != nil {
			logger.Errorf(ctx, "failed to rebase agent capability bindings: actor_ptid=%s agent_id=%s err=%v",
				options.ActorPTID, options.AgentID, rebase.Error)
			return errcode.New(
				errcode.AgentInternal,
				http.StatusInternalServerError,
				"failed to rebase agent capability bindings",
				rebase.Error,
			)
		}
		if err := tx.Where("id = ? AND owner_actor_ptid = ?", record.ID, options.ActorPTID).
			First(record).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to re-read agent after update", err)
		}
		updatedAgent = persistenceAgentToDomain(record)
		return nil
	})
	if err != nil {
		return nil, err
	}
	if casLostResourceID != "" {
		actualRevision, loadErr := loadAuthoritativeAgentRevision(ctx, db, options.ActorPTID, casLostResourceID)
		if loadErr != nil {
			logger.Errorf(ctx, "failed to load agent revision after CAS conflict: actor_ptid=%s agent_id=%s err=%v",
				options.ActorPTID, options.AgentID, loadErr)
			return nil, errcode.New(
				errcode.AgentInternal,
				http.StatusInternalServerError,
				"failed to load agent revision after update conflict",
				loadErr,
			)
		}
		return nil, errcode.NewActiveMutationConflict(casLostResourceID, options.Version, actualRevision)
	}
	s.publishAuthorityInvalidation(ctx, domain.AgentAuthorityInvalidation{
		Reason:       domain.AgentAuthorityInvalidationAgentUpdated,
		AgentID:      updatedAgent.AgentID,
		AgentVersion: uint64(updatedAgent.Version),
	}, updatedAgent.OwnerActorPTID)
	return &updatedAgent, nil
}

func (s *AgentService) DeleteAgent(ctx context.Context, actorPTID, agentID string) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	record, err := s.getOwnedAgent(ctx, actorPTID, agentID)
	if err != nil {
		return err
	}
	if err := db.WithContext(ctx).Delete(record).Error; err != nil {
		logger.Errorf(ctx, "failed to delete agent: actor_ptid=%s agent_id=%s err=%v", actorPTID, agentID, err)
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to delete agent", err)
	}
	return nil
}

func (s *AgentService) getVisibleAgent(ctx context.Context, actorPTID, agentID string) (*persistence.Agent, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	actorPTID = strings.TrimSpace(actorPTID)
	agentID = strings.TrimSpace(agentID)
	if actorPTID == "" || agentID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "actor_ptid and agent_id are required", nil)
	}
	var record persistence.Agent
	err = db.WithContext(ctx).
		Where("id = ? AND (owner_actor_ptid = ? OR visibility = ?)", agentID, actorPTID, string(domain.AgentVisibilityWorkspace)).
		First(&record).Error
	if err == gorm.ErrRecordNotFound {
		return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "agent not found", err)
	}
	if err != nil {
		logger.Errorf(ctx, "failed to get visible agent: actor_ptid=%s agent_id=%s err=%v", actorPTID, agentID, err)
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to get agent", err)
	}
	return &record, nil
}

func (s *AgentService) getOwnedAgent(ctx context.Context, actorPTID, agentID string) (*persistence.Agent, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	return getOwnedAgentWithDB(ctx, db.WithContext(ctx), actorID, agentID)
}

func getOwnedAgentWithDB(
	ctx context.Context,
	db *gorm.DB,
	actorID string,
	agentID string,
) (*persistence.Agent, error) {
	actorID = strings.TrimSpace(actorID)
	agentID = strings.TrimSpace(agentID)
	if actorPTID == "" || agentID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "actor_ptid and agent_id are required", nil)
	}
	var record persistence.Agent
	err := db.WithContext(ctx).Where("id = ?", agentID).First(&record).Error
	if err == gorm.ErrRecordNotFound {
		return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "agent not found", err)
	}
	if err != nil {
		logger.Errorf(ctx, "failed to get owned agent: actor_ptid=%s agent_id=%s err=%v", actorPTID, agentID, err)
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to get agent", err)
	}
	if record.OwnerActorPTID != actorPTID {
		return nil, errcode.New(errcode.AgentSecurityViolation, http.StatusForbidden, "agent mutation requires owner", nil)
	}
	return &record, nil
}

func loadAuthoritativeAgentRevision(
	ctx context.Context,
	db *gorm.DB,
	actorID string,
	agentID string,
) (int64, error) {
	var record struct {
		Version int64
	}
	err := db.WithContext(ctx).
		Model(&persistence.Agent{}).
		Select("version").
		Where("id = ? AND owner_actor_ptid = ?", strings.TrimSpace(agentID), strings.TrimSpace(actorID)).
		Take(&record).Error
	if err != nil {
		return 0, err
	}
	return record.Version, nil
}

func (s *AgentService) publishAuthorityInvalidation(
	ctx context.Context,
	payload domain.AgentAuthorityInvalidation,
	actorID string,
) {
	if s.eventBus == nil {
		return
	}
	if err := s.eventBus.Publish(ctx, domain.DomainEvent{
		EventID:    generateID("event"),
		EventType:  string(domain.EventTypeAgentAuthorityInvalidated),
		OccurredAt: time.Now().UTC(),
		ActorID:    actorID,
		Payload:    payload,
		Metadata: map[string]string{
			"agent_id": payload.AgentID,
		},
	}); err != nil {
		logger.Errorf(ctx, "failed to publish agent authority invalidation: actor_ptid=%s agent_id=%s err=%v",
			actorID, payload.AgentID, err)
	}
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
		OwnerActorPTID: record.OwnerActorPTID,
		ConfigJSON:   record.ConfigJSON,
		Version:      record.Version,
		CreatedAt:    record.CreatedAt,
		UpdatedAt:    record.UpdatedAt,
	}
}
