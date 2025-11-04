package service

import (
	"bytes"
	"context"
	"fmt"
	texttemplate "text/template"

	"github.com/peers-touch/peers-touch/station/mcp-dev/internal/types"
	"gorm.io/gorm"
)

type TemplateService interface {
	GetCodeTemplate(ctx context.Context, templateID string) (*types.CodeTemplate, error)
	GetCodeTemplateByType(templateType string, language string) (*types.CodeTemplate, error)
	RenderTemplate(template *types.CodeTemplate, data map[string]interface{}) (string, error)
	ListCodeTemplates(ctx context.Context, filter map[string]interface{}) ([]*types.CodeTemplate, error)
	CreateCodeTemplate(ctx context.Context, template *types.CodeTemplate) error
	ValidateTemplateCompliance(ctx context.Context, template *types.CodeTemplate, rules []*types.Rule) (*types.ComplianceReport, error)
}

type templateService struct {
	db *gorm.DB
}

func NewTemplateService(db *gorm.DB) TemplateService {
	return &templateService{db: db}
}

func (s *templateService) GetCodeTemplate(ctx context.Context, templateID string) (*types.CodeTemplate, error) {
	var template types.CodeTemplate
	if err := s.db.WithContext(ctx).First(&template, "id = ?", templateID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, fmt.Errorf("code template not found: %s", templateID)
		}
		return nil, fmt.Errorf("failed to get code template: %w", err)
	}
	return &template, nil
}

func (s *templateService) GetCodeTemplateByType(templateType string, language string) (*types.CodeTemplate, error) {
	var template types.CodeTemplate
	if err := s.db.First(&template, "type = ? AND language = ?", templateType, language).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, fmt.Errorf("code template not found: %s/%s", templateType, language)
		}
		return nil, fmt.Errorf("failed to get code template: %w", err)
	}
	return &template, nil
}

func (s *templateService) RenderTemplate(template *types.CodeTemplate, data map[string]interface{}) (string, error) {
	tmpl, err := texttemplate.New("code").Parse(template.Content)
	if err != nil {
		return "", fmt.Errorf("failed to parse template: %w", err)
	}
	
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("failed to execute template: %w", err)
	}
	
	return buf.String(), nil
}

func (s *templateService) ListCodeTemplates(ctx context.Context, filter map[string]interface{}) ([]*types.CodeTemplate, error) {
	var templates []*types.CodeTemplate
	query := s.db.WithContext(ctx).Model(&types.CodeTemplate{})
	
	if language, ok := filter["language"].(string); ok && language != "" {
		query = query.Where("language = ?", language)
	}
	if framework, ok := filter["framework"].(string); ok && framework != "" {
		query = query.Where("framework = ?", framework)
	}
	if templateType, ok := filter["type"].(string); ok && templateType != "" {
		query = query.Where("type = ?", templateType)
	}
	
	if err := query.Find(&templates).Error; err != nil {
		return nil, fmt.Errorf("failed to list code templates: %w", err)
	}
	
	return templates, nil
}

func (s *templateService) CreateCodeTemplate(ctx context.Context, template *types.CodeTemplate) error {
	return s.db.WithContext(ctx).Create(template).Error
}

func (s *templateService) ValidateTemplateCompliance(ctx context.Context, template *types.CodeTemplate, rules []*types.Rule) (*types.ComplianceReport, error) {
	// This is a simplified implementation
	// In a real implementation, you would parse the template and check it against rules
	violations := make([]types.ComplianceIssue, 0)
	
	for _, rule := range rules {
		// Simple rule checking logic
		switch rule.Type {
		case "naming":
			// Check naming conventions in template
		case "structure":
			// Check code structure
		case "import":
			// Check import statements
		}
	}
	
	totalRules := len(rules)
	violationCount := len(violations)
	score := 1.0
	if totalRules > 0 {
		score = float64(totalRules-violationCount) / float64(totalRules)
	}
	
	summary := types.ComplianceSummary{
		TotalViolations: violationCount,
		BySeverity:      make(map[string]int),
		ByRule:            make(map[string]int),
	}
	
	for _, violation := range violations {
		summary.BySeverity[violation.Severity]++
		summary.ByRule[violation.RuleName]++
	}
	
	return &types.ComplianceReport{
		Violations:  violations,
		TotalRules:  totalRules,
		Score:       score,
		Summary:     summary,
	}, nil
}