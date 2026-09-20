package service

import (
	"context"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

type homeAgentGetterStub struct {
	agent *domain.Agent
	err   error
}

func (s homeAgentGetterStub) GetAgent(
	context.Context,
	string,
	string,
) (*domain.Agent, error) {
	return s.agent, s.err
}

type homeTurnStarterStub struct {
	db      *gorm.DB
	accept  bool
	started int
	settled int
	request *model.ExecuteTurnRequest
}

func (s *homeTurnStarterStub) StartAdmittedTurn(
	_ string,
	request *model.ExecuteTurnRequest,
	_ *model.TurnAdmission,
) bool {
	s.started++
	s.request = proto.Clone(request).(*model.ExecuteTurnRequest)
	return s.accept
}

func (s *homeTurnStarterStub) FailAdmittedTurnStart(
	ctx context.Context,
	_ string,
	turnID string,
	reason string,
	_ error,
) error {
	s.settled++
	now := time.Now().UTC()
	return s.db.WithContext(ctx).
		Model(&persistence.AgentTurn{}).
		Where("id = ?", turnID).
		Updates(map[string]interface{}{
			"status":          string(domain.TurnStatusFailed),
			"terminal_reason": reason,
			"ended_at":        now,
		}).Error
}

func newHomeCommandTestService(t *testing.T) (*HomeCommandService, *gorm.DB, *homeTurnStarterStub) {
	t.Helper()
	db := openConversationAuthorityDB(t, "home_command_"+t.Name())
	if err := db.AutoMigrate(
		&persistence.AgentTask{},
		&persistence.CapabilityReadinessSnapshot{},
	); err != nil {
		t.Fatalf("migrate Home command models: %v", err)
	}
	agent := &domain.Agent{
		AgentID:      "agent-1",
		Name:         "researcher",
		Title:        "Researcher",
		ProviderID:   "provider-1",
		ModelName:    "model-1",
		ThinkingMode: domain.ThinkingModeAuto,
		Version:      3,
	}
	seedHomeReadiness(t, db, "ptid:actor-1", agent.AgentID, uint64(agent.Version))
	admission := newTurnAdmissionServiceWithDB(db)
	starter := &homeTurnStarterStub{db: db, accept: true}
	service := NewHomeCommandService(
		homeAgentGetterStub{agent: agent},
		admission,
		starter,
		NewAgentTaskService(),
	)
	service.db = db
	service.now = func() time.Time {
		return time.Date(2026, 9, 16, 5, 0, 0, 0, time.UTC)
	}
	return service, db, starter
}

func seedHomeReadiness(
	t *testing.T,
	db *gorm.DB,
	ptid string,
	agentID string,
	agentVersion uint64,
) {
	t.Helper()
	now := time.Date(2026, 9, 16, 4, 59, 0, 0, time.UTC)
	snapshot := &model.CapabilityReadinessSnapshot{
		SnapshotId:        "readiness-1",
		Ptid:              ptid,
		AgentId:           agentID,
		RuntimeSnapshotId: "runtime-1",
		BindingRevisions: []string{
			"agent:" + agentID + ":3",
		},
		CreatedAt: timestamppb.New(now),
		ExpiresAt: timestamppb.New(now.Add(5 * time.Minute)),
	}
	payload, err := proto.Marshal(snapshot)
	if err != nil {
		t.Fatalf("marshal readiness: %v", err)
	}
	if err := db.Create(&persistence.CapabilityReadinessSnapshot{
		SnapshotID:  snapshot.GetSnapshotId(),
		Ptid:        ptid,
		AgentID:     agentID,
		Payload:     payload,
		PayloadHash: "hash",
		CreatedAt:   now,
		ExpiresAt:   now.Add(5 * time.Minute),
	}).Error; err != nil {
		t.Fatalf("seed readiness: %v", err)
	}
	if agentVersion != 3 {
		t.Fatalf("test fixture expects agent version 3, got %d", agentVersion)
	}
}

func TestSubmitHomeChatIsAtomicAndIdempotent(t *testing.T) {
	service, db, starter := newHomeCommandTestService(t)
	request := &model.SubmitHomeChatCommandRequest{
		AgentId:              "agent-1",
		Input:                "Compare recovery models",
		RuntimeProfileId:     modernChatAgentProfileID,
		ClientIdempotencyKey: "home-chat-1",
		ExpectedAgentVersion: 3,
		ReadinessSnapshotId:  "readiness-1",
	}

	first, err := service.SubmitChat(context.Background(), "ptid:actor-1", request)
	if err != nil {
		t.Fatalf("SubmitChat() error = %v", err)
	}
	second, err := service.SubmitChat(context.Background(), "ptid:actor-1", request)
	if err != nil {
		t.Fatalf("SubmitChat() replay error = %v", err)
	}
	if first.GetConversationId() != second.GetConversationId() ||
		first.GetTurnId() != second.GetTurnId() {
		t.Fatalf("replay changed ids: first=%+v second=%+v", first, second)
	}
	if starter.started != 1 {
		t.Fatalf("turn starts = %d, want 1", starter.started)
	}
	var conversations int64
	var turns int64
	db.Model(&persistence.Conversation{}).Count(&conversations)
	db.Model(&persistence.AgentTurn{}).Count(&turns)
	if conversations != 1 || turns != 1 {
		t.Fatalf("conversation/turn counts = %d/%d, want 1/1", conversations, turns)
	}
}

func TestSubmitHomeChatRejectsIdempotencyPayloadMismatch(t *testing.T) {
	service, _, _ := newHomeCommandTestService(t)
	request := &model.SubmitHomeChatCommandRequest{
		AgentId:              "agent-1",
		Input:                "First input",
		RuntimeProfileId:     modernChatAgentProfileID,
		ClientIdempotencyKey: "home-chat-conflict",
		ExpectedAgentVersion: 3,
		ReadinessSnapshotId:  "readiness-1",
	}
	if _, err := service.SubmitChat(context.Background(), "ptid:actor-1", request); err != nil {
		t.Fatalf("SubmitChat() error = %v", err)
	}
	request.Input = "Different input"
	if _, err := service.SubmitChat(context.Background(), "ptid:actor-1", request); err == nil {
		t.Fatal("SubmitChat() conflict error = nil")
	}
}

func TestSubmitHomeTaskStartsOnceAndReplays(t *testing.T) {
	service, db, _ := newHomeCommandTestService(t)
	request := &model.SubmitHomeTaskCommandRequest{
		AgentId:              "agent-1",
		Input:                "Prepare the launch brief",
		RuntimeProfileId:     modernChatAgentProfileID,
		ClientIdempotencyKey: "home-task-1",
		ExpectedAgentVersion: 3,
		ReadinessSnapshotId:  "readiness-1",
	}

	first, err := service.SubmitTask(context.Background(), "ptid:actor-1", request)
	if err != nil {
		t.Fatalf("SubmitTask() error = %v", err)
	}
	second, err := service.SubmitTask(context.Background(), "ptid:actor-1", request)
	if err != nil {
		t.Fatalf("SubmitTask() replay error = %v", err)
	}
	if first.GetTaskId() != second.GetTaskId() {
		t.Fatalf("replay changed task id: %q != %q", first.GetTaskId(), second.GetTaskId())
	}
	var tasks []persistence.AgentTask
	if err := db.Find(&tasks).Error; err != nil {
		t.Fatalf("list tasks: %v", err)
	}
	if len(tasks) != 1 || tasks[0].Status != "running" {
		t.Fatalf("tasks = %+v", tasks)
	}
}

func TestSubmitHomeCommandRejectsStaleAgentVersionBeforePersistence(t *testing.T) {
	service, db, _ := newHomeCommandTestService(t)
	_, err := service.SubmitTask(context.Background(), "ptid:actor-1", &model.SubmitHomeTaskCommandRequest{
		AgentId:              "agent-1",
		Input:                "Prepare the launch brief",
		RuntimeProfileId:     modernChatAgentProfileID,
		ClientIdempotencyKey: "home-task-stale",
		ExpectedAgentVersion: 2,
		ReadinessSnapshotId:  "readiness-1",
	})
	if err == nil {
		t.Fatal("SubmitTask() stale version error = nil")
	}
	var count int64
	db.Model(&persistence.AgentTask{}).Count(&count)
	if count != 0 {
		t.Fatalf("task count = %d, want 0", count)
	}
}

func TestSubmitHomeChatSettlesLifecycleStartFailureAndReplaysAcceptedIntent(t *testing.T) {
	service, db, starter := newHomeCommandTestService(t)
	starter.accept = false
	request := &model.SubmitHomeChatCommandRequest{
		AgentId:              "agent-1",
		Input:                "Keep this draft",
		RuntimeProfileId:     modernChatAgentProfileID,
		ClientIdempotencyKey: "home-chat-lifecycle-unavailable",
		ExpectedAgentVersion: 3,
		ReadinessSnapshotId:  "readiness-1",
	}

	first, err := service.SubmitChat(
		context.Background(),
		"ptid:actor-1",
		request,
	)
	if err != nil {
		t.Fatalf("SubmitChat() lifecycle settlement error = %v", err)
	}

	var turn persistence.AgentTurn
	if err := db.First(&turn).Error; err != nil {
		t.Fatalf("load settled turn: %v", err)
	}
	if turn.Status != string(domain.TurnStatusFailed) ||
		turn.TerminalReason != "station_execution_lifecycle_unavailable" ||
		turn.EndedAt == nil {
		t.Fatalf("settled turn = %+v", turn)
	}
	if starter.started != 1 || starter.settled != 1 {
		t.Fatalf(
			"starter attempts/settlements = %d/%d, want 1/1",
			starter.started,
			starter.settled,
		)
	}

	starter.accept = true
	replayed, err := service.SubmitChat(
		context.Background(),
		"ptid:actor-1",
		request,
	)
	if err != nil {
		t.Fatalf("SubmitChat() replay error = %v", err)
	}
	if replayed.GetConversationId() != first.GetConversationId() ||
		replayed.GetTurnId() != first.GetTurnId() {
		t.Fatalf("replay changed accepted intent: first=%+v replay=%+v", first, replayed)
	}
	if starter.started != 1 || starter.settled != 1 {
		t.Fatalf(
			"replay attempts/settlements = %d/%d, want 1/1",
			starter.started,
			starter.settled,
		)
	}
}
