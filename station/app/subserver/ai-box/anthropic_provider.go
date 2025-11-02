package aibox

import (
	"context"
	"fmt"
	"net/http"
	"time"
)

// AnthropicProvider implements the Provider interface for Anthropic Claude
type AnthropicProvider struct {
	name        string
	displayName string
	enabled     bool
	config      map[string]interface{}
	client      *http.Client
}

// NewAnthropicProvider creates a new Anthropic provider
func NewAnthropicProvider() *AnthropicProvider {
	return &AnthropicProvider{
		name:        "anthropic",
		displayName: "Anthropic Claude",
		enabled:     true,
		config: map[string]interface{}{
			"api_key":     "",
			"max_tokens":  1000,
			"temperature": 0.7,
			"stream":      true,
		},
		client: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

// Name returns the provider name
func (p *AnthropicProvider) Name() string {
	return p.name
}

// DisplayName returns the display name for UI
func (p *AnthropicProvider) DisplayName() string {
	return p.displayName
}

// GenerateResponse generates a response from Anthropic
func (p *AnthropicProvider) GenerateResponse(ctx context.Context, request *ChatRequest, agent *Agent) (*ChatResponse, error) {
	if !p.enabled {
		return nil, fmt.Errorf("anthropic provider is disabled")
	}

	// Implementation would go here
	return &ChatResponse{
		Content: "This is a mock response from Anthropic Claude",
	}, nil
}

// ValidateConfig validates the Anthropic provider configuration
func (p *AnthropicProvider) ValidateConfig() error {
	apiKey := p.getAPIKey()
	if apiKey == "" {
		return fmt.Errorf("api_key is required")
	}

	maxTokens := p.getMaxTokens()
	if maxTokens <= 0 || maxTokens > 100000 {
		return fmt.Errorf("max_tokens must be between 1 and 100000")
	}

	temperature := p.getTemperature()
	if temperature < 0 || temperature > 1 {
		return fmt.Errorf("temperature must be between 0 and 1")
	}

	return nil
}

// SetConfig sets provider configuration
func (p *AnthropicProvider) SetConfig(config map[string]interface{}) error {
	p.config = config
	return nil
}

// GetConfig gets provider configuration
func (p *AnthropicProvider) GetConfig() map[string]interface{} {
	return p.config
}

// GetConfigFields returns the configuration fields for Anthropic provider
func (p *AnthropicProvider) GetConfigFields() []ConfigField {
	return []ConfigField{
		{
			Name:        "api_key",
			Type:        "string",
			Required:    true,
			Description: "Anthropic API key for authentication",
			EnvVar:      "ANTHROPIC_API_KEY",
		},
		{
			Name:         "max_tokens",
			Type:         "number",
			Required:     false,
			Description:  "Maximum number of tokens to generate",
			DefaultValue: "1000",
		},
		{
			Name:         "temperature",
			Type:         "number",
			Required:     false,
			Description:  "Sampling temperature (0.0 to 1.0)",
			DefaultValue: "0.7",
		},
		{
			Name:         "stream",
			Type:         "boolean",
			Required:     false,
			Description:  "Enable streaming responses",
			DefaultValue: "true",
		},
	}
}

// IsEnabled checks if provider is enabled
func (p *AnthropicProvider) IsEnabled() bool {
	return p.enabled
}

// SetEnabled sets provider enabled status
func (p *AnthropicProvider) SetEnabled(enabled bool) {
	p.enabled = enabled
}

// ListModels returns available models from Anthropic
func (p *AnthropicProvider) ListModels() []ModelInfo {
	return []ModelInfo{
		{
			ID:           "claude-3-opus-20240229",
			Name:         "Claude 3 Opus",
			Provider:     "anthropic",
			Type:         "chat",
			Description:  "Most powerful Claude 3 model",
			MaxTokens:    200000,
			Capabilities: []string{"chat", "completion", "analysis"},
			Pricing: map[string]float64{
				"input":  0.015,
				"output": 0.075,
			},
			IsActive: true,
		},
		{
			ID:           "claude-3-sonnet-20240229",
			Name:         "Claude 3 Sonnet",
			Provider:     "anthropic",
			Type:         "chat",
			Description:  "Balanced Claude 3 model",
			MaxTokens:    200000,
			Capabilities: []string{"chat", "completion", "analysis"},
			Pricing: map[string]float64{
				"input":  0.003,
				"output": 0.015,
			},
			IsActive: true,
		},
	}
}

// TestConnection tests connection to Anthropic
func (p *AnthropicProvider) TestConnection() error {
	if !p.enabled {
		return fmt.Errorf("anthropic provider is disabled")
	}

	apiKey := p.getAPIKey()
	if apiKey == "" {
		return fmt.Errorf("api_key not configured")
	}

	// In a real implementation, you would make a test API call
	return nil
}

// Helper methods

func (p *AnthropicProvider) getAPIKey() string {
	if apiKey, ok := p.config["api_key"].(string); ok {
		return apiKey
	}
	return ""
}

func (p *AnthropicProvider) getMaxTokens() int {
	if maxTokens, ok := p.config["max_tokens"].(int); ok {
		return maxTokens
	}
	return 1000
}

func (p *AnthropicProvider) getTemperature() float64 {
	if temperature, ok := p.config["temperature"].(float64); ok {
		return temperature
	}
	return 0.7
}

func (p *AnthropicProvider) getStream() bool {
	if stream, ok := p.config["stream"].(bool); ok {
		return stream
	}
	return true
}
