package aibox

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/peers-touch/peers-touch/station/frame/core/logger"
)

// OllamaProvider implements the Provider interface for Ollama
type OllamaProvider struct {
	name        string
	displayName string
	enabled     bool
	config      map[string]interface{}
	client      *http.Client
}

// OllamaConfig represents Ollama configuration
type OllamaConfig struct {
	Endpoint string `json:"endpoint"`
	Origins  string `json:"origins"`
}

// OllamaRequest represents a request to Ollama API
type OllamaRequest struct {
	Model    string                 `json:"model"`
	Prompt   string                 `json:"prompt"`
	Stream   bool                   `json:"stream"`
	Options  map[string]interface{} `json:"options,omitempty"`
	Context  []int                  `json:"context,omitempty"`
	Template string                 `json:"template,omitempty"`
}

// OllamaResponse represents a response from Ollama API
type OllamaResponse struct {
	Model              string    `json:"model"`
	CreatedAt          time.Time `json:"created_at"`
	Response           string    `json:"response"`
	Done               bool      `json:"done"`
	Context            []int     `json:"context,omitempty"`
	TotalDuration      int64     `json:"total_duration,omitempty"`
	LoadDuration       int64     `json:"load_duration,omitempty"`
	PromptEvalCount    int       `json:"prompt_eval_count,omitempty"`
	PromptEvalDuration int64     `json:"prompt_eval_duration,omitempty"`
	EvalCount          int       `json:"eval_count,omitempty"`
	EvalDuration       int64     `json:"eval_duration,omitempty"`
}

// OllamaModel represents a model from Ollama API
type OllamaModel struct {
	Name       string    `json:"name"`
	Size       int64     `json:"size"`
	Digest     string    `json:"digest"`
	ModifiedAt time.Time `json:"modified_at"`
}

// OllamaModelsResponse represents the response from /api/tags endpoint
type OllamaModelsResponse struct {
	Models []OllamaModel `json:"models"`
}

