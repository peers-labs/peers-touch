package externalruntime

import (
	"encoding/json"
	"fmt"
	"strings"
)

type Activity struct {
	ID     string `json:"id"`
	Kind   string `json:"kind"`
	Status string `json:"status"`
	Title  string `json:"title"`
	Detail string `json:"detail,omitempty"`
}

type Delta struct {
	Type     string
	Content  string
	Activity *Activity
}

type normalizedEvent struct {
	sessionID   string
	delta       *Delta
	failureCode string
	terminal    bool
}

func normalizeEvent(line string) (normalizedEvent, error) {
	if line == "" {
		return normalizedEvent{}, nil
	}
	var raw map[string]any
	if err := json.Unmarshal([]byte(line), &raw); err != nil {
		return normalizedEvent{}, fmt.Errorf("external runtime emitted invalid JSONL")
	}
	eventType := strings.ToLower(strings.TrimSpace(stringField(raw, "type")))
	switch eventType {
	case "session.started":
		return normalizedEvent{sessionID: safeIdentifier(stringField(raw, "session_id"))}, nil
	case "thread.started":
		return normalizedEvent{sessionID: safeIdentifier(stringField(raw, "thread_id"))}, nil
	case "text.delta", "delta":
		return normalizedEvent{delta: &Delta{
			Type:    "text",
			Content: boundedText(stringField(raw, "content")),
		}}, nil
	case "thinking", "reasoning":
		return normalizedEvent{delta: &Delta{
			Type:    "thinking",
			Content: boundedText(stringField(raw, "content")),
		}}, nil
	case "activity":
		activity := normalizeActivity(raw["activity"])
		return normalizedEvent{delta: &Delta{
			Type:     "external_activity",
			Activity: activity,
			Content:  marshalActivity(activity),
		}}, nil
	case "item.completed":
		return normalizeCompletedItem(raw["item"])
	case "turn.completed", "turn.complete", "done", "completed":
		content := boundedText(firstString(raw, "content", "text"))
		if content == "" {
			return normalizedEvent{terminal: true}, nil
		}
		return normalizedEvent{
			delta:    &Delta{Type: "text", Content: content},
			terminal: true,
		}, nil
	case "turn.failed":
		code := strings.ToLower(strings.TrimSpace(stringField(raw, "code")))
		if code == "" && resumeUnavailableText(stringField(raw, "message")) {
			code = "resume_unavailable"
		}
		if code == "" {
			code = "execution_failed"
		}
		return normalizedEvent{failureCode: code}, nil
	case "error", "turn.started", "progress", "status", "stage":
		return normalizedEvent{}, nil
	default:
		return normalizedEvent{}, nil
	}
}

func normalizeCompletedItem(value any) (normalizedEvent, error) {
	item, _ := value.(map[string]any)
	itemType := strings.ToLower(strings.TrimSpace(stringField(item, "type")))
	switch itemType {
	case "agent_message":
		return normalizedEvent{delta: &Delta{
			Type:    "text",
			Content: boundedText(firstString(item, "text", "content")),
		}}, nil
	case "reasoning", "thinking":
		return normalizedEvent{delta: &Delta{
			Type:    "thinking",
			Content: boundedText(firstString(item, "text", "content")),
		}}, nil
	case "command_execution", "file_change", "todo_list", "mcp_tool_call",
		"collab_agent_tool_call":
		activity := &Activity{
			ID:     safeIdentifier(stringField(item, "id")),
			Kind:   itemType,
			Status: "completed",
			Title:  activityTitle(itemType),
		}
		return normalizedEvent{delta: &Delta{
			Type:     "external_activity",
			Activity: activity,
			Content:  marshalActivity(activity),
		}}, nil
	default:
		return normalizedEvent{}, nil
	}
}

func normalizeActivity(value any) *Activity {
	raw, _ := value.(map[string]any)
	return &Activity{
		ID:     safeIdentifier(stringField(raw, "id")),
		Kind:   safeToken(stringField(raw, "kind")),
		Status: safeToken(stringField(raw, "status")),
		Title:  boundedText(stringField(raw, "title")),
		Detail: boundedText(stringField(raw, "detail")),
	}
}

func activityTitle(kind string) string {
	switch kind {
	case "command_execution":
		return "Command"
	case "file_change":
		return "File change"
	case "todo_list":
		return "Todo"
	case "mcp_tool_call":
		return "MCP tool"
	case "collab_agent_tool_call":
		return "Subagent"
	default:
		return "External activity"
	}
}

func marshalActivity(activity *Activity) string {
	encoded, _ := json.Marshal(activity)
	return string(encoded)
}

func safeIdentifier(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 256 || strings.ContainsAny(value, "\x00\r\n") {
		return ""
	}
	return value
}

func safeToken(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" || len(value) > 64 {
		return ""
	}
	for _, char := range value {
		if (char < 'a' || char > 'z') &&
			(char < '0' || char > '9') &&
			char != '_' && char != '-' && char != '.' {
			return ""
		}
	}
	return value
}

func boundedText(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > 4096 {
		return value[:4096]
	}
	return value
}

func stringField(value map[string]any, key string) string {
	if value == nil {
		return ""
	}
	text, _ := value[key].(string)
	return text
}

func firstString(value map[string]any, keys ...string) string {
	for _, key := range keys {
		if text := stringField(value, key); text != "" {
			return text
		}
	}
	return ""
}

func resumeUnavailableText(value string) bool {
	value = strings.ToLower(value)
	return strings.Contains(value, "resume_unavailable") ||
		strings.Contains(value, "session not found") ||
		strings.Contains(value, "thread not found") ||
		strings.Contains(value, "no rollout found")
}
