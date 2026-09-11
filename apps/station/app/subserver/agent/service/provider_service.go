// provider_service.go — LLM provider call service for the agent turn loop.
//
// Changelog:
// 2026-04-11 — Initial implementation: ProviderService wrapping LLM API calls
//   for Ollama, OpenAI-compatible, and Anthropic providers. Loads provider
//   configuration from the agent database (agent_providers table), auto-detects
//   provider type, and integrates with PromptCachingService for Anthropic
//   cache_control support. Returns structured ProviderCallResponse with token
//   usage metrics.
// 2026-04-11 — Migration: replaced ai_chat DB dependency with agent-owned
//   agent_providers table via persistence.AgentProvider model. Zero cross-domain
//   database coupling.
// 2026-04-11 — Bug fixes (P0):
//   1. HTTP status code not checked after provider Do() calls — added
//      ProviderHTTPError type and status checks in callOllama, callOpenAI,
//      callAnthropic so ErrorClassifier's Priority 1 pipeline activates.
//   2. Anthropic non-cached path used toAPIMessages (plain string content)
//      instead of the content-block format required by the Messages API —
//      added toAnthropicMessages producing [{"type":"text","text":"..."}].
//   3. OpenAI URL builder double-appended /v1/chat/completions when baseURL
//      already contained the full path — added HasSuffix guard.
// 2026-06-17 — Agent rebuild P0-1: added provider-token streaming parity for
//   Ollama NDJSON and Anthropic Messages SSE, both feeding the shared
//   ProviderDeltaSink used by the TurnService event stream.

package service

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const (
	providerTypeOllama    = "ollama"
	providerTypeOpenAI    = "openai"
	providerTypeAnthropic = "anthropic"
	providerRuntimeCLI    = "cli"

	anthropicAPIVersion = "2023-06-01"
	defaultMaxTokens    = 4096
	maxResponseBytes    = 2 * 1024 * 1024 // 2 MiB safety limit on response body

	// HTTP client timeout for all provider calls.
	providerHTTPTimeout = 120 * time.Second
)

// apiVersionSuffix matches a base URL that already ends in a version segment,
// e.g. "/v1", "/openai/v1", or Ark's "/api/v3". The version must be the final
// path segment so "/v1/chat/completions" does not match it.
var apiVersionSuffix = regexp.MustCompile(`(^|/)v\d+$`)

// #region debug-point A-E:ark-provider-request
func reportArkProviderRequestDebug(
	hypothesisID, stage, endpoint string,
	body []byte,
	payload map[string]any,
	data map[string]any,
) {
	if !strings.Contains(endpoint, "ark-cn-beijing.bytedance.net") {
		return
	}
	messageRoles := make([]string, 0)
	messageLengths := make([]int, 0)
	if messages, ok := payload["messages"].([]openAIMessage); ok {
		for _, message := range messages {
			messageRoles = append(messageRoles, message.Role)
			messageLengths = append(messageLengths, len(message.Content))
		}
	}
	eventData := map[string]any{
		"endpoint":       endpoint,
		"bodyBytes":      len(body),
		"bodyHash":       fmt.Sprintf("%x", sha256.Sum256(body)),
		"messageRoles":   messageRoles,
		"messageLengths": messageLengths,
		"maxTokens":      payload["max_tokens"],
		"stream":         payload["stream"],
		"thinking":       payload["thinking"],
	}
	if tools, ok := payload["tools"].([]openAIToolDefinition); ok {
		eventData["toolCount"] = len(tools)
	} else {
		eventData["toolCount"] = 0
	}
	for key, value := range data {
		eventData[key] = value
	}
	event, err := json.Marshal(map[string]any{
		"sessionId":    "ark-provider-request",
		"runId":        "post-fix",
		"hypothesisId": hypothesisID,
		"location":     "provider_service.go:callOpenAIStream",
		"msg":          "[DEBUG] " + stage,
		"data":         eventData,
		"ts":           time.Now().UnixMilli(),
	})
	if err != nil {
		return
	}
	go func() {
		request, requestErr := http.NewRequest(
			http.MethodPost,
			"http://10.4.55.179:7784/event",
			bytes.NewReader(event),
		)
		if requestErr != nil {
			return
		}
		request.Header.Set("Content-Type", "application/json")
		client := &http.Client{Timeout: 500 * time.Millisecond}
		response, requestErr := client.Do(request)
		if requestErr == nil {
			_ = response.Body.Close()
		}
	}()
}

// #endregion

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

// ProviderCallRequest carries all inputs needed to invoke a single LLM completion.
type ProviderCallRequest struct {
	ProviderID                      string
	Model                           string
	SystemPrompt                    string
	Messages                        []domain.Message
	Tools                           []*domain.ToolDefinition
	UserID                          string
	ProviderType                    string // "ollama", "openai", "anthropic", or empty for auto-detect
	Effort                          string // reasoning effort: "low" | "medium" | "high"
	ThinkingMode                    domain.ThinkingMode
	MaxOutputTokens                 int
	DeltaSink                       ProviderDeltaSink
	ExpectedProviderConfigVersion   string
	ExpectedCapabilitySourceVersion string
	BeforeDispatch                  func(context.Context) error
}

type ProviderDeltaSink func(ctx context.Context, delta ProviderDelta) error

type ProviderDelta struct {
	Type    string
	Content string
}

type ProviderToolCall struct {
	ID        string
	Name      string
	Arguments string
}

// ProviderCallResponse captures the structured result of an LLM call,
// including token usage and cache hit status.
type ProviderCallResponse struct {
	Content         string
	ToolCalls       []ProviderToolCall
	Model           string
	Provider        string
	InputTokens     int
	OutputTokens    int
	BilledMoney     float64
	BillingSource   string
	BillingCurrency string
	CacheHit        bool
	FinishReason    string
	Streamed        bool
}

