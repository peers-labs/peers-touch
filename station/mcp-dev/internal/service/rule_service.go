package service

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/peers-touch/peers-touch/station/mcp-dev/internal/types"
	"gorm.io/gorm"
)

type RuleService interface {
	GetRulesByProject(ctx context.Context, projectID string) ([]*types.Rule, error)
	CheckCodeCompliance(ctx context.Context, code string, rules []*types.Rule) (*types.ComplianceReport, error)
	CreateRule(ctx context.Context, rule *types.Rule) error
	UpdateRule(ctx context.Context, rule *types.Rule) error
	DeleteRule(ctx context.Context, ruleID string) error
	GenerateFixSuggestion(ctx context.Context, violation *types.ComplianceIssue) (*types.FixSuggestion, error)
}

type ruleService struct {
	db *gorm.DB
}

func NewRuleService(db *gorm.DB) RuleService {
	return &ruleService{db: db}
}

func (s *ruleService) GetRulesByProject(ctx context.Context, projectID string) ([]*types.Rule, error) {
	var rules []*types.Rule
	if err := s.db.WithContext(ctx).Where("project_id = ? OR project_id = ?", projectID, "global").Find(&rules).Error; err != nil {
		return nil, fmt.Errorf("failed to get rules: %w", err)
	}
	return rules, nil
}

func (s *ruleService) CheckCodeCompliance(ctx context.Context, code string, rules []*types.Rule) (*types.ComplianceReport, error) {
	violations := make([]types.ComplianceIssue, 0)
	
	for _, rule := range rules {
		issues := s.checkRule(code, rule)
		violations = append(violations, issues...)
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
		ByRule:          make(map[string]int),
	}
	
	for _, violation := range violations {
		summary.BySeverity[violation.Severity]++
		summary.ByRule[violation.RuleName]++
	}
	
	return &types.ComplianceReport{
		Violations: violations,
		TotalRules: totalRules,
		Score:      score,
		Summary:    summary,
	}, nil
}

func (s *ruleService) checkRule(code string, rule *types.Rule) []types.ComplianceIssue {
	var issues []types.ComplianceIssue
	
	switch rule.Type {
	case "pattern":
		issues = append(issues, s.checkPatternRule(code, rule)...)
	case "structure":
		issues = append(issues, s.checkStructureRule(code, rule)...)
	case "naming":
		issues = append(issues, s.checkNamingRule(code, rule)...)
	case "import":
		issues = append(issues, s.checkImportRule(code, rule)...)
	}
	
	return issues
}

func (s *ruleService) checkPatternRule(code string, rule *types.Rule) []types.ComplianceIssue {
	var issues []types.ComplianceIssue
	
	if rule.Pattern == "" {
		return issues
	}
	
	re, err := regexp.Compile(rule.Pattern)
	if err != nil {
		return issues
	}
	
	lines := strings.Split(code, "\n")
	for i, line := range lines {
		if re.MatchString(line) {
			issues = append(issues, types.ComplianceIssue{
				RuleID:     rule.ID,
				RuleName:   rule.Name,
				Severity:   rule.Severity,
				Message:    rule.Description,
				Suggestion: rule.Description,
				LineNumber: i + 1,
			})
		}
	}
	
	return issues
}

func (s *ruleService) checkStructureRule(code string, rule *types.Rule) []types.ComplianceIssue {
	var issues []types.ComplianceIssue
	
	if rule.Pattern == "" {
		return issues
	}
	
	lines := strings.Split(code, "\n")
	for i, line := range lines {
		if strings.Contains(line, rule.Pattern) {
			issues = append(issues, types.ComplianceIssue{
				RuleID:     rule.ID,
				RuleName:   rule.Name,
				Severity:   rule.Severity,
				Message:    rule.Description,
				Suggestion: rule.Description,
				LineNumber: i + 1,
			})
		}
	}
	
	return issues
}

func (s *ruleService) checkNamingRule(code string, rule *types.Rule) []types.ComplianceIssue {
	var issues []types.ComplianceIssue
	
	if rule.Pattern == "" {
		return issues
	}
	
	re, err := regexp.Compile(rule.Pattern)
	if err != nil {
		return issues
	}
	
	lines := strings.Split(code, "\n")
	for i, line := range lines {
		matches := re.FindAllString(line, -1)
		for _, match := range matches {
			issues = append(issues, types.ComplianceIssue{
				RuleID:     rule.ID,
				RuleName:   rule.Name,
				Severity:   rule.Severity,
				Message:    fmt.Sprintf("%s: %s", rule.Description, match),
				Suggestion: rule.Description,
				LineNumber: i + 1,
			})
		}
	}
	
	return issues
}

func (s *ruleService) checkImportRule(code string, rule *types.Rule) []types.ComplianceIssue {
	var issues []types.ComplianceIssue
	
	if rule.Pattern == "" {
		return issues
	}
	
	lines := strings.Split(code, "\n")
	for i, line := range lines {
		if strings.HasPrefix(line, "import") && strings.Contains(line, rule.Pattern) {
			issues = append(issues, types.ComplianceIssue{
				RuleID:     rule.ID,
				RuleName:   rule.Name,
				Severity:   rule.Severity,
				Message:    rule.Description,
				Suggestion: rule.Description,
				LineNumber: i + 1,
			})
		}
	}
	
	return issues
}

func (s *ruleService) CreateRule(ctx context.Context, rule *types.Rule) error {
	return s.db.WithContext(ctx).Create(rule).Error
}

func (s *ruleService) UpdateRule(ctx context.Context, rule *types.Rule) error {
	return s.db.WithContext(ctx).Save(rule).Error
}

func (s *ruleService) DeleteRule(ctx context.Context, ruleID string) error {
	return s.db.WithContext(ctx).Delete(&types.Rule{}, "id = ?", ruleID).Error
}

func (s *ruleService) GenerateFixSuggestion(ctx context.Context, violation *types.ComplianceIssue) (*types.FixSuggestion, error) {
	// Generate fix suggestions based on the violation type
	suggestion := &types.FixSuggestion{
		IssueID:     violation.RuleID,
		Description: fmt.Sprintf("Fix for %s violation", violation.RuleName),
		Confidence:  0.8,
	}
	
	switch violation.RuleName {
	case "naming_convention":
		suggestion.Original = "// Use proper naming convention"
		suggestion.Replacement = "Follow the project's naming convention for functions and variables"
	case "import_order":
		suggestion.Original = "// Reorder imports alphabetically"
		suggestion.Replacement = "Import statements should be ordered alphabetically"
	default:
		suggestion.Original = "// Fix compliance issue"
		suggestion.Replacement = "Address the compliance violation"
	}
	
	return suggestion, nil
}