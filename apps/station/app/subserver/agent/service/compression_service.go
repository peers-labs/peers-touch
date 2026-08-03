// compression_service.go — Context compression service for agent conversations.
// Created: 2026-04-11 — Initial implementation of context window compression
// with tool-output pruning, structured/iterative summarization prompts, and
// tool-call/result pair sanitization.
// 2026-04-11 — Added SetPreviousSummary() to allow turn_service to store actual
//
//	LLM-generated summary text instead of the raw summary prompt.
//
// 2026-04-11 — Fix: added sync.RWMutex to protect previousSummary from
//
//	concurrent read/write races. Added GetPreviousSummary() accessor.
//
// 2026-04-11 — Removed previousSummary state and BuildIterativeSummaryPrompt.
//
//	The summary text is already injected into the message list as a system
//	message after compression, so the LLM naturally sees prior summaries
//	on subsequent compressions. Keeping per-instance state caused:
//	(a) multi-conversation cross-contamination (singleton shared across convs),
//	(b) process-restart inconsistency, (c) unnecessary complexity.
package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

const (
	CompressionThresholdPercent = 0.50
	SummaryRatio                = 0.20
	MinSummaryTokens            = 2000
	SummaryTokensCeiling        = 12000
	ProtectFirstN               = 3
	PrunedToolPlaceholder       = "[Old tool output cleared to save context space]"
	ToolOutputPruneThreshold    = 200
)

type CompressionResult struct {
	Messages     []domain.Message
	Summary      string
	TokensBefore int
	TokensAfter  int
	WasPruned    bool
}

type CompressionService struct{}

func NewCompressionService() *CompressionService {
	return &CompressionService{}
}

// ShouldCompress returns true when prompt tokens exceed the compression
// threshold relative to the full context window.
func (s *CompressionService) ShouldCompress(promptTokens int, contextWindowSize int) bool {
	return float64(promptTokens) > float64(contextWindowSize)*CompressionThresholdPercent
}

// EstimateTokens provides a fast heuristic token count for a message slice.
// Each message contributes len(Content)/4 + 10 (per-message overhead), plus
// len(ToolCallsJSON)/4 when tool-call arguments are present.
func (s *CompressionService) EstimateTokens(messages []domain.Message) int {
	total := 0
	for _, m := range messages {
		tokens := len(m.Content)/4 + 10
		if len(m.ToolCallsJSON) > 0 {
			tokens += len(m.ToolCallsJSON) / 4
		}
		total += tokens
	}
	return total
}

// PruneToolOutputs replaces large tool-role message content with a compact
// placeholder. Messages near the tail of the conversation are protected so
// that recent tool results remain available to the model.
func (s *CompressionService) PruneToolOutputs(messages []domain.Message) []domain.Message {
	n := len(messages)
	if n == 0 {
		return messages
	}

	result := make([]domain.Message, n)
	copy(result, messages)

	protected := make([]bool, n)

	protectCount := ProtectFirstN
	if protectCount > n {
		protectCount = n
	}

	tokenBudget := 0
	budgetLimit := s.EstimateTokens(messages) / 3

	for i := n - 1; i >= 0; i-- {
		tokens := len(result[i].Content)/4 + 10
		if tokenBudget+tokens <= budgetLimit || i >= n-protectCount {
			protected[i] = true
			tokenBudget += tokens
		}
	}

	for i := 0; i < n; i++ {
		if protected[i] {
			continue
		}
		if result[i].Role == domain.MessageRoleTool && len(result[i].Content) > ToolOutputPruneThreshold {
			result[i].Content = PrunedToolPlaceholder
		}
	}

	return result
}

// ComputeSummaryBudget determines how many tokens the summary should target.
// The budget is based on SummaryRatio of content tokens, clamped between
// MinSummaryTokens and the lesser of SummaryTokensCeiling or 5% of the
// context length.
func (s *CompressionService) ComputeSummaryBudget(contentTokens int, contextLength int) int {
	budget := float64(contentTokens) * SummaryRatio

	contextCap := float64(contextLength) * 0.05

	capped := budget
	if capped > contextCap {
		capped = contextCap
	}
	if capped > SummaryTokensCeiling {
		capped = SummaryTokensCeiling
	}
	if capped < MinSummaryTokens {
		capped = MinSummaryTokens
	}

	return int(capped)
}

// BuildStructuredSummaryPrompt constructs the first-time summarization prompt
// that asks the LLM to produce a section-based summary of the conversation.
func (s *CompressionService) BuildStructuredSummaryPrompt(messages []domain.Message) string {
	var b strings.Builder

	b.WriteString("Summarize the following conversation into a structured format.\n")
	b.WriteString("Use these sections:\n")
	b.WriteString("## Goal\n")
	b.WriteString("[What the user is trying to accomplish]\n")
	b.WriteString("## Constraints & Preferences\n")
	b.WriteString("## Progress\n")
	b.WriteString("### Done\n")
	b.WriteString("### In Progress\n")
	b.WriteString("### Blocked\n")
	b.WriteString("## Key Decisions\n")
	b.WriteString("## Relevant Files\n")
	b.WriteString("## Next Steps\n")
	b.WriteString("## Critical Context\n")
	b.WriteString("## Tools & Patterns\n")
	b.WriteString("\nConversation to summarize:\n")
	b.WriteString(formatMessagesForSummary(messages))

	return b.String()
}

