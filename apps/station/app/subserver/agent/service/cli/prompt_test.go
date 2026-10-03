package cli

import (
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
)

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

func TestBuildConversationPromptIncludesCompleteTurnContext(t *testing.T) {
	got := BuildConversationPrompt("follow the system contract", []domain.Message{
		{Role: domain.MessageRoleUser, Content: "first question"},
		{Role: domain.MessageRoleAssistant, Content: "first answer"},
		{Role: domain.MessageRoleTool, Content: "tool output"},
		{Role: domain.MessageRoleUser, Content: "follow up"},
	})
	want := "# System\nfollow the system contract\n\n" +
		"# Conversation\n" +
		"## user\nfirst question\n\n" +
		"## assistant\nfirst answer\n\n" +
		"## tool\ntool output\n\n" +
		"## user\nfollow up\n"
	if got != want {
		t.Fatalf("BuildConversationPrompt() = %q, want %q", got, want)
	}
}
