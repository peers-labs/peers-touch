package logrus

import (
	"testing"
)

func TestReplacePkgPath(t *testing.T) {
	replacer := map[string]string{
		"github.com/peers-labs/peers-touch/station/frame": "@frame",
		"github.com/peers-labs/peers-touch/station/app":   "@app",
		"github.com/peers-labs/peers-touch":               "@touch",
	}

	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "frame package",
			input:    "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/node.(*native)",
			expected: "@frame/core/plugin/native/node.(*native)",
		},
		{
			name:     "app package",
			input:    "github.com/peers-labs/peers-touch/station/app/subserver/oss.(*ossServer)",
			expected: "@app/subserver/oss.(*ossServer)",
		},
		{
			name:     "touch package (fallback)",
			input:    "github.com/peers-labs/peers-touch/model/domain.(*User)",
			expected: "@touch/model/domain.(*User)",
		},
		{
			name:     "no match",
			input:    "github.com/other/package.(*Type)",
			expected: "github.com/other/package.(*Type)",
		},
		{
			name:     "longest match first",
			input:    "github.com/peers-labs/peers-touch/station/frame/touch.(*Router)",
			expected: "@frame/touch.(*Router)",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := replacePkgPath(tt.input, replacer)
			if result != tt.expected {
				t.Errorf("replacePkgPath(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestReplacePkgPathEmptyReplacer(t *testing.T) {
	input := "github.com/peers-labs/peers-touch/station/frame/core"
	result := replacePkgPath(input, nil)
	if result != input {
		t.Errorf("replacePkgPath with nil replacer should return original path, got %q", result)
	}

	result = replacePkgPath(input, map[string]string{})
	if result != input {
		t.Errorf("replacePkgPath with empty replacer should return original path, got %q", result)
	}
}

func TestReplacePkgPathPriorityOrder(t *testing.T) {
	// Test that longer prefixes take priority over shorter ones
	// even when shorter prefix is defined first in the map
	replacer := map[string]string{
		"github.com/peers-labs/peers-touch":               "@touch", // shorter, defined first
		"github.com/peers-labs/peers-touch/station/frame": "@frame", // longer, defined later
		"github.com/peers-labs/peers-touch/station/app":   "@app",   // longer, defined later
	}

	tests := []struct {
		name     string
		input    string
		expected string
		reason   string
	}{
		{
			name:     "longest match wins (frame)",
			input:    "github.com/peers-labs/peers-touch/station/frame/core/logger",
			expected: "@frame/core/logger",
			reason:   "should match longer prefix '@frame' not shorter '@touch'",
		},
		{
			name:     "longest match wins (app)",
			input:    "github.com/peers-labs/peers-touch/station/app/main",
			expected: "@app/main",
			reason:   "should match longer prefix '@app' not shorter '@touch'",
		},
		{
			name:     "fallback to shorter when no longer match",
			input:    "github.com/peers-labs/peers-touch/model/domain",
			expected: "@touch/model/domain",
			reason:   "should match '@touch' when no longer prefix matches",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := replacePkgPath(tt.input, replacer)
			if result != tt.expected {
				t.Errorf("replacePkgPath(%q) = %q, want %q\nReason: %s",
					tt.input, result, tt.expected, tt.reason)
			}
		})
	}
}