// ProviderHTTPError wraps HTTP-level errors from LLM provider APIs,
// carrying the status code for ErrorClassifier's Priority 1 pipeline.
//
// Changelog:
// 2026-04-11 — Added: provider HTTP status was not checked after Do(),
//
//	causing ErrorClassifier's HTTP-status-based classification (Priority 1)
//	to never trigger. This type propagates the raw status code upward.
type ProviderHTTPError struct {
	StatusCode int
	Body       string
	Provider   string
}

func (e *ProviderHTTPError) Error() string {
	return fmt.Sprintf("provider %s returned HTTP %d: %s", e.Provider, e.StatusCode, e.Body)
}

// ---------------------------------------------------------------------------
// Provider DB access
// ---------------------------------------------------------------------------

// loadProvider queries the agent database for the provider record by ID.
func (s *ProviderService) loadProvider(ctx context.Context, providerID string) (*persistence.AgentProvider, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		logger.Errorf(ctx, "agent database not available: %v", err)
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to open agent db", err)
	}

	var provider persistence.AgentProvider
	if err := db.WithContext(ctx).Where("id = ?", providerID).First(&provider).Error; err != nil {
		logger.Errorf(ctx, "provider not found: provider_id=%s err=%v", providerID, err)
		return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound,
			"provider not found", err)
	}

	return &provider, nil
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

// ProviderService orchestrates LLM provider calls for the agent turn loop.
// It loads provider configuration from the agent database (agent_providers table),
// detects the provider type, applies prompt caching for Anthropic, and dispatches
// the request to the appropriate API endpoint.
type ProviderService struct {
	cachingService *PromptCachingService
	httpClient     *http.Client
}

// NewProviderService creates a ProviderService with the given caching dependency.
func NewProviderService(cachingService *PromptCachingService) *ProviderService {
	return &ProviderService{
		cachingService: cachingService,
		httpClient: &http.Client{
			Timeout: providerHTTPTimeout,
		},
	}
}

// ---------------------------------------------------------------------------
// Call — main entry point
// ---------------------------------------------------------------------------

// Call loads the provider record, extracts credentials, detects the provider
// type, and dispatches the request to the matching LLM endpoint.
func (s *ProviderService) Call(ctx context.Context, req *ProviderCallRequest) (*ProviderCallResponse, error) {
	if req == nil {
		return nil, errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"provider call request is required",
			nil,
		)
	}
	authorityFieldCount := 0
	if req.ExpectedProviderConfigVersion != "" {
		authorityFieldCount++
	}
	if req.ExpectedCapabilitySourceVersion != "" {
		authorityFieldCount++
	}
	if req.BeforeDispatch != nil {
		authorityFieldCount++
	}
	if authorityFieldCount != 0 && authorityFieldCount != 3 {
		return nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"provider execution authority is incomplete",
			nil,
		)
	}
	if req.ProviderID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			"provider_id is required", nil)
	}

	// Step 1 — Load provider config from agent DB.
	provider, err := s.loadProvider(ctx, req.ProviderID)
	if err != nil {
		return nil, err
	}
	if !provider.Enabled {
		return nil, errcode.New(
			errcode.AgentProviderDisabled,
			http.StatusBadRequest,
			"provider is disabled before execution",
			nil,
		)
	}
	if strings.EqualFold(strings.TrimSpace(provider.RuntimeKind), providerRuntimeCLI) ||
		strings.EqualFold(strings.TrimSpace(provider.SourceType), providerRuntimeCLI) {
		return nil, errcode.New(errcode.AgentSecurityViolation, http.StatusForbidden,
			"cli provider execution is owned by Desktop runtime", nil)
	}

	// Step 2 — Extract base_url and api_key from provider record.
	baseURL, apiKey := s.extractConfig(provider.Config, provider.KeyVaults)
	if baseURL == "" {
		baseURL = strings.TrimSpace(provider.BaseURL)
	}

	// Step 3 — Resolve the explicit persisted protocol. Provider names and URLs
	// are display/configuration facts and must not infer execution capability.
	providerType, protocolErr := explicitProviderType(provider.Protocol)
	if protocolErr != nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			"provider protocol is not supported by the active Agent profile", protocolErr)
	}
	reasoningSupported := false
	if req.ExpectedCapabilitySourceVersion != "" {
		current, authorityErr := validateExpectedProviderAuthority(ctx, req, provider)
		if authorityErr != nil {
			return nil, authorityErr
		}
		reasoningSupported = current.Capabilities.GetRuntime().GetReasoning()
	}

	// Step 4 — Resolve model name: prefer request, then fall back to provider default.
	model := req.Model
	if model == "" {
		model = provider.CheckModel
	}
	thinkingMode, modeErr := normalizeThinkingMode(req.ThinkingMode)
	if modeErr != nil {
		return nil, modeErr
	}
	if req.ExpectedCapabilitySourceVersion == "" {
		reasoningSupported = providerThinkingControl(provider.Name, model) != ""
	}
	if thinkingMode != domain.ThinkingModeAuto &&
		(providerType != providerTypeOpenAI || !reasoningSupported) {
		return nil, errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"explicit thinking mode is unsupported by the selected provider",
			nil,
		)
	}

	maxOutputTokens := req.MaxOutputTokens
	if maxOutputTokens <= 0 {
		maxOutputTokens = defaultMaxTokens
	}
	if req.BeforeDispatch != nil {
		if err := req.BeforeDispatch(ctx); err != nil {
			return nil, err
		}
		finalProvider, err := s.loadProvider(ctx, req.ProviderID)
		if err != nil {
			return nil, err
		}
		if _, err := validateExpectedProviderAuthority(
			ctx,
			req,
			finalProvider,
		); err != nil {
			return nil, err
		}
	}

	logger.Infof(ctx, "provider call: provider_id=%s type=%s model=%s messages=%d",
		req.ProviderID, providerType, model, len(req.Messages))

	// Step 5 — Dispatch to the appropriate endpoint.
	var resp *ProviderCallResponse

	switch providerType {
	case providerTypeOllama:
		if baseURL == "" {
			baseURL = "http://127.0.0.1:11434"
		}
		resp, err = s.callOllama(ctx, baseURL, model, req.SystemPrompt, req.Messages, maxOutputTokens, req.DeltaSink)

	case providerTypeAnthropic:
		if baseURL == "" {
			baseURL = "https://api.anthropic.com"
		}

		// Apply prompt caching for Anthropic providers.
		var cachingResult *PromptCachingResult
		if s.cachingService != nil {
			cachingResult = s.cachingService.Apply(ctx, req.SystemPrompt, req.Messages, providerType)
		}

		resp, err = s.callAnthropic(ctx, baseURL, apiKey, model, req.SystemPrompt, req.Messages, cachingResult, maxOutputTokens, req.DeltaSink)

	default:
		// OpenAI-compatible is the default fallback.
		if baseURL == "" {
			return nil, errcode.New(errcode.AgentProviderFailed, http.StatusBadGateway,
				"provider base_url is empty for openai-compatible provider", nil)
		}
		resp, err = s.callOpenAI(
			ctx,
			baseURL,
			apiKey,
			model,
			req.SystemPrompt,
			req.Messages,
			req.Effort,
			thinkingMode,
			maxOutputTokens,
			req.Tools,
			req.DeltaSink,
		)
	}

	if err != nil {
		logger.Errorf(ctx, "provider call failed: provider_id=%s type=%s model=%s err=%v",
			req.ProviderID, providerType, model, err)
		return nil, errcode.New(errcode.AgentProviderFailed, http.StatusBadGateway,
			"provider call failed", err)
	}

	// Populate provider metadata on the response.
	resp.Provider = providerType
	if resp.Model == "" {
		resp.Model = model
	}

	logger.Infof(ctx, "provider call completed: provider_id=%s model=%s input_tokens=%d output_tokens=%d cache_hit=%v",
		req.ProviderID, resp.Model, resp.InputTokens, resp.OutputTokens, resp.CacheHit)

	return resp, nil
}