// NewOllamaProvider creates a new Ollama provider
func NewOllamaProvider() *OllamaProvider {
	return &OllamaProvider{
		name:        "ollama",
		displayName: "Ollama",
		enabled:     true,
		config: map[string]interface{}{
			"endpoint": "http://localhost:11434",
			"origins":  "*",
		},
		client: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

// Name returns the provider name
func (p *OllamaProvider) Name() string {
	return p.name
}

// DisplayName returns the display name for UI
func (p *OllamaProvider) DisplayName() string {
	return p.displayName
}

// GenerateResponse generates a response from Ollama
func (p *OllamaProvider) GenerateResponse(ctx context.Context, request *ChatRequest, agent *Agent) (*ChatResponse, error) {
	if !p.enabled {
		return nil, fmt.Errorf("ollama provider is disabled")
	}

	endpoint := p.getEndpoint()
	if endpoint == "" {
		return nil, fmt.Errorf("ollama endpoint not configured")
	}

	// Get model from agent configuration or use default
	model := "llama3.2:latest" // Default model
	if agentConfig, err := p.getAgentConfig(agent); err == nil && agentConfig.Model != "" {
		model = agentConfig.Model
	}

	// Prepare Ollama request
	ollamaReq := OllamaRequest{
		Model:  model,
		Prompt: request.Message,
		Stream: false, // For now, we don't support streaming
		Options: map[string]interface{}{
			"temperature": p.getTemperature(request),
			"num_predict": p.getMaxTokens(request),
		},
	}

	// Convert to JSON
	reqBody, err := json.Marshal(ollamaReq)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	// Make HTTP request
	url := fmt.Sprintf("%s/api/generate", endpoint)
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(reqBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("failed to make request to ollama: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("ollama API error (status %d): %s", resp.StatusCode, string(body))
	}

	// Parse response
	var ollamaResp OllamaResponse
	if err := json.NewDecoder(resp.Body).Decode(&ollamaResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	// Create chat response
	chatResp := &ChatResponse{
		MessageID:      generateID(),
		ConversationID: request.ConversationID,
		Content:        ollamaResp.Response,
		Role:           "assistant",
		Model:          model,
		TokenCount:     ollamaResp.EvalCount,
		Metadata: map[string]interface{}{
			"total_duration":       ollamaResp.TotalDuration,
			"load_duration":        ollamaResp.LoadDuration,
			"prompt_eval_count":    ollamaResp.PromptEvalCount,
			"prompt_eval_duration": ollamaResp.PromptEvalDuration,
			"eval_count":           ollamaResp.EvalCount,
			"eval_duration":        ollamaResp.EvalDuration,
		},
		Timestamp: time.Now(),
	}

	return chatResp, nil
}

// ValidateConfig validates the Ollama provider configuration
func (p *OllamaProvider) ValidateConfig() error {
	endpoint := p.getEndpoint()
	if endpoint == "" {
		return fmt.Errorf("endpoint is required")
	}

	// Test connection to Ollama
	return p.TestConnection()
}

// SetConfig sets provider configuration
func (p *OllamaProvider) SetConfig(config map[string]interface{}) error {
	p.config = config
	return nil
}

// GetConfig gets provider configuration
func (p *OllamaProvider) GetConfig() map[string]interface{} {
	return p.config
}

// GetConfigFields returns the configuration fields for Ollama provider
func (p *OllamaProvider) GetConfigFields() []ConfigField {
	return []ConfigField{
		{
			Name:         "endpoint",
			Type:         "string",
			Required:     true,
			Description:  "Ollama server endpoint URL",
			EnvVar:       "OLLAMA_ENDPOINT",
			DefaultValue: "http://localhost:11434",
		},
		{
			Name:         "origins",
			Type:         "string",
			Required:     false,
			Description:  "CORS origins for the Ollama server",
			EnvVar:       "OLLAMA_ORIGINS",
			DefaultValue: "*",
		},
	}
}

// IsEnabled checks if provider is enabled
func (p *OllamaProvider) IsEnabled() bool {
	return p.enabled
}

// SetEnabled sets provider enabled status
func (p *OllamaProvider) SetEnabled(enabled bool) {
	p.enabled = enabled
}

// ListModels returns available models from Ollama
func (p *OllamaProvider) ListModels() []ModelInfo {
	if !p.enabled {
		return []ModelInfo{}
	}

	endpoint := p.getEndpoint()
	if endpoint == "" {
		logger.Log(logger.WarnLevel, "Ollama endpoint not configured")
		return p.getDefaultModels()
	}

	// Try to get models from Ollama API
	models, err := p.fetchModelsFromAPI(endpoint)
	if err != nil {
		logger.Logf(logger.WarnLevel, "Failed to fetch models from Ollama: %v", err)
		return p.getDefaultModels()
	}

	return models
}

// TestConnection tests connection to Ollama
func (p *OllamaProvider) TestConnection() error {
	if !p.enabled {
		return fmt.Errorf("ollama provider is disabled")
	}

	endpoint := p.getEndpoint()
	if endpoint == "" {
		return fmt.Errorf("endpoint not configured")
	}

	// Test connection by calling /api/tags
	url := fmt.Sprintf("%s/api/tags", endpoint)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to connect to ollama: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("ollama API returned status %d", resp.StatusCode)
	}

	return nil
}

// Helper methods

func (p *OllamaProvider) getEndpoint() string {
	if endpoint, ok := p.config["endpoint"].(string); ok {
		return endpoint
	}
	return "http://localhost:11434"
}

func (p *OllamaProvider) getTemperature(request *ChatRequest) float32 {
	if request.Temperature > 0 {
		return request.Temperature
	}
	return 0.7 // Default temperature
}

func (p *OllamaProvider) getMaxTokens(request *ChatRequest) int {
	if request.MaxTokens > 0 {
		return request.MaxTokens
	}
	return 2048 // Default max tokens
}

func (p *OllamaProvider) getAgentConfig(agent *Agent) (*AgentConfiguration, error) {
	// This is a placeholder - in a real implementation, you would fetch
	// the agent configuration from the database
	return &AgentConfiguration{
		Model: "llama3.2:latest",
	}, nil
}

func (p *OllamaProvider) fetchModelsFromAPI(endpoint string) ([]ModelInfo, error) {
	url := fmt.Sprintf("%s/api/tags", endpoint)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	var modelsResp OllamaModelsResponse
	if err := json.NewDecoder(resp.Body).Decode(&modelsResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	// Convert Ollama models to ModelInfo
	models := make([]ModelInfo, 0, len(modelsResp.Models))
	for _, model := range modelsResp.Models {
		modelInfo := ModelInfo{
			ID:           model.Name,
			Name:         p.formatModelName(model.Name),
			Provider:     "ollama",
			Type:         "chat",
			Description:  fmt.Sprintf("Local model: %s", model.Name),
			MaxTokens:    p.getModelMaxTokens(model.Name),
			Capabilities: []string{"text"},
			Pricing:      map[string]float64{}, // Local models are free
			IsActive:     true,
		}
		models = append(models, modelInfo)
	}

	return models, nil
}

func (p *OllamaProvider) getDefaultModels() []ModelInfo {
	// Return default models based on our metadata file
	return []ModelInfo{
		{
			ID:           "llama3.2:latest",
			Name:         "Llama 3.2",
			Provider:     "ollama",
			Type:         "chat",
			Description:  "Meta's Llama 3.2 model",
			MaxTokens:    128000,
			Capabilities: []string{"text"},
			Pricing:      map[string]float64{},
			IsActive:     true,
		},
		{
			ID:           "llama3.1:latest",
			Name:         "Llama 3.1",
			Provider:     "ollama",
			Type:         "chat",
			Description:  "Meta's Llama 3.1 model",
			MaxTokens:    128000,
			Capabilities: []string{"text"},
			Pricing:      map[string]float64{},
			IsActive:     true,
		},
		{
			ID:           "mistral:latest",
			Name:         "Mistral",
			Provider:     "ollama",
			Type:         "chat",
			Description:  "Mistral AI model",
			MaxTokens:    32768,
			Capabilities: []string{"text"},
			Pricing:      map[string]float64{},
			IsActive:     true,
		},
		{
			ID:           "qwen2.5:latest",
			Name:         "Qwen 2.5",
			Provider:     "ollama",
			Type:         "chat",
			Description:  "Alibaba's Qwen 2.5 model",
			MaxTokens:    32768,
			Capabilities: []string{"text"},
			Pricing:      map[string]float64{},
			IsActive:     true,
		},
	}
}

func (p *OllamaProvider) formatModelName(modelName string) string {
	// Convert model names like "llama3.2:latest" to "Llama 3.2"
	name := strings.Split(modelName, ":")[0]
	name = strings.ReplaceAll(name, "llama", "Llama ")
	name = strings.ReplaceAll(name, "mistral", "Mistral")
	name = strings.ReplaceAll(name, "qwen", "Qwen ")
	name = strings.ReplaceAll(name, "gemma", "Gemma ")
	name = strings.ReplaceAll(name, "phi", "Phi-")
	return name
}

func (p *OllamaProvider) getModelMaxTokens(modelName string) int {
	// Return max tokens based on model name
	if strings.Contains(modelName, "llama3") {
		return 128000
	}
	if strings.Contains(modelName, "mistral") {
		return 32768
	}
	if strings.Contains(modelName, "qwen") {
		return 32768
	}
	if strings.Contains(modelName, "gemma") {
		return 8192
	}
	if strings.Contains(modelName, "phi") {
		return 128000
	}
	return 8192 // Default
}
