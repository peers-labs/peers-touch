// Changelog:
// 2026-08-14 — M11 localStorage→Station migration: EcosystemService with CRUD for
//   AgentGroups, TopicComments, CustomPlugins.

package service

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

// EcosystemService handles persistence for ecosystem entities migrated from localStorage.
type EcosystemService struct{}

func NewEcosystemService() *EcosystemService { return &EcosystemService{} }

func (s *EcosystemService) getDB(ctx context.Context) (*gorm.DB, error) {
	return store.GetRDS(ctx, store.WithRDSDBName("agent"))
}

// --- Agent Groups ---

func (s *EcosystemService) CreateAgentGroup(ctx context.Context, group *persistence.EcosystemAgentGroup) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	if group.ID == "" {
		group.ID = uuid.New().String()
	}
	return db.WithContext(ctx).Create(group).Error
}

func (s *EcosystemService) UpdateAgentGroup(ctx context.Context, group *persistence.EcosystemAgentGroup) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	return db.WithContext(ctx).Model(group).Updates(map[string]interface{}{
		"name":               group.Name,
		"description":        group.Description,
		"member_agent_ids":   group.MemberAgentIDs,
		"orchestration_mode": group.OrchestrationMode,
	}).Error
}

func (s *EcosystemService) DeleteAgentGroup(ctx context.Context, id string) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	return db.WithContext(ctx).Delete(&persistence.EcosystemAgentGroup{}, "id = ?", id).Error
}

func (s *EcosystemService) ListAgentGroups(ctx context.Context, ownerActorPTID string) ([]persistence.EcosystemAgentGroup, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var groups []persistence.EcosystemAgentGroup
	if err := db.WithContext(ctx).Where("owner_actor_ptid = ?", ownerActorPTID).Order("created_at DESC").Find(&groups).Error; err != nil {
		return nil, err
	}
	return groups, nil
}

// --- Topic Comments ---

func (s *EcosystemService) CreateTopicComment(ctx context.Context, comment *persistence.EcosystemTopicComment) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	if comment.ID == "" {
		comment.ID = uuid.New().String()
	}
	return db.WithContext(ctx).Create(comment).Error
}

func (s *EcosystemService) DeleteTopicComment(ctx context.Context, topicKey, commentID string) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	return db.WithContext(ctx).Delete(&persistence.EcosystemTopicComment{}, "id = ? AND topic_key = ?", commentID, topicKey).Error
}

func (s *EcosystemService) ListTopicComments(ctx context.Context, topicKey string) ([]persistence.EcosystemTopicComment, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var comments []persistence.EcosystemTopicComment
	if err := db.WithContext(ctx).Where("topic_key = ?", topicKey).Order("created_at ASC").Find(&comments).Error; err != nil {
		return nil, err
	}
	return comments, nil
}

// --- Custom Plugins ---

func (s *EcosystemService) CreateCustomPlugin(ctx context.Context, plugin *persistence.EcosystemCustomPlugin) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	if plugin.ID == "" {
		plugin.ID = uuid.New().String()
	}
	return db.WithContext(ctx).Create(plugin).Error
}

func (s *EcosystemService) UpdateCustomPlugin(ctx context.Context, plugin *persistence.EcosystemCustomPlugin) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	return db.WithContext(ctx).Model(plugin).Updates(map[string]interface{}{
		"name":          plugin.Name,
		"description":   plugin.Description,
		"endpoint":      plugin.Endpoint,
		"method":        plugin.Method,
		"auth_type":     plugin.AuthType,
		"input_schema":  plugin.InputSchema,
		"output_schema": plugin.OutputSchema,
		"enabled":       plugin.Enabled,
	}).Error
}

func (s *EcosystemService) DeleteCustomPlugin(ctx context.Context, id string) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	return db.WithContext(ctx).Delete(&persistence.EcosystemCustomPlugin{}, "id = ?", id).Error
}

func (s *EcosystemService) ListCustomPlugins(ctx context.Context, ownerActorPTID string) ([]persistence.EcosystemCustomPlugin, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var plugins []persistence.EcosystemCustomPlugin
	if err := db.WithContext(ctx).Where("owner_actor_ptid = ?", ownerActorPTID).Order("created_at DESC").Find(&plugins).Error; err != nil {
		return nil, err
	}
	return plugins, nil
}