func validateExpectedProviderAuthority(
	ctx context.Context,
	req *ProviderCallRequest,
	provider *persistence.AgentProvider,
) (*AdmissionSnapshot, error) {
	if req == nil ||
		provider == nil ||
		strings.TrimSpace(req.UserID) == "" ||
		strings.TrimSpace(req.ProviderType) == "" ||
		strings.TrimSpace(req.Model) == "" {
		return nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"capability source validation requires actor, provider, and model",
			nil,
		)
	}
	if fmt.Sprintf("%d", provider.Version) != req.ExpectedProviderConfigVersion ||
		provider.Name != strings.TrimSpace(req.ProviderType) {
		return nil, errcode.New(
			errcode.AgentVersionConflict,
			http.StatusConflict,
			"provider execution authority differs from the pinned runtime",
			nil,
		)
	}
	current, resolveErr := NewRuntimeAdmissionResolver(
		NewProviderConfigService(),
		NewModelConfigService(),
	).Resolve(ctx, req.UserID, req.ProviderType, req.Model)
	if resolveErr != nil {
		return nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"runtime capability source changed before execution",
			resolveErr,
		)
	}
	if current.Capabilities.GetProvenance().GetSourceVersion() !=
		req.ExpectedCapabilitySourceVersion {
		return nil, errcode.New(
			errcode.AgentVersionConflict,
			http.StatusConflict,
			"runtime capability source changed before execution",
			nil,
		)
	}
	if req.DeltaSink != nil &&
		!current.Capabilities.GetRuntime().GetStreaming() {
		return nil, errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"selected runtime does not support streaming",
			nil,
		)
	}
	if len(req.Tools) > 0 &&
		!current.Capabilities.GetAgentic().GetNativeTools() {
		return nil, errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"selected runtime does not support native tools",
			nil,
		)
	}
	return current, nil
}

func providerThinkingControl(providerID string, modelID string) string {
	catalogProvider := catalog.Find(strings.TrimSpace(providerID))
	if catalogProvider == nil {
		return ""
	}
	for _, catalogModel := range catalogProvider.Models {
		if catalogModel.ID == strings.TrimSpace(modelID) {
			return strings.TrimSpace(catalogModel.ThinkingControl)
		}
	}
	return ""
}

func explicitProviderType(protocol string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(protocol)) {
	case "openai-compatible", "openai":
		return providerTypeOpenAI, nil
	case providerTypeAnthropic:
		return providerTypeAnthropic, nil
	case providerTypeOllama:
		return providerTypeOllama, nil
	default:
		return "", fmt.Errorf("unsupported provider protocol %q", protocol)
	}
}

// ---------------------------------------------------------------------------
// Config extraction
// ---------------------------------------------------------------------------

// extractConfig reads base_url from the provider's Config JSON and api_key
// from the provider's KeyVaults (base64-encoded JSON).
func (s *ProviderService) extractConfig(configJSON json.RawMessage, keyVaults string) (baseURL, apiKey string) {

	// Parse base_url from config JSON.
	cfg := map[string]any{}
	_ = json.Unmarshal(configJSON, &cfg)

	baseURL = asProviderString(cfg["base_url"])
	if baseURL != "" && !strings.HasPrefix(baseURL, "http://") && !strings.HasPrefix(baseURL, "https://") {
		baseURL = "http://" + baseURL
	}

	// Decode KeyVaults: try base64 first, then raw JSON.
	rawKeyVault := keyVaults
	if decoded, ok := decodeMaybeBase64Provider(rawKeyVault); ok {
		rawKeyVault = decoded
	}

	kv := map[string]any{}
	_ = json.Unmarshal([]byte(rawKeyVault), &kv)

	apiKey = asProviderString(kv["api_key"])
	if apiKey == "" {
		apiKey = asProviderString(kv["key"])
	}
	if apiKey == "" {
		apiKey = asProviderString(kv["token"])
	}

	return strings.TrimSpace(baseURL), strings.TrimSpace(apiKey)
}

