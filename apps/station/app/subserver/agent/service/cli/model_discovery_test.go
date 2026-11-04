package cli

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDiscoveryRunsWithPrivateStateAndRejectsEnvironmentOverrides(t *testing.T) {
	root := t.TempDir()
	output := filepath.Join(root, "state.txt")
	command := writeExecutable(t, root, "discover", `#!/bin/sh
printf '%s\n' "$HOME" "$CODEX_HOME" "$XDG_CACHE_HOME" "$TMPDIR" "${CURSOR_API_KEY:-}" > "$1"
printf '%s' '{"models":["private-model"]}'
`)
	t.Setenv("HOME", root)
	t.Setenv("CURSOR_API_KEY", "station-secret")
	request := ModelDiscoveryRequest{Command: []string{command, output}, StateRoot: filepath.Join(root, "discovery")}
	models, err := DiscoverModels(context.Background(), request)
	if err != nil || len(models) != 1 {
		t.Fatalf("private discovery = %+v %v", models, err)
	}
	raw, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(raw), request.StateRoot+"/home\n") || strings.Contains(string(raw), "station-secret") {
		t.Fatal("discovery inherited Station state")
	}
	request.Environment = map[string]string{"HOME": root}
	if _, err := DiscoverModels(context.Background(), request); err == nil {
		t.Fatal("discovery accepted a HOME override")
	}
}

func TestParseDiscoveredModelsPreservesTraeMetadata(t *testing.T) {
	models, err := ParseDiscoveredModels(`{
  "models": [
    {
      "slug": "Seed-Evolving",
      "description": "1000K context window, support reasoning.",
      "default_reasoning_level": "high",
      "supported_reasoning_levels": [],
      "supports_reasoning_summaries": true,
      "context_window": 1000000,
      "input_modalities": ["text", "image"],
      "supported_in_api": true,
      "visibility": "list",
      "priority": 0,
      "base_instructions": "must not cross the discovery boundary"
    },
    {
      "slug": "openrouter-4o",
      "description": "support reasoning.",
      "default_reasoning_level": "xhigh",
      "supported_reasoning_levels": [
        {"effort": "low"},
        {"effort": "medium"},
        {"effort": "high"},
        {"effort": "xhigh"}
      ],
      "supports_reasoning_summaries": true,
      "context_window": 200000,
      "input_modalities": ["text", "image"],
      "supported_in_api": true,
      "visibility": "list",
      "priority": 3
    },
    {
      "slug": "hidden",
      "supported_in_api": true,
      "visibility": "hidden",
      "priority": 1
    }
  ]
}`, []string{"streaming"})
	if err != nil {
		t.Fatalf("ParseDiscoveredModels() error = %v", err)
	}
	if len(models) != 2 {
		t.Fatalf("ParseDiscoveredModels() count = %d, want 2", len(models))
	}
	first := models[0]
	if first.ID != "Seed-Evolving" ||
		first.ContextWindow != 1000000 ||
		first.DefaultReasoningLevel != "high" ||
		!containsString(first.Capabilities, "image-input") ||
		!containsString(first.Capabilities, "reasoning") ||
		!containsString(first.Capabilities, "streaming") {
		t.Fatalf("first model metadata = %+v", first)
	}
	second := models[1]
	if second.ID != "openrouter-4o" ||
		len(second.SupportedReasoningLevels) != 4 ||
		second.SupportedReasoningLevels[3] != "xhigh" {
		t.Fatalf("second model metadata = %+v", second)
	}
}

func TestParseDiscoveredModelsAcceptsStringCatalogAndDeduplicates(t *testing.T) {
	models, err := ParseDiscoveredModels(
		`{"models":["default","default","fast"]}`,
		[]string{"streaming"},
	)
	if err != nil {
		t.Fatalf("ParseDiscoveredModels() error = %v", err)
	}
	if len(models) != 2 || models[0].ID != "default" || models[1].ID != "fast" {
		t.Fatalf("ParseDiscoveredModels() = %+v", models)
	}
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
