package service

import (
	"context"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
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
			NodeId:              "node_2",
			TaskId:              "collab_1",
			AgentId:             "agent_2",
			Role:                "Executor",
			Description:         "实现 mapper",
			Status:              model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING,
			PrerequisiteNodeIds: []string{"node_1"},
		},
	}
	events := []*model.TaskEvent{
		{
			EventId:     "evt_art_node_2",
			TaskId:      "collab_1",
			EventSeq:    1,
			Type:        model.TaskEventType_TASK_EVENT_TYPE_TURN_EVENT,
			PayloadJson: `{"block_kind":"artifact","artifact_id":"art_node_2","node_id":"node_2","name":"mapper.md","kind":"markdown"}`,
		},
		{
			EventId:     "evt_gate_node_2",
			TaskId:      "collab_1",
			EventSeq:    2,
			Type:        model.TaskEventType_TASK_EVENT_TYPE_GATE_RESULT,
			PayloadJson: `{"block_kind":"gate_result","gate_id":"gate_node_2","node_id":"node_2","status":"passed","artifactIds":["art_node_2"]}`,
		},
	}

	snapshot := BuildAtelierProjectionSnapshot(
		[]*model.CollaborationTask{task},
		map[string][]*model.TaskNode{"collab_1": nodes},
		map[string][]*model.TaskEvent{"collab_1": events},
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
	if projected.ProjectID != "collab_1" {
		t.Fatalf("unexpected project id: %q", projected.ProjectID)
	}
	if !projected.Running {
		t.Fatal("expected running task projection")
	}
	if len(snapshot.Workspace.Projects) != 1 {
		t.Fatalf("expected one projected project, got %d", len(snapshot.Workspace.Projects))
	}
	project := snapshot.Workspace.Projects[0]
	if project.ID != "collab_1" || project.WorkspaceRef != "workspace_1" || project.Title != "实现 Atelier projection" {
		t.Fatalf("unexpected project projection: %+v", project)
	}
	if project.State != "verifying" {
		t.Fatalf("expected running project with passed gate to enter verifying state, got %q", project.State)
	}
	if project.GoalOwnerSignoff {
		t.Fatal("expected goal owner signoff to default false")
	}
	if !project.Completion.NoOpenBlockers {
		t.Fatal("expected no open blockers without failing gate events")
	}
	if len(project.TaskGraph.Tasks) != 2 || len(project.TaskGraph.Edges) != 1 {
		t.Fatalf("unexpected task graph: %+v", project.TaskGraph)
	}
	if len(project.TaskGraph.Tasks[0].ArtifactIDs) != 0 || len(project.TaskGraph.Tasks[0].GateIDs) != 0 {
		t.Fatalf("expected node_1 to have no direct evidence refs, got %+v", project.TaskGraph.Tasks[0])
	}
	if got := project.TaskGraph.Tasks[1].ArtifactIDs; !reflect.DeepEqual(got, []string{"art_node_2"}) {
		t.Fatalf("unexpected node_2 artifact refs: %+v", got)
	}
	if got := project.TaskGraph.Tasks[1].GateIDs; !reflect.DeepEqual(got, []string{"gate_node_2"}) {
		t.Fatalf("unexpected node_2 gate refs: %+v", got)
	}
	if project.TaskGraph.Edges[0].From != "node_1" || project.TaskGraph.Edges[0].To != "node_2" {
		t.Fatalf("unexpected task graph edge: %+v", project.TaskGraph.Edges[0])
	}
	if len(project.MilestoneTree.Milestones) != 1 || len(project.MilestoneTree.Milestones[0].TaskIDs) != 2 {
		t.Fatalf("unexpected milestone tree: %+v", project.MilestoneTree)
	}
	if project.MilestoneTree.Milestones[0].State != "active" {
		t.Fatalf("expected active milestone state, got %q", project.MilestoneTree.Milestones[0].State)
	}
	if projected.WorkspaceOpenTarget == nil {
		t.Fatal("expected workspace open target")
	}
	if projected.WorkspaceOpenTarget.WorkspaceURI != "pt-workspace://task/collab_1?workspace=workspace_1" {
		t.Fatalf("unexpected workspace open uri: %q", projected.WorkspaceOpenTarget.WorkspaceURI)
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

func TestProjectAtelierMilestoneTreeDefaultsAcceptancePredicateIDs(t *testing.T) {
	task := &model.CollaborationTask{
		TaskId: "task-default-predicate",
		Title:  "Default Predicate Task",
		Status: model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING,
	}
	tree := projectAtelierMilestoneTree(
		task,
		AtelierTaskGraph{},
		AtelierProjectCompletion{NoOpenBlockers: true},
		"",
		nil,
		"",
		nil,
		nil,
	)

	if len(tree.Milestones) != 1 {
		t.Fatalf("expected one fallback milestone, got %+v", tree.Milestones)
	}
	got := tree.Milestones[0].AcceptancePredicateIDs
	want := []string{"task-default-predicate.acceptance.no_open_blockers"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("expected default acceptance predicate ids %v, got %v", want, got)
	}
}

func TestBuildAtelierProjectionSnapshotDerivesProjectCompletion(t *testing.T) {
	task := &model.CollaborationTask{
		TaskId:      "collab_completion",
		Title:       "完成 Atelier projection evaluator",
		Description: "把 completion predicate 变成 Station read-only projection",
		Status:      model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED,
		WorkspaceId: "workspace_completion",
		Meta: map[string]string{
			"project":            "peers-touch",
			"goal_owner_signoff": "true",
		},
	}
	nodes := []*model.TaskNode{
		{
			NodeId:      "node_plan",
			TaskId:      "collab_completion",
			Role:        "Planner",
			Description: "规划 completion evaluator",
			Status:      model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED,
		},
		{
			NodeId:              "node_verify",
			TaskId:              "collab_completion",
			Role:                "Verifier",
			Description:         "验证 completion evaluator",
			Status:              model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED,
			PrerequisiteNodeIds: []string{"node_plan"},
		},
	}
	events := []*model.TaskEvent{
		{
			EventId:     "evt_gate_passed",
			TaskId:      "collab_completion",
			EventSeq:    1,
			Type:        model.TaskEventType_TASK_EVENT_TYPE_GATE_RESULT,
			PayloadJson: `{"block_kind":"gate_result","gate_id":"gate_l1","status":"passed","summary":"L1 checks passed","level":"L1"}`,
		},
		{
			EventId:     "evt_memory_candidate",
			TaskId:      "collab_completion",
			EventSeq:    2,
			Type:        model.TaskEventType_TASK_EVENT_TYPE_FEEDBACK_RECORDED,
			PayloadJson: `{"block_kind":"feedback","feedback_id":"feedback_memory","block_id":"agent_reply","signal":"positive","comment":"use this completion pattern","memory_candidate_status":"candidate","memory_candidate_feeds":["planner","verifier"]}`,
		},
	}

	snapshot := BuildAtelierProjectionSnapshot(
		[]*model.CollaborationTask{task},
		map[string][]*model.TaskNode{"collab_completion": nodes},
		map[string][]*model.TaskEvent{"collab_completion": events},
		nil,
		"",
	)

	if len(snapshot.Workspace.Projects) != 1 {
		t.Fatalf("expected one projected project, got %d", len(snapshot.Workspace.Projects))
	}
	completion := snapshot.Workspace.Projects[0].Completion
	if snapshot.Workspace.Projects[0].State != "accepted" {
		t.Fatalf("expected accepted project state, got %q", snapshot.Workspace.Projects[0].State)
	}
	if snapshot.Workspace.Projects[0].MilestoneTree.Milestones[0].State != "accepted" {
		t.Fatalf("expected accepted milestone state, got %q", snapshot.Workspace.Projects[0].MilestoneTree.Milestones[0].State)
	}
	if !completion.NoOpenBlockers ||
		!completion.L0L1AcceptancePassed ||
		!completion.L2HumanSignoffComplete ||
		!completion.ResidualRisksLogged ||
		!completion.MemoryCandidatesGenerated {
		t.Fatalf("unexpected completion projection: %+v", completion)
	}

	blockingGate := &model.TaskEvent{
		EventId:     "evt_gate_failed",
		TaskId:      "collab_completion",
		EventSeq:    3,
		Type:        model.TaskEventType_TASK_EVENT_TYPE_GATE_RESULT,
		PayloadJson: `{"block_kind":"gate_result","gate_id":"gate_blocking","status":"failed","summary":"blocking check failed","blocking":true,"artifact_id":"artifact_gate"}`,
	}
	blocked := BuildAtelierProjectionSnapshot(
		[]*model.CollaborationTask{task},
		map[string][]*model.TaskNode{"collab_completion": nodes},
		map[string][]*model.TaskEvent{"collab_completion": append(events, blockingGate)},
		nil,
		"",
	)
	project := blocked.Workspace.Projects[0]
	if project.State != "blocked" {
		t.Fatalf("expected blocked project state, got %q", project.State)
	}
	if project.MilestoneTree.Milestones[0].State != "blocked" {
		t.Fatalf("expected blocked milestone state, got %q", project.MilestoneTree.Milestones[0].State)
	}
	if project.Completion.NoOpenBlockers {
		t.Fatalf("expected blocking failed gate to clear noOpenBlockers: %+v", project.Completion)
	}
	if len(project.OpenBlockers) != 1 || project.OpenBlockers[0].ID != "gate_blocking" {
		t.Fatalf("expected blocker projection from failed gate, got %+v", project.OpenBlockers)
	}
	if project.OpenBlockers[0].State != "open" {
		t.Fatalf("expected failed blocking gate to create open blocker, got %+v", project.OpenBlockers[0])
	}
	if len(project.Defects) != 1 || project.Defects[0].ID != "evt_gate_failed" {
		t.Fatalf("expected defect projection from failed gate, got %+v", project.Defects)
	}

	resolvedDecision := &model.TaskEvent{
		EventId:     "evt_gate_resolved",
		TaskId:      "collab_completion",
		EventSeq:    4,
		Type:        model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_RESOLVED,
		PayloadJson: `{"block_kind":"decision_resolved","human_decision_reason":"gate_blocked","human_decision_action":"rerun_failed_node","gate_id":"gate_blocking"}`,
	}
	retryPassedGate := &model.TaskEvent{
		EventId:     "evt_gate_retry_passed",
		TaskId:      "collab_completion",
		EventSeq:    5,
		Type:        model.TaskEventType_TASK_EVENT_TYPE_GATE_RESULT,
		PayloadJson: `{"block_kind":"gate_result","gate_id":"gate_blocking","status":"passed","summary":"blocking check passed after rerun","blocking":true,"artifact_id":"artifact_gate_retry"}`,
	}
	recovered := BuildAtelierProjectionSnapshot(
		[]*model.CollaborationTask{task},
		map[string][]*model.TaskNode{"collab_completion": nodes},
		map[string][]*model.TaskEvent{"collab_completion": append(events, blockingGate, resolvedDecision, retryPassedGate)},
		nil,
		"",
	)
	recoveredProject := recovered.Workspace.Projects[0]
	if recoveredProject.State != "accepted" {
		t.Fatalf("expected recovered project state accepted, got %q", recoveredProject.State)
	}
	if !recoveredProject.Completion.NoOpenBlockers || !recoveredProject.Completion.L0L1AcceptancePassed {
		t.Fatalf("expected recovered completion to use latest gate and resolved blocker state, got %+v", recoveredProject.Completion)
	}
	if len(recoveredProject.OpenBlockers) != 1 ||
		recoveredProject.OpenBlockers[0].ID != "gate_blocking" ||
		recoveredProject.OpenBlockers[0].State != "resolved" {
		t.Fatalf("expected recovered gate blocker to remain as resolved evidence, got %+v", recoveredProject.OpenBlockers)
	}
	if len(recoveredProject.MilestoneTree.Milestones[0].OpenBlockers) != 1 ||
		recoveredProject.MilestoneTree.Milestones[0].OpenBlockers[0].State != "resolved" {
		t.Fatalf("expected milestone blocker predicate to reuse resolved project blocker evidence, got %+v", recoveredProject.MilestoneTree.Milestones[0].OpenBlockers)
	}
}

func TestAtelierEngineTypeFromFlowIDMapsPrototypeFlows(t *testing.T) {
	tests := []struct {
		flowID string
		want   model.CollaborationEngineType
	}{
		{flowID: "", want: model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_HIERARCHY},
		{flowID: "expert-hierarchy", want: model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_HIERARCHY},
		{flowID: "roundtable", want: model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_ROUNDTABLE},
		{flowID: "debate-judge", want: model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_DEBATE_JUDGE},
		{flowID: "expert-mesh", want: model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_MESH},
		{flowID: "swarm", want: model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_SWARM},
		{flowID: "hierarchy", want: model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_HIERARCHY},
	}
	for _, tt := range tests {
		t.Run(tt.flowID, func(t *testing.T) {
			got, err := atelierEngineTypeFromFlowID(tt.flowID)
			if err != nil {
				t.Fatalf("map flow %q: %v", tt.flowID, err)
			}
			if got != tt.want {
				t.Fatalf("flow %q mapped to %v, want %v", tt.flowID, got, tt.want)
			}
		})
	}
}

func TestAtelierEngineTypeFromFlowIDRejectsUnknownFlow(t *testing.T) {
	if _, err := atelierEngineTypeFromFlowID("local-shortcut"); err == nil ||
		!strings.Contains(err.Error(), "known Atelier EngineType") {
		t.Fatalf("expected unknown flow rejection, got %v", err)
	}
}

func TestAtelierDirectRunTargetIsStationOwnedIntent(t *testing.T) {
	run := AtelierRunTargetRequest{
		Kind:  "model",
		Model: "gpt-4.1",
	}
	runKind, err := validateAtelierRunTarget(run)
	if err != nil {
		t.Fatalf("validate DirectRun target: %v", err)
	}
	if runKind != atelierRunKindModel {
		t.Fatalf("expected model run kind, got %q", runKind)
	}
	plan := atelierProviderPlanFromCreateRequest([]string{"agent-1", "agent-2"}, run)
	if plan.GetSource() != "atelier.direct_run.intent" {
		t.Fatalf("expected Station DirectRun intent source, got %q", plan.GetSource())
	}
	if plan.GetSynthesizerAgentId() != "agent-1" || len(plan.GetProviders()) != 1 {
		t.Fatalf("expected DirectRun to bind one Station-selected provider, got %+v", plan)
	}
	if plan.GetProviders()[0].GetModel() != "gpt-4.1" {
		t.Fatalf("expected DirectRun model intent to be preserved, got %+v", plan.GetProviders()[0])
	}
}

func TestAtelierDirectRunTargetRejectsProviderExecutionShape(t *testing.T) {
	for name, run := range map[string]AtelierRunTargetRequest{
		"unknown_kind":  {Kind: "execute", Model: "gpt-4.1"},
		"missing_model": {Kind: "model"},
		"flow_id":       {Kind: "model", Model: "gpt-4.1", FlowID: "roundtable"},
		"agent_ids":     {Kind: "model", Model: "gpt-4.1", AgentIDs: []string{"agent-1"}},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := validateAtelierRunTarget(run); err == nil {
				t.Fatalf("expected invalid DirectRun target to be rejected: %+v", run)
			}
		})
	}
}

func TestAtelierIntentPresetMapsToDeclarativeProviderAndGatePresets(t *testing.T) {
	tests := map[string]map[string]string{
		"": {
			"intent_preset":            "work",
			"provider_strategy_preset": "station_generalist_research",
			"gate_plan_preset":         "plan_review_evidence",
		},
		"work": {
			"intent_preset":            "work",
			"provider_strategy_preset": "station_generalist_research",
			"gate_plan_preset":         "plan_review_evidence",
		},
		"code": {
			"intent_preset":            "code",
			"provider_strategy_preset": "coding_provider_preferred",
			"gate_plan_preset":         "lint_typecheck_build",
		},
		"design": {
			"intent_preset":            "design",
			"provider_strategy_preset": "design_review_preferred",
			"gate_plan_preset":         "prototype_visual_review",
		},
	}
	for preset, want := range tests {
		t.Run(preset, func(t *testing.T) {
			normalized, err := normalizeAtelierIntentPreset(preset)
			if err != nil {
				t.Fatalf("normalize preset %q: %v", preset, err)
			}
			got := atelierIntentPresetMetadata(normalized)
			for key, wantValue := range want {
				if got[key] != wantValue {
					t.Fatalf("preset %q key %s = %q, want %q", preset, key, got[key], wantValue)
				}
			}
			task := projectCollaborationTask(&model.CollaborationTask{
				TaskId: "task-preset",
				Title:  "Preset task",
				Meta:   got,
			})
			if task.IntentPreset != got["intent_preset"] ||
				task.ProviderStrategy != got["provider_strategy_preset"] ||
				task.GatePlanPreset != got["gate_plan_preset"] {
				t.Fatalf("projection did not preserve declarative preset metadata: %+v from %+v", task, got)
			}
		})
	}
}

