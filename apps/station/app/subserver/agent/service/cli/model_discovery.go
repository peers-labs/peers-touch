package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"sort"
	"strings"
	"time"
)

const (
	defaultDiscoveryTimeout = 30 * time.Second
	maxDiscoveryOutputBytes = 4 * 1024 * 1024
	maxDiscoveredModels     = 256
)

type ModelDiscoveryRequest struct {
	Command             []string
	Environment         map[string]string
	Timeout             time.Duration
	RuntimeCapabilities []string
}

type DiscoveredModel struct {
	ID                       string
	DisplayName              string
	Description              string
	Type                     string
	ContextWindow            int
	Capabilities             []string
	DefaultReasoningLevel    string
	SupportedReasoningLevels []string
}

type rawDiscoveredModel struct {
	Slug                     string `json:"slug"`
	ID                       string `json:"id"`
	Name                     string `json:"name"`
	Description              string `json:"description"`
	DefaultReasoningLevel    string `json:"default_reasoning_level"`
	SupportedReasoningLevels []struct {
		Effort string `json:"effort"`
	} `json:"supported_reasoning_levels"`
	SupportsReasoningSummaries bool     `json:"supports_reasoning_summaries"`
	ContextWindow              int      `json:"context_window"`
	InputModalities            []string `json:"input_modalities"`
	SupportedInAPI             *bool    `json:"supported_in_api"`
	Visibility                 string   `json:"visibility"`
	Priority                   int      `json:"priority"`
}

func DiscoverModels(
	ctx context.Context,
	req ModelDiscoveryRequest,
) ([]DiscoveredModel, error) {
	if len(req.Command) == 0 || strings.TrimSpace(req.Command[0]) == "" {
		return nil, fmt.Errorf("model discovery command is not registered")
	}
	if _, err := exec.LookPath(req.Command[0]); err != nil {
		return nil, fmt.Errorf("model discovery binary is unavailable")
	}

	timeout := req.Timeout
	if timeout <= 0 || timeout > defaultDiscoveryTimeout {
		timeout = defaultDiscoveryTimeout
	}
	execCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	command := exec.Command(req.Command[0], req.Command[1:]...)
	configureProcessGroup(command)
	command.Env = restrictedEnv()
	for key, value := range req.Environment {
		command.Env = append(command.Env, key+"="+value)
	}
	stdout := &boundedCapture{limit: maxDiscoveryOutputBytes}
	stderr := &boundedCapture{limit: maxStderrCaptureLen}
	command.Stdout = stdout
	command.Stderr = stderr

	if err := command.Start(); err != nil {
		return nil, fmt.Errorf("model discovery command could not start")
	}
	processDone := make(chan struct{})
	supervisorDone := superviseProcess(
		execCtx,
		command.Process,
		processDone,
		defaultTerminationGrace,
	)
	waitErr := command.Wait()
	close(processDone)
	<-supervisorDone
	shutdownErr := shutdownProcessGroup(command.Process, defaultTerminationGrace)

	if execCtx.Err() != nil {
		return nil, fmt.Errorf("model discovery timed out")
	}
	if waitErr != nil || shutdownErr != nil {
		return nil, fmt.Errorf("model discovery command failed")
	}
	if len(stdout.data) >= maxDiscoveryOutputBytes {
		return nil, fmt.Errorf("model discovery output exceeded the allowed limit")
	}

	models, err := ParseDiscoveredModels(stdout.String(), req.RuntimeCapabilities)
	if err != nil {
		return nil, fmt.Errorf("model discovery output is invalid: %w", err)
	}
	if len(models) == 0 {
		return nil, fmt.Errorf("model discovery returned no supported models")
	}
	return models, nil
}

func ParseDiscoveredModels(
	output string,
	runtimeCapabilities []string,
) ([]DiscoveredModel, error) {
	var envelope struct {
		Models []json.RawMessage `json:"models"`
	}
	if err := json.Unmarshal([]byte(output), &envelope); err != nil {
		var values []json.RawMessage
		if arrayErr := json.Unmarshal([]byte(output), &values); arrayErr != nil {
			return nil, err
		}
		envelope.Models = values
	}

	models := make([]struct {
		model    DiscoveredModel
		priority int
	}, 0, len(envelope.Models))
	seen := make(map[string]struct{}, len(envelope.Models))
	for _, value := range envelope.Models {
		var stringID string
		if err := json.Unmarshal(value, &stringID); err == nil {
			stringID = strings.TrimSpace(stringID)
			if stringID != "" {
				models = appendDiscoveredModel(
					models,
					seen,
					DiscoveredModel{
						ID:           stringID,
						DisplayName:  stringID,
						Type:         "chat",
						Capabilities: normalizeCapabilities(runtimeCapabilities),
					},
					0,
				)
			}
			continue
		}

		var raw rawDiscoveredModel
		if err := json.Unmarshal(value, &raw); err != nil {
			continue
		}
		if raw.SupportedInAPI != nil && !*raw.SupportedInAPI {
			continue
		}
		if raw.Visibility != "" && !strings.EqualFold(raw.Visibility, "list") {
			continue
		}
		id := firstNonEmpty(raw.Slug, raw.ID, raw.Name)
		if id == "" {
			continue
		}
		capabilities := append([]string{}, runtimeCapabilities...)
		for _, modality := range raw.InputModalities {
			switch strings.ToLower(strings.TrimSpace(modality)) {
			case "text":
				capabilities = append(capabilities, "text-input")
			case "image":
				capabilities = append(capabilities, "image-input")
			case "audio":
				capabilities = append(capabilities, "audio-input")
			case "file":
				capabilities = append(capabilities, "file-input")
			}
		}
		if raw.DefaultReasoningLevel != "" ||
			len(raw.SupportedReasoningLevels) > 0 ||
			raw.SupportsReasoningSummaries {
			capabilities = append(capabilities, "reasoning")
		}
		capabilities = append(capabilities, "text-output")

		reasoningLevels := make([]string, 0, len(raw.SupportedReasoningLevels))
		for _, level := range raw.SupportedReasoningLevels {
			if effort := strings.TrimSpace(level.Effort); effort != "" {
				reasoningLevels = append(reasoningLevels, effort)
			}
		}
		models = appendDiscoveredModel(
			models,
			seen,
			DiscoveredModel{
				ID:                       id,
				DisplayName:              id,
				Description:              truncateText(raw.Description, 512),
				Type:                     "chat",
				ContextWindow:            raw.ContextWindow,
				Capabilities:             normalizeCapabilities(capabilities),
				DefaultReasoningLevel:    strings.TrimSpace(raw.DefaultReasoningLevel),
				SupportedReasoningLevels: uniqueStrings(reasoningLevels),
			},
			raw.Priority,
		)
		if len(models) == maxDiscoveredModels {
			break
		}
	}

	sort.SliceStable(models, func(i, j int) bool {
		return models[i].priority < models[j].priority
	})
	result := make([]DiscoveredModel, 0, len(models))
	for _, item := range models {
		result = append(result, item.model)
	}
	return result, nil
}

func appendDiscoveredModel(
	models []struct {
		model    DiscoveredModel
		priority int
	},
	seen map[string]struct{},
	model DiscoveredModel,
	priority int,
) []struct {
	model    DiscoveredModel
	priority int
} {
	if _, exists := seen[model.ID]; exists {
		return models
	}
	seen[model.ID] = struct{}{}
	return append(models, struct {
		model    DiscoveredModel
		priority int
	}{model: model, priority: priority})
}

func normalizeCapabilities(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func uniqueStrings(values []string) []string {
	return normalizeCapabilities(values)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

func truncateText(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}