// SplitMessages divides the conversation into a head portion (to summarize)
// and a protected tail. The tail budget is derived from the context window
// and compression threshold. Tool-call / tool-result groups are never split.
func (s *CompressionService) SplitMessages(messages []domain.Message, contextWindowSize int) (toSummarize []domain.Message, tail []domain.Message) {
	n := len(messages)
	if n == 0 {
		return nil, nil
	}

	budget := int(SummaryRatio * float64(contextWindowSize) * CompressionThresholdPercent)
	softCeiling := int(float64(budget) * 1.5)

	splitIdx := n
	accumulated := 0

	for i := n - 1; i >= 0; i-- {
		tokens := len(messages[i].Content)/4 + 10
		if len(messages[i].ToolCallsJSON) > 0 {
			tokens += len(messages[i].ToolCallsJSON) / 4
		}

		if accumulated+tokens > softCeiling && (n-i) >= ProtectFirstN {
			splitIdx = i + 1
			break
		}
		accumulated += tokens
	}

	if n-splitIdx < ProtectFirstN {
		splitIdx = n - ProtectFirstN
		if splitIdx < 0 {
			splitIdx = 0
		}
	}

	// Never split inside a tool-call / tool-result group: if the message at
	// splitIdx is a tool-role response, walk backward to include the
	// preceding assistant message that carries the tool call.
	for splitIdx > 0 && splitIdx < n && messages[splitIdx].Role == domain.MessageRoleTool {
		splitIdx--
	}

	toSummarize = messages[:splitIdx]
	tail = messages[splitIdx:]
	return
}

// SanitizePairs ensures every tool call has a matching result and vice-versa.
// Orphan tool results are removed; orphan tool calls get a stub result
// appended so the model always sees balanced pairs.
func (s *CompressionService) SanitizePairs(messages []domain.Message) []domain.Message {
	var sanitized []domain.Message

	// Phase 1 — remove orphan tool results by verifying a preceding tool
	// call exists for each tool-role message.
	hasToolCall := false
	for _, m := range messages {
		if len(m.ToolCallsJSON) > 0 {
			hasToolCall = true
		}

		if m.Role == domain.MessageRoleTool && !hasToolCall {
			continue
		}

		if m.Role == domain.MessageRoleTool {
			hasToolCall = false
		}
		sanitized = append(sanitized, m)
	}

	// Phase 2 — append stub results for orphan tool calls at the end.
	var result []domain.Message
	for i, m := range sanitized {
		result = append(result, m)

		if len(m.ToolCallsJSON) == 0 {
			continue
		}

		hasResult := false
		if i+1 < len(sanitized) && sanitized[i+1].Role == domain.MessageRoleTool {
			hasResult = true
		}

		if !hasResult {
			result = append(result, domain.Message{
				Role:    domain.MessageRoleTool,
				Content: "[Result from earlier conversation — see context summary above]",
			})
		}
	}

	return result
}

// Compress is the main orchestration entry-point. It prunes tool outputs,
// splits messages, builds the appropriate summary prompt, sanitizes pairs,
// and returns a CompressionResult. The actual LLM call is NOT performed
// here — the Summary field contains the prompt for the caller (turn_service)
// to send to the model.
func (s *CompressionService) Compress(ctx context.Context, messages []domain.Message, contextWindowSize int) (*CompressionResult, error) {
	tokensBefore := s.EstimateTokens(messages)
	logger.Infof(ctx, "compression started, messages=%d tokens_before=%d context_window=%d",
		len(messages), tokensBefore, contextWindowSize)

	pruned := s.PruneToolOutputs(messages)
	wasPruned := false
	for i := range pruned {
		if pruned[i].Content != messages[i].Content {
			wasPruned = true
			break
		}
	}

	toSummarize, tail := s.SplitMessages(pruned, contextWindowSize)
	logger.Infof(ctx, "split result: to_summarize=%d tail=%d", len(toSummarize), len(tail))

	summaryPrompt := s.BuildStructuredSummaryPrompt(toSummarize)

	sanitized := s.SanitizePairs(tail)
	tokensAfter := s.EstimateTokens(sanitized)

	logger.Infof(ctx, "compression complete, tokens_after=%d pruned=%v", tokensAfter, wasPruned)

	return &CompressionResult{
		Messages:     sanitized,
		Summary:      summaryPrompt,
		TokensBefore: tokensBefore,
		TokensAfter:  tokensAfter,
		WasPruned:    wasPruned,
	}, nil
}

// formatMessagesForSummary renders a message slice as "Role: content" lines
// for inclusion in summarization prompts.
func formatMessagesForSummary(messages []domain.Message) string {
	var b strings.Builder
	for _, m := range messages {
		b.WriteString(fmt.Sprintf("%s: %s\n", m.Role, m.Content))
	}
	return b.String()
}
