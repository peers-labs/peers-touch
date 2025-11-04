package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"text/template"

	"github.com/peers-touch/peers-touch/station/mcp-dev/internal/types"
)

type MCPService interface {
	Initialize(ctx context.Context, req *types.InitializeRequest) (*types.InitializeResponse, error)
	ListTools(ctx context.Context) ([]types.Tool, error)
	CallTool(ctx context.Context, req *types.CallToolRequest) (*types.CallToolResponse, error)
	ListPrompts(ctx context.Context) ([]types.Prompt, error)
	GetPrompt(ctx context.Context, req *types.GetPromptRequest) (*types.GetPromptResponse, error)
}

type mcpService struct {
	contextService  ContextService
	templateService TemplateService
	ruleService     RuleService
}

func NewMCPService(ctxService ContextService, tmplService TemplateService, ruleService RuleService) MCPService {
	return &mcpService{
		contextService:  ctxService,
		templateService: tmplService,
		ruleService:     ruleService,
	}
}

func (s *mcpService) Initialize(ctx context.Context, req *types.InitializeRequest) (*types.InitializeResponse, error) {
	return &types.InitializeResponse{
		ProtocolVersion: "2024-11-05",
		Capabilities: types.ServerCapabilities{
			Tools: &types.ToolsCapability{
				ListChanged: true,
			},
			Prompts: &types.PromptsCapability{
				ListChanged: true,
			},
			Logging: map[string]interface{}{
				"level": "info",
			},
		},
		ServerInfo: types.Implementation{
			Name:    "peers-dev-mcp",
			Version: "0.1.0",
		},
	}, nil
}

