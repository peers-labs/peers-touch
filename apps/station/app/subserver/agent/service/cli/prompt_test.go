package cli

import "testing"

func TestBuildCliPromptIncludesConfiguredSections(t *testing.T) {
	got := BuildCliPrompt("identity", "agent configuration", "user request")
	want := "# SOUL.md\nidentity\n\n# AGENTS.md\nagent configuration\n\n# User\nuser request\n"

	if got != want {
		t.Fatalf("BuildCliPrompt() = %q, want %q", got, want)
	}
}

func TestBuildCliPromptOmitsEmptyOptionalSections(t *testing.T) {
	got := BuildCliPrompt("", "", "user request")
	want := "# User\nuser request\n"

	if got != want {
		t.Fatalf("BuildCliPrompt() = %q, want %q", got, want)
	}
}
