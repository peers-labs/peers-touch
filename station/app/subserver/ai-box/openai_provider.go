package aibox

import (
	"context"
	"fmt"
	"net/http"
	"time"
)

// OpenAIProvider implements the Provider interface for OpenAI
type OpenAIProvider struct {
	name        string
	displayName string
	enabled     bool
	config      map[string]interface{}
	client      *http.Client
}

// NewOpenAIProvider creates a new OpenAI provider
func NewOpenAIProvider() *OpenAIProvider {
	return &OpenAIProvider{
		name:        "openai",
		displayName: "OpenAI",
		enabled:     true,
		config: map[string]interface{}{
			"api_key":   "",
			"proxy_url": "",
		},
		client: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

// Name returns the provider name
func (p *OpenAIProvider) Name() string {
	return p.name
}

// DisplayName returns the display name for UI
func (p *OpenAIProvider) DisplayName() string {
	return p.displayName
}

// GenerateResponse generates a response from OpenAI
func (p *OpenAIProvider) GenerateResponse(ctx context.Context, request *ChatRequest, agent *Agent) (*ChatResponse, error) {
	if !p.enabled {
		return nil, fmt.Errorf("openai provider is disabled")
	}

	// Implementation would go here
	return &ChatResponse{
		Content: "This is a mock response from OpenAI",
	}, nil
}

// ValidateConfig validates the OpenAI provider configuration
func (p *OpenAIProvider) ValidateConfig() error {
	apiKey := p.getAPIKey()
	if apiKey == "" {
		return fmt.Errorf("api_key is required")
	}
	return nil
}

// SetConfig sets provider configuration
func (p *OpenAIProvider) SetConfig(config map[string]interface{}) error {
	p.config = config
	return nil
}

// GetConfig gets provider configuration
func (p *OpenAIProvider) GetConfig() map[string]interface{} {
	return p.config
}

// GetConfigFields returns the configuration fields for OpenAI provider
func (p *OpenAIProvider) GetConfigFields() []ConfigField {
	return []ConfigField{
		{
			Name:        "api_key",
			Type:        "string",
			Required:    true,
			Description: "OpenAI API key for authentication",
			EnvVar:      "OPENAI_API_KEY",
		},
		{
			Name:        "proxy_url",
			Type:        "string",
			Required:    false,
			Description: "Proxy URL for API requests (optional)",
			EnvVar:      "OPENAI_PROXY_URL",
		},
	}
}

// IsEnabled checks if provider is enabled
func (p *OpenAIProvider) IsEnabled() bool {
	return p.enabled
}

// SetEnabled sets provider enabled status
func (p *OpenAIProvider) SetEnabled(enabled bool) {
	p.enabled = enabled
}

// ListModels returns available models from OpenAI
func (p *OpenAIProvider) ListModels() []ModelInfo {
	return []ModelInfo{
		{
			ID:           "gpt-4",
			Name:         "GPT-4",
			Provider:     "openai",
			Type:         "chat",
			Description:  "Most capable GPT-4 model",
			MaxTokens:    8192,
			Capabilities: []string{"chat", "completion"},
			Pricing: map[string]float64{
				"input":  0.03,
				"output": 0.06,
			},
			IsActive: true,
		},
		{
			ID:           "gpt-3.5-turbo",
			Name:         "GPT-3.5 Turbo",
			Provider:     "openai",
			Type:         "chat",
			Description:  "Fast and efficient GPT-3.5 model",
			MaxTokens:    4096,
			Capabilities: []string{"chat", "completion"},
			Pricing: map[string]float64{
				"input":  0.001,
				"output": 0.002,
			},
			IsActive: true,
		},
	}
}

// TestConnection tests connection to OpenAI
func (p *OpenAIProvider) TestConnection() error {
	if !p.enabled {
		return fmt.Errorf("openai provider is disabled")
	}

	apiKey := p.getAPIKey()
	if apiKey == "" {
		return fmt.Errorf("api_key not configured")
	}

	// In a real implementation, you would make a test API call
	// For now, just validate that the API key is present
	return nil
}

// Helper methods

func (p *OpenAIProvider) getAPIKey() string {
	if apiKey, ok := p.config["api_key"].(string); ok {
		return apiKey
	}
	return ""
}