func (s *mcpService) ListTools(ctx context.Context) ([]types.Tool, error) {
	tools := []types.Tool{
		{
			Name:        "generate_code",
			Description: "Generate code based on project context and templates",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"properties": {
					"project_id": {"type": "string", "description": "Project ID"},
					"template_name": {"type": "string", "description": "Template name"},
					"parameters": {"type": "object", "description": "Template parameters"},
					"context_override": {"type": "object", "description": "Context overrides"}
				},
				"required": ["project_id", "template_name"]
			}`),
		},
		{
			Name:        "check_compliance",
			Description: "Check code compliance against project rules",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"properties": {
					"code": {"type": "string", "description": "Code to check"},
					"project_id": {"type": "string", "description": "Project ID"}
				},
				"required": ["code", "project_id"]
			}`),
		},
		{
			Name:        "get_project_context",
			Description: "Get project context and configuration",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"properties": {
					"project_id": {"type": "string", "description": "Project ID"}
				},
				"required": ["project_id"]
			}`),
		},
		{
			Name:        "list_templates",
			Description: "List available code templates",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"properties": {
					"language": {"type": "string", "description": "Programming language"},
					"framework": {"type": "string", "description": "Framework name"},
					"type": {"type": "string", "description": "Template type"}
				}
			}`),
		},
		{
			Name:        "fix_code",
			Description: "Fix code compliance issues",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"properties": {
					"code": {"type": "string", "description": "Code to fix"},
					"project_id": {"type": "string", "description": "Project ID"},
					"auto_fix": {"type": "boolean", "description": "Auto-fix issues"}
				},
				"required": ["code", "project_id"]
			}`),
		},
	}
	
	return tools, nil
}

func (s *mcpService) CallTool(ctx context.Context, req *types.CallToolRequest) (*types.CallToolResponse, error) {
	switch req.Name {
	case "generate_code":
		return s.handleGenerateCode(ctx, req.Arguments)
	case "check_compliance":
		return s.handleCheckCompliance(ctx, req.Arguments)
	case "get_project_context":
		return s.handleGetProjectContext(ctx, req.Arguments)
	case "list_templates":
		return s.handleListTemplates(ctx, req.Arguments)
	case "fix_code":
		return s.handleFixCode(ctx, req.Arguments)
	default:
		return nil, fmt.Errorf("unknown tool: %s", req.Name)
	}
}

func (s *mcpService) handleGenerateCode(ctx context.Context, args json.RawMessage) (*types.CallToolResponse, error) {
	var params struct {
		ProjectID      string                 `json:"project_id"`
		TemplateName   string                 `json:"template_name"`
		Parameters     map[string]interface{} `json:"parameters"`
		ContextOverride map[string]interface{} `json:"context_override"`
	}
	
	if err := json.Unmarshal(args, &params); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	
	// Get project context
	project, err := s.contextService.GetProjectContext(ctx, params.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("failed to get project context: %w", err)
	}
	
	// Get template
	template, err := s.templateService.GetCodeTemplateByType(params.TemplateName, project.Language)
	if err != nil {
		return nil, fmt.Errorf("failed to get template: %w", err)
	}
	
	// Prepare context data
	contextData := map[string]interface{}{
		"project":  project,
		"language": project.Language,
		"framework": project.Framework,
	}
	
	// Merge parameters
	for k, v := range params.Parameters {
		contextData[k] = v
	}
	
	// Apply context overrides
	for k, v := range params.ContextOverride {
		contextData[k] = v
	}
	
	// Render template
	renderedCode, err := s.renderTemplate(template.Content, contextData)
	if err != nil {
		return nil, fmt.Errorf("failed to render template: %w", err)
	}
	
	// Check compliance
	rules, err := s.ruleService.GetRulesByProject(ctx, params.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("failed to get rules: %w", err)
	}
	
	report, err := s.ruleService.CheckCodeCompliance(ctx, renderedCode, rules)
	if err != nil {
		return nil, fmt.Errorf("failed to check compliance: %w", err)
	}
	
	response := &types.CallToolResponse{
		Content: []types.ContentItem{
			{
				Type: "text",
				Text: fmt.Sprintf("Generated code:\n```%s\n%s\n```\n\nCompliance Report:\n- Total Rules: %d\n- Violations: %d\n- Score: %.2f%%",
					project.Language, renderedCode, report.TotalRules, len(report.Violations), report.Score*100),
			},
		},
		IsError: false,
	}
	
	if len(report.Violations) > 0 {
		response.Content = append(response.Content, types.ContentItem{
			Type: "text",
			Text: fmt.Sprintf("\nViolations found: %d", len(report.Violations)),
		})
	}
	
	return response, nil
}

func (s *mcpService) handleCheckCompliance(ctx context.Context, args json.RawMessage) (*types.CallToolResponse, error) {
	var params struct {
		Code      string `json:"code"`
		ProjectID string `json:"project_id"`
	}
	
	if err := json.Unmarshal(args, &params); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	
	rules, err := s.ruleService.GetRulesByProject(ctx, params.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("failed to get rules: %w", err)
	}
	
	report, err := s.ruleService.CheckCodeCompliance(ctx, params.Code, rules)
	if err != nil {
		return nil, fmt.Errorf("failed to check compliance: %w", err)
	}
	
	result := fmt.Sprintf("Compliance Check Results:\n- Total Rules: %d\n- Violations: %d\n- Score: %.2f%%",
		report.TotalRules, len(report.Violations), report.Score*100)
	
	if len(report.Violations) > 0 {
		result += "\n\nViolations:"
		for _, violation := range report.Violations {
			result += fmt.Sprintf("\n- [%s] %s: %s", violation.Severity, violation.RuleName, violation.Message)
		}
	}
	
	return &types.CallToolResponse{
		Content: []types.ContentItem{
			{Type: "text", Text: result},
		},
		IsError: false,
	}, nil
}

func (s *mcpService) handleGetProjectContext(ctx context.Context, args json.RawMessage) (*types.CallToolResponse, error) {
	var params struct {
		ProjectID string `json:"project_id"`
	}
	
	if err := json.Unmarshal(args, &params); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	
	project, err := s.contextService.GetProjectContext(ctx, params.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("failed to get project context: %w", err)
	}
	
	projectJSON, err := json.MarshalIndent(project, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("failed to marshal project context: %w", err)
	}
	
	return &types.CallToolResponse{
		Content: []types.ContentItem{
			{Type: "text", Text: fmt.Sprintf("Project Context:\n```json\n%s\n```", string(projectJSON))},
		},
		IsError: false,
	}, nil
}

func (s *mcpService) handleListTemplates(ctx context.Context, args json.RawMessage) (*types.CallToolResponse, error) {
	var params struct {
		Language  string `json:"language"`
		Framework string `json:"framework"`
		Type      string `json:"type"`
	}
	
	json.Unmarshal(args, &params) // Ignore error for optional parameters
	
	filter := map[string]interface{}{
		"language":  params.Language,
		"framework": params.Framework,
		"type":      params.Type,
	}
	
	templates, err := s.templateService.ListCodeTemplates(ctx, filter)
	if err != nil {
		return nil, fmt.Errorf("failed to list templates: %w", err)
	}
	
	result := "Available Templates:\n"
	for _, tmpl := range templates {
		result += fmt.Sprintf("- %s (%s/%s): %s\n", tmpl.Name, tmpl.Language, tmpl.Framework, tmpl.Description)
	}
	
	return &types.CallToolResponse{
		Content: []types.ContentItem{
			{Type: "text", Text: result},
		},
		IsError: false,
	}, nil
}

func (s *mcpService) handleFixCode(ctx context.Context, args json.RawMessage) (*types.CallToolResponse, error) {
	// Placeholder for code fixing functionality
	return &types.CallToolResponse{
		Content: []types.ContentItem{
			{Type: "text", Text: "Code fixing functionality not yet implemented"},
		},
		IsError: false,
	}, nil
}

func (s *mcpService) ListPrompts(ctx context.Context) ([]types.Prompt, error) {
	prompts := []types.Prompt{
		{
			Name:        "code_generation",
			Description: "Generate code with project context and compliance checking",
			Arguments: []types.PromptArgument{
				{Name: "project_id", Description: "Project identifier", Required: true},
				{Name: "template_name", Description: "Code template name", Required: true},
				{Name: "parameters", Description: "Template parameters", Required: false},
			},
		},
		{
			Name:        "compliance_check",
			Description: "Check code compliance against project rules",
			Arguments: []types.PromptArgument{
				{Name: "code", Description: "Code to check", Required: true},
				{Name: "project_id", Description: "Project identifier", Required: true},
			},
		},
		{
			Name:        "project_analysis",
			Description: "Analyze project structure and provide insights",
			Arguments: []types.PromptArgument{
				{Name: "project_id", Description: "Project identifier", Required: true},
			},
		},
	}
	
	return prompts, nil
}

func (s *mcpService) GetPrompt(ctx context.Context, req *types.GetPromptRequest) (*types.GetPromptResponse, error) {
	switch req.Name {
	case "code_generation":
		return s.getCodeGenerationPrompt(ctx, req.Arguments)
	case "compliance_check":
		return s.getComplianceCheckPrompt(ctx, req.Arguments)
	case "project_analysis":
		return s.getProjectAnalysisPrompt(ctx, req.Arguments)
	default:
		return nil, fmt.Errorf("unknown prompt: %s", req.Name)
	}
}

func (s *mcpService) getCodeGenerationPrompt(ctx context.Context, args json.RawMessage) (*types.GetPromptResponse, error) {
	var params struct {
		ProjectID    string                 `json:"project_id"`
		TemplateName string                 `json:"template_name"`
		Parameters   map[string]interface{} `json:"parameters"`
	}
	
	if err := json.Unmarshal(args, &params); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	
	project, err := s.contextService.GetProjectContext(ctx, params.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("failed to get project context: %w", err)
	}
	
	return &types.GetPromptResponse{
		Description: "Generate code with project context and compliance checking",
		Messages: []types.PromptMessage{
			{
				Role:    "system",
				Content: fmt.Sprintf("You are a code generation assistant for project: %s (%s/%s). Follow the project's coding standards and rules.", project.Name, project.Language, project.Framework),
			},
			{
				Role:    "user",
				Content: fmt.Sprintf("Generate code using template '%s' with parameters: %v", params.TemplateName, params.Parameters),
			},
		},
	}, nil
}

func (s *mcpService) getComplianceCheckPrompt(ctx context.Context, args json.RawMessage) (*types.GetPromptResponse, error) {
	var params struct {
		Code      string `json:"code"`
		ProjectID string `json:"project_id"`
	}
	
	if err := json.Unmarshal(args, &params); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	
	project, err := s.contextService.GetProjectContext(ctx, params.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("failed to get project context: %w", err)
	}
	
	return &types.GetPromptResponse{
		Description: "Check code compliance against project rules",
		Messages: []types.PromptMessage{
			{
				Role:    "system",
				Content: fmt.Sprintf("You are a code compliance checker for project: %s (%s/%s). Check the provided code against the project's coding standards.", project.Name, project.Language, project.Framework),
			},
			{
				Role:    "user",
				Content: fmt.Sprintf("Check this code for compliance issues:\n```%s\n%s\n```", project.Language, params.Code),
			},
		},
	}, nil
}

func (s *mcpService) getProjectAnalysisPrompt(ctx context.Context, args json.RawMessage) (*types.GetPromptResponse, error) {
	var params struct {
		ProjectID string `json:"project_id"`
	}
	
	if err := json.Unmarshal(args, &params); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	
	project, err := s.contextService.GetProjectContext(ctx, params.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("failed to get project context: %w", err)
	}
	
	projectJSON, _ := json.MarshalIndent(project, "", "  ")
	
	return &types.GetPromptResponse{
		Description: "Analyze project structure and provide insights",
		Messages: []types.PromptMessage{
			{
				Role:    "system",
				Content: "You are a project analysis assistant. Analyze the provided project structure and provide insights about architecture, dependencies, and best practices.",
			},
			{
				Role:    "user",
				Content: fmt.Sprintf("Analyze this project:\n```json\n%s\n```", string(projectJSON)),
			},
		},
	}, nil
}

func (s *mcpService) renderTemplate(content string, data map[string]interface{}) (string, error) {
	tmpl, err := template.New("code").Parse(content)
	if err != nil {
		return "", fmt.Errorf("failed to parse template: %w", err)
	}
	
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("failed to execute template: %w", err)
	}
	
	return buf.String(), nil
}