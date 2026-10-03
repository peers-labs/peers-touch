// Changelog:
// 2026-04-11 — Initial creation: domain types for the Tool Registry system.
//   Defines ToolDefinition (schema + handler signature), ToolCallPayload,
//   and ToolResult types used by the central tool dispatcher.

package domain

import (
	"context"
	"encoding/json"
)

// ToolHandler is the execution function signature for a registered tool.
// It receives the parsed arguments as raw JSON and a context carrying
// agent/turn metadata.  The handler returns a textual result (for the LLM)
// and an optional error.
type ToolHandler func(ctx context.Context, meta *ToolCallMeta, args json.RawMessage) (*ToolResult, error)

// ToolDefinition describes a tool that the agent can invoke during a turn.
// The JSONSchema field is the OpenAI-compatible JSON schema for `parameters`.
type ToolDefinition struct {
	Name        string
	Description string
	JSONSchema  json.RawMessage
	Handler     ToolHandler
}

// ToolCallMeta carries per-invocation context that handlers may need.
type ToolCallMeta struct {
	ActorID        string
	AgentID        string
	ConversationID string
	TurnID         string
}

// ToolResult is the structured return from a tool handler.
type ToolResult struct {
	Content string
	IsError bool
}
