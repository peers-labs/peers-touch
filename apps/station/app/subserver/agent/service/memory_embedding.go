package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"io"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

const defaultMemoryEmbeddingDims = 384
const defaultProviderEmbeddingTimeout = 60 * time.Second

// MemoryEmbeddingProvider is the pluggable embedding surface used by memory
// indexing and retrieval. Production providers can call any model/backend; the
// default hash provider is only a deterministic local fallback.
type MemoryEmbeddingProvider interface {
	Name() string
	Model() string
	Dimensions() int
	Embed(ctx context.Context, text string) ([]float64, error)
}

type HashMemoryEmbeddingProvider struct {
	dimensions int
}

func NewHashMemoryEmbeddingProvider(dimensions int) *HashMemoryEmbeddingProvider {
	if dimensions <= 0 {
		dimensions = defaultMemoryEmbeddingDims
	}
	return &HashMemoryEmbeddingProvider{dimensions: dimensions}
}

func (p *HashMemoryEmbeddingProvider) Name() string  { return "local" }
func (p *HashMemoryEmbeddingProvider) Model() string { return "token-hash" }
func (p *HashMemoryEmbeddingProvider) Dimensions() int {
	return p.dimensions
}

func (p *HashMemoryEmbeddingProvider) Embed(_ context.Context, text string) ([]float64, error) {
	vector := make([]float64, p.dimensions)
	tokens := strings.Fields(strings.ToLower(text))
	if len(tokens) == 0 {
		tokens = []string{strings.ToLower(strings.TrimSpace(text))}
	}
	for _, token := range tokens {
		token = strings.Trim(token, ".,;:!?()[]{}\"'`，。！？；：（）【】")
		if token == "" {
			continue
		}
		h := fnv.New32a()
		_, _ = h.Write([]byte(token))
		idx := int(h.Sum32() % uint32(p.dimensions))
		vector[idx] += 1
	}
	return normalizeEmbedding(vector), nil
}

type ProviderMemoryEmbeddingProvider struct {
	providerID string
	model      string
	dimensions int
	httpClient *http.Client
}

func NewProviderMemoryEmbeddingProvider(providerID, model string, dimensions int) *ProviderMemoryEmbeddingProvider {
	if dimensions <= 0 {
		dimensions = defaultMemoryEmbeddingDims
	}
	return &ProviderMemoryEmbeddingProvider{
		providerID: strings.TrimSpace(providerID),
		model:      strings.TrimSpace(model),
		dimensions: dimensions,
		httpClient: &http.Client{Timeout: defaultProviderEmbeddingTimeout},
	}
}

func (p *ProviderMemoryEmbeddingProvider) Name() string {
	if p.providerID == "" {
		return "provider"
	}
	return "provider:" + p.providerID
}

func (p *ProviderMemoryEmbeddingProvider) Model() string {
	if p.model != "" {
		return p.model
	}
	return "provider-default"
}

func (p *ProviderMemoryEmbeddingProvider) Dimensions() int {
	return p.dimensions
}

func (p *ProviderMemoryEmbeddingProvider) Embed(ctx context.Context, text string) ([]float64, error) {
	if p.providerID == "" {
		return nil, fmt.Errorf("embedding provider_id is required")
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return make([]float64, p.dimensions), nil
	}

	provider, err := p.loadProvider(ctx)
	if err != nil {
		return nil, err
	}

	providerHelper := NewProviderService(nil)
	baseURL, apiKey := providerHelper.extractConfig(provider.Config, provider.KeyVaults)
	providerType, err := explicitProviderType(provider.Protocol)
	if err != nil {
		return nil, err
	}
	model := p.resolveModel(provider)
	if model == "" {
		return nil, fmt.Errorf("embedding model is required for provider %q", p.providerID)
	}

	switch providerType {
	case providerTypeOllama:
		if baseURL == "" {
			baseURL = "http://127.0.0.1:11434"
		}
		return p.callOllamaEmbedding(ctx, baseURL, model, text)
	case providerTypeAnthropic:
		return nil, fmt.Errorf("provider %q does not support embeddings", providerTypeAnthropic)
	default:
		if baseURL == "" {
			return nil, fmt.Errorf("embedding provider base_url is empty for provider %q", p.providerID)
		}
		return p.callOpenAIEmbedding(ctx, baseURL, apiKey, model, text)
	}
}

