package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

type RuntimeAdmissionResolver struct {
	providers *ProviderConfigService
	models    *ModelConfigService
	now       func() time.Time
}

func NewRuntimeAdmissionResolver(
	providers *ProviderConfigService,
	models *ModelConfigService,
) *RuntimeAdmissionResolver {
	return &RuntimeAdmissionResolver{
		providers: providers,
		models:    models,
		now:       func() time.Time { return time.Now().UTC() },
	}
}

type AdmissionSnapshot struct {
	SnapshotID            string
	ProviderID            string
	ModelID               string
	ProviderConfigVersion string
	Capabilities          *model.RuntimeCapabilitySnapshot
	Budget                *model.RuntimeBudget
}

type ResolvedAvailableModel struct {
	ID            string
	ProviderID    string
	ProviderName  string
	DisplayName   string
	Type          string
	Enabled       bool
	ContextWindow int32
}

func (r *RuntimeAdmissionResolver) ListAvailableModels(
	ctx context.Context,
	actorPTID string,
) ([]ResolvedAvailableModel, error) {
	userProviders, err := r.providers.List(ctx, actorPTID)
	if err != nil {
		return nil, err
	}

	providerMap := make(map[string]*persistence.AgentProvider, len(userProviders))
	for i := range userProviders {
		if _, exists := providerMap[userProviders[i].Name]; !exists {
			providerMap[userProviders[i].Name] = &userProviders[i]
		}
	}

	var result []ResolvedAvailableModel

	for _, cp := range catalog.List() {
		if !catalogProviderAdvertised(cp) {
			continue
		}
		userMatch := providerMap[cp.ID]
		if !admitProvider(cp, userMatch) {
			continue
		}
		hidden := parseHiddenModels(func() string {
			if userMatch != nil {
				return userMatch.HiddenModels
			}
			return ""
		}())
		dbModels, err := r.models.List(ctx, actorPTID, cp.ID)
		if err != nil {
			return nil, errcode.New(
				errcode.AgentInternal,
				http.StatusInternalServerError,
				fmt.Sprintf("failed to load model capability source for provider %q", cp.ID),
				err,
			)
		}
		dbModelsByID := make(map[string]*persistence.AgentModel, len(dbModels))
		for i := range dbModels {
			dbModelsByID[dbModels[i].ModelID] = &dbModels[i]
		}

		for _, m := range cp.Models {
			if !admitCatalogModel(m, hidden) {
				continue
			}
			databaseModel := dbModelsByID[m.ID]
			if databaseModel != nil && !databaseModel.Enabled {
				continue
			}
			if _, err := resolveModelCapabilityFacts(&m, databaseModel); err != nil {
				return nil, errcode.New(
					errcode.AgentInvalidSourceState,
					http.StatusConflict,
					fmt.Sprintf("model %q capability metadata is invalid", m.ID),
					err,
				)
			}
			displayName := m.DisplayName
			contextWindow := m.ContextWindow
			if databaseModel != nil {
				if strings.TrimSpace(databaseModel.DisplayName) != "" {
					displayName = databaseModel.DisplayName
				}
				if databaseModel.ContextWindow > 0 {
					contextWindow = databaseModel.ContextWindow
				}
			}
			if contextWindow <= 1 {
				continue
			}
			result = append(result, ResolvedAvailableModel{
				ID:            m.ID,
				ProviderID:    cp.ID,
				ProviderName:  cp.Name,
				DisplayName:   displayName,
				Type:          m.Type,
				Enabled:       m.Enabled,
				ContextWindow: int32(contextWindow),
			})
		}

		catalogIDs := make(map[string]bool, len(cp.Models))
		for _, m := range cp.Models {
			catalogIDs[m.ID] = true
		}
		for i := range dbModels {
			if !dbModels[i].Enabled || catalogIDs[dbModels[i].ModelID] || containsStr(hidden, dbModels[i].ModelID) {
				continue
			}
			if dbModels[i].ContextWindow <= 1 {
				continue
			}
			if _, err := resolveModelCapabilityFacts(nil, &dbModels[i]); err != nil {
				return nil, errcode.New(
					errcode.AgentInvalidSourceState,
					http.StatusConflict,
					fmt.Sprintf("model %q capability metadata is invalid", dbModels[i].ModelID),
					err,
				)
			}
			result = append(result, ResolvedAvailableModel{
				ID:            dbModels[i].ModelID,
				ProviderID:    cp.ID,
				ProviderName:  cp.Name,
				DisplayName:   dbModels[i].DisplayName,
				Type:          "chat",
				Enabled:       dbModels[i].Enabled,
				ContextWindow: int32(dbModels[i].ContextWindow),
			})
		}
	}

	sort.SliceStable(result, func(i, j int) bool {
		if result[i].ProviderID != result[j].ProviderID {
			return result[i].ProviderID < result[j].ProviderID
		}
		return result[i].ID < result[j].ID
	})

	return result, nil
}

