package service

import (
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestBuildAtelierProjectionSnapshotMapsCollaborationTask(t *testing.T) {
	now := timestamppb.New(time.Date(2026, 7, 1, 10, 30, 0, 0, time.UTC))
	task := &model.CollaborationTask{
		TaskId:      "collab_1",
		Title:       "实现 Atelier projection",
		Description: "把 orchestration event 投影给 Atelier UI",
		Status:      model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING,
		WorkspaceId: "workspace_1",
		BudgetMoney: 12.5,
		CreatedAt:   now,
		Meta: map[string]string{
			"project": "peers-touch",
			"branch":  "atelier/projection",
		},
	}
	nodes := []*model.TaskNode{
		{
			NodeId:        "node_1",
			TaskId:        "collab_1",
			AgentId:       "agent_1",
			Role:          "Architect",
			Description:   "设计 projection contract",
			Status:        model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED,
			ResultSummary: "projection contract 已确认",
		},
		{
			NodeId:      "node_2",
			TaskId:      "collab_1",
			AgentId:     "agent_2",
			Role:        "Executor",
			Description: "实现 mapper",
			Status:      model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING,
		},
	}

	snapshot := BuildAtelierProjectionSnapshot(
		[]*model.CollaborationTask{task},
		map[string][]*model.TaskNode{"collab_1": nodes},
		nil,
		"",
	)

	if snapshot.Version != atelierProjectionVersion {
		t.Fatalf("unexpected version: %s", snapshot.Version)
	}
	if snapshot.SelectedTaskID != "collab_1" {
		t.Fatalf("expected selected task collab_1, got %q", snapshot.SelectedTaskID)
	}
	if len(snapshot.Workspace.Tasks) != 1 {
		t.Fatalf("expected one projected task, got %d", len(snapshot.Workspace.Tasks))
	}
	projected := snapshot.Workspace.Tasks[0]
	if projected.ID != "collab_1" || projected.Project != "peers-touch" || projected.Status != "active" {
		t.Fatalf("unexpected task projection: %+v", projected)
	}
	if !projected.Running {
		t.Fatal("expected running task projection")
	}
	if len(snapshot.Workspace.Todos["collab_1"]) != 2 {
		t.Fatalf("expected two todos, got %d", len(snapshot.Workspace.Todos["collab_1"]))
	}
	if snapshot.Workspace.Todos["collab_1"][0].Status != "done" {
		t.Fatalf("expected first todo done, got %q", snapshot.Workspace.Todos["collab_1"][0].Status)
	}
	if len(snapshot.Workspace.Streams["collab_1"]) < 2 {
		t.Fatalf("expected summary and negotiation blocks, got %d", len(snapshot.Workspace.Streams["collab_1"]))
	}
}

func TestBuildAtelierProjectionEventMapsTaskEventToStreamPatch(t *testing.T) {
	event := &model.TaskEvent{
		EventId:     "evt_1",
		TaskId:      "collab_1",
		EventSeq:    7,
		Type:        model.TaskEventType_TASK_EVENT_TYPE_STEP_COMPLETED,
		PayloadJson: `{"role":"Executor","result_summary":"实现完成"}`,
		CreatedAt:   timestamppb.New(time.Date(2026, 7, 1, 11, 0, 0, 0, time.UTC)),
	}

	projected, ok := BuildAtelierProjectionEvent(event)
	if !ok {
		t.Fatal("expected event to be projected")
	}
	if projected.Patch.Kind != "stream.append" {
		t.Fatalf("expected stream.append patch, got %q", projected.Patch.Kind)
	}
	if projected.Patch.TaskID != "collab_1" {
		t.Fatalf("expected task id collab_1, got %q", projected.Patch.TaskID)
	}
	if len(projected.Patch.Blocks) != 1 {
		t.Fatalf("expected one block, got %d", len(projected.Patch.Blocks))
	}
	if projected.Patch.Blocks[0].Text != "实现完成" {
		t.Fatalf("unexpected block text: %q", projected.Patch.Blocks[0].Text)
	}
}

func TestBuildAtelierProjectionEventMapsUserMessage(t *testing.T) {
	event := &model.TaskEvent{
		EventId:     "evt_user_1",
		TaskId:      "collab_1",
		EventSeq:    8,
		Type:        model.TaskEventType_TASK_EVENT_TYPE_TURN_EVENT,
		PayloadJson: `{"source":"atelier.message.send","block_kind":"user","text":"继续推进实现"}`,
		CreatedAt:   timestamppb.New(time.Date(2026, 7, 1, 11, 5, 0, 0, time.UTC)),
	}

	projected, ok := BuildAtelierProjectionEvent(event)
	if !ok {
		t.Fatal("expected event to be projected")
	}
	if len(projected.Patch.Blocks) != 1 {
		t.Fatalf("expected one block, got %d", len(projected.Patch.Blocks))
	}
	block := projected.Patch.Blocks[0]
	if block.Kind != "user" {
		t.Fatalf("expected user block, got %q", block.Kind)
	}
	if block.Text != "继续推进实现" {
		t.Fatalf("unexpected user text: %q", block.Text)
	}
}

func TestBuildAtelierProjectionEventMapsDecisionResolved(t *testing.T) {
	event := &model.TaskEvent{
		EventId:     "evt_decision_1",
		TaskId:      "collab_1",
		EventSeq:    9,
		Type:        model.TaskEventType_TASK_EVENT_TYPE_TURN_EVENT,
		PayloadJson: `{"source":"atelier.escalation.resolve","block_kind":"decision_resolved","block_id":"decision_1","choice":"继续执行"}`,
		CreatedAt:   timestamppb.New(time.Date(2026, 7, 1, 11, 10, 0, 0, time.UTC)),
	}

	projected, ok := BuildAtelierProjectionEvent(event)
	if !ok {
		t.Fatal("expected event to be projected")
	}
	if projected.Patch.Kind != "decision.resolved" {
		t.Fatalf("expected decision.resolved patch, got %q", projected.Patch.Kind)
	}
	if projected.Patch.BlockID != "decision_1" {
		t.Fatalf("unexpected block id: %q", projected.Patch.BlockID)
	}
	if projected.Patch.Choice != "继续执行" {
		t.Fatalf("unexpected choice: %q", projected.Patch.Choice)
	}
}

func TestBuildAtelierProjectionEventMapsArtifactUpsert(t *testing.T) {
	event := &model.TaskEvent{
		EventId:     "evt_artifact_1",
		TaskId:      "collab_1",
		EventSeq:    10,
		Type:        model.TaskEventType_TASK_EVENT_TYPE_TURN_EVENT,
		PayloadJson: `{"block_kind":"artifact","artifact_id":"art_1","name":"report.md","kind":"markdown","meta":"Report · Verifier","markdown":"# Report"}`,
		CreatedAt:   timestamppb.New(time.Date(2026, 7, 1, 11, 15, 0, 0, time.UTC)),
	}

	projected, ok := BuildAtelierProjectionEvent(event)
	if !ok {
		t.Fatal("expected event to be projected")
	}
	if projected.Patch.Kind != "artifact.upsert" {
		t.Fatalf("expected artifact.upsert patch, got %q", projected.Patch.Kind)
	}
	if projected.Patch.Artifact == nil {
		t.Fatal("expected artifact payload")
	}
	if projected.Patch.Artifact.ID != "art_1" || projected.Patch.Artifact.Markdown != "# Report" {
		t.Fatalf("unexpected artifact payload: %+v", projected.Patch.Artifact)
	}
}

func TestBuildAtelierProjectionEventMapsGateUpsert(t *testing.T) {
	event := &model.TaskEvent{
		EventId:     "evt_gate_1",
		TaskId:      "collab_1",
		EventSeq:    11,
		Type:        model.TaskEventType_TASK_EVENT_TYPE_TURN_EVENT,
		PayloadJson: `{"block_kind":"gate_result","gate_id":"gate_1","name":"Verification Gate","status":"passed","summary":"All checks passed","artifactIds":["art_1"],"checks":[{"name":"unit","status":"passed","detail":"ok"}]}`,
		CreatedAt:   timestamppb.New(time.Date(2026, 7, 1, 11, 20, 0, 0, time.UTC)),
	}

	projected, ok := BuildAtelierProjectionEvent(event)
	if !ok {
		t.Fatal("expected event to be projected")
	}
	if projected.Patch.Kind != "gate.upsert" {
		t.Fatalf("expected gate.upsert patch, got %q", projected.Patch.Kind)
	}
	if projected.Patch.Gate == nil {
		t.Fatal("expected gate payload")
	}
	if projected.Patch.Gate.ID != "gate_1" || projected.Patch.Gate.Status != "passed" {
		t.Fatalf("unexpected gate payload: %+v", projected.Patch.Gate)
	}
	if len(projected.Patch.Gate.Checks) != 1 || projected.Patch.Gate.Checks[0].Status != "passed" {
		t.Fatalf("unexpected gate checks: %+v", projected.Patch.Gate.Checks)
	}
	if len(projected.Patch.Gate.ArtifactIDs) != 1 || projected.Patch.Gate.ArtifactIDs[0] != "art_1" {
		t.Fatalf("unexpected artifact ids: %+v", projected.Patch.Gate.ArtifactIDs)
	}
}

func TestBuildAtelierProjectionSnapshotReplaysArtifactsAndGates(t *testing.T) {
	now := timestamppb.New(time.Date(2026, 7, 1, 11, 25, 0, 0, time.UTC))
	task := &model.CollaborationTask{
		TaskId:      "collab_1",
		Title:       "验证 projection replay",
		Description: "测试 Artifact / Gate replay",
		Status:      model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED,
		WorkspaceId: "workspace_1",
		CreatedAt:   now,
		Meta: map[string]string{
			"project": "peers-touch",
		},
	}
	events := []*model.TaskEvent{
		{
			EventId:     "evt_artifact_1",
			TaskId:      "collab_1",
			EventSeq:    10,
			Type:        model.TaskEventType_TASK_EVENT_TYPE_TURN_EVENT,
			PayloadJson: `{"block_kind":"artifact","artifact_id":"art_1","name":"report.md","kind":"markdown","markdown":"# Report"}`,
			CreatedAt:   now,
		},
		{
			EventId:     "evt_gate_1",
			TaskId:      "collab_1",
			EventSeq:    11,
			Type:        model.TaskEventType_TASK_EVENT_TYPE_TURN_EVENT,
			PayloadJson: `{"block_kind":"gate_result","gate_id":"gate_1","status":"passed","summary":"All checks passed","artifactIds":["art_1"]}`,
			CreatedAt:   now,
		},
	}

	snapshot := BuildAtelierProjectionSnapshot(
		[]*model.CollaborationTask{task},
		nil,
		map[string][]*model.TaskEvent{"collab_1": events},
		"",
	)

	if len(snapshot.Workspace.Artifacts["collab_1"]) != 1 {
		t.Fatalf("expected one artifact, got %+v", snapshot.Workspace.Artifacts["collab_1"])
	}
	if len(snapshot.Workspace.Gates["collab_1"]) != 1 {
		t.Fatalf("expected one gate, got %+v", snapshot.Workspace.Gates["collab_1"])
	}
	if len(snapshot.Workspace.Streams["collab_1"]) < 2 {
		t.Fatalf("expected stream to include summary and artifact card, got %+v", snapshot.Workspace.Streams["collab_1"])
	}
	last := snapshot.Workspace.Streams["collab_1"][len(snapshot.Workspace.Streams["collab_1"])-1]
	if last.Kind != "artifact" || last.Name != "report.md" {
		t.Fatalf("expected artifact stream block, got %+v", last)
	}
}
