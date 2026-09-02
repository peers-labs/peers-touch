package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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
}

func NewRuntimeAdmissionResolver(
	providers *ProviderConfigService,
	models *ModelConfigService,
) *RuntimeAdmissionResolver {
	return &RuntimeAdmissionResolver{providers: providers, models: models}
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
	actorID string,
) ([]ResolvedAvailableModel, error) {
	userProviders, err := r.providers.List(ctx, actorID)
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

		for _, m := range cp.Models {
			if !admitCatalogModel(m, hidden) {
				continue
			}
			result = append(result, ResolvedAvailableModel{
				ID:            m.ID,
				ProviderID:    cp.ID,
				ProviderName:  cp.Name,
				DisplayName:   m.DisplayName,
				Type:          m.Type,
				Enabled:       m.Enabled,
				ContextWindow: int32(m.ContextWindow),
			})
		}

		dbModels, _ := r.models.List(ctx, actorID, cp.ID)
		catalogIDs := make(map[string]bool, len(cp.Models))
		for _, m := range cp.Models {
			catalogIDs[m.ID] = true
		}
		for i := range dbModels {
			if !dbModels[i].Enabled || catalogIDs[dbModels[i].ModelID] || containsStr(hidden, dbModels[i].ModelID) {
				continue
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
	actorID string,
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

	userProviders, err := r.providers.List(ctx, actorID)
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
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			fmt.Sprintf("provider %q runtime is not supported by the active Agent profile", providerID), nil)
	}
	if userMatch != nil && !providerAdvertised(userMatch.RuntimeKind, userMatch.Protocol) {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			fmt.Sprintf("provider %q runtime is not supported by the active Agent profile", providerID), nil)
	}

	if userMatch != nil && !userMatch.Enabled {
		return nil, errcode.New(errcode.AgentProviderDisabled, http.StatusBadRequest,
			fmt.Sprintf("provider %q is disabled", providerID), nil)
	}

	if cp != nil {
		requiresAPIKey := cp.ShowAPIKey == nil || *cp.ShowAPIKey
		if requiresAPIKey {
			if userMatch == nil || parseKeyVaultAPIKey(userMatch.KeyVaults) == "" {
				return nil, errcode.New(errcode.AgentProviderDisabled, http.StatusBadRequest,
					fmt.Sprintf("provider %q credential is not configured", providerID), nil)
			}
		}
	}

	modelEnabled := false
	var contextWindow int32
	var modelType string
	var imageInput bool
	var fileInput bool
	dbModels, _ := r.models.List(ctx, actorID, providerID)

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
				break
			}
		}
		if !modelEnabled {
			for i := range dbModels {
				if dbModels[i].ModelID == modelID {
					if !dbModels[i].Enabled {
						return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
							fmt.Sprintf("model %q is disabled", modelID), nil)
					}
					modelEnabled = true
					contextWindow = int32(dbModels[i].ContextWindow)
					modelType = "chat"
					imageInput, fileInput = modelInputCapabilities(dbModels[i].CapabilitiesJSON)
					break
				}
			}
		}
	} else if userMatch != nil {
		for i := range dbModels {
			if dbModels[i].ModelID == modelID {
				if !dbModels[i].Enabled {
					return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
						fmt.Sprintf("model %q is disabled", modelID), nil)
				}
				modelEnabled = true
				contextWindow = int32(dbModels[i].ContextWindow)
				modelType = "chat"
				imageInput, fileInput = modelInputCapabilities(dbModels[i].CapabilitiesJSON)
				break
			}
		}
	}

	if !modelEnabled {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			fmt.Sprintf("model %q is not available for provider %q", modelID, providerID), nil)
	}
	for i := range dbModels {
		if dbModels[i].ModelID == modelID {
			imageInput, fileInput = modelInputCapabilities(dbModels[i].CapabilitiesJSON)
			break
		}
	}

	if modelType != "" && modelType != "chat" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			fmt.Sprintf("model %q type %q is not supported for agent execution", modelID, modelType), nil)
	}

	capabilities := buildCapabilitySnapshot(
		providerID,
		modelID,
		contextWindow,
		userMatch,
		imageInput,
		fileInput,
	)
	budget := defaultRuntimeBudget(contextWindow)

	snapshotID := computeSnapshotID(actorID, providerID, modelID, capabilities, budget)
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

func modelInputCapabilities(raw json.RawMessage) (image bool, file bool) {
	var names []string
	if err := json.Unmarshal(raw, &names); err == nil {
		for _, name := range names {
			switch strings.ToLower(strings.TrimSpace(name)) {
			case "image", "vision", "image_input":
				image = true
			case "file", "pdf", "file_input":
				file = true
			}
		}
		return image, file
	}

	var flags map[string]bool
	if err := json.Unmarshal(raw, &flags); err != nil {
		return false, false
	}
	for name, enabled := range flags {
		if !enabled {
			continue
		}
		switch strings.ToLower(strings.TrimSpace(name)) {
		case "image", "vision", "image_input":
			image = true
		case "file", "pdf", "file_input":
			file = true
		}
	}
	return image, file
}