func TestAtelierIntentPresetRejectsExecutionShapedPreset(t *testing.T) {
	if _, err := normalizeAtelierIntentPreset("execute"); err == nil ||
		!strings.Contains(err.Error(), "intentPreset must be work, code, or design") {
		t.Fatalf("expected execution-shaped preset to be rejected, got %v", err)
	}
}

func TestAtelierProviderCapabilitiesAreReadOnlyDiscovery(t *testing.T) {
	service := NewAtelierProjectionService(nil)
	response, err := service.ProviderCapabilities(context.Background(), "actor-1", &ListAtelierProviderCapabilitiesRequest{TaskID: "task-1"})
	if err != nil {
		t.Fatalf("provider capabilities: %v", err)
	}
	if response.Source != "station.provider.capabilities" {
		t.Fatalf("unexpected capability source: %q", response.Source)
	}
	if len(response.Capabilities) == 0 {
		t.Fatal("expected provider capability descriptors")
	}
	for _, capability := range response.Capabilities {
		if !capability.ReadOnly || capability.Scope != "station-provider" {
			t.Fatalf("capability must be read-only station provider metadata: %+v", capability)
		}
		if capability.SlashCommand == "" || capability.SlashCommand[0] != '/' {
			t.Fatalf("expected slash command metadata, got %+v", capability)
		}
	}
}

func TestAtelierProviderCapabilitiesWritesFullE2EProviderRuntimeEvidenceFromStationFacts(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "atelier_provider_runtime_evidence")
	injectOrchestrationServiceTestStore(t, db)
	now := time.Now().UTC()
	taskID := "task-provider-runtime-evidence"
	directRunID := "direct-run-provider-runtime"
	artifactID := "artifact-provider-runtime"
	if err := db.Create(&persistence.CollaborationTask{
		ID:          taskID,
		Title:       "Provider runtime evidence",
		GoalOwnerID: "actor-1",
		Status:      int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED),
		CreatedAt:   now,
		StartedAt:   now,
		EndedAt:     now,
	}).Error; err != nil {
		t.Fatalf("seed task: %v", err)
	}
	if err := db.Create(&persistence.DirectRun{
		DirectRunID:       directRunID,
		TaskID:            taskID,
		ProviderID:        "openai-direct",
		ModelIntent:       "gpt-4.1",
		InputSnapshotJSON: `{"raw_prompt":"must-not-project"}`,
		BudgetRef:         "budget-provider-runtime",
		PolicyRef:         "policy-provider-runtime",
		TraceID:           "trace-provider-runtime",
		State:             "succeeded",
		Source:            "atelier.direct_run.intent",
		CreatedAt:         now,
		UpdatedAt:         now,
	}).Error; err != nil {
		t.Fatalf("seed direct run: %v", err)
	}
	if err := db.Create(&persistence.TaskArtifact{
		ArtifactID:  artifactID,
		TaskID:      taskID,
		EventID:     "evt-provider-runtime-artifact",
		EventSeq:    1,
		RunID:       directRunID,
		Kind:        "direct_run.provider_response",
		Name:        "DirectRun provider response",
		URI:         stationArtifactURI(taskID, artifactID),
		Checksum:    "sha256:provider-runtime",
		ProducedBy:  "station.direct_run",
		RefsJSON:    `["direct-run-provider-runtime"]`,
		PayloadJSON: `{"streamed":true,"markdown":"must-not-project","input_snapshot":{"write":true}}`,
		CreatedAt:   now,
	}).Error; err != nil {
		t.Fatalf("seed artifact: %v", err)
	}
	if err := db.Create(&persistence.TaskArtifactBlob{
		BlobID:          artifactID + ":body",
		ArtifactID:      artifactID,
		TaskID:          taskID,
		EventID:         "evt-provider-runtime-artifact",
		EventSeq:        1,
		BodyKind:        "markdown",
		BodyURI:         atelierArtifactBodyRef(taskID, artifactID),
		ContentHash:     atelierArtifactBodyHash("Station-owned DirectRun result"),
		ByteSize:        int64(len([]byte("Station-owned DirectRun result"))),
		RetentionPolicy: "station_managed",
		RetentionStatus: "active",
		BodyText:        "Station-owned DirectRun result",
		CreatedAt:       now,
	}).Error; err != nil {
		t.Fatalf("seed artifact blob: %v", err)
	}
	if err := db.Create(&persistence.TaskGateResult{
		GateResultID:    "gate-result-provider-runtime",
		TaskID:          taskID,
		EventID:         "evt-provider-runtime-gate",
		EventSeq:        2,
		GateID:          "gate-provider-runtime",
		Status:          "passed",
		Summary:         "DirectRun provider execution produced durable evidence.",
		ArtifactIDsJSON: `["artifact-provider-runtime"]`,
		ProducedBy:      "station.direct_run",
		PayloadJSON:     `{"checks":[{"raw":"must-not-project"}]}`,
		CreatedAt:       now,
	}).Error; err != nil {
		t.Fatalf("seed gate: %v", err)
	}
	if err := db.Create(&persistence.TaskBudgetUsage{
		BudgetUsageID:  "budget-usage-provider-runtime",
		TaskID:         taskID,
		EventID:        "evt-provider-runtime-artifact",
		EventSeq:       1,
		BudgetID:       "budget-provider-runtime",
		DirectRunID:    directRunID,
		ProviderID:     "openai-direct",
		Model:          "gpt-4.1",
		InputTokens:    12,
		OutputTokens:   34,
		TotalTokens:    46,
		UsedMoney:      0.09,
		EstimatedMoney: 0.08,
		PricingSource:  "provider.config.pricing",
		Source:         "station.direct_run",
		PayloadJSON:    `{"raw_invoice":"must-not-project"}`,
		CreatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed budget usage: %v", err)
	}
	if err := db.Create(&persistence.TaskCheckpoint{
		CheckpointID: "ckpt-provider-runtime",
		TaskID:       taskID,
		EventSeq:     2,
		StateJSON:    `{"resume":"station-owned"}`,
		CreatedAt:    now,
	}).Error; err != nil {
		t.Fatalf("seed checkpoint: %v", err)
	}

	outputPath := t.TempDir() + "/atelier-full-e2e-provider-runtime.json"
	t.Setenv(atelierFullE2EProviderRuntimeEvidenceEnv, outputPath)
	service := NewAtelierProjectionService(nil)
	response, err := service.ProviderCapabilities(context.Background(), "actor-1", &ListAtelierProviderCapabilitiesRequest{
		TaskID:                    taskID,
		FullE2ELaunchID:           "launch-provider-runtime",
		FullE2ESessionID:          "session-provider-runtime",
		FullE2EProviderProfileRef: "controlled-provider-profile",
	})
	if err != nil {
		t.Fatalf("provider capabilities: %v", err)
	}
	if response.Source != "station.provider.capabilities" || len(response.Capabilities) == 0 {
		t.Fatalf("expected read-only provider capabilities response, got %+v", response)
	}
	body, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatalf("read provider runtime evidence: %v", err)
	}
	var evidence map[string]interface{}
	if err := json.Unmarshal(body, &evidence); err != nil {
		t.Fatalf("decode provider runtime evidence: %v", err)
	}
	for _, key := range []string{
		"ok",
		"providerRuntimeProven",
		"providerModelQualityProven",
		"streamingReplyUXProven",
		"artifactPersistenceProven",
		"traceCheckpointResumeProven",
	} {
		if evidence[key] != true {
			t.Fatalf("expected %s=true in evidence, got %+v", key, evidence)
		}
	}
	if evidence["owner"] != "station" ||
		evidence["scope"] != "production-provider-runtime" ||
		evidence["launchId"] != "launch-provider-runtime" ||
		evidence["sessionId"] != "session-provider-runtime" ||
		evidence["providerProfileRefRedacted"] != true ||
		evidence["providerProfileRefHash"] != atelierSHA256Hash("controlled-provider-profile") {
		t.Fatalf("unexpected provider runtime identity evidence: %+v", evidence)
	}
	if _, ok := evidence["providerProfileRef"]; ok {
		t.Fatalf("provider runtime evidence must not persist raw providerProfileRef: %+v", evidence)
	}
	for _, key := range []string{
		"appletProviderInvokeExposed",
		"appletRuntimeExecuteExposed",
		"appletArtifactWriteExposed",
		"appletTraceCheckpointResumeExposed",
	} {
		if evidence[key] != false {
			t.Fatalf("expected %s=false in evidence, got %+v", key, evidence)
		}
	}
	serialized, err := json.Marshal(evidence)
	if err != nil {
		t.Fatalf("marshal evidence: %v", err)
	}
	for _, forbidden := range []string{"must-not-project", "raw_prompt", "raw_invoice", "input_snapshot", "markdown", "checks"} {
		if strings.Contains(string(serialized), forbidden) {
			t.Fatalf("provider runtime evidence leaked forbidden field %q: %s", forbidden, serialized)
		}
	}
}

func TestTaskEventWriterPersistsProjectAcceptanceIndexes(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "atelier_project_acceptance_indexes")
	injectOrchestrationServiceTestStore(t, db)
	writer := NewTaskEventWriter(nil)
	ctx := context.Background()

	if _, err := writer.Append(ctx, "evt_gate_failed_index", "task-acceptance-index", "", "", string(domain.EventTypeCollaborationGateResult), map[string]interface{}{
		"block_kind":  "gate_result",
		"gate_id":     "gate-typecheck",
		"status":      "failed",
		"blocking":    true,
		"summary":     "typecheck failed",
		"artifact_id": "artifact-typecheck",
	}); err != nil {
		t.Fatalf("append blocking gate: %v", err)
	}
	var blocker persistence.ProjectBlocker
	if err := db.First(&blocker, "blocker_id = ?", "gate-typecheck").Error; err != nil {
		t.Fatalf("load persisted blocker: %v", err)
	}
	if blocker.TaskID != "task-acceptance-index" ||
		blocker.State != "open" ||
		blocker.EvidenceRef != "artifact-typecheck" ||
		blocker.SourceEventID != "evt_gate_failed_index" {
		t.Fatalf("unexpected persisted blocker: %+v", blocker)
	}

	if _, err := writer.Append(ctx, "evt_gate_resolved_index", "task-acceptance-index", "", "", string(domain.EventTypeCollaborationInterruptResolved), map[string]interface{}{
		"interrupt_id":           "interrupt-gate-typecheck",
		"block_kind":             "decision_resolved",
		"human_decision_reason":  "gate_blocked",
		"human_decision_action":  "rerun_failed_node",
		"gate_id":                "gate-typecheck",
		"gate_recovery_action":   "rerun",
		"human_decision_route":   "station.orchestration",
		"human_decision_comment": "rerun accepted",
	}); err != nil {
		t.Fatalf("append gate decision: %v", err)
	}
	if err := db.First(&blocker, "blocker_id = ?", "gate-typecheck").Error; err != nil {
		t.Fatalf("reload persisted blocker: %v", err)
	}
	if blocker.State != "resolved" ||
		blocker.SourceEventID != "evt_gate_resolved_index" ||
		blocker.EvidenceRef != "artifact-typecheck" {
		t.Fatalf("expected resolved persisted blocker, got %+v", blocker)
	}

	if _, err := writer.Append(ctx, "evt_risk_index", "task-acceptance-index", "", "", string(domain.EventTypeCollaborationFeedbackRecorded), map[string]interface{}{
		"block_kind":  "feedback",
		"feedback_id": "feedback-risk",
		"block_id":    "agent-risk",
		"signal":      "negative",
		"comment":     "follow-up needed",
		"risk_state":  "follow_up",
	}); err != nil {
		t.Fatalf("append residual risk feedback: %v", err)
	}
	var risk persistence.ProjectResidualRisk
	if err := db.First(&risk, "risk_id = ?", "feedback-risk").Error; err != nil {
		t.Fatalf("load persisted risk: %v", err)
	}
	if risk.TaskID != "task-acceptance-index" ||
		risk.State != "follow_up" ||
		risk.Description != "follow-up needed" ||
		risk.EvidenceRef != "agent-risk" {
		t.Fatalf("unexpected persisted risk: %+v", risk)
	}

	if _, err := writer.Append(ctx, "evt_project_state_index", "task-acceptance-index", "", "", string(domain.EventTypeCollaborationTaskCompleted), map[string]interface{}{
		"block_kind":      "project_state",
		"project_id":      "project-acceptance-index",
		"project_state":   "accepted",
		"milestone_state": "accepted",
	}); err != nil {
		t.Fatalf("append project state: %v", err)
	}
	var projectState persistence.ProjectState
	if err := db.First(&projectState, "project_id = ?", "project-acceptance-index").Error; err != nil {
		t.Fatalf("load persisted project state: %v", err)
	}
	if projectState.TaskID != "task-acceptance-index" ||
		projectState.ProjectState != "accepted" ||
		projectState.MilestoneState != "accepted" ||
		projectState.SourceEventID != "evt_project_state_index" {
		t.Fatalf("unexpected persisted project state: %+v", projectState)
	}
	if _, err := writer.Append(ctx, "evt_project_state_invalid", "task-acceptance-index", "", "", string(domain.EventTypeCollaborationTaskCompleted), map[string]interface{}{
		"block_kind":      "project_state",
		"project_id":      "project-state-invalid",
		"project_state":   "teleporting",
		"milestone_state": "floating",
	}); err != nil {
		t.Fatalf("append invalid project state event: %v", err)
	}
	var invalidStateCount int64
	if err := db.Model(&persistence.ProjectState{}).Where("project_id = ?", "project-state-invalid").Count(&invalidStateCount).Error; err != nil {
		t.Fatalf("count invalid project state rows: %v", err)
	}
	if invalidStateCount != 0 {
		t.Fatalf("invalid project state should not be persisted, count=%d", invalidStateCount)
	}

	if _, err := writer.Append(ctx, "evt_predicate_l1_index", "task-acceptance-index", "", "", string(domain.EventTypeCollaborationTaskCompleted), map[string]interface{}{
		"block_kind":              "acceptance_predicate",
		"acceptance_predicate_id": "predicate-l1",
		"acceptance_level":        "L1",
		"expr":                    "typecheck.passed",
		"evaluator":               "verifier",
		"last_eval":               false,
	}); err != nil {
		t.Fatalf("append L1 predicate: %v", err)
	}
	if _, err := writer.Append(ctx, "evt_predicate_l1_update", "task-acceptance-index", "", "", string(domain.EventTypeCollaborationTaskCompleted), map[string]interface{}{
		"block_kind":              "acceptance_predicate",
		"acceptance_predicate_id": "predicate-l1",
		"last_eval":               true,
	}); err != nil {
		t.Fatalf("append L1 predicate update: %v", err)
	}
	if _, err := writer.Append(ctx, "evt_predicate_l2_index", "task-acceptance-index", "", "", string(domain.EventTypeCollaborationTaskCompleted), map[string]interface{}{
		"block_kind":              "acceptance_predicate",
		"acceptance_predicate_id": "predicate-l2",
		"acceptance_level":        "L2",
		"expr":                    "owner.signoff == true",
		"evaluator":               "human",
		"human_signoff":           true,
	}); err != nil {
		t.Fatalf("append L2 predicate: %v", err)
	}
	var predicate persistence.AcceptancePredicate
	if err := db.First(&predicate, "predicate_id = ?", "predicate-l1").Error; err != nil {
		t.Fatalf("load persisted predicate: %v", err)
	}
	if predicate.Level != "L1" || predicate.LastEval == nil || !*predicate.LastEval || predicate.SourceEventID != "evt_predicate_l1_update" {
		t.Fatalf("expected partial predicate update to preserve level and set eval, got %+v", predicate)
	}
	var l2Predicate persistence.AcceptancePredicate
	if err := db.First(&l2Predicate, "predicate_id = ?", "predicate-l2").Error; err != nil {
		t.Fatalf("load persisted L2 predicate: %v", err)
	}
	if l2Predicate.Level != "L2" || !l2Predicate.HumanSignoff {
		t.Fatalf("expected L2 predicate signoff, got %+v", l2Predicate)
	}
	if _, err := writer.Append(ctx, "evt_predicate_invalid", "task-acceptance-index", "", "", string(domain.EventTypeCollaborationTaskCompleted), map[string]interface{}{
		"block_kind":              "acceptance_predicate",
		"acceptance_predicate_id": "predicate-invalid",
		"acceptance_level":        "L9",
		"last_eval":               true,
	}); err != nil {
		t.Fatalf("append invalid predicate event: %v", err)
	}
	var invalidPredicateCount int64
	if err := db.Model(&persistence.AcceptancePredicate{}).Where("predicate_id = ?", "predicate-invalid").Count(&invalidPredicateCount).Error; err != nil {
		t.Fatalf("count invalid predicate rows: %v", err)
	}
	if invalidPredicateCount != 0 {
		t.Fatalf("invalid acceptance predicate should not be persisted, count=%d", invalidPredicateCount)
	}
}

