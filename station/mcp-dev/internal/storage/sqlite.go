package storage

import (
	"fmt"
	"time"

	"github.com/peers-touch/peers-touch/station/mcp-dev/internal/types"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type SQLiteStorage struct {
	db *gorm.DB
}

func NewSQLiteStorage(dbPath string) (*SQLiteStorage, error) {
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	storage := &SQLiteStorage{db: db}
	
	if err := storage.autoMigrate(); err != nil {
		return nil, fmt.Errorf("failed to auto migrate: %w", err)
	}

	return storage, nil
}

func (s *SQLiteStorage) autoMigrate() error {
	return s.db.AutoMigrate(
		&types.ProjectContext{},
		&types.CodeTemplate{},
		&types.Rule{},
		&types.AIAgentConfig{},
	)
}

func (s *SQLiteStorage) Close() error {
	sqlDB, err := s.db.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}

// GetDB returns the underlying GORM DB instance
func (s *SQLiteStorage) GetDB() *gorm.DB {
	return s.db
}

// ProjectContext operations
func (s *SQLiteStorage) GetProjectContext(id string) (*types.ProjectContext, error) {
	var project types.ProjectContext
	if err := s.db.First(&project, "id = ?", id).Error; err != nil {
		return nil, fmt.Errorf("failed to get project context: %w", err)
	}
	return &project, nil
}

func (s *SQLiteStorage) SaveProjectContext(project *types.ProjectContext) error {
	if project.CreatedAt.IsZero() {
		project.CreatedAt = time.Now()
	}
	project.UpdatedAt = time.Now()
	
	if err := s.db.Save(project).Error; err != nil {
		return fmt.Errorf("failed to save project context: %w", err)
	}
	return nil
}

func (s *SQLiteStorage) ListProjectContexts(filter map[string]interface{}) ([]*types.ProjectContext, error) {
	var projects []*types.ProjectContext
	query := s.db
	
	if language, ok := filter["language"].(string); ok && language != "" {
		query = query.Where("language = ?", language)
	}
	if framework, ok := filter["framework"].(string); ok && framework != "" {
		query = query.Where("framework = ?", framework)
	}
	
	if err := query.Find(&projects).Error; err != nil {
		return nil, fmt.Errorf("failed to list project contexts: %w", err)
	}
	return projects, nil
}

// CodeTemplate operations
func (s *SQLiteStorage) GetCodeTemplate(id string) (*types.CodeTemplate, error) {
	var template types.CodeTemplate
	if err := s.db.First(&template, "id = ?", id).Error; err != nil {
		return nil, fmt.Errorf("failed to get code template: %w", err)
	}
	return &template, nil
}

func (s *SQLiteStorage) GetCodeTemplateByType(templateType, language string) (*types.CodeTemplate, error) {
	var template types.CodeTemplate
	if err := s.db.First(&template, "type = ? AND language = ?", templateType, language).Error; err != nil {
		return nil, fmt.Errorf("failed to get code template by type: %w", err)
	}
	return &template, nil
}

func (s *SQLiteStorage) SaveCodeTemplate(template *types.CodeTemplate) error {
	if template.CreatedAt.IsZero() {
		template.CreatedAt = time.Now()
	}
	template.UpdatedAt = time.Now()
	
	if err := s.db.Save(template).Error; err != nil {
		return fmt.Errorf("failed to save code template: %w", err)
	}
	return nil
}

func (s *SQLiteStorage) ListCodeTemplates(filter map[string]interface{}) ([]*types.CodeTemplate, error) {
	var templates []*types.CodeTemplate
	query := s.db
	
	if templateType, ok := filter["type"].(string); ok && templateType != "" {
		query = query.Where("type = ?", templateType)
	}
	if language, ok := filter["language"].(string); ok && language != "" {
		query = query.Where("language = ?", language)
	}
	if framework, ok := filter["framework"].(string); ok && framework != "" {
		query = query.Where("framework = ?", framework)
	}
	
	if err := query.Find(&templates).Error; err != nil {
		return nil, fmt.Errorf("failed to list code templates: %w", err)
	}
	return templates, nil
}

// Rule operations
func (s *SQLiteStorage) GetRule(id string) (*types.Rule, error) {
	var rule types.Rule
	if err := s.db.First(&rule, "id = ?", id).Error; err != nil {
		return nil, fmt.Errorf("failed to get rule: %w", err)
	}
	return &rule, nil
}

func (s *SQLiteStorage) GetRulesByProject(projectID string) ([]*types.Rule, error) {
	var rules []*types.Rule
	if err := s.db.Where("project_id = ? OR project_id = ?", projectID, "global").Find(&rules).Error; err != nil {
		return nil, fmt.Errorf("failed to get rules by project: %w", err)
	}
	return rules, nil
}

func (s *SQLiteStorage) SaveRule(rule *types.Rule) error {
	if rule.CreatedAt.IsZero() {
		rule.CreatedAt = time.Now()
	}
	rule.UpdatedAt = time.Now()
	
	if err := s.db.Save(rule).Error; err != nil {
		return fmt.Errorf("failed to save rule: %w", err)
	}
	return nil
}

// AIAgentConfig operations
func (s *SQLiteStorage) GetAIAgentConfig(agentType string) (*types.AIAgentConfig, error) {
	var config types.AIAgentConfig
	if err := s.db.First(&config, "agent_type = ?", agentType).Error; err != nil {
		return nil, fmt.Errorf("failed to get AI agent config: %w", err)
	}
	return &config, nil
}

func (s *SQLiteStorage) SaveAIAgentConfig(config *types.AIAgentConfig) error {
	if config.CreatedAt.IsZero() {
		config.CreatedAt = time.Now()
	}
	config.UpdatedAt = time.Now()
	
	if err := s.db.Save(config).Error; err != nil {
		return fmt.Errorf("failed to save AI agent config: %w", err)
	}
	return nil
}