func (p *ProviderMemoryEmbeddingProvider) loadProvider(ctx context.Context) (*persistence.AgentProvider, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName(agentDBName))
	if err != nil {
		return nil, err
	}
	var provider persistence.AgentProvider
	if err := db.WithContext(ctx).Where("id = ? AND enabled = ?", p.providerID, true).First(&provider).Error; err != nil {
		return nil, err
	}
	return &provider, nil
}

func (p *ProviderMemoryEmbeddingProvider) resolveModel(provider *persistence.AgentProvider) string {
	if p.model != "" {
		return p.model
	}
	if model := embeddingModelFromConfig(provider.Config); model != "" {
		return model
	}
	return strings.TrimSpace(provider.CheckModel)
}

func embeddingModelFromConfig(configJSON json.RawMessage) string {
	cfg := map[string]any{}
	_ = json.Unmarshal(configJSON, &cfg)
	for _, key := range []string{"embedding_model", "embeddingModel", "embeddings_model", "embeddingsModel", "model"} {
		if value := strings.TrimSpace(asProviderString(cfg[key])); value != "" {
			return value
		}
	}
	return ""
}

func (p *ProviderMemoryEmbeddingProvider) callOpenAIEmbedding(ctx context.Context, baseURL, apiKey, model, text string) ([]float64, error) {
	endpointBase := strings.TrimRight(baseURL, "/")
	if strings.HasSuffix(endpointBase, "/embeddings") {
		// Use the configured endpoint as-is.
	} else if strings.HasSuffix(endpointBase, "/v1") {
		endpointBase += "/embeddings"
	} else {
		endpointBase += "/v1/embeddings"
	}

	payload := map[string]any{
		"model":           model,
		"input":           text,
		"encoding_format": "float",
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpointBase, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, &ProviderHTTPError{
			StatusCode: resp.StatusCode,
			Body:       string(bodyBytes),
			Provider:   providerTypeOpenAI,
		}
	}

	var data struct {
		Data []struct {
			Embedding []float64 `json:"embedding"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxResponseBytes)).Decode(&data); err != nil {
		return nil, err
	}
	if len(data.Data) == 0 || len(data.Data[0].Embedding) == 0 {
		return nil, fmt.Errorf("empty embedding response")
	}
	return normalizeEmbedding(data.Data[0].Embedding), nil
}

func (p *ProviderMemoryEmbeddingProvider) callOllamaEmbedding(ctx context.Context, baseURL, model, text string) ([]float64, error) {
	vector, err := p.callOllamaEmbedEndpoint(ctx, strings.TrimRight(baseURL, "/")+"/api/embed", map[string]any{
		"model": model,
		"input": text,
	})
	if err == nil {
		return vector, nil
	}
	return p.callOllamaEmbedEndpoint(ctx, strings.TrimRight(baseURL, "/")+"/api/embeddings", map[string]any{
		"model":  model,
		"prompt": text,
	})
}

func (p *ProviderMemoryEmbeddingProvider) callOllamaEmbedEndpoint(ctx context.Context, endpoint string, payload map[string]any) ([]float64, error) {
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, &ProviderHTTPError{
			StatusCode: resp.StatusCode,
			Body:       string(bodyBytes),
			Provider:   providerTypeOllama,
		}
	}

	var data struct {
		Embedding  []float64   `json:"embedding"`
		Embeddings [][]float64 `json:"embeddings"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxResponseBytes)).Decode(&data); err != nil {
		return nil, err
	}
	if len(data.Embedding) > 0 {
		return normalizeEmbedding(data.Embedding), nil
	}
	if len(data.Embeddings) > 0 && len(data.Embeddings[0]) > 0 {
		return normalizeEmbedding(data.Embeddings[0]), nil
	}
	return nil, fmt.Errorf("empty embedding response")
}

func normalizeEmbedding(vector []float64) []float64 {
	var norm float64
	for _, value := range vector {
		norm += value * value
	}
	if norm == 0 {
		return vector
	}
	norm = math.Sqrt(norm)
	for i := range vector {
		vector[i] /= norm
	}
	return vector
}

func embeddingVectorLiteral(vector []float64) string {
	var b strings.Builder
	b.WriteByte('[')
	for i, value := range vector {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(fmt.Sprintf("%.6f", value))
	}
	b.WriteByte(']')
	return b.String()
}