func TestLoadAtelierWorkspacePrefersPersistedProjectAcceptanceIndexes(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "atelier_project_acceptance_load_workspace")
	injectOrchestrationServiceTestStore(t, db)
	now := time.Now().UTC()
	task := persistence.CollaborationTask{
		ID:          "task-persisted-acceptance",
		Title:       "Persisted acceptance indexes",
		GoalOwnerID: "actor-1",
		Status:      int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED),
		MetaJSON:    `{"project":"peers-touch","goal_owner_signoff":"true","project_state":"blocked","milestone_state":"blocked"}`,
		CreatedAt:   now,
		StartedAt:   now,
		EndedAt:     now,
	}
	seedResumeCollaborationTask(t, db, task, nil)
	if err := db.Create(&persistence.ProjectBlocker{
		BlockerID:      "gate-persisted",
		TaskID:         task.ID,
		Scope:          "project",
		Owner:          "verifier",
		Severity:       "block",
		State:          "resolved",
		EvidenceRef:    "artifact-persisted",
		Reason:         "persisted gate resolved",
		SourceEventID:  "evt-persisted-blocker",
		SourceEventSeq: 7,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("create persisted blocker: %v", err)
	}
	if err := db.Create(&persistence.ProjectResidualRisk{
		RiskID:         "risk-persisted",
		TaskID:         task.ID,
		Description:    "persisted follow-up",
		State:          "follow_up",
		EvidenceRef:    "artifact-risk",
		Owner:          "risk",
		SourceEventID:  "evt-persisted-risk",
		SourceEventSeq: 8,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("create persisted residual risk: %v", err)
	}
	if err := db.Create(&persistence.ProjectState{
		ProjectID:      task.ID,
		TaskID:         task.ID,
		ProjectState:   "accepted",
		MilestoneState: "accepted",
		SourceEventID:  "evt-persisted-project-state",
		SourceEventSeq: 9,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("create persisted project state: %v", err)
	}
	accepted := true
	for _, predicate := range []persistence.AcceptancePredicate{
		{
			PredicateID:    "predicate-persisted-l1",
			TaskID:         task.ID,
			Scope:          "project",
			Level:          "L1",
			Evaluator:      "verifier",
			Expr:           "typecheck.passed",
			LastEval:       &accepted,
			SourceEventID:  "evt-persisted-predicate-l1",
			SourceEventSeq: 10,
			CreatedAt:      now,
			UpdatedAt:      now,
		},
		{
			PredicateID:    "predicate-persisted-l2",
			TaskID:         task.ID,
			Scope:          "project",
			Level:          "L2",
			Evaluator:      "human",
			Expr:           "owner.signoff == true",
			HumanSignoff:   true,
			SourceEventID:  "evt-persisted-predicate-l2",
			SourceEventSeq: 11,
			CreatedAt:      now,
			UpdatedAt:      now,
		},
	} {
		if err := db.Create(&predicate).Error; err != nil {
			t.Fatalf("create persisted predicate %s: %v", predicate.PredicateID, err)
		}
	}

	snapshot, err := NewAtelierProjectionService(nil).LoadWorkspace(context.Background(), "actor-1", &LoadAtelierWorkspaceRequest{})
	if err != nil {
		t.Fatalf("load workspace: %v", err)
	}
	if len(snapshot.Workspace.Projects) != 1 {
		t.Fatalf("expected one project, got %+v", snapshot.Workspace.Projects)
	}
	project := snapshot.Workspace.Projects[0]
	if len(project.OpenBlockers) != 1 ||
		project.OpenBlockers[0].ID != "gate-persisted" ||
		project.OpenBlockers[0].State != "resolved" ||
		project.OpenBlockers[0].EvidenceRef != "artifact-persisted" {
		t.Fatalf("expected persisted blocker projection, got %+v", project.OpenBlockers)
	}
	if !project.Completion.NoOpenBlockers || !project.Completion.ResidualRisksLogged {
		t.Fatalf("expected completion to use persisted acceptance indexes, got %+v", project.Completion)
	}
	if !project.Completion.L0L1AcceptancePassed || !project.Completion.L2HumanSignoffComplete {
		t.Fatalf("expected completion to use persisted acceptance predicates, got %+v", project.Completion)
	}
	if len(project.ResidualRisks) != 1 ||
		project.ResidualRisks[0].ID != "risk-persisted" ||
		project.ResidualRisks[0].State != "follow_up" {
		t.Fatalf("expected persisted residual risk projection, got %+v", project.ResidualRisks)
	}
	if len(project.MilestoneTree.Milestones[0].OpenBlockers) != 1 ||
		project.MilestoneTree.Milestones[0].OpenBlockers[0].ID != "gate-persisted" {
		t.Fatalf("expected milestone to reuse persisted blocker evidence, got %+v", project.MilestoneTree.Milestones[0].OpenBlockers)
	}
	if project.State != "accepted" || project.MilestoneTree.Milestones[0].State != "accepted" {
		t.Fatalf("expected persisted project/milestone state to override task meta fallback, got project=%q milestone=%q", project.State, project.MilestoneTree.Milestones[0].State)
	}
	if got := project.MilestoneTree.Milestones[0].AcceptancePredicateIDs; !reflect.DeepEqual(got, []string{"predicate-persisted-l1", "predicate-persisted-l2"}) {
		t.Fatalf("expected persisted acceptance predicate ids, got %+v", got)
	}
}

func TestAcceptancePredicateEvaluatorEvaluatesDeterministicPredicates(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "atelier_acceptance_predicate_evaluator")
	injectOrchestrationServiceTestStore(t, db)
	now := time.Now().UTC()
	task := persistence.CollaborationTask{
		ID:          "task-predicate-eval",
		Title:       "Predicate eval",
		GoalOwnerID: "actor-1",
		Status:      int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED),
		MetaJSON:    `{"goal_owner_signoff":"true"}`,
		CreatedAt:   now,
		StartedAt:   now,
		EndedAt:     now,
	}
	seedResumeCollaborationTask(t, db, task, nil)
	if err := db.Create(&persistence.ProjectState{
		ProjectID:      task.ID,
		TaskID:         task.ID,
		ProjectState:   "accepted",
		MilestoneState: "accepted",
		SourceEventID:  "evt-state",
		SourceEventSeq: 1,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed project state: %v", err)
	}
	if err := db.Create(&persistence.ProjectBlocker{
		BlockerID:      "blocker-resolved",
		TaskID:         task.ID,
		State:          "resolved",
		SourceEventID:  "evt-blocker",
		SourceEventSeq: 2,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed blocker: %v", err)
	}
	if err := db.Create(&persistence.ProjectResidualRisk{
		RiskID:         "risk-follow-up",
		TaskID:         task.ID,
		State:          "follow_up",
		SourceEventID:  "evt-risk",
		SourceEventSeq: 3,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed risk: %v", err)
	}
	if err := db.Create(&persistence.TaskGateResult{
		GateResultID: "gate-typecheck-result",
		TaskID:       task.ID,
		EventID:      "evt-gate",
		EventSeq:     4,
		GateID:       "typecheck",
		Name:         "Typecheck",
		Status:       "passed",
		Blocking:     true,
		CreatedAt:    now,
	}).Error; err != nil {
		t.Fatalf("seed gate result: %v", err)
	}
	if err := db.Create(&persistence.TaskEvent{
		ID:        "evt-memory",
		TaskID:    task.ID,
		EventSeq:  5,
		EventType: int32(model.TaskEventType_TASK_EVENT_TYPE_FEEDBACK_RECORDED),
		Payload:   `{"block_kind":"memory_candidate","memory_candidate_id":"mem-1"}`,
		CreatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed memory candidate event: %v", err)
	}
	predicates := []persistence.AcceptancePredicate{
		{PredicateID: "pred-blockers", TaskID: task.ID, Level: "L1", Expr: "no_open_blockers(project)", SourceEventSeq: 1, CreatedAt: now, UpdatedAt: now},
		{PredicateID: "pred-blockers-dsl", TaskID: task.ID, Level: "L1", Expr: "all(b in project.open_blockers : b.state in {resolved, waived})", SourceEventSeq: 2, CreatedAt: now, UpdatedAt: now},
		{PredicateID: "pred-milestones", TaskID: task.ID, Level: "L1", Expr: "all_milestones.status == accepted", SourceEventSeq: 3, CreatedAt: now, UpdatedAt: now},
		{PredicateID: "pred-tasks-dsl", TaskID: task.ID, Level: "L1", Expr: "all(t in tasks : t.state == accepted)", SourceEventSeq: 4, CreatedAt: now, UpdatedAt: now},
		{PredicateID: "pred-risks", TaskID: task.ID, Level: "L1", Expr: "all_residual_risks.state in {logged,downgraded,follow_up}", SourceEventSeq: 5, CreatedAt: now, UpdatedAt: now},
		{PredicateID: "pred-signoff", TaskID: task.ID, Level: "L1", Expr: "goal_owner_signoff == true", SourceEventSeq: 6, CreatedAt: now, UpdatedAt: now},
		{PredicateID: "pred-memory", TaskID: task.ID, Level: "L1", Expr: "memory_candidates.generated == true", SourceEventSeq: 7, CreatedAt: now, UpdatedAt: now},
		{PredicateID: "pred-typecheck", TaskID: task.ID, Level: "L1", Expr: "typecheck.passed", SourceEventSeq: 8, CreatedAt: now, UpdatedAt: now},
		{PredicateID: "pred-gate-result-call", TaskID: task.ID, Level: "L1", Expr: "gate_result(typecheck).passed", SourceEventSeq: 9, CreatedAt: now, UpdatedAt: now},
		{PredicateID: "pred-blocking-gates", TaskID: task.ID, Level: "L1", Expr: "all(g in gate_plan where g.blocking_level == block : gate_result(g).passed)", SourceEventSeq: 10, CreatedAt: now, UpdatedAt: now},
		{PredicateID: "pred-human-aggregate", TaskID: task.ID, Level: "L1", Expr: "all(p in contract.acceptance where p.level == L2 : p.human_signoff == true)", SourceEventSeq: 11, CreatedAt: now, UpdatedAt: now},
		{PredicateID: "pred-unknown", TaskID: task.ID, Level: "L1", Expr: "llm_says_done", SourceEventSeq: 12, CreatedAt: now, UpdatedAt: now},
		{PredicateID: "pred-human", TaskID: task.ID, Level: "L2", Expr: "owner.signoff == true", HumanSignoff: true, SourceEventSeq: 13, CreatedAt: now, UpdatedAt: now},
	}
	if err := db.Create(&predicates).Error; err != nil {
		t.Fatalf("seed predicates: %v", err)
	}

	if err := NewAcceptancePredicateEvaluator().EvaluateTaskTx(context.Background(), db, task.ID); err != nil {
		t.Fatalf("evaluate predicates: %v", err)
	}
	var updated []persistence.AcceptancePredicate
	if err := db.Order("predicate_id ASC").Find(&updated, "task_id = ?", task.ID).Error; err != nil {
		t.Fatalf("load updated predicates: %v", err)
	}
	got := map[string]persistence.AcceptancePredicate{}
	for _, predicate := range updated {
		got[predicate.PredicateID] = predicate
	}
	for _, id := range []string{
		"pred-blockers",
		"pred-blockers-dsl",
		"pred-milestones",
		"pred-tasks-dsl",
		"pred-risks",
		"pred-signoff",
		"pred-memory",
		"pred-typecheck",
		"pred-gate-result-call",
		"pred-blocking-gates",
		"pred-human-aggregate",
	} {
		if got[id].LastEval == nil || !*got[id].LastEval {
			t.Fatalf("expected %s to evaluate true, got %+v", id, got[id])
		}
	}
	if got["pred-unknown"].LastEval == nil || *got["pred-unknown"].LastEval {
		t.Fatalf("expected unknown predicate to fail closed, got %+v", got["pred-unknown"])
	}
	if got["pred-human"].LastEval != nil || !got["pred-human"].HumanSignoff {
		t.Fatalf("expected L2 predicate eval to remain human-signoff owned, got %+v", got["pred-human"])
	}
}

func TestTaskEventWriterAdvancesProjectStateMachineFromDurableEvidence(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "atelier_project_state_machine_writer")
	injectOrchestrationServiceTestStore(t, db)
	now := time.Now().UTC()
	task := persistence.CollaborationTask{
		ID:          "task-state-machine",
		Title:       "State machine",
		GoalOwnerID: "actor-1",
		Status:      int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED),
		MetaJSON:    `{"goal_owner_signoff":"true","memory_candidates_generated":"true"}`,
		CreatedAt:   now,
		StartedAt:   now,
		EndedAt:     now,
	}
	node := persistence.CollaborationTaskNode{
		ID:        "node-state-machine",
		TaskID:    task.ID,
		AgentID:   "agent-verifier",
		Role:      "verifier",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
		StartedAt: now,
		EndedAt:   now,
	}
	seedResumeCollaborationTask(t, db, task, []persistence.CollaborationTaskNode{node})
	initialEval := false
	if err := db.Create(&persistence.AcceptancePredicate{
		PredicateID:  "predicate-contract",
		TaskID:       task.ID,
		Scope:        "project",
		Level:        "L1",
		Evaluator:    "deterministic",
		Expr:         "gate-contract.passed",
		LastEval:     &initialEval,
		HumanSignoff: false,
		CreatedAt:    now,
		UpdatedAt:    now,
	}).Error; err != nil {
		t.Fatalf("seed L1 predicate: %v", err)
	}
	if err := db.Create(&persistence.AcceptancePredicate{
		PredicateID:  "predicate-owner",
		TaskID:       task.ID,
		Scope:        "project",
		Level:        "L2",
		Evaluator:    "human",
		Expr:         "owner.signoff == true",
		HumanSignoff: true,
		CreatedAt:    now,
		UpdatedAt:    now,
	}).Error; err != nil {
		t.Fatalf("seed L2 predicate: %v", err)
	}
	if err := db.Create(&persistence.TaskArtifact{
		ArtifactID: "artifact-contract",
		TaskID:     task.ID,
		StepID:     node.ID,
		EventID:    "evt-artifact-contract",
		EventSeq:   1,
		Kind:       "test_report",
		Name:       "Contract artifact",
		URI:        "artifact://task-state-machine/artifact-contract",
		Checksum:   "sha256:contract",
		CreatedAt:  now,
	}).Error; err != nil {
		t.Fatalf("seed artifact index: %v", err)
	}

	writer := NewTaskEventWriter(nil)
	if _, err := writer.Append(context.Background(), "evt-state-machine-gate", task.ID, node.ID, "", string(domain.EventTypeCollaborationGateResult), map[string]interface{}{
		"block_kind":  "gate_result",
		"gate_id":     "gate-contract",
		"status":      "passed",
		"blocking":    true,
		"summary":     "contract gate passed",
		"artifact_id": "artifact-contract",
	}); err != nil {
		t.Fatalf("append gate event: %v", err)
	}

	var state persistence.ProjectState
	if err := db.First(&state, "project_id = ?", task.ID).Error; err != nil {
		t.Fatalf("load runtime project state: %v", err)
	}
	if state.ProjectState != "accepted" || state.MilestoneState != "accepted" || state.SourceEventID != "evt-state-machine-gate" {
		t.Fatalf("expected runtime state machine to accept project from durable evidence, got %+v", state)
	}
	var predicate persistence.AcceptancePredicate
	if err := db.First(&predicate, "predicate_id = ?", "predicate-contract").Error; err != nil {
		t.Fatalf("load refreshed predicate: %v", err)
	}
	if predicate.LastEval == nil || !*predicate.LastEval {
		t.Fatalf("expected writer hook to refresh predicate before state advance, got %+v", predicate)
	}
	var milestone persistence.AtelierMilestone
	if err := db.First(&milestone, "task_id = ?", task.ID).Error; err != nil {
		t.Fatalf("load runtime milestone index: %v", err)
	}
	if milestone.MilestoneID != task.ID+"-milestone-root" || milestone.State != "accepted" || milestone.TaskIDsJSON != `["node-state-machine"]` {
		t.Fatalf("expected runtime milestone index, got %+v", milestone)
	}
	var graphNode persistence.AtelierTaskGraphNode
	if err := db.First(&graphNode, "node_id = ?", node.ID).Error; err != nil {
		t.Fatalf("load runtime task graph node index: %v", err)
	}
	if graphNode.ArtifactIDsJSON != `["artifact-contract"]` || graphNode.GateIDsJSON != `["gate-contract"]` {
		t.Fatalf("expected runtime graph node refs from Station indexes, got %+v", graphNode)
	}
	snapshot, err := NewAtelierProjectionService(nil).LoadWorkspace(context.Background(), "actor-1", &LoadAtelierWorkspaceRequest{})
	if err != nil {
		t.Fatalf("load workspace: %v", err)
	}
	project := snapshot.Workspace.Projects[0]
	if got := project.TaskGraph.Tasks[0].ArtifactIDs; !reflect.DeepEqual(got, []string{"artifact-contract"}) {
		t.Fatalf("expected projection to use persisted task graph artifact refs, got %+v", got)
	}
	if got := project.TaskGraph.Tasks[0].GateIDs; !reflect.DeepEqual(got, []string{"gate-contract"}) {
		t.Fatalf("expected projection to use persisted task graph gate refs, got %+v", got)
	}
	if got := project.MilestoneTree.Milestones[0].TaskIDs; !reflect.DeepEqual(got, []string{node.ID}) {
		t.Fatalf("expected projection to use persisted milestone task ids, got %+v", got)
	}
}

func TestTaskEventWriterMaterializesPolicyDefectIndexes(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "atelier_policy_defect_materializer")
	injectOrchestrationServiceTestStore(t, db)
	now := time.Now().UTC()
	task := persistence.CollaborationTask{
		ID:          "task-policy-defect",
		Title:       "Policy defect",
		GoalOwnerID: "actor-1",
		Status:      int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		MetaJSON:    `{"policy_id":"policy-station","policy_hard_deny":"true","policy_rule_expr":"no_unresolved_blocking_gate","policy_rule_scope":"project","policy_rule_severity":"block"}`,
		CreatedAt:   now,
		StartedAt:   now,
		EndedAt:     now,
	}
	node := persistence.CollaborationTaskNode{
		ID:        "node-policy-defect",
		TaskID:    task.ID,
		AgentID:   "agent-verifier",
		Role:      "verifier",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
		StartedAt: now,
		EndedAt:   now,
	}
	seedResumeCollaborationTask(t, db, task, []persistence.CollaborationTaskNode{node})

	writer := NewTaskEventWriter(nil)
	if _, err := writer.Append(context.Background(), "evt-policy-defect-gate", task.ID, node.ID, "", string(domain.EventTypeCollaborationGateResult), map[string]interface{}{
		"block_kind":      "gate_result",
		"gate_id":         "gate-policy",
		"status":          "failed",
		"blocking":        true,
		"summary":         "policy gate failed",
		"artifact_id":     "artifact-policy",
		"expected_change": "rerun verifier",
		"target_refs":     []string{node.ID},
	}); err != nil {
		t.Fatalf("append failed gate event: %v", err)
	}

	var policy persistence.AtelierPolicy
	if err := db.First(&policy, "policy_projection_id = ?", "task-policy-defect:policy-station").Error; err != nil {
		t.Fatalf("load policy index: %v", err)
	}
	if !policy.HardDeny || policy.PolicyID != "policy-station" {
		t.Fatalf("expected task-scoped hard-deny policy index, got %+v", policy)
	}
	var rule persistence.AtelierPolicyRule
	if err := db.First(&rule, "task_id = ? AND policy_id = ?", task.ID, "policy-station").Error; err != nil {
		t.Fatalf("load policy rule index: %v", err)
	}
	if rule.Expr != "no_unresolved_blocking_gate" || rule.Scope != "project" || rule.Severity != "block" {
		t.Fatalf("expected policy rule index from task meta, got %+v", rule)
	}
	var defect persistence.AtelierDefect
	if err := db.First(&defect, "task_id = ?", task.ID).Error; err != nil {
		t.Fatalf("load defect index: %v", err)
	}
	if defect.DefectID != "evt-policy-defect-gate" || defect.EvidenceRef != "artifact-policy" || defect.ExpectedChange != "rerun verifier" {
		t.Fatalf("expected defect index from failed gate, got %+v", defect)
	}

	snapshot, err := NewAtelierProjectionService(nil).LoadWorkspace(context.Background(), "actor-1", &LoadAtelierWorkspaceRequest{})
	if err != nil {
		t.Fatalf("load workspace: %v", err)
	}
	project := snapshot.Workspace.Projects[0]
	if project.Policy == nil || project.Policy.ID != "policy-station" || !project.Policy.HardDeny {
		t.Fatalf("expected projection to use persisted policy index, got %+v", project.Policy)
	}
	if len(project.Policy.Rules) != 1 || project.Policy.Rules[0].Expr != "no_unresolved_blocking_gate" {
		t.Fatalf("expected projection to use persisted policy rule index, got %+v", project.Policy.Rules)
	}
	if len(project.Defects) != 1 || project.Defects[0].ID != "evt-policy-defect-gate" || project.Defects[0].Proposal.TargetRefs[0] != node.ID {
		t.Fatalf("expected projection to use persisted defect index, got %+v", project.Defects)
	}
}

func TestFetchAtelierArtifactBodyReturnsOwnedSafeTextBody(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "atelier_artifact_body_fetch")
	injectOrchestrationServiceTestStore(t, db)
	now := time.Now().UTC()
	task := persistence.CollaborationTask{
		ID:          "task-body-fetch",
		Title:       "Fetch artifact body",
		GoalOwnerID: "actor-1",
		Status:      int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		CreatedAt:   now,
		StartedAt:   now,
		EndedAt:     now,
	}
	seedResumeCollaborationTask(t, db, task, nil)
	if err := db.Create(&persistence.TaskArtifact{
		ArtifactID:  "artifact-report",
		TaskID:      task.ID,
		Kind:        "markdown",
		Name:        "report.md",
		URI:         "artifact://task-body-fetch/artifact-report",
		Checksum:    validArtifactChecksum,
		PayloadJSON: `{"body_ref":"artifact://task-body-fetch/artifact-report/body","body_kind":"markdown"}`,
		CreatedAt:   now,
	}).Error; err != nil {
		t.Fatalf("create artifact: %v", err)
	}
	if err := db.Create(&persistence.TaskArtifactBlob{
		BlobID:          "artifact-report:markdown",
		ArtifactID:      "artifact-report",
		TaskID:          task.ID,
		BodyKind:        "markdown",
		BodyURI:         "artifact://task-body-fetch/artifact-report/body",
		ContentHash:     atelierArtifactBodyHash("# Report"),
		ByteSize:        int64(len([]byte("# Report"))),
		RetentionPolicy: "task_lifetime",
		RetentionStatus: "active",
		BodyText:        "# Report",
		CreatedAt:       now,
	}).Error; err != nil {
		t.Fatalf("create blob: %v", err)
	}

	response, err := NewAtelierProjectionService(nil).FetchArtifactBody(context.Background(), "actor-1", &FetchAtelierArtifactBodyRequest{
		TaskID:       task.ID,
		ArtifactID:   "artifact-report",
		BodyRef:      "artifact://task-body-fetch/artifact-report/body",
		ExpectedHash: atelierArtifactBodyHash("# Report"),
		MaxBytes:     4,
	})
	if err != nil {
		t.Fatalf("fetch artifact body: %v", err)
	}
	if response.TaskID != task.ID ||
		response.ArtifactID != "artifact-report" ||
		response.BodyKind != "markdown" ||
		response.BodyHash != atelierArtifactBodyHash("# Report") ||
		response.BodySize != int64(len([]byte("# Report"))) ||
		response.Text != "# Re" ||
		!response.Truncated ||
		response.RetentionStatus != "active" {
		t.Fatalf("unexpected artifact body response: %+v", response)
	}
}

