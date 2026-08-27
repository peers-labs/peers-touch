package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
)

func TestOpenAIThinkingModePayload(t *testing.T) {
	tests := []struct {
		name         string
		mode         domain.ThinkingMode
		wantThinking bool
	}{
		{name: "auto omits provider override", mode: domain.ThinkingModeAuto},
		{name: "disabled requests direct text", mode: domain.ThinkingModeDisabled, wantThinking: true},
		{name: "enabled requests thinking", mode: domain.ThinkingModeEnabled, wantThinking: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var payload map[string]interface{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
				if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
					t.Fatalf("decode provider request: %v", err)
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"},"finish_reason":"stop"}],"model":"test-model"}`))
			}))
			defer server.Close()

			provider := NewProviderService(nil)
			_, err := provider.callOpenAI(
				context.Background(),
				server.URL,
				"",
				"test-model",
				"",
				[]domain.Message{{Role: domain.MessageRoleUser, Content: "hello"}},
				"low",
				test.mode,
				64,
				nil,
			)
			if err != nil {
				t.Fatalf("call provider: %v", err)
			}

			thinking, present := payload["thinking"]
			if present != test.wantThinking {
				t.Fatalf("thinking field presence = %v, want %v", present, test.wantThinking)
			}
			if test.wantThinking {
				value, ok := thinking.(map[string]interface{})
				if !ok || value["type"] != string(test.mode) {
					t.Fatalf("thinking payload = %#v, want type %q", thinking, test.mode)
				}
			}
			if payload["reasoning_effort"] != "low" {
				t.Fatalf("reasoning effort changed by thinking mode: %#v", payload)
			}
		})
	}
}

func TestNormalizeThinkingMode(t *testing.T) {
	for input, want := range map[domain.ThinkingMode]domain.ThinkingMode{
		"":         domain.ThinkingModeAuto,
		"AUTO":     domain.ThinkingModeAuto,
		"enabled":  domain.ThinkingModeEnabled,
		"disabled": domain.ThinkingModeDisabled,
	} {
		got, err := normalizeThinkingMode(input)
		if err != nil {
			t.Fatalf("normalize %q: %v", input, err)
		}
		if got != want {
			t.Fatalf("normalize %q = %q, want %q", input, got, want)
		}
	}
	if _, err := normalizeThinkingMode("low"); err == nil {
		t.Fatal("reasoning effort must not be accepted as a thinking mode")
	}
}

func TestProviderThinkingControlUsesCatalogModelCapability(t *testing.T) {
	if got := providerThinkingControl("ark", "ep-20260623145021-n4xdm"); got != "ark" {
		t.Fatalf("Ark endpoint thinking control = %q, want ark", got)
	}
	if got := providerThinkingControl("openai", "gpt-4o"); got != "" {
		t.Fatalf("OpenAI model unexpectedly advertises thinking control %q", got)
	}
}

func TestAgentServicePreservesThinkingModeWhenUpdateOmitsIt(t *testing.T) {
	openRuntimeAuthorityDB(t, "thinking_mode_agent_update")
	service := NewAgentService()
	created, err := service.CreateAgent(context.Background(), domain.AgentUpsertOptions{
		ActorID:      "ptid:person:owner",
		Name:         "assistant",
		ThinkingMode: domain.ThinkingModeDisabled,
	})
	if err != nil {
		t.Fatalf("create agent: %v", err)
	}

	updated, err := service.UpdateAgent(context.Background(), domain.AgentUpsertOptions{
		ActorID: "ptid:person:owner",
		AgentID: created.AgentID,
		Name:    created.Name,
		Version: created.Version,
	})
	if err != nil {
		t.Fatalf("update agent: %v", err)
	}
	if updated.ThinkingMode != domain.ThinkingModeDisabled {
		t.Fatalf("thinking mode = %q, want disabled", updated.ThinkingMode)
	}
}
