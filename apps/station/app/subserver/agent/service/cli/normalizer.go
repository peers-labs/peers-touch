package cli

import (
	"strings"
)

type PromptDelivery int

const (
	PromptViaStdin PromptDelivery = iota
	PromptViaArgument
)

func adapterName(program string) string {
	base := strings.ToLower(program)
	if idx := strings.LastIndex(base, "/"); idx >= 0 {
		base = base[idx+1:]
	}
	switch {
	case strings.Contains(base, "trae"):
		return "trae"
	case strings.Contains(base, "codex"):
		return "codex"
	case strings.Contains(base, "claude"):
		return "claude"
	case strings.Contains(base, "cursor"):
		return "cursor"
	default:
		return "custom"
	}
}

func promptMethod(adapter string) PromptDelivery {
	if adapter == "cursor" {
		return PromptViaArgument
	}
	return PromptViaStdin
}