func TestFetchAtelierArtifactBodyRejectsUnsafeOrUnownedBlob(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "atelier_artifact_body_rejects")
	injectOrchestrationServiceTestStore(t, db)
	now := time.Now().UTC()
	task := persistence.CollaborationTask{
		ID:          "task-body-owned",
		Title:       "Owned task",
		GoalOwnerID: "actor-1",
		Status:      int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		CreatedAt:   now,
		StartedAt:   now,
		EndedAt:     now,
	}
	otherTask := persistence.CollaborationTask{
		ID:          "task-body-other",
		Title:       "Other task",
		GoalOwnerID: "actor-2",
		Status:      int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		CreatedAt:   now,
		StartedAt:   now,
		EndedAt:     now,
	}
	seedResumeCollaborationTask(t, db, task, nil)
	seedResumeCollaborationTask(t, db, otherTask, nil)
	for _, artifact := range []persistence.TaskArtifact{
		{ArtifactID: "artifact-report", TaskID: task.ID, Kind: "markdown", URI: "artifact://task-body-owned/artifact-report", Checksum: validArtifactChecksum, CreatedAt: now},
		{ArtifactID: "artifact-html", TaskID: task.ID, Kind: "html", URI: "artifact://task-body-owned/artifact-html", Checksum: validArtifactChecksum, CreatedAt: now},
		{ArtifactID: "artifact-expired", TaskID: task.ID, Kind: "markdown", URI: "artifact://task-body-owned/artifact-expired", Checksum: validArtifactChecksum, CreatedAt: now},
		{ArtifactID: "artifact-mismatch", TaskID: task.ID, Kind: "markdown", URI: "artifact://task-body-owned/artifact-mismatch", Checksum: validArtifactChecksum, CreatedAt: now},
		{ArtifactID: "artifact-other", TaskID: otherTask.ID, Kind: "markdown", URI: "artifact://task-body-other/artifact-other", Checksum: validArtifactChecksum, CreatedAt: now},
	} {
		if err := db.Create(&artifact).Error; err != nil {
			t.Fatalf("create artifact: %v", err)
		}
	}
	expiredAt := now.Add(-time.Minute)
	for _, blob := range []persistence.TaskArtifactBlob{
		{BlobID: "owned:markdown", ArtifactID: "artifact-report", TaskID: task.ID, BodyKind: "markdown", BodyURI: "artifact://task-body-owned/artifact-report/body", ContentHash: atelierArtifactBodyHash("owned"), ByteSize: 5, RetentionPolicy: "task_lifetime", RetentionStatus: "active", BodyText: "owned", CreatedAt: now},
		{BlobID: "owned:html", ArtifactID: "artifact-html", TaskID: task.ID, BodyKind: "html", BodyURI: "artifact://task-body-owned/artifact-html/body", ContentHash: atelierArtifactBodyHash("<b>x</b>"), ByteSize: 8, RetentionPolicy: "task_lifetime", RetentionStatus: "active", BodyText: "<b>x</b>", CreatedAt: now},
		{BlobID: "owned:expired", ArtifactID: "artifact-expired", TaskID: task.ID, BodyKind: "markdown", BodyURI: "artifact://task-body-owned/artifact-expired/body", ContentHash: atelierArtifactBodyHash("expired"), ByteSize: 7, RetentionPolicy: "task_lifetime", RetentionStatus: "active", BodyText: "expired", CreatedAt: now, ExpiresAt: &expiredAt},
		{BlobID: "owned:mismatch", ArtifactID: "artifact-mismatch", TaskID: task.ID, BodyKind: "markdown", BodyURI: "artifact://task-body-owned/artifact-mismatch/body", ContentHash: atelierArtifactBodyHash("different"), ByteSize: 8, RetentionPolicy: "task_lifetime", RetentionStatus: "active", BodyText: "mismatch", CreatedAt: now},
		{BlobID: "other:markdown", ArtifactID: "artifact-other", TaskID: otherTask.ID, BodyKind: "markdown", BodyURI: "artifact://task-body-other/artifact-other/body", ContentHash: atelierArtifactBodyHash("other"), ByteSize: 5, RetentionPolicy: "task_lifetime", RetentionStatus: "active", BodyText: "other", CreatedAt: now},
	} {
		if err := db.Create(&blob).Error; err != nil {
			t.Fatalf("create blob: %v", err)
		}
	}
	service := NewAtelierProjectionService(nil)
	for _, tc := range []struct {
		name       string
		actorID    string
		taskID     string
		artifactID string
		bodyRef    string
	}{
		{name: "unowned task", actorID: "actor-1", taskID: otherTask.ID, artifactID: "artifact-other", bodyRef: "artifact://task-body-other/artifact-other/body"},
		{name: "body ref mismatch", actorID: "actor-1", taskID: task.ID, artifactID: "artifact-report", bodyRef: "artifact://task-body-other/artifact-report/body"},
		{name: "unsafe html kind", actorID: "actor-1", taskID: task.ID, artifactID: "artifact-html", bodyRef: "artifact://task-body-owned/artifact-html/body"},
		{name: "expired body", actorID: "actor-1", taskID: task.ID, artifactID: "artifact-expired", bodyRef: "artifact://task-body-owned/artifact-expired/body"},
		{name: "hash mismatch", actorID: "actor-1", taskID: task.ID, artifactID: "artifact-mismatch", bodyRef: "artifact://task-body-owned/artifact-mismatch/body"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := service.FetchArtifactBody(context.Background(), tc.actorID, &FetchAtelierArtifactBodyRequest{
				TaskID:     tc.taskID,
				ArtifactID: tc.artifactID,
				BodyRef:    tc.bodyRef,
			})
			if err == nil {
				t.Fatalf("expected fetch to reject %s", tc.name)
			}
		})
	}
}

