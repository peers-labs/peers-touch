package aibox

import (
	"context"
	"fmt"
	"time"

	"github.com/peers-touch/peers-touch/station/frame/core/logger"
)

// ModelInfo represents information about an AI model
type ModelInfo struct {
	ID           string             `json:"id"`
	Name         string             `json:"name"`
	Provider     string             `json:"provider"`
	Type         string             `json:"type"` // "chat", "embedding", "image", "tts", "asr"
	Description  string             `json:"description"`
	MaxTokens    int                `json:"max_tokens"`
	Capabilities []string           `json:"capabilities"`
	Pricing      map[string]float64 `json:"pricing"`
	IsActive     bool               `json:"is_active"`
}

// ConfigField represents a configuration field for a provider
type ConfigField struct {
	Name         string      `json:"name"`
	Type         string      `json:"type"` // "string", "boolean", "number"
	Required     bool        `json:"required"`
	Description  string      `json:"description"`
	EnvVar       string      `json:"env_var,omitempty"`
	DefaultValue interface{} `json:"default_value,omitempty"`
}

// Provider defines the interface for AI model providers
type Provider interface {
	// Name returns the provider name (e.g., "openai", "anthropic")
	Name() string

	// DisplayName returns the display name for UI
	DisplayName() string

	// GenerateResponse generates a response from the AI model
	GenerateResponse(ctx context.Context, request *ChatRequest, agent *Agent) (*ChatResponse, error)

	// ValidateConfig validates the provider configuration
	ValidateConfig() error

	// SetConfig sets provider configuration
	SetConfig(config map[string]interface{}) error

	// GetConfig gets provider configuration
	GetConfig() map[string]interface{}

	// GetConfigFields returns the configuration fields for this provider
	GetConfigFields() []ConfigField

	// IsEnabled checks if provider is enabled
	IsEnabled() bool

	// SetEnabled sets provider enabled status
	SetEnabled(enabled bool)

	// ListModels returns available models
	ListModels() []ModelInfo

	// TestConnection tests provider connection
	TestConnection() error
}

// ProviderRegistry manages all available providers
type ProviderRegistry struct {
	providers map[string]Provider
}

// ProviderInfo represents comprehensive information about a provider
type ProviderInfo struct {
	Name         string                 `json:"name"`
	DisplayName  string                 `json:"display_name"`
	Enabled      bool                   `json:"enabled"`
	Config       map[string]interface{} `json:"config"`
	ConfigFields []ConfigField          `json:"config_fields"`
	Models       []ModelInfo            `json:"models"`
	Status       string                 `json:"status"` // "connected", "error", "unknown"
	Error        string                 `json:"error,omitempty"`
}

// NewProviderRegistry creates a new provider registry
func NewProviderRegistry() *ProviderRegistry {
	return &ProviderRegistry{
		providers: make(map[string]Provider),
	}
}

// Register registers a new provider
func (r *ProviderRegistry) Register(provider Provider) error {
	if err := provider.ValidateConfig(); err != nil {
		return fmt.Errorf("invalid provider configuration: %w", err)
	}

	r.providers[provider.Name()] = provider
	logger.Logf(logger.InfoLevel, "Provider registered: %s", provider.Name())
	return nil
}

// Get gets a provider by name
func (r *ProviderRegistry) Get(name string) (Provider, error) {
	provider, exists := r.providers[name]
	if !exists {
		return nil, fmt.Errorf("provider not found: %s", name)
	}
	return provider, nil
}

// List returns all registered providers
func (r *ProviderRegistry) List() []string {
	names := make([]string, 0, len(r.providers))
	for name := range r.providers {
		names = append(names, name)
	}
	return names
}

// GetProviderInfo returns detailed information about a provider
func (r *ProviderRegistry) GetProviderInfo(name string) (*ProviderInfo, error) {
	provider, exists := r.providers[name]
	if !exists {
		return nil, fmt.Errorf("provider not found: %s", name)
	}

	// Test connection
	status := "unknown"
	var connectionError string
	if provider.IsEnabled() {
		if err := provider.TestConnection(); err != nil {
			status = "error"
			connectionError = err.Error()
		} else {
			status = "connected"
		}
	} else {
		status = "disabled"
	}

	return &ProviderInfo{
		Name:         provider.Name(),
		DisplayName:  provider.DisplayName(),
		Enabled:      provider.IsEnabled(),
		Config:       provider.GetConfig(),
		ConfigFields: provider.GetConfigFields(),
		Models:       provider.ListModels(),
		Status:       status,
		Error:        connectionError,
	}, nil
}

// ListProviderInfos returns detailed information about all providers
func (r *ProviderRegistry) ListProviderInfos() []*ProviderInfo {
	infos := make([]*ProviderInfo, 0, len(r.providers))
	for name := range r.providers {
		if info, err := r.GetProviderInfo(name); err == nil {
			infos = append(infos, info)
		}
	}
	return infos
}

