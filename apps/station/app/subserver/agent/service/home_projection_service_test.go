package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/types/known/timestamppb"
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

type homeReadinessGetterStub struct {
	byAgent map[string]*model.CapabilityReadinessSnapshot
	errors  map[string]error
}

func (s homeReadinessGetterStub) Get(
	_ context.Context,
	_ string,
	req *model.GetCapabilityReadinessRequest,
) (*model.CapabilityReadinessSnapshot, error) {
	if err := s.errors[req.GetAgentId()]; err != nil {
		return nil, err
	}
	return s.byAgent[req.GetAgentId()], nil
}

type homeTaskListerStub struct {
	tasks []*persistence.AgentTask
	err   error
}

func (s homeTaskListerStub) ListTasks(
	context.Context,
	string,
	string,
) ([]*persistence.AgentTask, error) {
	return s.tasks, s.err
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

func TestHomeProjectionIgnoresUnpinnedAgentReadinessFailure(t *testing.T) {
	now := time.Date(2026, 9, 16, 12, 0, 0, 0, time.UTC)
	svc := NewHomeProjectionService(
		homeAgentListerStub{agents: []domain.Agent{
			{
				AgentID:    "agent-pinned",
				Name:       "ready",
				ProviderID: "provider-1",
				ModelName:  "model-1",
				ConfigJSON: `{"pinned":true}`,
				UpdatedAt:  now,
			},
			{
				AgentID:    "agent-unpinned",
				Name:       "unconfigured",
				ConfigJSON: `{"pinned":false}`,
				UpdatedAt:  now,
			},
		}},
		homeConversationListerStub{},
		homeReadinessGetterStub{
			byAgent: map[string]*model.CapabilityReadinessSnapshot{
				"agent-pinned": {
					SnapshotId:        "readiness-pinned",
					AgentId:           "agent-pinned",
					RuntimeSnapshotId: "runtime-pinned",
					CreatedAt:         timestamppb.New(now),
				},
			},
			errors: map[string]error{
				"agent-unpinned": errors.New("provider is not configured"),
			},
		},
		nil,
	)
	svc.now = func() time.Time { return now }

	projection, err := svc.Get(context.Background(), "ptid:actor-1", 0)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if projection.GetFreshness() != model.HomeProjectionFreshness_HOME_PROJECTION_FRESHNESS_FRESH {
		t.Fatalf("freshness = %s, want fresh", projection.GetFreshness())
	}
	if len(projection.GetPinnedAgents()) != 1 ||
		projection.GetPinnedAgents()[0].GetAgentId() != "agent-pinned" {
		t.Fatalf("pinned agents = %+v", projection.GetPinnedAgents())
	}
	if len(projection.GetReadiness()) != 1 ||
		projection.GetReadiness()[0].GetAgentId() != "agent-pinned" {
		t.Fatalf("readiness = %+v", projection.GetReadiness())
	}
	if len(projection.GetSliceErrors()) != 0 {
		t.Fatalf("slice errors = %+v, want none", projection.GetSliceErrors())
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

func TestHomeProjectionMarksOlderAuthoritativeRevisionStale(t *testing.T) {
	now := time.Date(2026, 9, 16, 12, 0, 0, 0, time.UTC)
	authoritativeRevision := uint64(now.UnixNano())
	svc := NewHomeProjectionService(
		homeAgentListerStub{agents: []domain.Agent{{
			AgentID:   "agent-1",
			Name:      "researcher",
			UpdatedAt: now,
		}}},
		homeConversationListerStub{},
		nil,
		nil,
	)
	svc.now = func() time.Time { return now }

	projection, err := svc.Get(
		context.Background(),
		"ptid:actor-1",
		authoritativeRevision+1,
	)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if projection.GetRevision() != authoritativeRevision {
		t.Fatalf(
			"revision = %d, want authoritative revision %d",
			projection.GetRevision(),
			authoritativeRevision,
		)
	}
	if projection.GetFreshness() != model.HomeProjectionFreshness_HOME_PROJECTION_FRESHNESS_STALE {
		t.Fatalf("freshness = %s, want stale", projection.GetFreshness())
	}
	if len(projection.GetSliceErrors()) != 1 {
		t.Fatalf("slice errors = %+v, want one", projection.GetSliceErrors())
	}
	staleError := projection.GetSliceErrors()[0]
	if staleError.GetSliceId() != "projection" ||
		staleError.GetCode() != model.HomeErrorCode_HOME_ERROR_CODE_PROJECTION_STALE ||
		!staleError.GetRetryable() ||
		staleError.GetRecoveryAction() != "retry" {
		t.Fatalf("stale error = %+v", staleError)
	}
}

func TestHomeProjectionIncludesReadinessAndTaskSlices(t *testing.T) {
	now := time.Date(2026, 9, 16, 12, 0, 0, 0, time.UTC)
	svc := NewHomeProjectionService(
		homeAgentListerStub{agents: []domain.Agent{{
			AgentID:    "agent-1",
			Name:       "researcher",
			Title:      "Researcher",
			ProviderID: "provider-1",
			ModelName:  "model-1",
			ConfigJSON: `{"pinned":true}`,
			Version:    3,
			UpdatedAt:  now,
		}}},
		homeConversationListerStub{},
		homeReadinessGetterStub{byAgent: map[string]*model.CapabilityReadinessSnapshot{
			"agent-1": {
				SnapshotId:        "readiness-1",
				AgentId:           "agent-1",
				RuntimeSnapshotId: "runtime-1",
				CreatedAt:         timestamppb.New(now),
				Capabilities: []*model.CapabilityReadiness{{
					CapabilityId:      "tool.search",
					CapabilityVersion: "1",
					State:             model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
				}},
			},
		}},
		homeTaskListerStub{tasks: []*persistence.AgentTask{{
			ID:           "task-1",
			Title:        "Prepare brief",
			AgentID:      "agent-1",
			Status:       "running",
			Progress:     25,
			OwnerActorID: "ptid:actor-1",
			UpdatedAt:    now,
		}}},
	)
	svc.now = func() time.Time { return now }

	projection, err := svc.Get(context.Background(), "ptid:actor-1", 0)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if projection.GetPinnedAgents()[0].GetReadinessSnapshotId() != "readiness-1" ||
		projection.GetPinnedAgents()[0].GetAgentVersion() != 3 {
		t.Fatalf("pinned Agent = %+v", projection.GetPinnedAgents()[0])
	}
	if len(projection.GetActiveTasks()) != 1 ||
		projection.GetActiveTasks()[0].GetTaskId() != "task-1" {
		t.Fatalf("active tasks = %+v", projection.GetActiveTasks())
	}
	if len(projection.GetRecentWork()) != 1 ||
		projection.GetRecentWork()[0].GetKind() != model.HomeWorkKind_HOME_WORK_KIND_TASK {
		t.Fatalf("recent work = %+v", projection.GetRecentWork())
	}
	if len(projection.GetCapabilitySummaries()) != 1 ||
		projection.GetCapabilitySummaries()[0].GetReadinessState() != "ready" {
		t.Fatalf("capability summaries = %+v", projection.GetCapabilitySummaries())
	}
}