func (r *RuntimeAdmissionResolver) Resolve(
	ctx context.Context,
	actorPTID string,
	providerID string,
	modelID string,
) (*AdmissionSnapshot, error) {
	if strings.TrimSpace(providerID) == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			"provider_id is required", nil)
	}
	if strings.TrimSpace(modelID) == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			"model_id is required", nil)
	}

	userProviders, err := r.providers.List(ctx, actorPTID)
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to load provider configuration", err)
	}

	var userMatch *persistence.AgentProvider
	for i := range userProviders {
		if userProviders[i].Name == providerID {
			userMatch = &userProviders[i]
			break
		}
	}

	cp := catalog.Find(providerID)
	if cp == nil && userMatch == nil {
		return nil, errcode.New(errcode.AgentProviderDisabled, http.StatusBadRequest,
			fmt.Sprintf("provider %q not found", providerID), nil)
	}

	if cp != nil && !catalogProviderAdvertised(*cp) {
		return nil, errcode.NewRuntimeUnavailable(
			runtimeKindForUnavailableProvider(cp.RuntimeKind),
			"runtime_not_advertised",
		)
	}
	if userMatch != nil && !ProviderRuntimeAdvertised(userMatch.RuntimeKind, userMatch.Protocol) {
		return nil, errcode.NewRuntimeUnavailable(
			runtimeKindForUnavailableProvider(userMatch.RuntimeKind),
			"runtime_not_advertised",
		)
	}

	if userMatch != nil && !userMatch.Enabled {
		return nil, errcode.NewRuntimeUnavailable(
			runtimeKindForUnavailableProvider(userMatch.RuntimeKind),
			"provider_disabled",
		)
	}

	if cp != nil {
		requiresAPIKey := cp.ShowAPIKey == nil || *cp.ShowAPIKey
		if requiresAPIKey {
			if userMatch == nil || parseKeyVaultAPIKey(userMatch.KeyVaults) == "" {
				return nil, errcode.NewProviderCredentialMissing(providerID)
			}
		}
	}

	modelEnabled := false
	var contextWindow int32
	var modelType string
	var catalogMatch *catalog.CatalogModel
	var databaseMatch *persistence.AgentModel
	dbModels, err := r.models.List(ctx, actorPTID, providerID)
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to load model capability source", err)
	}
	for i := range dbModels {
		if dbModels[i].ModelID == modelID {
			databaseMatch = &dbModels[i]
			break
		}
	}
	if databaseMatch != nil && !databaseMatch.Enabled {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			fmt.Sprintf("model %q is disabled", modelID), nil)
	}

	if cp != nil {
		hidden := parseHiddenModels(func() string {
			if userMatch != nil {
				return userMatch.HiddenModels
			}
			return ""
		}())
		for _, m := range cp.Models {
			if m.ID == modelID {
				if !m.Enabled || m.Type != "chat" || containsStr(hidden, modelID) {
					return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
						fmt.Sprintf("model %q is not available for agent execution", modelID), nil)
				}
				modelEnabled = true
				contextWindow = int32(m.ContextWindow)
				modelType = m.Type
				catalogModel := m
				catalogMatch = &catalogModel
				break
			}
		}
		if !modelEnabled {
			if databaseMatch != nil {
				modelEnabled = true
				contextWindow = int32(databaseMatch.ContextWindow)
				modelType = "chat"
			}
		}
	} else if userMatch != nil {
		if databaseMatch != nil {
			modelEnabled = true
			contextWindow = int32(databaseMatch.ContextWindow)
			modelType = "chat"
		}
	}

	if !modelEnabled {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			fmt.Sprintf("model %q is not available for provider %q", modelID, providerID), nil)
	}
	if databaseMatch != nil && databaseMatch.ContextWindow > 0 {
		contextWindow = int32(databaseMatch.ContextWindow)
	}

	if modelType != "" && modelType != "chat" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			fmt.Sprintf("model %q type %q is not supported for agent execution", modelID, modelType), nil)
	}
	if contextWindow <= 1 {
		return nil, errcode.New(errcode.AgentInvalidSourceState, http.StatusConflict,
			fmt.Sprintf("model %q has no valid context window", modelID), nil)
	}

	facts, err := resolveModelCapabilityFacts(catalogMatch, databaseMatch)
	if err != nil {
		return nil, errcode.New(errcode.AgentInvalidSourceState, http.StatusConflict,
			fmt.Sprintf("model %q capability metadata is invalid", modelID), err)
	}
	budget := defaultRuntimeBudget(contextWindow)
	sourceVersion, err := runtimeCapabilitySourceVersion(
		cp,
		catalogMatch,
		userMatch,
		databaseMatch,
		facts,
		contextWindow,
		budget,
	)
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to hash runtime capability source", err)
	}
	observedAt := time.Now().UTC()
	if r.now != nil {
		observedAt = r.now().UTC()
	}
	capabilities := buildCapabilitySnapshot(
		providerID,
		modelID,
		contextWindow,
		cp,
		userMatch,
		facts,
		sourceVersion,
		observedAt,
	)

	snapshotID, err := computeSnapshotID(
		actorPTID,
		providerID,
		modelID,
		capabilities,
		budget,
	)
	if err != nil {
		return nil, errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"failed to hash runtime capability snapshot",
			err,
		)
	}
	capabilities.SnapshotId = snapshotID
	providerConfigVersion := "0"
	if userMatch != nil {
		providerConfigVersion = fmt.Sprintf("%d", userMatch.Version)
	}

	return &AdmissionSnapshot{
		SnapshotID:            snapshotID,
		ProviderID:            providerID,
		ModelID:               modelID,
		ProviderConfigVersion: providerConfigVersion,
		Capabilities:          capabilities,
		Budget:                budget,
	}, nil
}

