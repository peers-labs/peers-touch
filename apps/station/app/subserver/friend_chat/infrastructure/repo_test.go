package infrastructure

import "testing"

func TestConversationSettingsBackgroundNormalization(t *testing.T) {
	for _, tc := range []struct {
		name  string
		input string
		want  string
	}{
		{name: "empty", input: "", want: "default"},
		{name: "blank", input: "  ", want: "default"},
		{name: "default", input: "default", want: "default"},
		{name: "paper", input: "paper", want: "paper"},
		{name: "mint", input: "mint", want: "mint"},
		{name: "dusk", input: "dusk", want: "dusk"},
		{name: "calm", input: "calm", want: "calm"},
		{name: "graphite", input: "graphite", want: "graphite"},
		{name: "unknown", input: "neon", want: "default"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := normalizedBackground(tc.input); got != tc.want {
				t.Fatalf("normalizedBackground(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}