func TestAtelierDirectRunExecutionEvidenceIsStationOwnedMetadataOnly(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "atelier_direct_run_execution_evidence")
	now := time.Now().UTC()
	taskID := "task-direct-run-evidence"
	directRunID := "direct-run-evidence"
	artifactID := "artifact-direct-run-result"
	if err := db.Create(&persistence.DirectRun{
		DirectRunID:       directRunID,
		TaskID:            taskID,
		ProviderID:        "openai-direct",
		ModelIntent:       "gpt-4.1",
		InputSnapshotJSON: `{"raw_prompt":"must-not-project","input_snapshot":{"write":true},"attachments":[{"base64":"AAAA"}]}`,
		BudgetRef:         "budget-direct",
		PolicyRef:         "policy-direct",
		TraceID:           "trace-direct-run",
		State:             "succeeded",
		Source:            "atelier.direct_run.intent",
		CreatedAt:         now,
		UpdatedAt:         now,
	}).Error; err != nil {
		t.Fatalf("seed direct run: %v", err)
	}
	if err := db.Create(&persistence.TaskArtifact{
		ArtifactID:  artifactID,
		TaskID:      taskID,
		EventID:     "evt-direct-run-artifact",
		EventSeq:    1,
		RunID:       directRunID,
		Kind:        "direct_run.provider_response",
		Name:        "DirectRun provider response",
		URI:         stationArtifactURI(taskID, artifactID),
		Checksum:    "sha256:artifact",
		ProducedBy:  "station.direct_run",
		RefsJSON:    `["direct-run-evidence"]`,
		PayloadJSON: `{"markdown":"raw provider body must-not-project","input_snapshot":{"write":true}}`,
		CreatedAt:   now,
	}).Error; err != nil {
		t.Fatalf("seed direct run artifact: %v", err)
	}
	if err := db.Create(&persistence.TaskArtifactBlob{
		BlobID:          artifactID + ":body",
		ArtifactID:      artifactID,
		TaskID:          taskID,
		EventID:         "evt-direct-run-artifact",
		EventSeq:        1,
		BodyKind:        "markdown",
		BodyURI:         atelierArtifactBodyRef(taskID, artifactID),
		ContentHash:     atelierArtifactBodyHash("raw provider body must-not-project"),
		ByteSize:        int64(len([]byte("raw provider body must-not-project"))),
		RetentionPolicy: "station_managed",
		RetentionStatus: "active",
		BodyText:        "raw provider body must-not-project",
		CreatedAt:       now,
	}).Error; err != nil {
		t.Fatalf("seed direct run blob: %v", err)
	}
	if err := db.Create(&persistence.TaskGateResult{
		GateResultID:    "gate-result-direct-run",
		TaskID:          taskID,
		EventID:         "evt-direct-run-gate",
		EventSeq:        2,
		GateID:          "gate-direct-run",
		Status:          "passed",
		Summary:         "DirectRun provider execution produced durable evidence.",
		ArtifactIDsJSON: `["artifact-direct-run-result"]`,
		ProducedBy:      "station.direct_run",
		PayloadJSON:     `{"checks":[{"raw":"must-not-project"}]}`,
		CreatedAt:       now,
	}).Error; err != nil {
		t.Fatalf("seed direct run gate: %v", err)
	}
	if err := db.Create(&persistence.TaskBudgetUsage{
		BudgetUsageID:  "budget-usage-direct-run",
		TaskID:         taskID,
		EventID:        "evt-direct-run-artifact",
		EventSeq:       1,
		BudgetID:       "budget-direct",
		DirectRunID:    directRunID,
		ProviderID:     "openai-direct",
		Model:          "gpt-4.1",
		InputTokens:    12,
		OutputTokens:   34,
		TotalTokens:    46,
		UsedMoney:      0.09,
		EstimatedMoney: 0.08,
		PricingSource:  "provider.config.pricing",
		Source:         "station.direct_run",
		PayloadJSON:    `{"raw_invoice":"must-not-project"}`,
		CreatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed direct run budget usage: %v", err)
	}

	evidence, err := buildAtelierDirectRunExecutionEvidence(context.Background(), db, taskID)
	if err != nil {
		t.Fatalf("build direct run evidence: %v", err)
	}
	if len(evidence) != 1 {
		t.Fatalf("expected one direct run evidence item, got %+v", evidence)
	}
	item := evidence[0]
	if item.DirectRunID != directRunID ||
		item.TaskID != taskID ||
		item.ProviderID != "openai-direct" ||
		item.ModelIntent != "gpt-4.1" ||
		item.State != "succeeded" ||
		item.TraceID != "trace-direct-run" {
		t.Fatalf("unexpected direct run metadata: %+v", item)
	}
	if !reflect.DeepEqual(item.ArtifactRefs, []string{stationArtifactURI(taskID, artifactID)}) ||
		!reflect.DeepEqual(item.GateRefs, []string{"gate://task-direct-run-evidence/gate-direct-run"}) {
		t.Fatalf("unexpected direct run refs: %+v", item)
	}
	if item.BudgetUsage.Tokens != 46 ||
		item.BudgetUsage.MoneyUSD != 0.09 ||
		item.BudgetUsage.Source != "station_budget_ledger_projection" ||
		item.BudgetUsage.BudgetRef != "budget-direct" ||
		item.BudgetUsage.PricingRef != "provider.config.pricing" {
		t.Fatalf("unexpected budget usage projection: %+v", item.BudgetUsage)
	}
	serialized, err := json.Marshal(item)
	if err != nil {
		t.Fatalf("marshal evidence: %v", err)
	}
	for _, forbidden := range []string{
		"must-not-project",
		"raw_prompt",
		"raw provider body",
		"raw_invoice",
		"input_snapshot",
		"base64",
		"markdown",
		"checks",
	} {
		if strings.Contains(string(serialized), forbidden) {
			t.Fatalf("direct run evidence leaked forbidden field %q: %s", forbidden, serialized)
		}
	}
}

func TestAtelierTaskLifecycleSetStatusPersistsWorkbenchStateWithoutExecutionTransition(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "atelier_task_lifecycle_set_status")
	injectOrchestrationServiceTestStore(t, db)
	now := time.Now().UTC()
	task := persistence.CollaborationTask{
		ID:          "task-lifecycle-status",
		Title:       "Lifecycle status",
		GoalOwnerID: "actor-1",
		Status:      int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		MetaJSON:    `{"atelier_status":"active","project":"atelier"}`,
		CreatedAt:   now,
		StartedAt:   now,
		EndedAt:     now,
	}
	seedResumeCollaborationTask(t, db, task, []persistence.CollaborationTaskNode{{
		ID:        "node-lifecycle-status",
		TaskID:    task.ID,
		AgentID:   "agent-lifecycle",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
		StartedAt: now,
		EndedAt:   now,
	}})

	service := NewAtelierProjectionService(nil)
	snapshot, err := service.SetTaskStatus(context.Background(), "actor-1", &SetAtelierTaskStatusRequest{
		TaskID: task.ID,
		Status: "archived",
	})
	if err != nil {
		t.Fatalf("set task status archived: %v", err)
	}
	if len(snapshot.Workspace.Tasks) != 1 {
		t.Fatalf("expected one projected task, got %+v", snapshot.Workspace.Tasks)
	}
	projected := snapshot.Workspace.Tasks[0]
	if projected.Status != "archived" {
		t.Fatalf("expected archived workbench lifecycle, got %+v", projected)
	}
	if !projected.Running {
		t.Fatalf("expected execution state to stay running while archived, got %+v", projected)
	}
	var persisted persistence.CollaborationTask
	if err := db.First(&persisted, "id = ?", task.ID).Error; err != nil {
		t.Fatalf("load persisted task: %v", err)
	}
	if persisted.Status != int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING) {
		t.Fatalf("expected execution status to remain running, got %d", persisted.Status)
	}
	meta := decodeStringMap(persisted.MetaJSON)
	if meta["atelier_status"] != "archived" || meta["project"] != "atelier" {
		t.Fatalf("expected archived lifecycle metadata preserving existing meta, got %+v", meta)
	}
	if _, err := service.SetTaskStatus(context.Background(), "actor-1", &SetAtelierTaskStatusRequest{
		TaskID: task.ID,
		Status: "running",
	}); err == nil {
		t.Fatal("expected execution status value to be rejected as workbench lifecycle status")
	}
}

func TestAtelierTaskLifecyclePurgeRequiresDeletedAndUsesPublicService(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "atelier_task_lifecycle_purge_service")
	injectOrchestrationServiceTestStore(t, db)
	now := time.Now().UTC()
	task := persistence.CollaborationTask{
		ID:          "task-lifecycle-purge",
		Title:       "Lifecycle purge",
		GoalOwnerID: "actor-1",
		Status:      int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_CANCELLED),
		MetaJSON:    `{"atelier_status":"archived"}`,
		CreatedAt:   now,
		StartedAt:   now,
		EndedAt:     now,
	}
	otherTask := persistence.CollaborationTask{
		ID:          "task-lifecycle-keep",
		Title:       "Keep lifecycle",
		GoalOwnerID: "actor-1",
		Status:      int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		MetaJSON:    `{"atelier_status":"active"}`,
		CreatedAt:   now,
		StartedAt:   now,
		EndedAt:     now,
	}
	seedResumeCollaborationTask(t, db, task, []persistence.CollaborationTaskNode{{
		ID:        "node-lifecycle-purge",
		TaskID:    task.ID,
		AgentID:   "agent-lifecycle",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
		StartedAt: now,
		EndedAt:   now,
	}})
	seedResumeCollaborationTask(t, db, otherTask, nil)
	if err := db.Create(&persistence.TaskEvent{
		ID:        "evt-lifecycle-purge",
		TaskID:    task.ID,
		EventSeq:  1,
		EventType: int32(model.TaskEventType_TASK_EVENT_TYPE_GATE_RESULT),
		Payload:   `{"block_kind":"gate_result","gate_id":"gate-lifecycle-purge"}`,
		CreatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed task event: %v", err)
	}
	if err := db.Create(&persistence.TaskArtifact{
		ArtifactID: "artifact-lifecycle-purge",
		TaskID:     task.ID,
		EventID:    "evt-lifecycle-purge",
		EventSeq:   1,
		CreatedAt:  now,
	}).Error; err != nil {
		t.Fatalf("seed artifact: %v", err)
	}
	if err := db.Create(&persistence.TaskGateResult{
		GateResultID: "gate-result-lifecycle-purge",
		TaskID:       task.ID,
		EventID:      "evt-lifecycle-purge",
		EventSeq:     1,
		GateID:       "gate-lifecycle-purge",
		Status:       "failed",
		Blocking:     true,
		CreatedAt:    now,
	}).Error; err != nil {
		t.Fatalf("seed gate result: %v", err)
	}

	service := NewAtelierProjectionService(nil)
	if _, err := service.PurgeTask(context.Background(), "actor-1", &PurgeAtelierTaskRequest{TaskID: task.ID}); err == nil {
		t.Fatal("expected purge to require deleted lifecycle status")
	}
	if _, err := service.SetTaskStatus(context.Background(), "actor-1", &SetAtelierTaskStatusRequest{
		TaskID: task.ID,
		Status: "deleted",
	}); err != nil {
		t.Fatalf("set deleted status: %v", err)
	}
	snapshot, err := service.PurgeTask(context.Background(), "actor-1", &PurgeAtelierTaskRequest{TaskID: task.ID})
	if err != nil {
		t.Fatalf("purge deleted task: %v", err)
	}
	for _, projected := range snapshot.Workspace.Tasks {
		if projected.ID == task.ID {
			t.Fatalf("purged task should not remain in projection: %+v", snapshot.Workspace.Tasks)
		}
	}
	for _, item := range []struct {
		label string
		model interface{}
		where string
	}{
		{label: "task", model: &persistence.CollaborationTask{}, where: "id = ?"},
		{label: "node", model: &persistence.CollaborationTaskNode{}, where: "task_id = ?"},
		{label: "event", model: &persistence.TaskEvent{}, where: "task_id = ?"},
		{label: "artifact", model: &persistence.TaskArtifact{}, where: "task_id = ?"},
		{label: "gate result", model: &persistence.TaskGateResult{}, where: "task_id = ?"},
	} {
		var count int64
		if err := db.Model(item.model).Where(item.where, task.ID).Count(&count).Error; err != nil {
			t.Fatalf("count purged %s: %v", item.label, err)
		}
		if count != 0 {
			t.Fatalf("expected public purge service to delete %s records, got %d", item.label, count)
		}
	}
	var kept int64
	if err := db.Model(&persistence.CollaborationTask{}).Where("id = ?", otherTask.ID).Count(&kept).Error; err != nil {
		t.Fatalf("count kept task: %v", err)
	}
	if kept != 1 {
		t.Fatalf("expected unrelated task to remain, got %d", kept)
	}
}