func runtimeKindForUnavailableProvider(providerRuntimeKind string) string {
	switch strings.ToLower(strings.TrimSpace(providerRuntimeKind)) {
	case "external", "external-agent", "external_agent":
		return "external_agent"
	default:
		return "direct_model"
	}
}

type runtimeCapabilityFacts map[string]bool

const (
	runtimeCapabilityDiscoverySource = "station-runtime-capability-authority"
	runtimeAttachmentCountLimit      = 10
	runtimeAttachmentBytesLimit      = 10 * 1024 * 1024
)

var runtimeCapabilityIDs = []string{
	"text-input",
	"image-input",
	"file-input",
	"audio-input",
	"text-output",
	"image-output",
	"structured-output",
	"streaming",
	"reasoning",
	"prompt-cache",
	"external-resume",
	"native-tools",
	"parallel-tools",
	"local-bridge",
}

func resolveModelCapabilityFacts(
	catalogModel *catalog.CatalogModel,
	databaseModel *persistence.AgentModel,
) (runtimeCapabilityFacts, error) {
	facts := runtimeCapabilityFacts{
		"text-input":  true,
		"text-output": true,
	}
	if catalogModel != nil {
		for _, name := range catalogModel.Capabilities {
			if capabilityID := normalizeRuntimeCapabilityID(name); capabilityID != "" {
				facts[capabilityID] = true
			}
		}
		if strings.TrimSpace(catalogModel.ThinkingControl) != "" {
			facts["reasoning"] = true
		}
	}
	if databaseModel == nil || len(databaseModel.CapabilitiesJSON) == 0 ||
		string(databaseModel.CapabilitiesJSON) == "null" {
		return facts, nil
	}
	overrides, err := parseModelCapabilityFlags(databaseModel.CapabilitiesJSON)
	if err != nil {
		return nil, err
	}
	for capabilityID, enabled := range overrides {
		facts[capabilityID] = enabled
	}
	return facts, nil
}