// ---------------------------------------------------------------------------
// Ollama endpoint
// ---------------------------------------------------------------------------

// callOllama invokes the Ollama /api/chat endpoint with the given system
// prompt and conversation messages.
func (s *ProviderService) callOllama(
	ctx context.Context,
	baseURL, model string,
	systemPrompt string,
	messages []domain.Message,
	maxOutputTokens int,
	deltaSink ProviderDeltaSink,
) (*ProviderCallResponse, error) {

	endpoint := strings.TrimRight(baseURL, "/") + "/api/chat"

	// Build message slice: prepend system prompt, then conversation history.
	apiMessages := make([]map[string]string, 0, len(messages)+1)
	if systemPrompt != "" {
		apiMessages = append(apiMessages, map[string]string{
			"role":    "system",
			"content": systemPrompt,
		})
	}
	apiMessages = append(apiMessages, s.toAPIMessages(messages)...)

	payload := map[string]any{
		"model":    model,
		"messages": apiMessages,
		"stream":   false,
		"options":  map[string]any{"num_predict": maxOutputTokens},
	}
	if deltaSink != nil {
		payload["stream"] = true
		return s.callOllamaStream(ctx, endpoint, payload, deltaSink)
	}

	body, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	// Check HTTP status before decoding — surfaces status code for
	// ErrorClassifier's Priority 1 pipeline (Bug 1 fix, 2026-04-11).
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, &ProviderHTTPError{
			StatusCode: resp.StatusCode,
			Body:       string(bodyBytes),
			Provider:   "ollama",
		}
	}

	limited := io.LimitReader(resp.Body, maxResponseBytes)

	var data struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
		Response string `json:"response"`
		Model    string `json:"model"`

		// Ollama token usage (available since v0.1.29+).
		PromptEvalCount int `json:"prompt_eval_count"`
		EvalCount       int `json:"eval_count"`
	}

	if err := json.NewDecoder(limited).Decode(&data); err != nil {
		return nil, err
	}

	content := strings.TrimSpace(data.Message.Content)
	if content == "" {
		content = strings.TrimSpace(data.Response)
	}
	if content == "" {
		return nil, errcode.New(errcode.AgentProviderFailed, http.StatusBadGateway,
			"empty ollama response", nil)
	}

	return &ProviderCallResponse{
		Content:      content,
		Model:        data.Model,
		InputTokens:  data.PromptEvalCount,
		OutputTokens: data.EvalCount,
		FinishReason: "stop",
	}, nil
}

func (s *ProviderService) callOllamaStream(
	ctx context.Context,
	endpoint string,
	payload map[string]any,
	deltaSink ProviderDeltaSink,
) (*ProviderCallResponse, error) {
	body, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, &ProviderHTTPError{
			StatusCode: resp.StatusCode,
			Body:       string(bodyBytes),
			Provider:   "ollama",
		}
	}

	var content strings.Builder
	var model string
	var finishReason string
	var inputTokens int
	var outputTokens int
	scanner := bufio.NewScanner(io.LimitReader(resp.Body, maxResponseBytes))
	scanner.Buffer(make([]byte, 0, 64*1024), maxResponseBytes)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		delta, parsedModel, parsedFinishReason, promptEvalCount, evalCount, ok := parseOllamaStreamDelta(line)
		if parsedModel != "" {
			model = parsedModel
		}
		if parsedFinishReason != "" {
			finishReason = parsedFinishReason
		}
		if promptEvalCount > 0 {
			inputTokens = promptEvalCount
		}
		if evalCount > 0 {
			outputTokens = evalCount
		}
		if !ok || delta.Content == "" {
			continue
		}
		content.WriteString(delta.Content)
		if err := deltaSink(ctx, delta); err != nil {
			return nil, err
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(content.String()) == "" {
		return nil, errcode.New(errcode.AgentProviderFailed, http.StatusBadGateway,
			"empty ollama stream response", nil)
	}

	return &ProviderCallResponse{
		Content:      content.String(),
		Model:        model,
		InputTokens:  inputTokens,
		OutputTokens: outputTokens,
		FinishReason: finishReason,
		Streamed:     true,
	}, nil
}

func parseOllamaStreamDelta(data string) (ProviderDelta, string, string, int, int, bool) {
	var parsed struct {
		Model   string `json:"model"`
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
		Response        string `json:"response"`
		Done            bool   `json:"done"`
		DoneReason      string `json:"done_reason"`
		PromptEvalCount int    `json:"prompt_eval_count"`
		EvalCount       int    `json:"eval_count"`
	}
	if err := json.Unmarshal([]byte(data), &parsed); err != nil {
		return ProviderDelta{}, "", "", 0, 0, false
	}
	content := parsed.Message.Content
	if content == "" {
		content = parsed.Response
	}
	if content == "" {
		return ProviderDelta{}, parsed.Model, parsed.DoneReason, parsed.PromptEvalCount, parsed.EvalCount, false
	}
	return ProviderDelta{Type: "text", Content: content}, parsed.Model, parsed.DoneReason, parsed.PromptEvalCount, parsed.EvalCount, true
}

// ---------------------------------------------------------------------------
// OpenAI-compatible endpoint
// ---------------------------------------------------------------------------

