package cli

import (
	"fmt"
	"strings"
)

type PromptDelivery int

const (
	PromptViaStdin    PromptDelivery = iota
	PromptViaArgument
)

type NormalizedCommand struct {
	Program       string
	Args          []string
	AdapterName   string
	PromptMethod  PromptDelivery
}

func NormalizeCommand(raw string) (NormalizedCommand, error) {
	parts := splitCommandLine(raw)
	if len(parts) == 0 {
		return NormalizedCommand{}, fmt.Errorf("cli_command is empty")
	}

	if len(parts) == 1 {
		return expandAdapter(parts[0])
	}

	program := parts[0]
	adapter := adapterName(program)
	return NormalizedCommand{
		Program:      program,
		Args:         parts[1:],
		AdapterName:  adapter,
		PromptMethod: promptMethod(adapter),
	}, nil
}

func expandAdapter(name string) (NormalizedCommand, error) {
	n := strings.TrimSpace(strings.ToLower(name))
	switch n {
	case "trae", "traecli", "traex":
		return NormalizedCommand{
			Program:      "traecli",
			Args:         []string{"exec", "--skip-git-repo-check", "-"},
			AdapterName:  "trae",
			PromptMethod: PromptViaStdin,
		}, nil
	case "codex":
		return NormalizedCommand{
			Program:      "codex",
			Args:         []string{"exec", "--skip-git-repo-check", "-"},
			AdapterName:  "codex",
			PromptMethod: PromptViaStdin,
		}, nil
	case "claude":
		return NormalizedCommand{
			Program:      "claude",
			Args:         []string{"-p"},
			AdapterName:  "claude",
			PromptMethod: PromptViaStdin,
		}, nil
	case "cursor", "cursor-agent":
		return NormalizedCommand{
			Program:      "cursor-agent",
			Args:         []string{"--print", "--output-format", "text", "--trust"},
			AdapterName:  "cursor",
			PromptMethod: PromptViaArgument,
		}, nil
	default:
		return NormalizedCommand{
			Program:      name,
			Args:         nil,
			AdapterName:  "custom",
			PromptMethod: PromptViaStdin,
		}, nil
	}
}

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

func splitCommandLine(s string) []string {
	var parts []string
	var current strings.Builder
	inQuote := false
	quoteChar := byte(0)

	for i := 0; i < len(s); i++ {
		ch := s[i]
		if inQuote {
			if ch == quoteChar {
				inQuote = false
			} else {
				current.WriteByte(ch)
			}
		} else {
			switch ch {
			case '"', '\'':
				inQuote = true
				quoteChar = ch
			case ' ', '\t':
				if current.Len() > 0 {
					parts = append(parts, current.String())
					current.Reset()
				}
			default:
				current.WriteByte(ch)
			}
		}
	}
	if current.Len() > 0 {
		parts = append(parts, current.String())
	}
	return parts
}
