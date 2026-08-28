package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

func TestOpenAINativeToolRequestAndResponse(t *testing.T) {
	var payload map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode provider request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"choices": [{
				"message": {
					"content": "",
					"tool_calls": [{
						"id": "provider-call-1",
						"type": "function",
						"function": {"name": "skills_list", "arguments": "{}"}
					}]
				},
				"finish_reason": "tool_calls"
			}],
			"model": "test-model"
		}`))
	}))
	defer server.Close()

	provider := NewProviderService(nil)
	response, err := provider.callOpenAI(
		context.Background(),
		server.URL,
		"",
		"test-model",
		"",
		[]domain.Message{{Role: domain.MessageRoleUser, Content: "list skills"}},
		"",
		domain.ThinkingModeAuto,
		64,
		[]*domain.ToolDefinition{{
			Name:        "skills_list",
			Description: "List skills",
			JSONSchema:  json.RawMessage(`{"type":"object","properties":{}}`),
		}},
		nil,
	)
	if err != nil {
		t.Fatalf("call provider: %v", err)
	}
	if payload["tool_choice"] != "auto" {
		t.Fatalf("tool_choice = %#v, want auto", payload["tool_choice"])
	}
	tools, ok := payload["tools"].([]interface{})
	if !ok || len(tools) != 1 {
		t.Fatalf("tools payload = %#v", payload["tools"])
	}
	if len(response.ToolCalls) != 1 ||
		response.ToolCalls[0].ID != "provider-call-1" ||
		response.ToolCalls[0].Name != "skills_list" ||
		response.ToolCalls[0].Arguments != "{}" {
		t.Fatalf("provider ToolCalls = %+v", response.ToolCalls)
	}
}

func TestOpenAIStreamAssemblesNativeToolCallFragments(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"model\":\"test-model\",\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"provider-call-1\",\"type\":\"function\",\"function\":{\"name\":\"skills_\",\"arguments\":\"{\"}}]},\"finish_reason\":null}]}\n\n"))
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"name\":\"list\",\"arguments\":\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	provider := NewProviderService(nil)
	response, err := provider.callOpenAI(
		context.Background(),
		server.URL,
		"",
		"test-model",
		"",
		[]domain.Message{{Role: domain.MessageRoleUser, Content: "list skills"}},
		"",
		domain.ThinkingModeAuto,
		64,
		[]*domain.ToolDefinition{{
			Name:        "skills_list",
			Description: "List skills",
			JSONSchema:  json.RawMessage(`{"type":"object","properties":{}}`),
		}},
		func(context.Context, ProviderDelta) {},
	)
	if err != nil {
		t.Fatalf("call provider stream: %v", err)
	}
	if len(response.ToolCalls) != 1 ||
		response.ToolCalls[0].ID != "provider-call-1" ||
		response.ToolCalls[0].Name != "skills_list" ||
		response.ToolCalls[0].Arguments != "{}" {
		t.Fatalf("stream ToolCalls = %+v", response.ToolCalls)
	}
}

func TestOpenAIStreamRejectsTruncatedToolCall(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"provider-call-1\",\"type\":\"function\",\"function\":{\"name\":\"skills_list\",\"arguments\":\"{\"}}]},\"finish_reason\":null}]}\n\n"))
	}))
	defer server.Close()

	provider := NewProviderService(nil)
	_, err := provider.callOpenAI(
		context.Background(),
		server.URL,
		"",
		"test-model",
		"",
		[]domain.Message{{Role: domain.MessageRoleUser, Content: "list skills"}},
		"",
		domain.ThinkingModeAuto,
		64,
		[]*domain.ToolDefinition{{
			Name:        "skills_list",
			Description: "List skills",
			JSONSchema:  json.RawMessage(`{"type":"object","properties":{}}`),
		}},
		func(context.Context, ProviderDelta) {},
	)
	if err == nil {
		t.Fatal("truncated provider ToolCall stream must fail closed")
	}
}

func TestOpenAIContinuationPreservesToolCallLinkage(t *testing.T) {
	messages, err := toOpenAIMessages([]domain.Message{
		{
			Role:    domain.MessageRoleAssistant,
			Content: "",
			ToolCallsJSON: json.RawMessage(`[{
				"id":"tool-call-1",
				"type":"function",
				"function":{"name":"skills_list","arguments":"{}"}
			}]`),
		},
		{
			Role:         domain.MessageRoleTool,
			Content:      "[skills_list] No skills installed.",
			MetadataJSON: json.RawMessage(`{"tool_call_id":"tool-call-1"}`),
		},
	})
	if err != nil {
		t.Fatalf("convert continuation messages: %v", err)
	}
	if len(messages) != 2 ||
		len(messages[0].ToolCalls) != 1 ||
		messages[0].ToolCalls[0].ID != "tool-call-1" ||
		messages[1].ToolCallID != "tool-call-1" {
		t.Fatalf("continuation messages = %+v", messages)
	}
}

func TestToolSchemaContextSegmentUsesPinnedCapabilityLineage(t *testing.T) {
	manifest := &model.CapabilityManifest{
		CapabilityId:     "tool:skills_list",
		Version:          "manifest-version",
		SourceKind:       model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_BUILTIN_TOOL,
		SourceInstanceId: "skills_list",
	}
	authorized := &AuthorizedCapabilitySet{
		byCapability: map[string]AuthorizedCapability{
			authorizedCapabilityKey(manifest.GetCapabilityId(), manifest.GetVersion()): {
				Manifest: manifest,
			},
		},
		bySource: map[string]AuthorizedCapability{
			authorizedSourceKey(manifest.GetSourceKind(), manifest.GetSourceInstanceId()): {
				Manifest: manifest,
			},
		},
	}
	segment, tokens, err := toolSchemaContextSegment(
		authorized,
		[]*domain.ToolDefinition{{
			Name:        "skills_list",
			Description: "List skills",
			JSONSchema:  json.RawMessage(`{"type":"object","properties":{}}`),
		}},
	)
	if err != nil {
		t.Fatalf("build Tool schema segment: %v", err)
	}
	if segment == nil ||
		segment.Type != model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_TOOL_SCHEMA ||
		segment.Decision != model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_INCLUDED ||
		tokens == 0 ||
		len(segment.SourceRefs) != 1 ||
		segment.SourceRefs[0] != "capability:tool:skills_list@manifest-version" {
		t.Fatalf("Tool schema segment = %+v, tokens=%d", segment, tokens)
	}
}

func TestTruncateRunesPreservesPersistenceBounds(t *testing.T) {
	value := "failure:" + strings.Repeat("x", 120)
	truncated := truncateRunes(value, 100)
	if len([]rune(truncated)) != 100 {
		t.Fatalf("bounded failure length = %d, want 100", len([]rune(truncated)))
	}
	if got := truncateRunes("短错误", 100); got != "短错误" {
		t.Fatalf("short unicode failure changed: %q", got)
	}
}