// callOpenAI invokes an OpenAI-compatible /v1/chat/completions endpoint.
func (s *ProviderService) callOpenAI(
	ctx context.Context,
	baseURL, apiKey, model string,
	systemPrompt string,
	messages []domain.Message,
	effort string,
	thinkingMode domain.ThinkingMode,
	maxOutputTokens int,
	tools []*domain.ToolDefinition,
	deltaSink ProviderDeltaSink,
) (*ProviderCallResponse, error) {

	// Build endpoint URL, append /chat/completions if not already present.
	// Handles base URLs that already include the full path (Bug 3 fix, 2026-04-11),
	// end with /v1 (OpenAI standard), or end with any /vN version prefix
	// (e.g. Ark /api/v3, custom gateways).
	endpointBase := strings.TrimRight(baseURL, "/")
	if strings.HasSuffix(endpointBase, "/chat/completions") {
		// Already a full endpoint URL — use as-is.
	} else if apiVersionSuffix.MatchString(endpointBase) {
		// Ends with a version segment like /v1, /v3, /api/v3 → append /chat/completions.
		endpointBase += "/chat/completions"
	} else {
		endpointBase += "/v1/chat/completions"
	}

	// Build messages with native assistant tool_calls and tool result linkage.
	apiMessages := make([]openAIMessage, 0, len(messages)+1)
	if systemPrompt != "" {
		apiMessages = append(apiMessages, openAIMessage{
			Role:    "system",
			Content: systemPrompt,
		})
	}
	convertedMessages, err := toOpenAIMessages(messages)
	if err != nil {
		return nil, err
	}
	apiMessages = append(apiMessages, convertedMessages...)

	payload := map[string]any{
		"model":      model,
		"messages":   apiMessages,
		"max_tokens": maxOutputTokens,
	}
	openAITools, err := toOpenAITools(tools)
	if err != nil {
		return nil, err
	}
	if len(openAITools) > 0 {
		payload["tools"] = openAITools
		payload["tool_choice"] = "auto"
	}
	if thinkingMode != domain.ThinkingModeDisabled &&
		effort != "" &&
		effort != "medium" {
		payload["reasoning_effort"] = effort
	}
	if thinkingMode != domain.ThinkingModeAuto {
		payload["thinking"] = map[string]string{
			"type": string(thinkingMode),
		}
	}
	if deltaSink != nil {
		payload["stream"] = true
		return s.callOpenAIStream(ctx, endpointBase, apiKey, payload, deltaSink)
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

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	// Check HTTP status before decoding — surfaces status code for
	// ErrorClassifier's Priority 1 pipeline (Bug 1 fix, 2026-04-11).
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, &ProviderHTTPError{
			StatusCode: resp.StatusCode,
			Body:       string(bodyBytes),
			Provider:   "openai",
		}
	}

	limited := io.LimitReader(resp.Body, maxResponseBytes)

	var data struct {
		Choices []struct {
			Message struct {
				Content   string           `json:"content"`
				ToolCalls []openAIToolCall `json:"tool_calls"`
			} `json:"message"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
		Model string `json:"model"`
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
		} `json:"usage"`
	}

	if err := json.NewDecoder(limited).Decode(&data); err != nil {
		return nil, err
	}

	if len(data.Choices) == 0 {
		return &ProviderCallResponse{Content: "", Model: data.Model, FinishReason: ""}, nil
	}

	content := data.Choices[0].Message.Content
	if strings.TrimSpace(content) == "" {
		content = ""
	}

	toolCalls, err := providerToolCalls(data.Choices[0].Message.ToolCalls)
	if err != nil {
		return nil, err
	}
	return &ProviderCallResponse{
		Content:      content,
		ToolCalls:    toolCalls,
		Model:        data.Model,
		InputTokens:  data.Usage.PromptTokens,
		OutputTokens: data.Usage.CompletionTokens,
		FinishReason: data.Choices[0].FinishReason,
	}, nil
}

func (s *ProviderService) callOpenAIStream(
	ctx context.Context,
	endpoint, apiKey string,
	payload map[string]any,
	deltaSink ProviderDeltaSink,
) (*ProviderCallResponse, error) {
	body, _ := json.Marshal(payload)
	requestStartedAt := time.Now()
	// #region debug-point A-B-D:ark-provider-request-dispatch
	reportArkProviderRequestDebug("A-B-D", "request-dispatched", endpoint, body, payload, nil)
	// #endregion
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		// #region debug-point C-E:ark-provider-request-error
		reportArkProviderRequestDebug(
			"C-E",
			"request-failed-before-headers",
			endpoint,
			body,
			payload,
			map[string]any{
				"elapsedMs":   time.Since(requestStartedAt).Milliseconds(),
				"errorType":   fmt.Sprintf("%T", err),
				"contextDone": ctx.Err() != nil,
			},
		)
		// #endregion
		return nil, err
	}
	defer resp.Body.Close()
	// #region debug-point C-D:ark-provider-response-headers
	reportArkProviderRequestDebug(
		"C-D",
		"response-headers-received",
		endpoint,
		body,
		payload,
		map[string]any{
			"elapsedMs":  time.Since(requestStartedAt).Milliseconds(),
			"httpStatus": resp.StatusCode,
		},
	)
	// #endregion

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, &ProviderHTTPError{
			StatusCode: resp.StatusCode,
			Body:       string(bodyBytes),
			Provider:   "openai",
		}
	}

	var content strings.Builder
	var model string
	var finishReason string
	var sawDone bool
	var dataLineCount int
	var parsedChunkCount int
	var contentDeltaCount int
	var firstDataReported bool
	toolCalls := make(map[int]*openAIToolCall)
	scanner := bufio.NewScanner(io.LimitReader(resp.Body, maxResponseBytes))
	scanner.Buffer(make([]byte, 0, 64*1024), maxResponseBytes)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ":") {
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		dataLineCount++
		if !firstDataReported {
			firstDataReported = true
			// #region debug-point C:ark-provider-first-stream-data
			reportArkProviderRequestDebug(
				"C",
				"first-stream-data-received",
				endpoint,
				body,
				payload,
				map[string]any{
					"elapsedMs": time.Since(requestStartedAt).Milliseconds(),
				},
			)
			// #endregion
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			sawDone = true
			break
		}
		chunk, ok := parseOpenAIStreamChunk(data)
		if !ok {
			continue
		}
		parsedChunkCount++
		if chunk.Model != "" {
			model = chunk.Model
		}
		if chunk.FinishReason != "" {
			finishReason = chunk.FinishReason
		}
		for _, fragment := range chunk.ToolCalls {
			call := toolCalls[fragment.Index]
			if call == nil {
				call = &openAIToolCall{Type: "function"}
				toolCalls[fragment.Index] = call
			}
			if fragment.ID != "" {
				call.ID = fragment.ID
			}
			if fragment.Type != "" {
				call.Type = fragment.Type
			}
			call.Function.Name += fragment.Function.Name
			call.Function.Arguments += fragment.Function.Arguments
		}
		if chunk.Delta.Content != "" {
			contentDeltaCount++
			if chunk.Delta.Type == "text" {
				content.WriteString(chunk.Delta.Content)
			}
			if err := deltaSink(ctx, chunk.Delta); err != nil {
				return nil, err
			}
		}
	}
	if err := scanner.Err(); err != nil {
		// #region debug-point C-E:ark-provider-stream-error
		reportArkProviderRequestDebug(
			"C-E",
			"stream-scan-failed",
			endpoint,
			body,
			payload,
			map[string]any{
				"elapsedMs":         time.Since(requestStartedAt).Milliseconds(),
				"errorType":         fmt.Sprintf("%T", err),
				"contextDone":       ctx.Err() != nil,
				"dataLineCount":     dataLineCount,
				"parsedChunkCount":  parsedChunkCount,
				"contentDeltaCount": contentDeltaCount,
			},
		)
		// #endregion
		return nil, err
	}
	// #region debug-point B-C:ark-provider-stream-complete
	reportArkProviderRequestDebug(
		"B-C",
		"stream-completed",
		endpoint,
		body,
		payload,
		map[string]any{
			"elapsedMs":         time.Since(requestStartedAt).Milliseconds(),
			"sawDone":           sawDone,
			"finishReason":      finishReason,
			"dataLineCount":     dataLineCount,
			"parsedChunkCount":  parsedChunkCount,
			"contentDeltaCount": contentDeltaCount,
			"contentBytes":      content.Len(),
			"toolCallCount":     len(toolCalls),
		},
	)
	// #endregion
	if !sawDone && finishReason == "" {
		return nil, io.ErrUnexpectedEOF
	}
	structuredCalls, err := orderedProviderToolCalls(toolCalls)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(content.String()) == "" && len(structuredCalls) == 0 {
		return &ProviderCallResponse{
			Content:      "",
			Model:        model,
			FinishReason: finishReason,
			Streamed:     true,
		}, nil
	}
	return &ProviderCallResponse{
		Content:      content.String(),
		ToolCalls:    structuredCalls,
		Model:        model,
		FinishReason: finishReason,
		Streamed:     true,
	}, nil
}

func parseOpenAIStreamDelta(data string) (ProviderDelta, string, string, bool) {
	chunk, ok := parseOpenAIStreamChunk(data)
	return chunk.Delta, chunk.Model, chunk.FinishReason, ok && chunk.Delta.Content != ""
}

type openAIStreamChunk struct {
	Delta        ProviderDelta
	Model        string
	FinishReason string
	ToolCalls    []openAIToolCallDelta
}

func parseOpenAIStreamChunk(data string) (openAIStreamChunk, bool) {
	var parsed struct {
		Model   string `json:"model"`
		Choices []struct {
			Delta struct {
				Content          string                `json:"content"`
				ReasoningContent string                `json:"reasoning_content"`
				ToolCalls        []openAIToolCallDelta `json:"tool_calls"`
			} `json:"delta"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
	}
	if err := json.Unmarshal([]byte(data), &parsed); err != nil || len(parsed.Choices) == 0 {
		return openAIStreamChunk{}, false
	}
	choice := parsed.Choices[0]
	chunk := openAIStreamChunk{
		Model:        parsed.Model,
		FinishReason: choice.FinishReason,
		ToolCalls:    choice.Delta.ToolCalls,
	}
	if choice.Delta.ReasoningContent != "" {
		chunk.Delta = ProviderDelta{Type: "thinking", Content: choice.Delta.ReasoningContent}
		return chunk, true
	}
	if choice.Delta.Content != "" {
		chunk.Delta = ProviderDelta{Type: "text", Content: choice.Delta.Content}
	}
	return chunk, true
}

// ---------------------------------------------------------------------------
// Anthropic endpoint
// ---------------------------------------------------------------------------

// callAnthropic invokes the Anthropic Messages API (POST /v1/messages) with
// optional cache_control breakpoints from the prompt caching service.
func (s *ProviderService) callAnthropic(
	ctx context.Context,
	baseURL, apiKey, model string,
	systemPrompt string,
	messages []domain.Message,
	cachingResult *PromptCachingResult,
	maxOutputTokens int,
	deltaSink ProviderDeltaSink,
) (*ProviderCallResponse, error) {

	endpoint := strings.TrimRight(baseURL, "/") + "/v1/messages"

	// Build the request body. If prompt caching produced a result, use its
	// pre-formatted system content and messages; otherwise build plain format.
	body := map[string]any{
		"model":      model,
		"max_tokens": maxOutputTokens,
	}

	if cachingResult != nil {
		// Use cache-annotated system and messages from the caching service.
		body["system"] = cachingResult.SystemContent
		body["messages"] = cachingResult.Messages
	} else {
		// Plain Anthropic format without caching.
		// Uses content-block format required by the Messages API (Bug 2 fix, 2026-04-11).
		if systemPrompt != "" {
			body["system"] = systemPrompt
		}
		body["messages"] = s.toAnthropicMessages(messages)
	}
	if deltaSink != nil {
		body["stream"] = true
		return s.callAnthropicStream(ctx, endpoint, apiKey, body, deltaSink)
	}

	payload, _ := json.Marshal(body)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", anthropicAPIVersion)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	// Check HTTP status before decoding — surfaces status code for
	// ErrorClassifier's Priority 1 pipeline (Bug 1 fix, 2026-04-11).
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, &ProviderHTTPError{
			StatusCode: resp.StatusCode,
			Body:       string(bodyBytes),
			Provider:   "anthropic",
		}
	}

	limited := io.LimitReader(resp.Body, maxResponseBytes)

	var data struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		Model      string `json:"model"`
		StopReason string `json:"stop_reason"`
		Usage      struct {
			InputTokens          int `json:"input_tokens"`
			OutputTokens         int `json:"output_tokens"`
			CacheReadInputTokens int `json:"cache_read_input_tokens"`
		} `json:"usage"`
	}

	if err := json.NewDecoder(limited).Decode(&data); err != nil {
		return nil, err
	}

	if len(data.Content) == 0 || strings.TrimSpace(data.Content[0].Text) == "" {
		return nil, errcode.New(errcode.AgentProviderFailed, http.StatusBadGateway,
			"empty anthropic response", nil)
	}

	cacheHit := data.Usage.CacheReadInputTokens > 0

	return &ProviderCallResponse{
		Content:      data.Content[0].Text,
		Model:        data.Model,
		InputTokens:  data.Usage.InputTokens,
		OutputTokens: data.Usage.OutputTokens,
		CacheHit:     cacheHit,
		FinishReason: data.StopReason,
	}, nil
}