func parseModelCapabilityFlags(raw json.RawMessage) (runtimeCapabilityFacts, error) {
	result := make(runtimeCapabilityFacts)
	var names []string
	if err := json.Unmarshal(raw, &names); err == nil {
		for _, name := range names {
			if capabilityID := normalizeRuntimeCapabilityID(name); capabilityID != "" {
				result[capabilityID] = true
			}
		}
		return result, nil
	}

	var flags map[string]bool
	if err := json.Unmarshal(raw, &flags); err != nil {
		return nil, err
	}
	for name, enabled := range flags {
		if capabilityID := normalizeRuntimeCapabilityID(name); capabilityID != "" {
			result[capabilityID] = enabled
		}
	}
	return result, nil
}

func normalizeRuntimeCapabilityID(name string) string {
	normalized := strings.NewReplacer("_", "-", " ", "-").Replace(
		strings.ToLower(strings.TrimSpace(name)),
	)
	switch normalized {
	case "text", "chat", "text-input":
		return "text-input"
	case "image", "vision", "image-input":
		return "image-input"
	case "file", "pdf", "file-input":
		return "file-input"
	case "audio", "audio-input":
		return "audio-input"
	case "text-output":
		return "text-output"
	case "image-output":
		return "image-output"
	case "structured", "structured-output":
		return "structured-output"
	case "stream", "streaming":
		return "streaming"
	case "reasoning":
		return "reasoning"
	case "prompt-cache", "prompt-caching":
		return "prompt-cache"
	case "external-resume":
		return "external-resume"
	case "tools", "tool-use", "native-tools":
		return "native-tools"
	case "parallel-tools", "parallel-tool-use":
		return "parallel-tools"
	case "local-bridge":
		return "local-bridge"
	default:
		return ""
	}
}

func runtimeCapabilitySourceVersion(
	catalogProvider *catalog.CatalogProvider,
	catalogModel *catalog.CatalogModel,
	databaseProvider *persistence.AgentProvider,
	databaseModel *persistence.AgentModel,
	facts runtimeCapabilityFacts,
	contextWindow int32,
	budget *model.RuntimeBudget,
) (string, error) {
	payload := map[string]interface{}{
		"runtimeProfileId": modernChatAgentProfileID,
		"facts":            facts,
		"limits": map[string]interface{}{
			"contextTokens":   contextWindow,
			"outputTokens":    budget.GetMaxOutputTokens(),
			"attachmentCount": runtimeAttachmentCountLimit,
			"attachmentBytes": runtimeAttachmentBytesLimit,
		},
		"budget": budget,
	}
	if catalogProvider != nil {
		payload["catalogProvider"] = map[string]interface{}{
			"id":          catalogProvider.ID,
			"protocol":    catalogProvider.Protocol,
			"runtimeKind": catalogProvider.RuntimeKind,
		}
	}
	if catalogModel != nil {
		payload["catalogModel"] = map[string]interface{}{
			"id":              catalogModel.ID,
			"type":            catalogModel.Type,
			"contextWindow":   catalogModel.ContextWindow,
			"thinkingControl": catalogModel.ThinkingControl,
		}
	}
	if databaseProvider != nil {
		payload["providerVersion"] = databaseProvider.Version
	}
	if databaseModel != nil {
		payload["databaseModel"] = map[string]interface{}{
			"version":       databaseModel.Version,
			"contextWindow": databaseModel.ContextWindow,
		}
	}
	hash, err := canonicalJSONHash(payload)
	if err != nil {
		return "", err
	}
	return "cap-src-" + hash, nil
}

