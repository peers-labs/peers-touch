package service

import (
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

func TestCollaborationEngineExecutionMode(t *testing.T) {
	parallelEngines := []model.CollaborationEngineType{
		model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_ROUNDTABLE,
		model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_SWARM,
		model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_MESH,
	}
	for _, engine := range parallelEngines {
		if !isParallelCollaborationEngine(engine) {
			t.Fatalf("expected %v to use parallel execution", engine)
		}
	}

	sequentialEngines := []model.CollaborationEngineType{
		model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_HIERARCHY,
		model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_DEBATE_JUDGE,
		model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_HIERARCHY,
		model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_UNSPECIFIED,
	}
	for _, engine := range sequentialEngines {
		if isParallelCollaborationEngine(engine) {
			t.Fatalf("expected %v to use sequential execution", engine)
		}
	}
}

func TestBuildCollaborationTaskNodesPlansParallelFanOut(t *testing.T) {
	now := time.Date(2026, 7, 1, 10, 0, 0, 0, time.UTC)
	nodes := buildCollaborationTaskNodes(
		"task-1",
		"Ship the orchestration DAG.",
		model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_MESH,
		[]string{"agent-a", "agent-b", "agent-c"},
		"agent-judge",
		now,
	)

	if len(nodes) != 4 {
		t.Fatalf("expected 3 agent nodes plus synthesis, got %d", len(nodes))
	}
	for index := 0; index < 3; index++ {
		if nodes[index].PrerequisiteNodeIDs != "" {
			t.Fatalf("expected parallel node %d to have no prerequisites, got %q", index, nodes[index].PrerequisiteNodeIDs)
		}
	}
	synth := nodes[3]
	if synth.Role != collaborationRoleSynthesizer {
		t.Fatalf("expected synthesis node, got role %q", synth.Role)
	}
	prerequisites := parseMetaList(synth.PrerequisiteNodeIDs)
	if len(prerequisites) != 3 {
		t.Fatalf("expected synthesis to depend on all normal nodes, got %#v", prerequisites)
	}
}

func TestBuildCollaborationTaskNodesPlansSequentialChain(t *testing.T) {
	now := time.Date(2026, 7, 1, 10, 0, 0, 0, time.UTC)
	nodes := buildCollaborationTaskNodes(
		"task-1",
		"Ship the orchestration DAG.",
		model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_HIERARCHY,
		[]string{"agent-a", "agent-b", "agent-c"},
		"agent-judge",
		now,
	)

	if len(nodes) != 4 {
		t.Fatalf("expected 3 agent nodes plus synthesis, got %d", len(nodes))
	}
	if nodes[0].PrerequisiteNodeIDs != "" {
		t.Fatalf("expected first sequential node to have no prerequisites, got %q", nodes[0].PrerequisiteNodeIDs)
	}
	if got := nodes[1].PrerequisiteNodeIDs; got != nodes[0].ID {
		t.Fatalf("expected second node to depend on first node %q, got %q", nodes[0].ID, got)
	}
	if got := nodes[2].PrerequisiteNodeIDs; got != nodes[1].ID {
		t.Fatalf("expected third node to depend on second node %q, got %q", nodes[1].ID, got)
	}
	if prerequisites := parseMetaList(nodes[3].PrerequisiteNodeIDs); len(prerequisites) != 3 {
		t.Fatalf("expected synthesis to depend on all normal nodes, got %#v", prerequisites)
	}
}

func TestReadyCollaborationNodesRespectsPrerequisites(t *testing.T) {
	nodes := []persistence.CollaborationTaskNode{
		{ID: "node-a", AgentID: "agent-a", Status: int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING)},
		{ID: "node-b", AgentID: "agent-b", Status: int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING), PrerequisiteNodeIDs: "node-a"},
		{ID: "node-c", AgentID: "agent-c", Status: int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING), PrerequisiteNodeIDs: "missing-node"},
		{ID: "node-s", AgentID: "agent-j", Role: collaborationRoleSynthesizer, Status: int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING), PrerequisiteNodeIDs: "node-a,node-b"},
	}

	ready := readyCollaborationNodes(nodes)
	if len(ready) != 1 || ready[0] != 0 {
		t.Fatalf("expected only the root node to be ready, got %#v", ready)
	}

	nodes[0].Status = int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED)
	nodes[0].ResultSummary = "Root complete."
	ready = readyCollaborationNodes(nodes)
	if len(ready) != 1 || ready[0] != 1 {
		t.Fatalf("expected dependent node to be ready after prerequisite completion, got %#v", ready)
	}
	contexts := collaborationContextsForPrerequisites(&nodes[1], nodes)
	if len(contexts) != 1 || contexts[0].Summary != "Root complete." {
		t.Fatalf("expected prerequisite context to include completed root summary, got %#v", contexts)
	}
}