func (s *ProviderService) callAnthropicStream(
	ctx context.Context,
	endpoint, apiKey string,
	body map[string]any,
	deltaSink ProviderDeltaSink,
) (*ProviderCallResponse, error) {
	payload, _ := json.Marshal(body)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", anthropicAPIVersion)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, &ProviderHTTPError{
			StatusCode: resp.StatusCode,
			Body:       string(bodyBytes),
			Provider:   "anthropic",
		}
	}

	var content strings.Builder
	var model string
	var finishReason string
	var inputTokens int
	var outputTokens int
	scanner := bufio.NewScanner(io.LimitReader(resp.Body, maxResponseBytes))
	scanner.Buffer(make([]byte, 0, 64*1024), maxResponseBytes)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ":") {
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		delta, parsedModel, parsedFinishReason, parsedInputTokens, parsedOutputTokens, ok := parseAnthropicStreamDelta(data)
		if parsedModel != "" {
			model = parsedModel
		}
		if parsedFinishReason != "" {
			finishReason = parsedFinishReason
		}
		if parsedInputTokens > 0 {
			inputTokens = parsedInputTokens
		}
		if parsedOutputTokens > 0 {
			outputTokens = parsedOutputTokens
		}
		if !ok || delta.Content == "" {
			continue
		}
		if delta.Type == "text" {
			content.WriteString(delta.Content)
		}
		if err := deltaSink(ctx, delta); err != nil {
			return nil, err
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(content.String()) == "" {
		return nil, errcode.New(errcode.AgentProviderFailed, http.StatusBadGateway,
			"empty anthropic stream response", nil)
	}

	return &ProviderCallResponse{
		Content:      content.String(),
		Model:        model,
		InputTokens:  inputTokens,
		OutputTokens: outputTokens,
		FinishReason: finishReason,
		Streamed:     true,
	}, nil
}

func parseAnthropicStreamDelta(data string) (ProviderDelta, string, string, int, int, bool) {
	var parsed struct {
		Type    string `json:"type"`
		Message struct {
			Model string `json:"model"`
			Usage struct {
				InputTokens  int `json:"input_tokens"`
				OutputTokens int `json:"output_tokens"`
			} `json:"usage"`
		} `json:"message"`
		Delta struct {
			Type       string `json:"type"`
			Text       string `json:"text"`
			StopReason string `json:"stop_reason"`
			Thinking   string `json:"thinking"`
		} `json:"delta"`
		Usage struct {
			OutputTokens int `json:"output_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal([]byte(data), &parsed); err != nil {
		return ProviderDelta{}, "", "", 0, 0, false
	}
	switch parsed.Type {
	case "message_start":
		return ProviderDelta{}, parsed.Message.Model, "", parsed.Message.Usage.InputTokens, parsed.Message.Usage.OutputTokens, false
	case "content_block_delta":
		if parsed.Delta.Type == "thinking_delta" && parsed.Delta.Thinking != "" {
			return ProviderDelta{Type: "thinking", Content: parsed.Delta.Thinking}, "", "", 0, 0, true
		}
		if parsed.Delta.Text != "" {
			return ProviderDelta{Type: "text", Content: parsed.Delta.Text}, "", "", 0, 0, true
		}
	case "message_delta":
		return ProviderDelta{}, "", parsed.Delta.StopReason, 0, parsed.Usage.OutputTokens, false
	}
	return ProviderDelta{}, "", "", 0, 0, false
}

// ---------------------------------------------------------------------------
// Message conversion helpers
// ---------------------------------------------------------------------------

// toAPIMessages converts domain messages to the simple {"role", "content"}
// map format consumed by Ollama and OpenAI-compatible endpoints.
func (s *ProviderService) toAPIMessages(messages []domain.Message) []map[string]string {
	out := make([]map[string]string, 0, len(messages))

	for _, m := range messages {
		content := strings.TrimSpace(m.Content)
		if content == "" {
			continue
		}

		role := "user"
		switch m.Role {
		case domain.MessageRoleSystem:
			role = "system"
		case domain.MessageRoleAssistant:
			role = "assistant"
		case domain.MessageRoleTool:
			role = "tool"
		default:
			role = "user"
		}

		out = append(out, map[string]string{
			"role":    role,
			"content": content,
		})
	}

	return out
}

type openAIFunctionCall struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type openAIToolCall struct {
	ID       string             `json:"id"`
	Type     string             `json:"type"`
	Function openAIFunctionCall `json:"function"`
}

type openAIToolCallDelta struct {
	Index    int                `json:"index"`
	ID       string             `json:"id"`
	Type     string             `json:"type"`
	Function openAIFunctionCall `json:"function"`
}

type openAIMessage struct {
	Role       string           `json:"role"`
	Content    string           `json:"content,omitempty"`
	ToolCalls  []openAIToolCall `json:"tool_calls,omitempty"`
	ToolCallID string           `json:"tool_call_id,omitempty"`
}

type openAIFunctionDefinition struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Parameters  json.RawMessage `json:"parameters"`
}

type openAIToolDefinition struct {
	Type     string                   `json:"type"`
	Function openAIFunctionDefinition `json:"function"`
}

func toOpenAITools(definitions []*domain.ToolDefinition) ([]openAIToolDefinition, error) {
	tools := make([]openAIToolDefinition, 0, len(definitions))
	for _, definition := range definitions {
		if definition == nil || strings.TrimSpace(definition.Name) == "" {
			return nil, fmt.Errorf("openai tool definition requires a name")
		}
		schema := bytes.TrimSpace(definition.JSONSchema)
		if len(schema) == 0 || !json.Valid(schema) || schema[0] != '{' {
			return nil, fmt.Errorf("openai tool %q has an invalid parameters schema", definition.Name)
		}
		tools = append(tools, openAIToolDefinition{
			Type: "function",
			Function: openAIFunctionDefinition{
				Name:        definition.Name,
				Description: definition.Description,
				Parameters:  append(json.RawMessage(nil), schema...),
			},
		})
	}
	return tools, nil
}

func toOpenAIMessages(messages []domain.Message) ([]openAIMessage, error) {
	out := make([]openAIMessage, 0, len(messages))
	for _, message := range messages {
		apiMessage := openAIMessage{Role: string(message.Role), Content: message.Content}
		switch message.Role {
		case domain.MessageRoleSystem, domain.MessageRoleUser, domain.MessageRoleAssistant:
		case domain.MessageRoleTool:
			var metadata struct {
				ToolCallID string `json:"tool_call_id"`
			}
			if err := json.Unmarshal(message.MetadataJSON, &metadata); err != nil ||
				strings.TrimSpace(metadata.ToolCallID) == "" {
				return nil, fmt.Errorf("openai tool result message requires tool_call_id")
			}
			apiMessage.ToolCallID = metadata.ToolCallID
		default:
			apiMessage.Role = "user"
		}
		if len(message.ToolCallsJSON) > 0 {
			if message.Role != domain.MessageRoleAssistant {
				return nil, fmt.Errorf("openai tool_calls require an assistant message")
			}
			if err := json.Unmarshal(message.ToolCallsJSON, &apiMessage.ToolCalls); err != nil {
				return nil, fmt.Errorf("decode assistant tool_calls: %w", err)
			}
			if len(apiMessage.ToolCalls) == 0 {
				return nil, fmt.Errorf("assistant tool_calls cannot be empty")
			}
		}
		if strings.TrimSpace(apiMessage.Content) == "" && len(apiMessage.ToolCalls) == 0 {
			continue
		}
		out = append(out, apiMessage)
	}
	return out, nil
}

func providerToolCalls(calls []openAIToolCall) ([]ProviderToolCall, error) {
	out := make([]ProviderToolCall, 0, len(calls))
	for _, call := range calls {
		if call.Type != "" && call.Type != "function" {
			return nil, fmt.Errorf("openai ToolCall %q has unsupported type %q", call.ID, call.Type)
		}
		if strings.TrimSpace(call.ID) == "" ||
			strings.TrimSpace(call.Function.Name) == "" {
			return nil, fmt.Errorf("openai ToolCall requires id and function name")
		}
		arguments := strings.TrimSpace(call.Function.Arguments)
		if arguments == "" {
			arguments = "{}"
		}
		if !json.Valid([]byte(arguments)) {
			return nil, fmt.Errorf("openai ToolCall %q has invalid arguments", call.ID)
		}
		out = append(out, ProviderToolCall{
			ID:        strings.TrimSpace(call.ID),
			Name:      call.Function.Name,
			Arguments: arguments,
		})
	}
	return out, nil
}

func orderedProviderToolCalls(calls map[int]*openAIToolCall) ([]ProviderToolCall, error) {
	indexes := make([]int, 0, len(calls))
	for index := range calls {
		indexes = append(indexes, index)
	}
	sort.Ints(indexes)
	ordered := make([]openAIToolCall, 0, len(indexes))
	for _, index := range indexes {
		ordered = append(ordered, *calls[index])
	}
	return providerToolCalls(ordered)
}

// toAnthropicMessages converts domain messages to Anthropic's content-block
// format required by the Messages API. Each message carries its content in
// an array of typed blocks: [{"type":"text","text":"..."}].
//
// Changelog:
// 2026-04-11 — Added: the previous code used toAPIMessages for non-cached
//
//	Anthropic calls, producing {"role","content":string} which is incompatible
//	with the Anthropic Messages API's required content-block format (Bug 2).
func (s *ProviderService) toAnthropicMessages(messages []domain.Message) []map[string]any {
	out := make([]map[string]any, 0, len(messages))

	for _, m := range messages {
		content := strings.TrimSpace(m.Content)
		if content == "" {
			continue
		}

		role := "user"
		switch m.Role {
		case domain.MessageRoleAssistant:
			role = "assistant"
		case domain.MessageRoleTool:
			role = "user"
		default:
			role = "user"
		}

		out = append(out, map[string]any{
			"role": role,
			"content": []map[string]string{
				{"type": "text", "text": content},
			},
		})
	}

	return out
}

// ---------------------------------------------------------------------------
// Config parsing helpers
// ---------------------------------------------------------------------------

// asProviderString safely extracts a string from an any-typed map value.
func asProviderString(v any) string {
	s, ok := v.(string)
	if !ok {
		return ""
	}
	return s
}

// decodeMaybeBase64Provider attempts to base64-decode the input and returns
// the decoded string if it looks like a JSON object. This matches the
// KeyVaults encoding pattern used by the provider configuration system.
func decodeMaybeBase64Provider(input string) (string, bool) {
	decoded, err := base64.StdEncoding.DecodeString(input)
	if err != nil {
		return "", false
	}

	out := strings.TrimSpace(string(decoded))
	if strings.HasPrefix(out, "{") && strings.HasSuffix(out, "}") {
		return out, true
	}

	return "", false
}
