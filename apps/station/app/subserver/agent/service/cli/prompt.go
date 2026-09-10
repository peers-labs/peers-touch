package cli

import "strings"

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