func TestAtelierSendMessagePersistsTextOnlyUserEvent(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "atelier_message_send_text_only")
	injectOrchestrationServiceTestStore(t, db)
	now := time.Now().UTC()
	task := persistence.CollaborationTask{
		ID:          "task-message-text-only",
		Title:       "Message text only",
		GoalOwnerID: "actor-1",
		Status:      int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		MetaJSON:    `{"agent_ids":"agent-message"}`,
		CreatedAt:   now,
		StartedAt:   now,
		EndedAt:     now,
	}
	seedResumeCollaborationTask(t, db, task, []persistence.CollaborationTaskNode{{
		ID:        "node-message-text-only",
		TaskID:    task.ID,
		AgentID:   "agent-message",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
		StartedAt: now,
		EndedAt:   now,
	}})

	orchestration := NewOrchestrationService(nil, nil, nil)
	orchestration.SetEventBus(nil)
	service := NewAtelierProjectionService(orchestration)
	if _, err := service.SendMessage(context.Background(), "actor-1", &SendAtelierMessageRequest{
		TaskID: task.ID,
		Text:   "继续推进实现",
	}); err != nil {
		t.Fatalf("send message: %v", err)
	}

	var event persistence.TaskEvent
	if err := db.Where("task_id = ?", task.ID).Order("event_seq DESC").First(&event).Error; err != nil {
		t.Fatalf("load message event: %v", err)
	}
	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(event.Payload), &payload); err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	for _, forbidden := range []string{"run", "run_kind", "run_model", "run_flow_id", "attachments", "inputSnapshot", "input_snapshot"} {
		if _, ok := payload[forbidden]; ok {
			t.Fatalf("message send payload must not include %s: %+v", forbidden, payload)
		}
	}
	if payload["source"] != "atelier.message.send" || payload["block_kind"] != "user" || payload["text"] != "继续推进实现" {
		t.Fatalf("unexpected text-only message payload: %+v", payload)
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

func TestBuildAtelierProjectionEventMapsInterruptRequestedToDecisionBlock(t *testing.T) {
	event := &model.TaskEvent{
		EventId:  "evt_interrupt_1",
		TaskId:   "collab_1",
		EventSeq: 9,
		Type:     model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_REQUESTED,
		PayloadJson: `{
		  "interrupt_id":"decision_1",
		  "interrupt_type":"human_decision",
		  "question":"是否继续执行？",
		  "options":[{"text":"继续执行","recommended":true},{"text":"暂停"}],
		  "rollback_impact":"会保留当前 checkpoint"
		}`,
		CreatedAt: timestamppb.New(time.Date(2026, 7, 1, 11, 8, 0, 0, time.UTC)),
	}

	projected, ok := BuildAtelierProjectionEvent(event)
	if !ok {
		t.Fatal("expected interrupt request to be projected")
	}
	if projected.Patch.Kind != "stream.append" {
		t.Fatalf("expected stream.append patch, got %q", projected.Patch.Kind)
	}
	if len(projected.Patch.Blocks) != 1 {
		t.Fatalf("expected one decision block, got %d", len(projected.Patch.Blocks))
	}
	block := projected.Patch.Blocks[0]
	if block.Kind != "decision" || block.ID != "decision_1" {
		t.Fatalf("expected decision block decision_1, got %+v", block)
	}
	if block.Question != "是否继续执行？" {
		t.Fatalf("unexpected decision question: %q", block.Question)
	}
	if len(block.Options) != 2 || !block.Options[0].Recommended {
		t.Fatalf("unexpected decision options: %+v", block.Options)
	}
	if block.RollbackImpact != "会保留当前 checkpoint" {
		t.Fatalf("unexpected rollback impact: %q", block.RollbackImpact)
	}
}

func TestBuildAtelierProjectionEventMapsDecisionResolved(t *testing.T) {
	event := &model.TaskEvent{
		EventId:     "evt_decision_1",
		TaskId:      "collab_1",
		EventSeq:    9,
		Type:        model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_RESOLVED,
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

func TestBuildAtelierProjectionEventMapsDecisionResolvedByInterruptID(t *testing.T) {
	event := &model.TaskEvent{
		EventId:     "evt_decision_2",
		TaskId:      "collab_1",
		EventSeq:    10,
		Type:        model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_RESOLVED,
		PayloadJson: `{"source":"atelier.escalation.resolve","block_kind":"decision_resolved","interrupt_id":"decision_2","choice":"继续执行"}`,
		CreatedAt:   timestamppb.New(time.Date(2026, 7, 1, 11, 12, 0, 0, time.UTC)),
	}

	projected, ok := BuildAtelierProjectionEvent(event)
	if !ok {
		t.Fatal("expected event to be projected")
	}
	if projected.Patch.Kind != "decision.resolved" || projected.Patch.BlockID != "decision_2" {
		t.Fatalf("expected decision.resolved patch by interrupt id, got %+v", projected.Patch)
	}
}

func TestAtelierDecisionResolvedUsesStructuredInterruptEventType(t *testing.T) {
	if got := taskEventTypeForDomainEvent(string(domain.EventTypeCollaborationInterruptRequested)); got != model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_REQUESTED {
		t.Fatalf("expected interrupt requested task event type, got %s", got.String())
	}
	if got := taskEventTypeForDomainEvent(string(domain.EventTypeCollaborationInterruptResolved)); got != model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_RESOLVED {
		t.Fatalf("expected interrupt resolved task event type, got %s", got.String())
	}
	if got := taskEventDomainType(int32(model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_REQUESTED), nil); got != string(domain.EventTypeCollaborationInterruptRequested) {
		t.Fatalf("expected interrupt requested domain event type, got %q", got)
	}
	payload := map[string]interface{}{
		"block_kind":          "decision_resolved",
		"resume_payload_json": `{"choice":"继续执行"}`,
	}
	if got := taskEventDomainType(int32(model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_RESOLVED), payload); got != string(domain.EventTypeCollaborationInterruptResolved) {
		t.Fatalf("expected interrupt resolved domain event type, got %q", got)
	}
}

func TestAtelierFeedbackRecordedIsTypedIntentNotStreamPatch(t *testing.T) {
	if got := taskEventTypeForDomainEvent(string(domain.EventTypeCollaborationFeedbackRecorded)); got != model.TaskEventType_TASK_EVENT_TYPE_FEEDBACK_RECORDED {
		t.Fatalf("expected feedback recorded task event type, got %s", got.String())
	}
	if got := taskEventDomainType(int32(model.TaskEventType_TASK_EVENT_TYPE_FEEDBACK_RECORDED), nil); got != string(domain.EventTypeCollaborationFeedbackRecorded) {
		t.Fatalf("expected feedback recorded domain event type, got %q", got)
	}
	memoryStatus, _, memoryFeeds := atelierFeedbackMemoryCandidatePolicy("positive")
	if memoryStatus != "candidate" {
		t.Fatalf("expected positive feedback to record memory candidate policy, got %q", memoryStatus)
	}
	if !reflect.DeepEqual(memoryFeeds, []string{"planner", "verifier"}) {
		t.Fatalf("expected positive memory candidate to feed planner/verifier, got %#v", memoryFeeds)
	}
	candidateHint := AtelierFeedbackPolicyHint{
		Status:               memoryStatus,
		Reason:               "test",
		RequiresConfirmation: memoryStatus == "candidate",
		ConfirmationMode:     "station_memory_review",
		Feeds:                memoryFeeds,
	}
	if !candidateHint.RequiresConfirmation || candidateHint.ConfirmationMode != "station_memory_review" {
		t.Fatalf("expected memory candidate to require Station-owned confirmation, got %+v", candidateHint)
	}
	negativeStatus, _, negativeFeeds := atelierFeedbackMemoryCandidatePolicy("negative")
	if negativeStatus != "candidate" || !reflect.DeepEqual(negativeFeeds, []string{"planner", "risk", "verifier"}) {
		t.Fatalf("expected negative memory candidate to feed planner/risk/verifier, got status=%q feeds=%#v", negativeStatus, negativeFeeds)
	}
	copyStatus, _, copyFeeds := atelierFeedbackMemoryCandidatePolicy("copy")
	copyHint := AtelierFeedbackPolicyHint{
		Status:               copyStatus,
		Reason:               "test",
		RequiresConfirmation: copyStatus == "candidate",
		ConfirmationMode:     "not_required",
		Feeds:                copyFeeds,
	}
	if copyHint.RequiresConfirmation || copyHint.ConfirmationMode != "not_required" {
		t.Fatalf("expected copy feedback to skip memory confirmation, got %+v", copyHint)
	}
	if len(copyHint.Feeds) != 0 {
		t.Fatalf("expected non-candidate feedback feeds to be empty, got %#v", copyHint.Feeds)
	}
	rerunStatus, _ := atelierFeedbackRerunPolicy("regenerate")
	if rerunStatus != "intent_recorded" {
		t.Fatalf("expected regenerate feedback to record rerun intent, got %q", rerunStatus)
	}
	rerunHint := AtelierFeedbackPolicyHint{
		Status:               rerunStatus,
		Reason:               "test",
		RequiresConfirmation: rerunStatus == "intent_recorded",
		ConfirmationMode:     "station_rerun_review",
	}
	if !rerunHint.RequiresConfirmation || rerunHint.ConfirmationMode != "station_rerun_review" {
		t.Fatalf("expected regenerate feedback to require Station-owned rerun review, got %+v", rerunHint)
	}
	event := &model.TaskEvent{
		EventId:     "evt_feedback_1",
		TaskId:      "collab_1",
		EventSeq:    14,
		Type:        model.TaskEventType_TASK_EVENT_TYPE_FEEDBACK_RECORDED,
		PayloadJson: `{"block_kind":"feedback","feedback_id":"feedback_1","block_id":"agent_1","signal":"regenerate","memory_candidate_status":"not_applicable","rerun_intent_status":"intent_recorded","rerun_confirmation_required":true,"rerun_confirmation_mode":"station_rerun_review"}`,
		CreatedAt:   timestamppb.New(time.Date(2026, 7, 1, 11, 10, 0, 0, time.UTC)),
	}
	if _, ok := BuildAtelierProjectionEvent(event); ok {
		t.Fatal("feedback intent must not be projected as a stream patch")
	}
}

func TestAtelierSubmitFeedbackPersistsStationOwnedPolicyEvent(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "atelier_feedback_submit_policy_event")
	injectOrchestrationServiceTestStore(t, db)
	now := time.Now().UTC()
	task := persistence.CollaborationTask{
		ID:          "task-feedback-policy-event",
		Title:       "Feedback policy event",
		GoalOwnerID: "actor-1",
		Status:      int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		MetaJSON:    `{"agent_ids":["agent-feedback"]}`,
		CreatedAt:   now,
		StartedAt:   now,
		EndedAt:     now,
	}
	seedResumeCollaborationTask(t, db, task, nil)

	orchestration := NewOrchestrationService(nil, nil, nil)
	orchestration.SetEventBus(nil)
	service := NewAtelierProjectionService(orchestration)
	response, err := service.SubmitFeedback(context.Background(), "actor-1", &SubmitAtelierFeedbackRequest{
		TaskID:  task.ID,
		BlockID: "block-feedback-policy",
		Signal:  "regenerate",
		Comment: "Please try again after Station review.",
	})
	if err != nil {
		t.Fatalf("submit feedback: %v", err)
	}
	if !response.Accepted || !response.RerunIntent.RequiresConfirmation || response.RerunIntent.ConfirmationMode != "station_rerun_review" {
		t.Fatalf("expected Station-owned rerun review response, got %+v", response)
	}

	var event persistence.TaskEvent
	if err := db.Where("task_id = ?", task.ID).Order("event_seq DESC").First(&event).Error; err != nil {
		t.Fatalf("load feedback event: %v", err)
	}
	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(event.Payload), &payload); err != nil {
		t.Fatalf("decode feedback payload: %v", err)
	}
	for _, forbidden := range []string{
		"run",
		"execute",
		"provider",
		"attachments",
		"memory",
		"memoryContent",
		"memory_content",
		"rerun",
		"rerunTaskId",
		"inputSnapshot",
		"input_snapshot",
	} {
		if _, ok := payload[forbidden]; ok {
			t.Fatalf("feedback payload must not include applet-supplied %s: %+v", forbidden, payload)
		}
	}
	if payload["source"] != "atelier.feedback.submit" ||
		payload["block_kind"] != "feedback" ||
		payload["signal"] != "regenerate" ||
		payload["rerun_intent_status"] != "intent_recorded" ||
		payload["rerun_confirmation_required"] != true ||
		payload["rerun_confirmation_mode"] != "station_rerun_review" {
		t.Fatalf("unexpected Station-owned feedback payload: %+v", payload)
	}
}

func TestConfirmAtelierMemoryCandidateWritesStationOwnedMemory(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "atelier_memory_confirm_candidate")
	injectOrchestrationServiceTestStore(t, db)
	injectOrchestrationServiceTestStore(t, db)
	now := time.Now().UTC()
	task := persistence.CollaborationTask{
		ID:          "task-memory-candidate",
		Title:       "Memory candidate task",
		GoalOwnerID: "actor-1",
		Status:      int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		MetaJSON:    `{"agent_ids":["agent-1"]}`,
		CreatedAt:   now,
		StartedAt:   now,
		EndedAt:     now,
	}
	seedResumeCollaborationTask(t, db, task, nil)
	orchestration := NewOrchestrationService(nil, nil, nil)
	orchestration.SetEventBus(nil)
	svc := NewAtelierProjectionService(orchestration, NewMemoryService(nil))

	feedback, err := svc.SubmitFeedback(context.Background(), "actor-1", &SubmitAtelierFeedbackRequest{
		TaskID:  task.ID,
		BlockID: "block-agent-1",
		Signal:  "positive",
		Comment: "This pattern should be kept",
	})
	if err != nil {
		t.Fatalf("submit feedback: %v", err)
	}
	if !feedback.MemoryCandidate.RequiresConfirmation || feedback.MemoryCandidate.ConfirmationMode != "station_memory_review" {
		t.Fatalf("expected confirmable memory candidate, got %+v", feedback.MemoryCandidate)
	}
	if !reflect.DeepEqual(feedback.MemoryCandidate.Feeds, []string{"planner", "verifier"}) {
		t.Fatalf("expected feedback response memory candidate feeds, got %#v", feedback.MemoryCandidate.Feeds)
	}
	confirmed, err := svc.ConfirmMemoryCandidate(context.Background(), "actor-1", &ConfirmAtelierMemoryCandidateRequest{
		TaskID:     task.ID,
		FeedbackID: feedback.FeedbackID,
	})
	if err != nil {
		t.Fatalf("confirm memory candidate: %v", err)
	}
	if !confirmed.Accepted || confirmed.Status != "confirmed" || confirmed.Source != "station_memory_review" || confirmed.AlreadyDone {
		t.Fatalf("unexpected confirmation response: %+v", confirmed)
	}
	var memory persistence.Memory
	if err := db.First(&memory, "id = ?", confirmed.MemoryID).Error; err != nil {
		t.Fatalf("load confirmed memory: %v", err)
	}
	if memory.AgentID != "actor-1" ||
		memory.Target != domain.MemoryTargetMemory ||
		memory.Layer != string(domain.MemoryLayerExperience) ||
		memory.Source != domain.MemorySourceReview ||
		memory.SourceTurnID == nil ||
		*memory.SourceTurnID != feedback.FeedbackID {
		t.Fatalf("unexpected memory row: %+v", memory)
	}
	if !strings.Contains(memory.Content, "This pattern should be kept") ||
		!strings.Contains(memory.Content, "signal=positive") {
		t.Fatalf("confirmed memory must be derived from feedback payload, got %q", memory.Content)
	}
	var eventCount int64
	if err := db.Model(&persistence.TaskEvent{}).
		Where("task_id = ? AND payload LIKE ?", task.ID, "%memory_candidate_confirmed%").
		Count(&eventCount).Error; err != nil {
		t.Fatalf("count memory confirmation events: %v", err)
	}
	if eventCount != 1 {
		t.Fatalf("expected one memory confirmation audit event, got %d", eventCount)
	}
	again, err := svc.ConfirmMemoryCandidate(context.Background(), "actor-1", &ConfirmAtelierMemoryCandidateRequest{
		TaskID:     task.ID,
		FeedbackID: feedback.FeedbackID,
	})
	if err != nil {
		t.Fatalf("confirm memory candidate again: %v", err)
	}
	if !again.AlreadyDone || again.MemoryID != confirmed.MemoryID {
		t.Fatalf("expected idempotent confirmation, got %+v", again)
	}
	var memoryCount int64
	if err := db.Model(&persistence.Memory{}).Where("source_turn_id = ?", feedback.FeedbackID).Count(&memoryCount).Error; err != nil {
		t.Fatalf("count memories: %v", err)
	}
	if memoryCount != 1 {
		t.Fatalf("expected one memory row after idempotent confirmation, got %d", memoryCount)
	}
}

func TestConfirmAtelierMemoryCandidateRejectsNonCandidateFeedback(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "atelier_memory_confirm_rejects_non_candidate")
	injectOrchestrationServiceTestStore(t, db)
	now := time.Now().UTC()
	task := persistence.CollaborationTask{
		ID:          "task-memory-copy",
		Title:       "Copy feedback task",
		GoalOwnerID: "actor-1",
		Status:      int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		MetaJSON:    `{"agent_ids":["agent-1"]}`,
		CreatedAt:   now,
		StartedAt:   now,
		EndedAt:     now,
	}
	seedResumeCollaborationTask(t, db, task, nil)
	orchestration := NewOrchestrationService(nil, nil, nil)
	orchestration.SetEventBus(nil)
	svc := NewAtelierProjectionService(orchestration, NewMemoryService(nil))
	feedback, err := svc.SubmitFeedback(context.Background(), "actor-1", &SubmitAtelierFeedbackRequest{
		TaskID:  task.ID,
		BlockID: "block-agent-1",
		Signal:  "copy",
	})
	if err != nil {
		t.Fatalf("submit copy feedback: %v", err)
	}
	if _, err := svc.ConfirmMemoryCandidate(context.Background(), "actor-1", &ConfirmAtelierMemoryCandidateRequest{
		TaskID:     task.ID,
		FeedbackID: feedback.FeedbackID,
	}); err == nil {
		t.Fatal("expected non-candidate feedback confirmation to be rejected")
	}
	var memoryCount int64
	if err := db.Model(&persistence.Memory{}).Count(&memoryCount).Error; err != nil {
		t.Fatalf("count memories: %v", err)
	}
	if memoryCount != 0 {
		t.Fatalf("expected no memory writes for non-candidate feedback, got %d", memoryCount)
	}
}

func TestAtelierConfirmedMemoryFeedsPlannerRiskVerifierRetrieval(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "atelier_confirmed_memory_consumption")
	injectOrchestrationServiceTestStore(t, db)
	now := time.Now().UTC()
	task := persistence.CollaborationTask{
		ID:          "task-confirmed-memory-consumption",
		Title:       "Memory consumption task",
		GoalOwnerID: "actor-1",
		Status:      int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		MetaJSON:    `{"agent_ids":["agent-1"]}`,
		CreatedAt:   now,
		StartedAt:   now,
		EndedAt:     now,
	}
	seedResumeCollaborationTask(t, db, task, nil)
	orchestration := NewOrchestrationService(nil, nil, nil)
	orchestration.SetEventBus(nil)
	memoryService := NewMemoryService(nil)
	svc := NewAtelierProjectionService(orchestration, memoryService)

	feedback, err := svc.SubmitFeedback(context.Background(), "actor-1", &SubmitAtelierFeedbackRequest{
		TaskID:  task.ID,
		BlockID: "block-agent-1",
		Signal:  "negative",
		Comment: "Prefer guarded migrations when planner risk verifier review asks for rollback notes",
	})
	if err != nil {
		t.Fatalf("submit feedback: %v", err)
	}
	if !reflect.DeepEqual(feedback.MemoryCandidate.Feeds, []string{"planner", "risk", "verifier"}) {
		t.Fatalf("expected negative memory candidate to feed planner/risk/verifier, got %#v", feedback.MemoryCandidate.Feeds)
	}
	confirmed, err := svc.ConfirmMemoryCandidate(context.Background(), "actor-1", &ConfirmAtelierMemoryCandidateRequest{
		TaskID:     task.ID,
		FeedbackID: feedback.FeedbackID,
	})
	if err != nil {
		t.Fatalf("confirm memory candidate: %v", err)
	}
	if confirmed.MemoryID == "" {
		t.Fatalf("expected confirmed memory id: %+v", confirmed)
	}

	results, err := memoryService.Search(context.Background(), domain.MemorySearchOptions{
		AgentID: "actor-1",
		Query:   "planner risk verifier rollback notes",
		Layers:  []domain.MemoryLayer{domain.MemoryLayerExperience},
		Limit:   5,
		Effort:  "medium",
	})
	if err != nil {
		t.Fatalf("search confirmed memory: %v", err)
	}
	if len(results) == 0 || results[0].Memory.MemoryID != confirmed.MemoryID {
		t.Fatalf("expected confirmed memory to be retrievable by planner/risk/verifier query, got %+v", results)
	}

	snapshot, err := memoryService.BuildRelevantSnapshot(context.Background(), "actor-1", "planner risk verifier rollback notes")
	if err != nil {
		t.Fatalf("build relevant snapshot: %v", err)
	}
	if !strings.Contains(snapshot.MemoryContent, "signal=negative") ||
		len(snapshot.RelevantItems) == 0 ||
		snapshot.RelevantItems[0].MemoryID != confirmed.MemoryID ||
		!strings.Contains(snapshot.RelevantItems[0].Content, "planner risk verifier") {
		t.Fatalf("expected prompt memory snapshot to include confirmed Atelier feedback memory, got %+v", snapshot)
	}
	if snapshot.RelevantItems[0].RetrievalCount == 0 {
		t.Fatalf("expected confirmed memory retrieval count to be updated, got %+v", snapshot.RelevantItems[0])
	}
}