func TestAgentExecutorKindDetectsDesktopCliRuntime(t *testing.T) {
	tests := []struct {
		name   string
		config string
		want   model.ExecutorKind
	}{
		{
			name:   "explicit desktop executor",
			config: `{"executorKind":"desktop_device"}`,
			want:   model.ExecutorKind_EXECUTOR_KIND_DESKTOP_DEVICE,
		},
		{
			name:   "cli command implies desktop executor",
			config: `{"cliCommand":"traecli exec --skip-git-repo-check -"}`,
			want:   model.ExecutorKind_EXECUTOR_KIND_DESKTOP_DEVICE,
		},
		{
			name:   "cli runtime implies desktop executor",
			config: `{"runtimeKind":"cli"}`,
			want:   model.ExecutorKind_EXECUTOR_KIND_DESKTOP_DEVICE,
		},
		{
			name:   "hosted default",
			config: `{"runtimeKind":"hosted"}`,
			want:   model.ExecutorKind_EXECUTOR_KIND_STATION_HOSTED,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			agent := &domain.Agent{AgentID: "agent-1", ConfigJSON: tt.config}
			if got := agentExecutorKind(agent); got != tt.want {
				t.Fatalf("expected executor kind %v, got %v", tt.want, got)
			}
		})
	}
}

func TestCollaborationNodePromptIncludesPriorResults(t *testing.T) {
	task := &persistence.CollaborationTask{
		Description: "Ship the orchestration kernel.",
	}
	node := &persistence.CollaborationTaskNode{
		AgentID:     "agent-impl",
		Role:        "collaborator",
		Description: "Implement the next step.",
	}

	prompt := collaborationNodePrompt(task, node, []collaborationNodeContext{
		{
			AgentID: "agent-architect",
			Role:    "lead",
			Summary: "Use a DAG runner with replayable checkpoints.",
		},
		{
			AgentID: "agent-reviewer",
			Role:    "collaborator",
			Summary: "Missing cancellation propagation.",
			Failed:  true,
		},
	})

	required := []string{
		"Ship the orchestration kernel.",
		"Node role: collaborator",
		"Previous collaboration results:",
		"agent-architect",
		"Use a DAG runner with replayable checkpoints.",
		"agent-reviewer",
		"failed",
		"Missing cancellation propagation.",
	}
	for _, value := range required {
		if !strings.Contains(prompt, value) {
			t.Fatalf("expected prompt to contain %q, got:\n%s", value, prompt)
		}
	}
}

func TestCollaborationSynthesisPromptUsesNodeResults(t *testing.T) {
	task := &persistence.CollaborationTask{
		Description: "Decide the launch plan.",
	}
	nodes := []persistence.CollaborationTaskNode{
		{
			AgentID:       "agent-product",
			Role:          "lead",
			Status:        int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
			ResultSummary: "Launch behind a feature flag.",
		},
		{
			AgentID:       "agent-risk",
			Role:          "collaborator",
			Status:        int32(model.TaskNodeStatus_TASK_NODE_STATUS_FAILED),
			ResultSummary: "Payment regression risk needs mitigation.",
		},
		{
			AgentID:       "agent-product",
			Role:          collaborationRoleSynthesizer,
			Status:        int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING),
			ResultSummary: "This pending synthesis result must not be included.",
		},
	}

	prompt := collaborationSynthesisPrompt(task, nodes)
	required := []string{
		"Decide the launch plan.",
		"Agent node results:",
		"agent-product",
		"Launch behind a feature flag.",
		"agent-risk",
		"Payment regression risk needs mitigation.",
		"final answer",
		"risks or disagreements",
	}
	for _, value := range required {
		if !strings.Contains(prompt, value) {
			t.Fatalf("expected synthesis prompt to contain %q, got:\n%s", value, prompt)
		}
	}
	if strings.Contains(prompt, "This pending synthesis result must not be included.") {
		t.Fatalf("expected synthesis prompt to exclude synthesis node output, got:\n%s", prompt)
	}
}

