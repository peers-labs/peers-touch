package cli

import (
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
)

func BuildCliPrompt(identity, agentConfigPrompt, userInput string) string {
	var b strings.Builder

	if identity != "" {
		b.WriteString("# SOUL.md\n")
		b.WriteString(identity)
		b.WriteString("\n\n")
	}

	if agentConfigPrompt != "" {
		b.WriteString("# AGENTS.md\n")
		b.WriteString(agentConfigPrompt)
		b.WriteString("\n\n")
	}

	b.WriteString("# User\n")
	b.WriteString(userInput)
	b.WriteByte('\n')

	return b.String()
}

func BuildConversationPrompt(systemPrompt string, messages []domain.Message) string {
	var b strings.Builder

	if strings.TrimSpace(systemPrompt) != "" {
		b.WriteString("# System\n")
		b.WriteString(systemPrompt)
		b.WriteString("\n\n")
	}

	if len(messages) > 0 {
		b.WriteString("# Conversation\n")
		for _, message := range messages {
			if strings.TrimSpace(message.Content) == "" {
				continue
			}
			b.WriteString("## ")
			b.WriteString(string(message.Role))
			b.WriteByte('\n')
			b.WriteString(message.Content)
			b.WriteString("\n\n")
		}
	}

	return strings.TrimSpace(b.String()) + "\n"
}
