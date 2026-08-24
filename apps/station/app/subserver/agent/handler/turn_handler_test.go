package handler

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
)

type fakeStreamResponse struct {
	headers map[string]string
	body    bytes.Buffer
	status  int
	flushed bool
}

func (r *fakeStreamResponse) Header() map[string]string {
	if r.headers == nil {
		r.headers = map[string]string{}
	}
	return r.headers
}

func (r *fakeStreamResponse) SetHeader(key, value string) {
	r.Header()[key] = value
}

func (r *fakeStreamResponse) Write(data []byte) (int, error) {
	return r.body.Write(data)
}

func (r *fakeStreamResponse) Flush() error {
	r.flushed = true
	return nil
}

func (r *fakeStreamResponse) WriteHeader(status int) {
	r.status = status
}

func (r *fakeStreamResponse) Status() int {
	return r.status
}

func TestWriteTurnStreamEvent(t *testing.T) {
	resp := &fakeStreamResponse{}

	if err := writeTurnStreamEvent(resp, "progress", map[string]any{
		"type":  "progress",
		"stage": "turn_started",
	}); err != nil {
		t.Fatalf("writeTurnStreamEvent returned error: %v", err)
	}

	body := resp.body.String()
	if !strings.Contains(body, "event: progress\n") {
		t.Fatalf("expected progress event frame, got %q", body)
	}
	if !strings.Contains(body, `"stage":"turn_started"`) {
		t.Fatalf("expected JSON data frame, got %q", body)
	}
	if !strings.HasSuffix(body, "\n\n") {
		t.Fatalf("expected SSE frame terminator, got %q", body)
	}
	if !resp.flushed {
		t.Fatal("expected SSE frame to flush")
	}
}

func TestDomainTurnStatusToProtoProjectsLocalToolWaitAsRunning(t *testing.T) {
	if got := domainTurnStatusToProto(domain.TurnStatusWaitingLocalTool); got != model.TurnStatus_TURN_STATUS_RUNNING {
		t.Fatalf("waiting local tool must remain a non-terminal running projection, got %s", got)
	}
}

func TestTurnConfigFromRequestCarriesKnowledgeResources(t *testing.T) {
	handlers := NewTurnHandlers(&service.TurnService{}, service.NewToolRegistryService(nil, nil), nil, nil)
	config := handlers.turnConfigFromRequest(context.Background(), &model.ExecuteTurnRequest{
		ConversationId: "conv_1",
		AgentId:        "agent_1",
		UserInput:      "How do traces work?",
		KnowledgeResources: []*model.KnowledgeResource{{
			ResourceId: "kr_1",
			AgentId:    "agent_1",
			Type:       model.KnowledgeResourceType_KNOWLEDGE_RESOURCE_TYPE_DOCUMENT,
			Title:      "Trace Guide",
			Source:     "trace content",
			Policy:     model.KnowledgeResourcePolicy_KNOWLEDGE_RESOURCE_POLICY_ALWAYS,
			Status:     model.KnowledgeResourceStatus_KNOWLEDGE_RESOURCE_STATUS_BOUND,
		}},
	}, nil)

	if len(config.KnowledgeResources) != 1 {
		t.Fatalf("expected one knowledge resource, got %d", len(config.KnowledgeResources))
	}
	if config.KnowledgeResources[0].ResourceID != "kr_1" {
		t.Fatalf("expected resource id kr_1, got %q", config.KnowledgeResources[0].ResourceID)
	}
	if config.KnowledgeResources[0].Source != "trace content" {
		t.Fatalf("expected resource source to be preserved, got %q", config.KnowledgeResources[0].Source)
	}
}