func TestGoalKeeperVerdictAcceptsCompletedSynthesis(t *testing.T) {
	task := &persistence.CollaborationTask{ID: "task-accepted"}
	nodes := []persistence.CollaborationTaskNode{
		{ID: "node-a", AgentID: "agent-a", Status: int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED), ResultSummary: "Done."},
		{ID: "node-b", AgentID: "agent-b", Status: int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED), ResultSummary: "Also done."},
		{ID: "node-s", AgentID: "agent-judge", Role: collaborationRoleSynthesizer, Status: int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED), ResultSummary: "Final."},
	}

	verdict := evaluateGoalKeeperVerdict(task, nodes, "Final answer.", false)
	if verdict.Verdict != model.AcceptanceVerdict_ACCEPTANCE_VERDICT_ACCEPTED {
		t.Fatalf("expected accepted verdict, got %v reason=%s", verdict.Verdict, verdict.Reason)
	}
	if verdict.JudgeID != "agent-judge" {
		t.Fatalf("expected synthesis judge id, got %q", verdict.JudgeID)
	}
	meta := goalKeeperVerdictMeta(verdict)
	if meta["acceptance_verdict"] != "accepted" || meta["acceptance_completed_nodes"] != "2" || meta["acceptance_total_nodes"] != "2" {
		t.Fatalf("unexpected verdict meta: %#v", meta)
	}
}

func TestGoalKeeperVerdictRejectsFailedOrMissingSummary(t *testing.T) {
	task := &persistence.CollaborationTask{ID: "task-rejected"}
	nodes := []persistence.CollaborationTaskNode{
		{ID: "node-a", AgentID: "agent-a", Status: int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED), ResultSummary: "Done."},
		{ID: "node-b", AgentID: "agent-b", Status: int32(model.TaskNodeStatus_TASK_NODE_STATUS_FAILED), ResultSummary: "Failed."},
		{ID: "node-s", AgentID: "agent-judge", Role: collaborationRoleSynthesizer, Status: int32(model.TaskNodeStatus_TASK_NODE_STATUS_FAILED), ResultSummary: "No final."},
	}

	verdict := evaluateGoalKeeperVerdict(task, nodes, "Final answer.", true)
	if verdict.Verdict != model.AcceptanceVerdict_ACCEPTANCE_VERDICT_REJECTED {
		t.Fatalf("expected rejected verdict for failed nodes, got %v", verdict.Verdict)
	}
	if !strings.Contains(verdict.Reason, "failed=1") {
		t.Fatalf("expected failure count in reason, got %q", verdict.Reason)
	}

	verdict = evaluateGoalKeeperVerdict(task, nodes[:1], "", false)
	if verdict.Verdict != model.AcceptanceVerdict_ACCEPTANCE_VERDICT_REJECTED {
		t.Fatalf("expected rejected verdict for missing final summary, got %v", verdict.Verdict)
	}
	if !strings.Contains(verdict.Reason, "missing") {
		t.Fatalf("expected missing summary reason, got %q", verdict.Reason)
	}
}

func TestSelectSynthesizerAgentID(t *testing.T) {
	if got := selectSynthesizerAgentID(map[string]string{"judge_agent_id": " agent-judge "}, []string{"agent-lead"}); got != "agent-judge" {
		t.Fatalf("expected explicit judge agent, got %q", got)
	}
	if got := selectSynthesizerAgentID(map[string]string{}, []string{"agent-lead", "agent-risk"}); got != "agent-lead" {
		t.Fatalf("expected first agent fallback, got %q", got)
	}
}

func TestSynthesisNodeDetection(t *testing.T) {
	nodes := []persistence.CollaborationTaskNode{
		{AgentID: "agent-lead", Role: "lead", Status: int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED)},
		{AgentID: "agent-judge", Role: collaborationRoleSynthesizer, Status: int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING)},
	}
	if got := synthesisNode(nodes); got == nil || got.AgentID != "agent-judge" {
		t.Fatalf("expected pending synthesis node, got %#v", got)
	}
}

func TestTaskTimeBudgetExceeded(t *testing.T) {
	startedAt := time.Date(2026, 7, 1, 10, 0, 0, 0, time.UTC)
	task := &persistence.CollaborationTask{
		StartedAt:    startedAt,
		BudgetTimeMs: 1000,
	}

	if taskTimeBudgetExceeded(task, startedAt.Add(999*time.Millisecond)) {
		t.Fatal("expected budget to remain open before the limit")
	}
	if !taskTimeBudgetExceeded(task, startedAt.Add(time.Second)) {
		t.Fatal("expected budget to be exceeded at the limit")
	}
	if got := taskElapsedMs(task, startedAt.Add(1500*time.Millisecond)); got != 1500 {
		t.Fatalf("expected elapsed 1500ms, got %d", got)
	}
}