func buildCapabilitySnapshot(
	providerID, modelID string,
	contextWindow int32,
	userMatch *persistence.AgentProvider,
	imageInput bool,
	fileInput bool,
) *model.RuntimeCapabilitySnapshot {
	protocol := "openai-compatible"
	runtimeKind := "http"
	if userMatch != nil {
		if userMatch.Protocol != "" {
			protocol = userMatch.Protocol
		}
		if userMatch.RuntimeKind != "" {
			runtimeKind = userMatch.RuntimeKind
		}
	}

	streaming := true
	reasoning := strings.Contains(strings.ToLower(modelID), "reason") ||
		strings.Contains(strings.ToLower(modelID), "o1") ||
		strings.Contains(strings.ToLower(modelID), "o3")

	inputCaps := &model.RuntimeInputCapabilities{
		Text:  true,
		Image: imageInput,
		File:  fileInput,
	}
	outputCaps := &model.RuntimeOutputCapabilities{Text: true, Structured: true}
	execCaps := &model.RuntimeExecutionCapabilities{
		Streaming:      streaming,
		Reasoning:      reasoning,
		PromptCache:    true,
		ExternalResume: true,
	}
	agenticCaps := &model.RuntimeAgenticCapabilities{
		NativeTools:   true,
		ParallelTools: true,
		LocalBridge:   false,
	}
	limits := &model.RuntimeCapabilityLimits{
		ContextTokens:   uint64(contextWindow),
		OutputTokens:    8192,
		AttachmentCount: 10,
		AttachmentBytes: 10 * 1024 * 1024,
	}

	resolution := []*model.RuntimeCapability{
		{CapabilityId: "provider", Resolution: model.RuntimeCapabilityResolution_RUNTIME_CAPABILITY_RESOLUTION_NATIVE, ReasonCode: providerID},
		{CapabilityId: "model", Resolution: model.RuntimeCapabilityResolution_RUNTIME_CAPABILITY_RESOLUTION_NATIVE, ReasonCode: modelID},
		{CapabilityId: "protocol", Resolution: model.RuntimeCapabilityResolution_RUNTIME_CAPABILITY_RESOLUTION_NATIVE, ReasonCode: protocol},
		{CapabilityId: "runtime", Resolution: model.RuntimeCapabilityResolution_RUNTIME_CAPABILITY_RESOLUTION_NATIVE, ReasonCode: runtimeKind},
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
			DiscoverySource: "station-admission-resolver",
			SourceVersion:   "v1",
			ObservedAt:      timestamppbNow(),
		},
	}
}

func defaultRuntimeBudget(contextWindow int32) *model.RuntimeBudget {
	maxInput := uint64(contextWindow) - 8192
	if maxInput > uint64(contextWindow) || contextWindow < 16384 {
		maxInput = 120000
	}
	return &model.RuntimeBudget{
		MaxAttempts:           3,
		MaxAgentSteps:         50,
		MaxToolCalls:          100,
		MaxIdenticalToolCalls: 3,
		MaxDelegationDepth:    3,
		WallTimeMs:            300000,
		MaxInputTokens:        maxInput,
		MaxOutputTokens:       8192,
		MaxAttachmentBytes:    10 * 1024 * 1024,
	}
}

func computeSnapshotID(
	actorID, providerID, modelID string,
	caps *model.RuntimeCapabilitySnapshot,
	budget *model.RuntimeBudget,
) string {
	payload := struct {
		ActorID    string                              `json:"actor_id"`
		ProviderID string                              `json:"provider_id"`
		ModelID    string                              `json:"model_id"`
		Input      *model.RuntimeInputCapabilities     `json:"input"`
		Output     *model.RuntimeOutputCapabilities    `json:"output"`
		Runtime    *model.RuntimeExecutionCapabilities `json:"runtime"`
		Agentic    *model.RuntimeAgenticCapabilities   `json:"agentic"`
		Limits     *model.RuntimeCapabilityLimits      `json:"limits"`
		Resolution []*model.RuntimeCapability          `json:"resolution"`
		Budget     *model.RuntimeBudget                `json:"budget"`
	}{
		ActorID:    actorID,
		ProviderID: providerID,
		ModelID:    modelID,
		Input:      caps.GetInput(),
		Output:     caps.GetOutput(),
		Runtime:    caps.GetRuntime(),
		Agentic:    caps.GetAgentic(),
		Limits:     caps.Limits,
		Resolution: caps.GetResolution(),
		Budget:     budget,
	}
	raw, _ := json.Marshal(payload)
	hash := sha256.Sum256(raw)
	return "snap-" + hex.EncodeToString(hash[:16])
}

func timestamppbNow() *timestamppb.Timestamp {
	return timestamppb.New(time.Now())
}

func catalogProviderAdvertised(cp catalog.CatalogProvider) bool {
	return providerAdvertised(cp.RuntimeKind, cp.Protocol)
}

func providerAdvertised(runtimeKind, protocol string) bool {
	return !strings.EqualFold(strings.TrimSpace(protocol), "cli") &&
		runtimeAdvertised(runtimeKind)
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
