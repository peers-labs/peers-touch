package service

import (
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
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

func TestRunningCollaborationNodesAreDeferred(t *testing.T) {
	nodes := []persistence.CollaborationTaskNode{
		{ID: "node-a", AgentID: "agent-a", Status: int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING)},
		{ID: "node-s", AgentID: "agent-j", Role: collaborationRoleSynthesizer, Status: int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING), PrerequisiteNodeIDs: "node-a"},
	}

	if ready := readyCollaborationNodes(nodes); len(ready) != 0 {
		t.Fatalf("expected no ready nodes while a prerequisite is still running, got %#v", ready)
	}
	if !hasRunningCollaborationNodes(nodes) {
		t.Fatal("expected running collaboration node to defer task finishing")
	}
	if hasPendingCollaborationNodes(nodes) {
		t.Fatal("expected synthesis-only pending node not to count as a runnable pending collaboration node")
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

func TestClaimNodeLeaseTxFencesActiveExecutorLease(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:claim_node_lease?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	for _, statement := range []string{
		`CREATE TABLE agent_collaboration_tasks (
			id text PRIMARY KEY,
			title text NOT NULL,
			description text,
			engine_type integer NOT NULL,
			status integer NOT NULL,
			goal_owner_id text NOT NULL,
			workspace_id text,
			budget_tokens real NOT NULL DEFAULT 0,
			budget_money real NOT NULL DEFAULT 0,
			budget_time_ms integer NOT NULL DEFAULT 0,
			meta_json text,
			created_at datetime NOT NULL,
			started_at datetime NOT NULL,
			ended_at datetime NOT NULL
		)`,
		`CREATE TABLE agent_collaboration_task_nodes (
			id text PRIMARY KEY,
			task_id text NOT NULL,
			parent_node_id text,
			agent_id text NOT NULL,
			role text,
			description text,
			status integer NOT NULL,
			prerequisite_node_ids text,
			result_summary text,
			started_at datetime NOT NULL,
			ended_at datetime NOT NULL
		)`,
		`CREATE TABLE agent_executor_leases (
			lease_id text PRIMARY KEY,
			task_id text NOT NULL,
			step_id text,
			executor_id text NOT NULL,
			executor_kind integer NOT NULL,
			status text NOT NULL,
			acquired_at datetime NOT NULL,
			heartbeat_at datetime NOT NULL,
			expires_at datetime NOT NULL
		)`,
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatalf("create test table: %v", err)
		}
	}

	now := time.Date(2026, 7, 1, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:          "task-lease",
		GoalOwnerID: "actor-1",
		Title:       "Lease claim",
		Status:      int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		CreatedAt:   now,
		StartedAt:   now,
		EndedAt:     now,
	}
	node := persistence.CollaborationTaskNode{
		ID:        "node-lease",
		TaskID:    task.ID,
		AgentID:   "agent-1",
		Role:      "lead",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
		StartedAt: now,
		EndedAt:   now,
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatalf("create task: %v", err)
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	service := &OrchestrationService{}
	var first persistence.ExecutorLease
	if err := db.Transaction(func(tx *gorm.DB) error {
		lease, ok, err := service.claimNodeLeaseTx(tx, &task, &node, "executor-a", time.Minute, now)
		if err != nil {
			return err
		}
		if !ok {
			t.Fatal("expected first executor to claim lease")
		}
		first = lease
		return nil
	}); err != nil {
		t.Fatalf("first claim: %v", err)
	}

	if err := db.Transaction(func(tx *gorm.DB) error {
		_, ok, err := service.claimNodeLeaseTx(tx, &task, &node, "executor-b", time.Minute, now.Add(time.Second))
		if err != nil {
			return err
		}
		if ok {
			t.Fatal("expected second executor to be fenced by active lease")
		}
		return nil
	}); err != nil {
		t.Fatalf("second claim: %v", err)
	}

	if err := db.Transaction(func(tx *gorm.DB) error {
		lease, ok, err := service.claimNodeLeaseTx(tx, &task, &node, "executor-a", 2*time.Minute, now.Add(2*time.Second))
		if err != nil {
			return err
		}
		if !ok {
			t.Fatal("expected original executor to renew active lease")
		}
		if lease.LeaseID != first.LeaseID {
			t.Fatalf("expected renewal of %q, got %q", first.LeaseID, lease.LeaseID)
		}
		return nil
	}); err != nil {
		t.Fatalf("renew claim: %v", err)
	}

	if err := db.Model(&persistence.ExecutorLease{}).
		Where("lease_id = ?", first.LeaseID).
		Updates(map[string]interface{}{
			"expires_at": now.Add(-time.Second),
		}).Error; err != nil {
		t.Fatalf("expire lease: %v", err)
	}

	if err := db.Transaction(func(tx *gorm.DB) error {
		lease, ok, err := service.claimNodeLeaseTx(tx, &task, &node, "executor-b", time.Minute, now.Add(3*time.Second))
		if err != nil {
			return err
		}
		if !ok {
			t.Fatal("expected new executor to claim after previous lease expired")
		}
		if lease.ExecutorID != "executor-b" || lease.LeaseID == first.LeaseID {
			t.Fatalf("expected a new executor-b lease, got %#v", lease)
		}
		return nil
	}); err != nil {
		t.Fatalf("claim after expiry: %v", err)
	}
}

func TestCollaborationNodePolicyUsesSpecificityOrder(t *testing.T) {
	task := &persistence.CollaborationTask{
		MetaJSON: `{
			"node_policy.default.retry_max": "1",
			"node_policy.default.timeout_ms": "1000",
			"node_policy.default.failure_policy": "continue",
			"node_policy.role.lead.retry_max": "2",
			"node_policy.agent.agent-1.timeout_ms": "2000",
			"node_policy.node.node-1.retry_max": "3",
			"node_policy.node.node-1.failure_policy": "skip_dependents"
		}`,
	}
	node := &persistence.CollaborationTaskNode{
		ID:      "node-1",
		AgentID: "agent-1",
		Role:    "lead",
	}

	policy := collaborationNodePolicyFor(task, node)
	if policy.RetryMax != 3 {
		t.Fatalf("expected node retry override, got %d", policy.RetryMax)
	}
	if policy.Timeout != 2*time.Second {
		t.Fatalf("expected agent timeout override, got %s", policy.Timeout)
	}
	if policy.FailurePolicy != "skip_dependents" {
		t.Fatalf("expected node failure policy override, got %q", policy.FailurePolicy)
	}
}

func TestCollaborationNodePolicyFallsBackToDefaults(t *testing.T) {
	task := &persistence.CollaborationTask{
		MetaJSON: `{
			"node_policy.default.retry_max": "bad",
			"node_policy.default.timeout_ms": "0",
			"node_policy.default.failure_policy": "unknown",
			"node_policy.role.reviewer.retry_max": "2"
		}`,
	}
	node := &persistence.CollaborationTaskNode{
		ID:      "node-2",
		AgentID: "agent-2",
		Role:    "reviewer",
	}

	policy := collaborationNodePolicyFor(task, node)
	if policy.RetryMax != 2 {
		t.Fatalf("expected role retry policy, got %d", policy.RetryMax)
	}
	if policy.Timeout != 0 {
		t.Fatalf("expected invalid timeout to fall back to zero, got %s", policy.Timeout)
	}
	if policy.FailurePolicy != "continue" {
		t.Fatalf("expected invalid failure policy to fall back to continue, got %q", policy.FailurePolicy)
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