// UpdateProviderConfig updates provider configuration
func (r *ProviderRegistry) UpdateProviderConfig(name string, config map[string]interface{}) error {
	provider, exists := r.providers[name]
	if !exists {
		return fmt.Errorf("provider not found: %s", name)
	}

	if err := provider.SetConfig(config); err != nil {
		return fmt.Errorf("failed to set provider config: %w", err)
	}

	// Validate the new configuration
	if provider.IsEnabled() {
		if err := provider.ValidateConfig(); err != nil {
			return fmt.Errorf("invalid provider configuration: %w", err)
		}
	}

	logger.Logf(logger.InfoLevel, "Provider config updated: %s", name)
	return nil
}

// SetProviderEnabled sets provider enabled status
func (r *ProviderRegistry) SetProviderEnabled(name string, enabled bool) error {
	provider, exists := r.providers[name]
	if !exists {
		return fmt.Errorf("provider not found: %s", name)
	}

	provider.SetEnabled(enabled)

	// If enabling, validate config
	if enabled {
		if err := provider.ValidateConfig(); err != nil {
			return fmt.Errorf("invalid provider configuration: %w", err)
		}
	}

	logger.Logf(logger.InfoLevel, "Provider %s %s", name, map[bool]string{true: "enabled", false: "disabled"}[enabled])
	return nil
}

// TestProviderConnection tests provider connection
func (r *ProviderRegistry) TestProviderConnection(name string) error {
	provider, exists := r.providers[name]
	if !exists {
		return fmt.Errorf("provider not found: %s", name)
	}

	return provider.TestConnection()
}

// MockProvider is a simple mock provider for MVP testing
type MockProvider struct {
	name    string
	enabled bool
	config  map[string]interface{}
}

// NewMockProvider creates a new mock provider
func NewMockProvider(name string) *MockProvider {
	return &MockProvider{
		name:    name,
		enabled: true,
		config:  make(map[string]interface{}),
	}
}

// Name returns the provider name
func (p *MockProvider) Name() string {
	return p.name
}

// DisplayName returns the display name for UI
func (p *MockProvider) DisplayName() string {
	switch p.name {
	case "openai":
		return "OpenAI"
	case "anthropic":
		return "Anthropic"
	case "local":
		return "本地模型"
	default:
		return p.name
	}
}

// GenerateResponse generates a mock response
func (p *MockProvider) GenerateResponse(ctx context.Context, request *ChatRequest, agent *Agent) (*ChatResponse, error) {
	if !p.enabled {
		return nil, fmt.Errorf("provider %s is disabled", p.name)
	}

	// For MVP, we don't have Model field in Agent, so we'll use provider name as model
	model := p.name
	response := &ChatResponse{
		MessageID:      generateID(),
		ConversationID: request.ConversationID,
		Content:        fmt.Sprintf("Mock response from %s using model %s: %s", p.name, model, request.Message),
		Role:           "assistant",
		Model:          model,
		TokenCount:     len(request.Message) / 4, // Rough estimate
		Timestamp:      time.Now(),
	}

	return response, nil
}

// ValidateConfig validates the mock provider configuration
func (p *MockProvider) ValidateConfig() error {
	return nil
}

// SetConfig sets provider configuration
func (p *MockProvider) SetConfig(config map[string]interface{}) error {
	p.config = config
	return nil
}

// GetConfig gets provider configuration
func (p *MockProvider) GetConfig() map[string]interface{} {
	return p.config
}

// IsEnabled checks if provider is enabled
func (p *MockProvider) IsEnabled() bool {
	return p.enabled
}

// SetEnabled sets provider enabled status
func (p *MockProvider) SetEnabled(enabled bool) {
	p.enabled = enabled
}

// ListModels returns available models
func (p *MockProvider) ListModels() []ModelInfo {
	models := []ModelInfo{
		{
			ID:           p.name + ".chat",
			Name:         p.name + " Chat Model",
			Provider:     p.name,
			Type:         "chat",
			Description:  "Mock chat model for " + p.name,
			MaxTokens:    8192,
			Capabilities: []string{"text", "code"},
			Pricing: map[string]float64{
				"prompt":     0.0015,
				"completion": 0.002,
			},
			IsActive: true,
		},
	}
	return models
}

// TestConnection tests provider connection
func (p *MockProvider) TestConnection() error {
	if !p.enabled {
		return fmt.Errorf("provider %s is disabled", p.name)
	}
	return nil
}

// CreateDefaultProviderRegistry creates a registry with default providers
func CreateDefaultProviderRegistry() *ProviderRegistry {
	registry := NewProviderRegistry()

	// Register real providers
	registry.Register(NewOllamaProvider())
	registry.Register(NewOpenAIProvider())
	registry.Register(NewAnthropicProvider())

	// Register mock providers for MVP
	registry.Register(NewMockProvider("local"))

	return registry
}
