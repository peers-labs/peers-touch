package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

type homeAgentListerStub struct {
	agents []domain.Agent
	err    error
}

func (s homeAgentListerStub) ListAgents(
	context.Context,
	domain.AgentListOptions,
) ([]domain.Agent, int64, error) {
	return s.agents, int64(len(s.agents)), s.err
}

type homeConversationListerStub struct {
	byAgent map[string][]*domain.Conversation
	errors  map[string]error
}

func (s homeConversationListerStub) ListConversations(
	_ context.Context,
	agentID string,
	_ string,
	_ string,
	_ int,
	_ int,
) ([]*domain.Conversation, int64, error) {
	if err := s.errors[agentID]; err != nil {
		return nil, 0, err
	}
	conversations := s.byAgent[agentID]
	return conversations, int64(len(conversations)), nil
}

func TestHomeProjectionUsesStationAgentsAndRecentConversations(t *testing.T) {
	older := time.Date(2026, 9, 15, 10, 0, 0, 0, time.UTC)
	newer := older.Add(time.Hour)
	svc := NewHomeProjectionService(
		homeAgentListerStub{agents: []domain.Agent{
			{
				AgentID:    "agent-1",
				Name:       "researcher",
				Title:      "Researcher",
				ConfigJSON: `{"pinned":true,"avatar":"avatar://researcher"}`,
				UpdatedAt:  older,
			},
			{
				AgentID:    "agent-2",
				Name:       "writer",
				Title:      "Writer",
				ConfigJSON: `{"pinned":false}`,
				UpdatedAt:  newer,
			},
		}},
		homeConversationListerStub{byAgent: map[string][]*domain.Conversation{
			"agent-1": {
				{
					ConversationID: "conversation-old",
					AgentID:        "agent-1",
					Title:          "Older",
					UpdatedAt:      older,
				},
			},
			"agent-2": {
				{
					ConversationID: "conversation-new",
					AgentID:        "agent-2",
					Title:          "Newer",
					UpdatedAt:      newer,
				},
			},
		}},
		nil,
		nil,
	)
	svc.now = func() time.Time { return newer.Add(time.Minute) }

	projection, err := svc.Get(context.Background(), "ptid:actor-1", 0)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if projection.GetPtid() != "ptid:actor-1" {
		t.Fatalf("ptid = %q", projection.GetPtid())
	}
	if projection.GetFreshness() != model.HomeProjectionFreshness_HOME_PROJECTION_FRESHNESS_FRESH {
		t.Fatalf("freshness = %s", projection.GetFreshness())
	}
	if len(projection.GetPinnedAgents()) != 1 ||
		projection.GetPinnedAgents()[0].GetAgentId() != "agent-1" ||
		projection.GetPinnedAgents()[0].GetAgentName() != "researcher" {
		t.Fatalf("pinned agents = %+v", projection.GetPinnedAgents())
	}
	if len(projection.GetRecentWork()) != 2 ||
		projection.GetRecentWork()[0].GetWorkId() != "conversation-new" {
		t.Fatalf("recent work = %+v", projection.GetRecentWork())
	}
	if projection.GetRevision() != uint64(newer.UnixNano()) {
		t.Fatalf("revision = %d, want %d", projection.GetRevision(), newer.UnixNano())
	}
}

func TestHomeProjectionPreservesValidSlicesWhenOneConversationSourceFails(t *testing.T) {
	now := time.Date(2026, 9, 16, 12, 0, 0, 0, time.UTC)
	svc := NewHomeProjectionService(
		homeAgentListerStub{agents: []domain.Agent{
			{AgentID: "agent-1", Name: "one", UpdatedAt: now},
			{AgentID: "agent-2", Name: "two", UpdatedAt: now},
		}},
		homeConversationListerStub{
			byAgent: map[string][]*domain.Conversation{
				"agent-1": {
					{
						ConversationID: "conversation-1",
						AgentID:        "agent-1",
						Title:          "Available",
						UpdatedAt:      now,
					},
				},
			},
			errors: map[string]error{"agent-2": errors.New("source unavailable")},
		},
		nil,
		nil,
	)
	svc.now = func() time.Time { return now }

	projection, err := svc.Get(context.Background(), "ptid:actor-1", 0)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if projection.GetFreshness() != model.HomeProjectionFreshness_HOME_PROJECTION_FRESHNESS_PARTIAL {
		t.Fatalf("freshness = %s", projection.GetFreshness())
	}
	if len(projection.GetRecentWork()) != 1 {
		t.Fatalf("recent work = %+v", projection.GetRecentWork())
	}
	if len(projection.GetSliceErrors()) != 1 ||
		projection.GetSliceErrors()[0].GetSliceId() != "recent_work:agent-2" ||
		!projection.GetSliceErrors()[0].GetRetryable() {
		t.Fatalf("slice errors = %+v", projection.GetSliceErrors())
	}
}

func TestHomeProjectionRejectsMissingActor(t *testing.T) {
	svc := NewHomeProjectionService(
		homeAgentListerStub{},
		homeConversationListerStub{},
		nil,
		nil,
	)

	if _, err := svc.Get(context.Background(), " ", 0); err == nil {
		t.Fatal("Get() error = nil, want actor validation error")
	}
}
