package types

import (
	"database/sql/driver"
	"encoding/json"
	"time"
)

// JSONMap represents a map that can be stored as JSON in database
type JSONMap map[string]interface{}

// Value implements driver.Valuer interface
func (j JSONMap) Value() (driver.Value, error) {
	if j == nil {
		return nil, nil
	}
	return json.Marshal(j)
}

// Scan implements sql.Scanner interface
func (j *JSONMap) Scan(value interface{}) error {
	if value == nil {
		*j = nil
		return nil
	}
	
	var bytes []byte
	switch v := value.(type) {
	case []byte:
		bytes = v
	case string:
		bytes = []byte(v)
	default:
		return nil
	}
	
	return json.Unmarshal(bytes, j)
}

// ProjectContext represents project-specific context for code generation
type ProjectContext struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Language        string    `json:"language"`
	Framework       string    `json:"framework"`
	CodingStandards JSONMap   `json:"coding_standards" gorm:"type:text"`
	Architecture    JSONMap   `json:"architecture" gorm:"type:text"`
	Dependencies    JSONMap   `json:"dependencies" gorm:"type:text"`
	Templates       []string  `json:"templates" gorm:"type:text"`
	Rules           []string  `json:"rules" gorm:"type:text"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// CodeGenerationRequest represents a code generation request
type CodeGenerationRequest struct {
	ProjectID       string  `json:"project_id"`
	TemplateName    string  `json:"template_name"`
	Parameters      JSONMap `json:"parameters"`
	ContextOverride JSONMap `json:"context_override,omitempty"`
}

// CodeGenerationResponse represents a code generation response
type CodeGenerationResponse struct {
	Code           string             `json:"code"`
	ComplianceReport *ComplianceReport `json:"compliance_report,omitempty"`
	Suggestions    []FixSuggestion    `json:"suggestions,omitempty"`
}

// ComplianceReport represents code compliance analysis results
type ComplianceReport struct {
	TotalRules  int                `json:"total_rules"`
	Violations  []ComplianceIssue  `json:"violations"`
	Summary     ComplianceSummary  `json:"summary"`
	Score       float64            `json:"score"`
}

// ComplianceIssue represents a compliance violation
type ComplianceIssue struct {
	RuleID      string  `json:"rule_id"`
	RuleName    string  `json:"rule_name"`
	Severity    string  `json:"severity"`
	Message     string  `json:"message"`
	Suggestion  string  `json:"suggestion"`
	LineNumber  int     `json:"line_number,omitempty"`
	Column      int     `json:"column,omitempty"`
}

// ComplianceSummary represents compliance summary statistics
type ComplianceSummary struct {
	TotalViolations int            `json:"total_violations"`
	BySeverity      map[string]int `json:"by_severity"`
	ByRule          map[string]int `json:"by_rule"`
}

// FixSuggestion represents a suggested fix for a compliance issue
type FixSuggestion struct {
	IssueID     string  `json:"issue_id"`
	Description string  `json:"description"`
	FixType     string  `json:"fix_type"`
	Original    string  `json:"original"`
	Replacement string  `json:"replacement"`
	FilePath    string  `json:"file_path"`
	LineNumber  int     `json:"line_number"`
	Confidence  float64 `json:"confidence"`
}

// CodeTemplate represents a code template
type CodeTemplate struct {
	ID          string             `json:"id"`
	Name        string             `json:"name"`
	Description string             `json:"description"`
	Type        string             `json:"type"`
	Language    string             `json:"language"`
	Framework   string             `json:"framework"`
	Content     string             `json:"content"`
	Variables   []TemplateVariable `json:"variables" gorm:"type:text"`
	Rules       []string           `json:"rules" gorm:"type:text"`
	Metadata    JSONMap            `json:"metadata" gorm:"type:text"`
	CreatedAt   time.Time          `json:"created_at"`
	UpdatedAt   time.Time          `json:"updated_at"`
}

// TemplateVariable represents a template variable
type TemplateVariable struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Description string `json:"description"`
	Required    bool   `json:"required"`
	Default     string `json:"default,omitempty"`
	Validation  string `json:"validation,omitempty"`
}

// Rule represents a coding rule
type Rule struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Type        string    `json:"type"`
	Severity    string    `json:"severity"`
	Enabled     bool      `json:"enabled"`
	Message     string    `json:"message"`
	Description string    `json:"description"`
	Pattern     string    `json:"pattern,omitempty"`
	FixTemplate string    `json:"fix_template,omitempty"`
	Metadata    JSONMap   `json:"metadata,omitempty" gorm:"type:text"`
	ProjectID   string    `json:"project_id"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// AIAgentConfig represents AI agent configuration
type AIAgentConfig struct {
	ID          string    `json:"id"`
	AgentType   string    `json:"agent_type"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Settings    JSONMap   `json:"settings" gorm:"type:text"`
	Prompts     JSONMap   `json:"prompts" gorm:"type:text"`
	Rules       []string  `json:"rules" gorm:"type:text"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}