func buildCapabilitySnapshot(
	providerID, modelID string,
	contextWindow int32,
	catalogProvider *catalog.CatalogProvider,
	userMatch *persistence.AgentProvider,
	facts runtimeCapabilityFacts,
	sourceVersion string,
	observedAt time.Time,
) *model.RuntimeCapabilitySnapshot {
	protocol := "openai-compatible"
	runtimeKind := "http"
	if catalogProvider != nil {
		if strings.TrimSpace(catalogProvider.Protocol) != "" {
			protocol = catalogProvider.Protocol
		}
		if strings.TrimSpace(catalogProvider.RuntimeKind) != "" {
			runtimeKind = catalogProvider.RuntimeKind
		}
	}
	if userMatch != nil {
		if userMatch.Protocol != "" {
			protocol = userMatch.Protocol
		}
		if userMatch.RuntimeKind != "" {
			runtimeKind = userMatch.RuntimeKind
		}
	}

	inputCaps := &model.RuntimeInputCapabilities{
		Text:  facts["text-input"],
		Image: facts["image-input"],
		File:  facts["file-input"],
		Audio: facts["audio-input"],
	}
	outputCaps := &model.RuntimeOutputCapabilities{
		Text:       facts["text-output"],
		Image:      facts["image-output"],
		Structured: facts["structured-output"],
	}
	execCaps := &model.RuntimeExecutionCapabilities{
		Streaming:      facts["streaming"],
		Reasoning:      facts["reasoning"],
		PromptCache:    facts["prompt-cache"],
		ExternalResume: facts["external-resume"],
	}
	agenticCaps := &model.RuntimeAgenticCapabilities{
		NativeTools:   facts["native-tools"],
		ParallelTools: facts["parallel-tools"],
		LocalBridge:   facts["local-bridge"],
	}
	budget := defaultRuntimeBudget(contextWindow)
	limits := &model.RuntimeCapabilityLimits{
		ContextTokens:   uint64(contextWindow),
		OutputTokens:    budget.GetMaxOutputTokens(),
		AttachmentCount: runtimeAttachmentCountLimit,
		AttachmentBytes: runtimeAttachmentBytesLimit,
	}

	resolution := []*model.RuntimeCapability{
		{CapabilityId: "provider", Resolution: model.RuntimeCapabilityResolution_RUNTIME_CAPABILITY_RESOLUTION_NATIVE, ReasonCode: providerID},
		{CapabilityId: "model", Resolution: model.RuntimeCapabilityResolution_RUNTIME_CAPABILITY_RESOLUTION_NATIVE, ReasonCode: modelID},
		{CapabilityId: "protocol", Resolution: model.RuntimeCapabilityResolution_RUNTIME_CAPABILITY_RESOLUTION_NATIVE, ReasonCode: protocol},
		{CapabilityId: "runtime", Resolution: model.RuntimeCapabilityResolution_RUNTIME_CAPABILITY_RESOLUTION_NATIVE, ReasonCode: runtimeKind},
	}
	for _, capabilityID := range runtimeCapabilityIDs {
		resolutionState := model.RuntimeCapabilityResolution_RUNTIME_CAPABILITY_RESOLUTION_REJECTED
		reasonCode := "model_capability_not_declared"
		if facts[capabilityID] {
			resolutionState = model.RuntimeCapabilityResolution_RUNTIME_CAPABILITY_RESOLUTION_NATIVE
			reasonCode = "model_capability_declared"
		}
		resolution = append(resolution, &model.RuntimeCapability{
			CapabilityId: capabilityID,
			Resolution:   resolutionState,
			ReasonCode:   reasonCode,
		})
	}

	return &model.RuntimeCapabilitySnapshot{
		SnapshotId: "",
		Input:      inputCaps,
		Output:     outputCaps,
		Runtime:    execCaps,
		Agentic:    agenticCaps,
		Limits:     limits,
		Resolution: resolution,
		Provenance: &model.RuntimeCapabilityProvenance{
			DiscoverySource: runtimeCapabilityDiscoverySource,
			SourceVersion:   sourceVersion,
			ObservedAt:      timestamppb.New(observedAt),
		},
	}
}