func TestConfirmAtelierRerunCreatesStationOwnedNewRun(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "atelier_rerun_confirm_creates_task")
	injectOrchestrationServiceTestStore(t, db)
	now := time.Now().UTC()
	task := persistence.CollaborationTask{
		ID:           "task-rerun-source",
		Title:        "Rerun source task",
		Description:  "Original task description",
		GoalOwnerID:  "actor-1",
		Status:       int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED),
		WorkspaceID:  "workspace-1",
		BudgetTokens: 100,
		MetaJSON: mergeStringMapJSON("", map[string]string{
			"agent_ids": mustJSONString([]string{"agent-1", "agent-2"}),
			"project":   "atelier",
		}),
		CreatedAt: now,
		StartedAt: now,
		EndedAt:   now,
	}
	seedResumeCollaborationTask(t, db, task, nil)
	providerPlanRecord, err := taskProviderPlanRecordFromProto(task.ID, &model.TaskProviderPlan{
		Providers: []*model.TaskProviderSpec{
			{AgentId: "agent-1", Role: "Architect", Model: "gpt-4.1"},
			{AgentId: "agent-2", Role: "Builder", Model: "gpt-4.1"},
		},
		SynthesizerAgentId: "agent-1",
		Source:             "test",
	}, now)
	if err != nil {
		t.Fatalf("provider plan fixture: %v", err)
	}
	if err := db.Create(providerPlanRecord).Error; err != nil {
		t.Fatalf("seed provider plan: %v", err)
	}
	orchestration := NewOrchestrationService(nil, nil, nil)
	orchestration.SetEventBus(nil)
	svc := NewAtelierProjectionService(orchestration, NewMemoryService(nil))

	feedback, err := svc.SubmitFeedback(context.Background(), "actor-1", &SubmitAtelierFeedbackRequest{
		TaskID:  task.ID,
		BlockID: "block-agent-1",
		Signal:  "regenerate",
	})
	if err != nil {
		t.Fatalf("submit regenerate feedback: %v", err)
	}
	if !feedback.RerunIntent.RequiresConfirmation || feedback.RerunIntent.ConfirmationMode != "station_rerun_review" {
		t.Fatalf("expected confirmable rerun intent, got %+v", feedback.RerunIntent)
	}
	confirmed, err := svc.ConfirmRerun(context.Background(), "actor-1", &ConfirmAtelierRerunRequest{
		TaskID:     task.ID,
		FeedbackID: feedback.FeedbackID,
	})
	if err != nil {
		t.Fatalf("confirm rerun: %v", err)
	}
	if !confirmed.Accepted || confirmed.Status != "confirmed" || confirmed.Source != "station_rerun_review" || confirmed.AlreadyDone || confirmed.Started {
		t.Fatalf("unexpected rerun confirmation response: %+v", confirmed)
	}
	if confirmed.RerunTaskID == "" || confirmed.RerunTaskID == task.ID {
		t.Fatalf("expected new rerun task id, got %+v", confirmed)
	}
	var rerunTask persistence.CollaborationTask
	if err := db.First(&rerunTask, "id = ?", confirmed.RerunTaskID).Error; err != nil {
		t.Fatalf("load rerun task: %v", err)
	}
	if rerunTask.GoalOwnerID != "actor-1" ||
		rerunTask.Title != task.Title ||
		rerunTask.Description != task.Description ||
		rerunTask.WorkspaceID != task.WorkspaceID ||
		model.CollaborationTaskStatus(rerunTask.Status) != model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING {
		t.Fatalf("unexpected rerun task: %+v", rerunTask)
	}
	meta := map[string]string{}
	if err := json.Unmarshal([]byte(rerunTask.MetaJSON), &meta); err != nil {
		t.Fatalf("decode rerun task meta: %v", err)
	}
	if meta["source"] != "atelier.feedback.confirmRerun" ||
		meta["rerun_source_task_id"] != task.ID ||
		meta["rerun_source_feedback_id"] != feedback.FeedbackID ||
		meta["rerun_source_signal"] != "regenerate" {
		t.Fatalf("unexpected rerun meta: %+v", meta)
	}
	var nodeCount int64
	if err := db.Model(&persistence.CollaborationTaskNode{}).Where("task_id = ?", confirmed.RerunTaskID).Count(&nodeCount).Error; err != nil {
		t.Fatalf("count rerun nodes: %v", err)
	}
	if nodeCount != 3 {
		t.Fatalf("expected two provider nodes plus synthesizer, got %d", nodeCount)
	}
	var auditCount int64
	if err := db.Model(&persistence.TaskEvent{}).
		Where("task_id = ? AND payload LIKE ?", task.ID, "%rerun_confirmed%").
		Count(&auditCount).Error; err != nil {
		t.Fatalf("count rerun audit events: %v", err)
	}
	if auditCount != 1 {
		t.Fatalf("expected one rerun confirmation audit event, got %d", auditCount)
	}
	again, err := svc.ConfirmRerun(context.Background(), "actor-1", &ConfirmAtelierRerunRequest{
		TaskID:     task.ID,
		FeedbackID: feedback.FeedbackID,
	})
	if err != nil {
		t.Fatalf("confirm rerun again: %v", err)
	}
	if !again.AlreadyDone || again.RerunTaskID != confirmed.RerunTaskID {
		t.Fatalf("expected idempotent rerun confirmation, got %+v", again)
	}
	var rerunTaskCount int64
	if err := db.Model(&persistence.CollaborationTask{}).Where("meta_json LIKE ?", "%"+feedback.FeedbackID+"%").Count(&rerunTaskCount).Error; err != nil {
		t.Fatalf("count rerun tasks: %v", err)
	}
	if rerunTaskCount != 1 {
		t.Fatalf("expected one rerun task after idempotent confirmation, got %d", rerunTaskCount)
	}
}

func TestConfirmAtelierRerunRejectsNonRerunFeedback(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "atelier_rerun_confirm_rejects_non_rerun")
	injectOrchestrationServiceTestStore(t, db)
	now := time.Now().UTC()
	task := persistence.CollaborationTask{
		ID:          "task-rerun-copy",
		Title:       "Copy feedback task",
		GoalOwnerID: "actor-1",
		Status:      int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		MetaJSON:    `{"agent_ids":["agent-1"]}`,
		CreatedAt:   now,
		StartedAt:   now,
		EndedAt:     now,
	}
	seedResumeCollaborationTask(t, db, task, nil)
	orchestration := NewOrchestrationService(nil, nil, nil)
	orchestration.SetEventBus(nil)
	svc := NewAtelierProjectionService(orchestration, NewMemoryService(nil))
	feedback, err := svc.SubmitFeedback(context.Background(), "actor-1", &SubmitAtelierFeedbackRequest{
		TaskID:  task.ID,
		BlockID: "block-agent-1",
		Signal:  "copy",
	})
	if err != nil {
		t.Fatalf("submit copy feedback: %v", err)
	}
	if _, err := svc.ConfirmRerun(context.Background(), "actor-1", &ConfirmAtelierRerunRequest{
		TaskID:     task.ID,
		FeedbackID: feedback.FeedbackID,
	}); err == nil {
		t.Fatal("expected non-rerun feedback confirmation to be rejected")
	}
	var taskCount int64
	if err := db.Model(&persistence.CollaborationTask{}).Count(&taskCount).Error; err != nil {
		t.Fatalf("count tasks: %v", err)
	}
	if taskCount != 1 {
		t.Fatalf("expected no rerun task for non-rerun feedback, got %d tasks", taskCount)
	}
}

