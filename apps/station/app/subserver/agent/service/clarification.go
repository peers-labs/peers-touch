package service

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
)

const clarificationToolName = "ask_user"

type clarificationQuestion struct {
	Prompt  string   `json:"prompt"`
	Choices []string `json:"choices,omitempty"`
}

func (r *ToolRegistryService) registerClarificationTool() {
	r.Register(&domain.ToolDefinition{
		Name:        clarificationToolName,
		Description: "Ask the user a clarification question and wait for their answer before continuing. The user may choose an option or enter their own answer.",
		JSONSchema:  json.RawMessage(`{"type":"object","properties":{"prompt":{"type":"string","minLength":1,"maxLength":4000},"choices":{"type":"array","maxItems":12,"items":{"type":"string","minLength":1,"maxLength":500}}},"required":["prompt"],"additionalProperties":false}`),
		Handler: func(context.Context, *domain.ToolCallMeta, json.RawMessage) (*domain.ToolResult, error) {
			return nil, invalidToolState("clarification requires a committed ToolBatch answer")
		},
	})
}

func validateClarificationAnswer(arguments []byte, answer string, approved bool) error {
	var question clarificationQuestion
	decoder := json.NewDecoder(bytes.NewReader(arguments))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&question); err != nil || strings.TrimSpace(question.Prompt) == "" ||
		len(question.Prompt) > 16000 || len(question.Choices) > 12 {
		return invalidToolRequest("invalid clarification question")
	}
	if err := decoder.Decode(new(interface{})); err != io.EOF {
		return invalidToolRequest("invalid clarification question suffix")
	}
	seen := make(map[string]bool, len(question.Choices))
	for _, choice := range question.Choices {
		if strings.TrimSpace(choice) == "" || len(choice) > 2000 || seen[choice] {
			return invalidToolRequest("invalid clarification choices")
		}
		seen[choice] = true
	}
	if approved && (strings.TrimSpace(answer) == "" || len(answer) > 16000) {
		return invalidToolRequest("clarification answer must contain 1 to 16000 bytes")
	}
	if !approved && answer != "" {
		return invalidToolRequest("declined clarification cannot contain an answer")
	}
	return nil
}