func defaultRuntimeBudget(contextWindow int32) *model.RuntimeBudget {
	if contextWindow <= 0 {
		contextWindow = 128000
	}
	window := uint64(contextWindow)
	maxOutput := uint64(8192)
	if maxOutput >= window {
		maxOutput = window / 4
		if maxOutput == 0 {
			maxOutput = 1
		}
	}
	maxInput := window - maxOutput
	return &model.RuntimeBudget{
		MaxAttempts:           3,
		MaxAgentSteps:         50,
		MaxToolCalls:          100,
		MaxIdenticalToolCalls: 3,
		MaxDelegationDepth:    3,
		WallTimeMs:            300000,
		MaxInputTokens:        maxInput,
		MaxOutputTokens:       maxOutput,
		MaxAttachmentBytes:    runtimeAttachmentBytesLimit,
	}
}

func computeSnapshotID(
	actorPTID, providerID, modelID string,
	caps *model.RuntimeCapabilitySnapshot,
	budget *model.RuntimeBudget,
) (string, error) {
	payload := struct {
		Ptid       string                              `json:"ptid"`
		ProviderID string                              `json:"provider_id"`
		ModelID    string                              `json:"model_id"`
		Input      *model.RuntimeInputCapabilities     `json:"input"`
		Output     *model.RuntimeOutputCapabilities    `json:"output"`
		Runtime    *model.RuntimeExecutionCapabilities `json:"runtime"`
		Agentic    *model.RuntimeAgenticCapabilities   `json:"agentic"`
		Limits     *model.RuntimeCapabilityLimits      `json:"limits"`
		Resolution []*model.RuntimeCapability          `json:"resolution"`
		Provenance map[string]string                   `json:"provenance"`
		Budget     *model.RuntimeBudget                `json:"budget"`
	}{
		Ptid:       actorPTID,
		ProviderID: providerID,
		ModelID:    modelID,
		Input:      caps.GetInput(),
		Output:     caps.GetOutput(),
		Runtime:    caps.GetRuntime(),
		Agentic:    caps.GetAgentic(),
		Limits:     caps.Limits,
		Resolution: caps.GetResolution(),
		Provenance: map[string]string{
			"discoverySource": caps.GetProvenance().GetDiscoverySource(),
			"sourceVersion":   caps.GetProvenance().GetSourceVersion(),
		},
		Budget: budget,
	}
	hash, err := canonicalJSONHash(payload)
	if err != nil {
		return "", err
	}
	return "snap-" + hash[:32], nil
}

func catalogProviderAdvertised(cp catalog.CatalogProvider) bool {
	return ProviderRuntimeAdvertised(cp.RuntimeKind, cp.Protocol)
}

// ProviderRuntimeAdvertised reports whether Station has an executable adapter
// for the declared runtime and protocol in the active product profile.
func ProviderRuntimeAdvertised(runtimeKind, protocol string) bool {
	if !runtimeAdvertised(runtimeKind) {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(protocol)) {
	case "openai-compatible", "openai", "anthropic", "ollama":
		return true
	default:
		return false
	}
}

func runtimeAdvertised(runtimeKind string) bool {
	switch strings.ToLower(strings.TrimSpace(runtimeKind)) {
	case "", "http":
		return true
	default:
		return false
	}
}

func admitProvider(cp catalog.CatalogProvider, userMatch *persistence.AgentProvider) bool {
	if !catalogProviderAdvertised(cp) {
		return false
	}
	enabled := cp.Enabled
	if userMatch != nil {
		enabled = userMatch.Enabled
	}
	if !enabled {
		return false
	}
	requiresAPIKey := cp.ShowAPIKey == nil || *cp.ShowAPIKey
	if !requiresAPIKey {
		return true
	}
	return userMatch != nil && parseKeyVaultAPIKey(userMatch.KeyVaults) != ""
}

func admitCatalogModel(m catalog.CatalogModel, hidden []string) bool {
	return m.Enabled && m.Type == "chat" && !containsStr(hidden, m.ID)
}

func containsStr(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

func parseKeyVaultAPIKey(kv string) string {
	var m map[string]interface{}
	if err := json.Unmarshal([]byte(kv), &m); err != nil {
		return ""
	}
	if v, ok := m["api_key"].(string); ok {
		return v
	}
	return ""
}
