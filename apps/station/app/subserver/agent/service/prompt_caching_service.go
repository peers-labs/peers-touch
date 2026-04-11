// prompt_caching_service.go — Prompt caching service for Anthropic's system_and_3 strategy.
// Created: 2026-04-11 — Initial implementation of the system_and_3 caching strategy
// that inserts 4 cache_control breakpoints (system prompt + last 3 messages)
// into Anthropic API requests to maximize prompt cache hits.
package service

import (
	"context"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// ---------------------------------------------------------------------------
// Types — Anthropic cache-control wire format
// ---------------------------------------------------------------------------

// CacheControl represents the Anthropic cache marker applied at breakpoints.
type CacheControl struct {
	Type string `json:"type"`
}

// ContentBlock is the structured content format required by Anthropic when
// cache_control markers are present. Plain string content must be promoted
// to this block format.
type ContentBlock struct {
	Type         string        `json:"type"`
	Text         string        `json:"text"`
	CacheControl *CacheControl `json:"cache_control,omitempty"`
}

// CachedMessage mirrors a conversation message with its content field left
// as interface{} so it can carry either a plain string (no caching) or a
// []ContentBlock slice (with caching breakpoints).
type CachedMessage struct {
	Role    string      `json:"role"`
	Content interface{} `json:"content"` // string or []ContentBlock
}

// PromptCachingResult holds the transformed system content and messages
// after breakpoint injection.
type PromptCachingResult struct {
	SystemContent   []ContentBlock
	Messages        []CachedMessage
	BreakpointCount int
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

// PromptCachingService applies the system_and_3 caching strategy for
// Anthropic providers. Four ephemeral cache_control breakpoints are placed:
//
//	BP-1  system prompt (full text)
//	BP-2  3rd-to-last non-system message
//	BP-3  2nd-to-last non-system message
//	BP-4  last non-system message
type PromptCachingService struct{}

func NewPromptCachingService() *PromptCachingService {
	return &PromptCachingService{}
}

// Apply is the main entry point. It transforms the system prompt and message
// slice into Anthropic-compatible structures with cache_control breakpoints.
// Returns nil when the provider is not Anthropic (caching is a no-op).
func (s *PromptCachingService) Apply(
	ctx context.Context,
	systemPrompt string,
	messages []domain.Message,
	providerType string,
) *PromptCachingResult {

	if !s.isAnthropicProvider(providerType) {
		logger.Infof(ctx, "prompt caching: skipped, provider %q is not anthropic", providerType)
		return nil
	}

	breakpoints := 0
	marker := &CacheControl{Type: "ephemeral"}

	// BP-1 — Cache the full system prompt.
	systemBlocks := []ContentBlock{
		{
			Type:         "text",
			Text:         systemPrompt,
			CacheControl: marker,
		},
	}
	breakpoints++

	// Collect indices of non-system messages for breakpoint targeting.
	nonSystemIndices := make([]int, 0, len(messages))
	for i := range messages {
		if messages[i].Role != domain.MessageRoleSystem {
			nonSystemIndices = append(nonSystemIndices, i)
		}
	}

	// Determine which indices receive BP-2, BP-3, BP-4 (last 3 non-system).
	bpTargets := make(map[int]bool)
	count := len(nonSystemIndices)

	if count >= 3 {
		bpTargets[nonSystemIndices[count-3]] = true // BP-2
		bpTargets[nonSystemIndices[count-2]] = true // BP-3
		bpTargets[nonSystemIndices[count-1]] = true // BP-4
	} else {
		// Fewer than 3 non-system messages — mark all of them.
		for _, idx := range nonSystemIndices {
			bpTargets[idx] = true
		}
	}

	// Build the cached message slice.
	cachedMessages := make([]CachedMessage, 0, len(messages))

	for i, msg := range messages {
		cm := CachedMessage{
			Role: string(msg.Role),
		}

		if bpTargets[i] {
			// Promote content to block format with cache_control marker.
			cm.Content = []ContentBlock{
				{
					Type:         "text",
					Text:         msg.Content,
					CacheControl: marker,
				},
			}
			breakpoints++
		} else {
			// Keep original string content — no breakpoint needed.
			cm.Content = msg.Content
		}

		cachedMessages = append(cachedMessages, cm)
	}

	logger.Infof(ctx, "prompt caching: applied system_and_3 strategy, breakpoints=%d messages=%d non_system=%d",
		breakpoints, len(messages), len(nonSystemIndices))

	return &PromptCachingResult{
		SystemContent:   systemBlocks,
		Messages:        cachedMessages,
		BreakpointCount: breakpoints,
	}
}

// isAnthropicProvider performs a case-insensitive check for the "anthropic" provider type.
func (s *PromptCachingService) isAnthropicProvider(providerType string) bool {
	return strings.EqualFold(providerType, "anthropic")
}