func TestBuildAtelierProjectionEventMapsArtifactUpsert(t *testing.T) {
	event := &model.TaskEvent{
		EventId:     "evt_artifact_1",
		TaskId:      "collab_1",
		EventSeq:    10,
		Type:        model.TaskEventType_TASK_EVENT_TYPE_TURN_EVENT,
		PayloadJson: `{"block_kind":"artifact","artifact_id":"art_1","name":"report.md","kind":"markdown","meta":"Report · Verifier","markdown":"# Report","url":"https://example.test/raw","src":"data:image/png;base64,raw","iframe":"<iframe></iframe>","preview_hint":"metadata_only","body_ref":"artifact://collab_1/art_1/body","body_hash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","body_size":8,"body_kind":"markdown","preview_target":{"kind":"markdown","mode":"sandbox_manifest","label":"Host sandbox preview manifest","sandbox_ref":"atelier-sandbox://collab_1/art_1/preview","body_ref":"artifact://collab_1/art_1/body"}}`,
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
	if projected.Patch.Artifact.ID != "art_1" {
		t.Fatalf("unexpected artifact payload: %+v", projected.Patch.Artifact)
	}
	artifactJSON, err := json.Marshal(projected.Patch.Artifact)
	if err != nil {
		t.Fatalf("marshal artifact projection: %v", err)
	}
	artifactProjectionFields := map[string]any{}
	if err := json.Unmarshal(artifactJSON, &artifactProjectionFields); err != nil {
		t.Fatalf("unmarshal artifact projection: %v", err)
	}
	for _, forbidden := range []string{"markdown", "url", "src", "iframe"} {
		if _, ok := artifactProjectionFields[forbidden]; ok {
			t.Fatalf("expected artifact projection to redact raw field %s, got %s", forbidden, artifactJSON)
		}
	}
	if projected.Patch.Artifact.PreviewHint != "metadata_only" ||
		projected.Patch.Artifact.BodyRef != "artifact://collab_1/art_1/body" ||
		projected.Patch.Artifact.BodyHash != "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" ||
		projected.Patch.Artifact.BodySize != "8" ||
		projected.Patch.Artifact.BodyKind != "markdown" {
		t.Fatalf("expected artifact metadata preview fields, got %+v", projected.Patch.Artifact)
	}
	if projected.Patch.Artifact.PreviewTarget == nil ||
		projected.Patch.Artifact.PreviewTarget.Kind != "markdown" ||
		projected.Patch.Artifact.PreviewTarget.Mode != "sandbox_manifest" ||
		projected.Patch.Artifact.PreviewTarget.SandboxRef != "atelier-sandbox://collab_1/art_1/preview" ||
		projected.Patch.Artifact.PreviewTarget.BodyRef != "artifact://collab_1/art_1/body" {
		t.Fatalf("expected artifact preview target metadata, got %+v", projected.Patch.Artifact.PreviewTarget)
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

func TestGoalKeeperProjectionPayloadsMapToAtelierArtifactAndGate(t *testing.T) {
	task := &persistence.CollaborationTask{ID: "collab_goalkeeper"}
	verdict := goalKeeperVerdict{
		Verdict:        model.AcceptanceVerdict_ACCEPTANCE_VERDICT_ACCEPTED,
		Reason:         "All checks passed.",
		JudgeID:        "agent_synth",
		CompletedNodes: 2,
		TotalNodes:     2,
	}
	artifactPayload := goalKeeperArtifactPayload(task, "collab_goalkeeper-final-summary", "## Done", verdict)
	artifactEvent := &model.TaskEvent{
		EventId:     "evt_goalkeeper_artifact",
		TaskId:      "collab_goalkeeper",
		EventSeq:    12,
		Type:        model.TaskEventType_TASK_EVENT_TYPE_ARTIFACT_CREATED,
		PayloadJson: mustJSON(artifactPayload),
		CreatedAt:   timestamppb.New(time.Date(2026, 7, 1, 11, 30, 0, 0, time.UTC)),
	}
	projectedArtifact, ok := BuildAtelierProjectionEvent(artifactEvent)
	if !ok || projectedArtifact.Patch.Kind != "artifact.upsert" {
		t.Fatalf("expected artifact.upsert from GoalKeeper artifact, got %+v ok=%v", projectedArtifact.Patch, ok)
	}
	if projectedArtifact.Patch.Artifact == nil {
		t.Fatalf("unexpected artifact projection: %+v", projectedArtifact.Patch.Artifact)
	}
	projectedArtifactJSON, err := json.Marshal(projectedArtifact.Patch.Artifact)
	if err != nil {
		t.Fatalf("marshal GoalKeeper artifact projection: %v", err)
	}
	projectedArtifactFields := map[string]any{}
	if err := json.Unmarshal(projectedArtifactJSON, &projectedArtifactFields); err != nil {
		t.Fatalf("unmarshal GoalKeeper artifact projection: %v", err)
	}
	for _, forbidden := range []string{"markdown", "url", "src", "iframe"} {
		if _, ok := projectedArtifactFields[forbidden]; ok {
			t.Fatalf("expected GoalKeeper artifact projection to redact raw field %s, got %s", forbidden, projectedArtifactJSON)
		}
	}
	if got := taskEventDomainType(int32(model.TaskEventType_TASK_EVENT_TYPE_ARTIFACT_CREATED), artifactPayload); got != string(domain.EventTypeCollaborationArtifactCreated) {
		t.Fatalf("expected artifact domain event type, got %q", got)
	}

	gatePayload := goalKeeperGatePayload(task, verdict, "collab_goalkeeper-final-summary")
	gateEvent := &model.TaskEvent{
		EventId:     "evt_goalkeeper_gate",
		TaskId:      "collab_goalkeeper",
		EventSeq:    13,
		Type:        model.TaskEventType_TASK_EVENT_TYPE_GATE_RESULT,
		PayloadJson: mustJSON(gatePayload),
		CreatedAt:   timestamppb.New(time.Date(2026, 7, 1, 11, 31, 0, 0, time.UTC)),
	}
	projectedGate, gateOK := BuildAtelierProjectionEvent(gateEvent)
	if !gateOK || projectedGate.Patch.Kind != "gate.upsert" {
		t.Fatalf("expected gate.upsert from GoalKeeper gate, got %+v ok=%v", projectedGate.Patch, gateOK)
	}
	if projectedGate.Patch.Gate == nil || projectedGate.Patch.Gate.Status != "passed" {
		t.Fatalf("unexpected gate projection: %+v", projectedGate.Patch.Gate)
	}
	if got := taskEventDomainType(int32(model.TaskEventType_TASK_EVENT_TYPE_GATE_RESULT), gatePayload); got != string(domain.EventTypeCollaborationGateResult) {
		t.Fatalf("expected gate domain event type, got %q", got)
	}
	if got := taskEventDomainType(int32(model.TaskEventType_TASK_EVENT_TYPE_TURN_EVENT), gatePayload); got != string(domain.EventTypeCollaborationGateResult) {
		t.Fatalf("expected legacy gate domain event type, got %q", got)
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
			PayloadJson: `{"block_kind":"artifact","artifact_id":"art_1","name":"report.md","kind":"markdown","markdown":"# Report","url":"https://example.test/raw","src":"data:image/png;base64,raw","iframe":"<iframe></iframe>"}`,
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
		nil,
		"",
	)

	if len(snapshot.Workspace.Artifacts["collab_1"]) != 1 {
		t.Fatalf("expected one artifact, got %+v", snapshot.Workspace.Artifacts["collab_1"])
	}
	artifactJSON, err := json.Marshal(snapshot.Workspace.Artifacts["collab_1"][0])
	if err != nil {
		t.Fatalf("marshal artifact projection: %v", err)
	}
	artifactProjectionFields := map[string]any{}
	if err := json.Unmarshal(artifactJSON, &artifactProjectionFields); err != nil {
		t.Fatalf("unmarshal artifact projection: %v", err)
	}
	for _, forbidden := range []string{"markdown", "url", "src", "iframe"} {
		if _, ok := artifactProjectionFields[forbidden]; ok {
			t.Fatalf("expected artifact projection to redact raw field %s, got %s", forbidden, artifactJSON)
		}
	}
	if got := snapshot.Workspace.Artifacts["collab_1"][0].PreviewHint; got != "metadata_only" {
		t.Fatalf("expected metadata-only artifact preview hint, got %q", got)
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
	for _, forbidden := range []string{"markdown", "url", "src", "iframe"} {
		if _, ok := last.Meta[forbidden]; ok {
			t.Fatalf("expected artifact stream meta to redact raw field %s, got %+v", forbidden, last.Meta)
		}
	}
}

func TestMergeAtelierProjectionReplayRecordsKeepsAnchorsAndTail(t *testing.T) {
	now := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	record := func(seq int64, payload string) persistence.TaskEvent {
		return persistence.TaskEvent{
			ID:        "evt_" + time.Unix(seq, 0).UTC().Format("150405"),
			TaskID:    "collab_long",
			EventSeq:  seq,
			EventType: int32(model.TaskEventType_TASK_EVENT_TYPE_TURN_EVENT),
			Payload:   payload,
			CreatedAt: now.Add(time.Duration(seq) * time.Second),
		}
	}

	head := []persistence.TaskEvent{
		record(1, `{"result_summary":"head 1"}`),
		record(2, `{"result_summary":"head 2"}`),
	}
	tail := []persistence.TaskEvent{
		record(101, `{"result_summary":"tail 101"}`),
		record(100, `{"result_summary":"tail 100"}`),
	}
	anchors := []persistence.TaskEvent{
		record(50, `{"block_kind":"artifact","artifact_id":"art_50","name":"report.md","kind":"markdown"}`),
		record(70, `{"block_kind":"gate_result","gate_id":"gate_70","status":"passed"}`),
		record(100, `{"result_summary":"tail 100 duplicate"}`),
	}

	events := mergeAtelierProjectionReplayRecords(head, tail, anchors)
	gotSeqs := make([]int64, 0, len(events))
	for _, event := range events {
		gotSeqs = append(gotSeqs, event.GetEventSeq())
	}
	wantSeqs := []int64{1, 2, 50, 70, 100, 101}
	if len(gotSeqs) != len(wantSeqs) {
		t.Fatalf("unexpected event seq count: got %v want %v", gotSeqs, wantSeqs)
	}
	for i := range wantSeqs {
		if gotSeqs[i] != wantSeqs[i] {
			t.Fatalf("unexpected replay order: got %v want %v", gotSeqs, wantSeqs)
		}
	}
	if _, ok := projectTaskEventToArtifact(events[2]); !ok {
		t.Fatalf("expected seq 50 to remain an artifact anchor: %+v", events[2])
	}
	if _, ok := projectTaskEventToGate(events[3]); !ok {
		t.Fatalf("expected seq 70 to remain a gate anchor: %+v", events[3])
	}
	if events[len(events)-1].GetEventSeq() != 101 {
		t.Fatalf("expected latest tail event to be retained, got seq %d", events[len(events)-1].GetEventSeq())
	}
}

func TestTaskEventRecordToDomainEventIncludesDurableEventEnvelopeMetadata(t *testing.T) {
	createdAt := time.Date(2026, 7, 1, 12, 20, 0, 0, time.UTC)
	record := &persistence.TaskEvent{
		ID:        "evt_replay_envelope",
		TaskID:    "collab_replay_envelope",
		StepID:    "node_replay_envelope",
		EventSeq:  42,
		EventType: int32(model.TaskEventType_TASK_EVENT_TYPE_TURN_EVENT),
		Payload:   `{"agent_id":"agent_replay_envelope","result_summary":"projection event"}`,
		CreatedAt: createdAt,
	}

	event, ok := taskEventRecordToDomainEvent(record, "agent_replay_envelope")
	if !ok {
		t.Fatal("expected replay record to map to domain event")
	}
	if event.EventID != record.ID {
		t.Fatalf("expected domain event id %q, got %q", record.ID, event.EventID)
	}
	if event.Metadata["event_id"] != record.ID {
		t.Fatalf("expected metadata event_id %q, got %q", record.ID, event.Metadata["event_id"])
	}
	if event.Metadata["event_seq"] != "42" {
		t.Fatalf("expected metadata event_seq 42, got %q", event.Metadata["event_seq"])
	}
	if event.Metadata["task_id"] != record.TaskID {
		t.Fatalf("expected metadata task_id %q, got %q", record.TaskID, event.Metadata["task_id"])
	}
	if event.Metadata["node_id"] != record.StepID {
		t.Fatalf("expected metadata node_id %q, got %q", record.StepID, event.Metadata["node_id"])
	}
}

func TestBuildAtelierReplayStateExposesCheckpointAndCursor(t *testing.T) {
	events := []*model.TaskEvent{
		{EventId: "evt_1", TaskId: "collab_replay", EventSeq: 1},
		{EventId: "evt_9", TaskId: "collab_replay", EventSeq: 9},
	}
	checkpoint := &persistence.TaskCheckpoint{
		CheckpointID: "ckpt_1",
		TaskID:       "collab_replay",
		EventSeq:     12,
	}

	state := buildAtelierReplayState(events, 30, checkpoint)
	if state.Source != "checkpoint-anchor+event-window" {
		t.Fatalf("unexpected source: %s", state.Source)
	}
	if state.CheckpointID != "ckpt_1" || state.CheckpointEventSeq != 12 {
		t.Fatalf("checkpoint anchor not exposed: %+v", state)
	}
	if state.NextEventSeq != 12 {
		t.Fatalf("expected checkpoint seq to advance cursor, got %d", state.NextEventSeq)
	}
	if !state.HasMore {
		t.Fatal("expected hasMore for partial replay")
	}
	if state.EventCount != 30 || state.ReplayedEventCount != 2 {
		t.Fatalf("unexpected replay counts: %+v", state)
	}
}

func TestAtelierMaterializedCheckpointProjectionFoldsPostCheckpointEvents(t *testing.T) {
	now := timestamppb.New(time.Date(2026, 7, 1, 12, 30, 0, 0, time.UTC))
	task := &model.CollaborationTask{
		TaskId:      "collab_materialized",
		Title:       "materialized replay",
		Description: "fold checkpoint state",
		Status:      model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING,
		WorkspaceId: "workspace_1",
		CreatedAt:   now,
		Meta: map[string]string{
			"project": "peers-touch",
		},
	}
	checkpoint := &persistence.TaskCheckpoint{
		CheckpointID: "ckpt_materialized",
		TaskID:       "collab_materialized",
		EventSeq:     10,
		StateJSON: `{
                  "atelierProjection": {
                    "version": "atelier-projection/v0",
                    "taskId": "collab_materialized",
                    "streams": [
                      {"kind":"agent","id":"summary","text":"checkpoint summary"},
                      {"kind":"decision","id":"decision_1","question":"Continue?"}
                    ],
                    "artifacts": [{"id":"art_1","name":"old.md","kind":"markdown","meta":"checkpoint"}],
                    "gates": [{"id":"gate_1","name":"GoalKeeper","status":"pending","summary":"pending"}]
                  }
                }`,
	}
	materializedByTask := loadAtelierMaterializedProjectionsByTask(map[string]*persistence.TaskCheckpoint{
		"collab_materialized": checkpoint,
	})
	events := []*model.TaskEvent{
		{
			EventId:     "evt_decision",
			TaskId:      "collab_materialized",
			EventSeq:    11,
			Type:        model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_RESOLVED,
			PayloadJson: `{"block_kind":"decision_resolved","block_id":"decision_1","choice":"继续执行"}`,
			CreatedAt:   now,
		},
		{
			EventId:     "evt_artifact",
			TaskId:      "collab_materialized",
			EventSeq:    12,
			Type:        model.TaskEventType_TASK_EVENT_TYPE_TURN_EVENT,
			PayloadJson: `{"block_kind":"artifact","artifact_id":"art_2","name":"new.md","kind":"markdown","markdown":"# New"}`,
			CreatedAt:   now,
		},
		{
			EventId:     "evt_gate",
			TaskId:      "collab_materialized",
			EventSeq:    13,
			Type:        model.TaskEventType_TASK_EVENT_TYPE_TURN_EVENT,
			PayloadJson: `{"block_kind":"gate_result","gate_id":"gate_1","name":"GoalKeeper","status":"passed","summary":"ok"}`,
			CreatedAt:   now,
		},
	}

	snapshot := buildAtelierProjectionSnapshot(
		[]*model.CollaborationTask{task},
		nil,
		map[string][]*model.TaskEvent{"collab_materialized": events},
		map[string]AtelierReplayState{
			"collab_materialized": buildAtelierReplayStateWithWindow(events, 13, checkpoint, true, len(events)),
		},
		materializedByTask,
		nil,
		"",
	)

	stream := snapshot.Workspace.Streams["collab_materialized"]
	if len(stream) != 3 || stream[0].Text != "checkpoint summary" {
		t.Fatalf("expected materialized stream to seed snapshot, got %+v", stream)
	}
	if stream[1].Chosen != "继续执行" {
		t.Fatalf("expected post-checkpoint decision resolution to update materialized block, got %+v", stream[1])
	}
	if stream[2].Kind != "artifact" || stream[2].Name != "new.md" {
		t.Fatalf("expected post-checkpoint artifact event to append stream card, got %+v", stream[2])
	}
	artifacts := snapshot.Workspace.Artifacts["collab_materialized"]
	if len(artifacts) != 2 || artifacts[0].ID != "art_1" || artifacts[1].ID != "art_2" {
		t.Fatalf("expected checkpoint artifact plus post-checkpoint artifact, got %+v", artifacts)
	}
	gates := snapshot.Workspace.Gates["collab_materialized"]
	if len(gates) != 1 || gates[0].ID != "gate_1" || gates[0].Status != "passed" {
		t.Fatalf("expected post-checkpoint gate upsert, got %+v", gates)
	}
	replay := snapshot.Workspace.Replay["collab_materialized"]
	if replay.Source != "checkpoint-materialized+event-window" || replay.NextEventSeq != 13 {
		t.Fatalf("unexpected replay state: %+v", replay)
	}
	if replay.ReplayedEventCount != 13 || replay.HasMore {
		t.Fatalf("expected materialized checkpoint to count folded events, got %+v", replay)
	}
}

func TestAtelierProjectionSnapshotFoldsInterruptRequestAndResolution(t *testing.T) {
	now := timestamppb.New(time.Date(2026, 7, 1, 13, 0, 0, 0, time.UTC))
	task := &model.CollaborationTask{
		TaskId:      "collab_interrupt",
		Title:       "interrupt replay",
		Description: "fold interrupt lifecycle",
		Status:      model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED,
		WorkspaceId: "workspace_1",
		CreatedAt:   now,
		Meta: map[string]string{
			"project": "peers-touch",
		},
	}
	events := []*model.TaskEvent{
		{
			EventId:  "evt_interrupt_request",
			TaskId:   "collab_interrupt",
			EventSeq: 21,
			Type:     model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_REQUESTED,
			PayloadJson: `{
			  "interrupt_id":"decision_1",
			  "question":"是否继续执行？",
			  "options":["继续执行","暂停"]
			}`,
			CreatedAt: now,
		},
		{
			EventId:     "evt_interrupt_resolved",
			TaskId:      "collab_interrupt",
			EventSeq:    22,
			Type:        model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_RESOLVED,
			PayloadJson: `{"block_kind":"decision_resolved","interrupt_id":"decision_1","choice":"继续执行"}`,
			CreatedAt:   now,
		},
	}

	snapshot := buildAtelierProjectionSnapshot(
		[]*model.CollaborationTask{task},
		nil,
		map[string][]*model.TaskEvent{"collab_interrupt": events},
		map[string]AtelierReplayState{
			"collab_interrupt": buildAtelierReplayStateWithWindow(events, 22, nil, true, len(events)),
		},
		nil,
		nil,
		"",
	)

	stream := snapshot.Workspace.Streams["collab_interrupt"]
	if len(stream) != 2 {
		t.Fatalf("expected summary and decision blocks, got %+v", stream)
	}
	decision := stream[1]
	if decision.Kind != "decision" || decision.ID != "decision_1" {
		t.Fatalf("expected decision block from interrupt request, got %+v", decision)
	}
	if decision.Chosen != "继续执行" {
		t.Fatalf("expected interrupt resolution to set chosen option, got %+v", decision)
	}
}

func TestAtelierMaterializedCheckpointProjectionRejectsWrongVersion(t *testing.T) {
	checkpoint := &persistence.TaskCheckpoint{
		CheckpointID: "ckpt_wrong_version",
		TaskID:       "collab_materialized",
		EventSeq:     10,
		StateJSON:    `{"atelierProjection":{"version":"atelier-projection/v999","streams":[{"kind":"agent","id":"stale"}]}}`,
	}
	materializedByTask := loadAtelierMaterializedProjectionsByTask(map[string]*persistence.TaskCheckpoint{
		"collab_materialized": checkpoint,
	})
	if len(materializedByTask) != 0 {
		t.Fatalf("expected wrong-version materialized projection to be ignored, got %+v", materializedByTask)
	}
}

func TestBuildChatTaskCheckpointStateJSONWritesReadableMaterializedProjection(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:atelier_checkpoint_state?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.Exec(`CREATE TABLE agent_task_events (
		id text PRIMARY KEY,
		task_id text NOT NULL,
		step_id text,
		turn_id text,
		event_seq integer NOT NULL,
		event_type integer NOT NULL,
		payload text,
		created_at datetime NOT NULL
	)`).Error; err != nil {
		t.Fatalf("create task events table: %v", err)
	}
	now := time.Date(2026, 7, 1, 12, 40, 0, 0, time.UTC)
	records := []persistence.TaskEvent{
		{
			ID:        "evt_artifact_1",
			TaskID:    "chat_checkpoint",
			EventSeq:  1,
			EventType: int32(model.TaskEventType_TASK_EVENT_TYPE_TURN_EVENT),
			Payload:   `{"block_kind":"artifact","artifact_id":"art_1","name":"checkpoint.md","kind":"markdown","markdown":"# checkpoint"}`,
			CreatedAt: now,
		},
		{
			ID:        "evt_gate_1",
			TaskID:    "chat_checkpoint",
			EventSeq:  2,
			EventType: int32(model.TaskEventType_TASK_EVENT_TYPE_TURN_EVENT),
			Payload:   `{"block_kind":"gate_result","gate_id":"gate_1","name":"GoalKeeper","status":"passed","summary":"ok"}`,
			CreatedAt: now.Add(time.Second),
		},
		{
			ID:        "evt_artifact_2",
			TaskID:    "chat_checkpoint",
			EventSeq:  3,
			EventType: int32(model.TaskEventType_TASK_EVENT_TYPE_TURN_EVENT),
			Payload:   `{"block_kind":"artifact","artifact_id":"art_2","name":"after-checkpoint.md","kind":"markdown"}`,
			CreatedAt: now.Add(2 * time.Second),
		},
	}
	if err := db.Create(&records).Error; err != nil {
		t.Fatalf("create task events: %v", err)
	}

	stateJSON, err := buildChatTaskCheckpointStateJSONTx(db, "chat_checkpoint", 2)
	if err != nil {
		t.Fatalf("build checkpoint state: %v", err)
	}
	checkpoint := &persistence.TaskCheckpoint{
		CheckpointID: "ckpt_chat",
		TaskID:       "chat_checkpoint",
		EventSeq:     2,
		StateJSON:    stateJSON,
	}
	materialized, ok := parseAtelierMaterializedTaskProjection(checkpoint)
	if !ok {
		t.Fatalf("expected written checkpoint state to be readable: %s", stateJSON)
	}
	if materialized.TaskID != "chat_checkpoint" {
		t.Fatalf("unexpected materialized task id: %q", materialized.TaskID)
	}
	if !materialized.HasContext || !materialized.HasStreams || !materialized.HasArtifacts || !materialized.HasGates {
		t.Fatalf("expected materialized projection sections, got %+v", materialized)
	}
	if len(materialized.Artifacts) != 1 || materialized.Artifacts[0].ID != "art_1" {
		t.Fatalf("expected only events at/before checkpoint to be folded into artifacts, got %+v", materialized.Artifacts)
	}
	if len(materialized.Gates) != 1 || materialized.Gates[0].ID != "gate_1" {
		t.Fatalf("expected gate folded into checkpoint state, got %+v", materialized.Gates)
	}
	for _, artifact := range materialized.Artifacts {
		if artifact.ID == "art_2" {
			t.Fatalf("post-checkpoint event leaked into checkpoint state: %+v", materialized.Artifacts)
		}
	}
}
