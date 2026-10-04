package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"google.golang.org/protobuf/encoding/protojson"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

const validArtifactChecksum = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

type fakeDirectRunProviderExecutor struct {
	calls int
	resp  *ProviderCallResponse
	err   error
}

func (f *fakeDirectRunProviderExecutor) CallDirectRunProvider(ctx context.Context, req *ProviderCallRequest) (*ProviderCallResponse, error) {
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	if f.resp != nil {
		return f.resp, nil
	}
	return &ProviderCallResponse{Content: "fake direct run response", Model: req.Model, Provider: "fake"}, nil
}

func directRunTestProviderPlan() *model.TaskProviderPlan {
	return &model.TaskProviderPlan{
		Source:             collaborationProviderPlanSourceDirectRun,
		SynthesizerAgentId: "agent-direct",
		Providers: []*model.TaskProviderSpec{{
			AgentId:         "agent-direct",
			ProviderId:      "openai",
			Model:           "gpt-4.1",
			ReasoningEffort: "high",
			Role:            "executor",
		}},
	}
}

type orchestrationServiceTestStore struct{}

func (s *orchestrationServiceTestStore) Init(context.Context, ...option.Option) error {
	return nil
}

func (s *orchestrationServiceTestStore) RDS(context.Context, ...store.RDSDMLOption) (*gorm.DB, error) {
	return orchestrationServiceTestDB, nil
}

func (s *orchestrationServiceTestStore) Name() string {
	return "orchestration-service-test"
}

var injectOrchestrationServiceTestStoreOnce sync.Once
var orchestrationServiceTestDB *gorm.DB

func injectOrchestrationServiceTestStore(t *testing.T, db *gorm.DB) {
	t.Helper()
	orchestrationServiceTestDB = db
	var injectErr error
	injectOrchestrationServiceTestStoreOnce.Do(func() {
		injectErr = store.InjectStore(context.Background(), &orchestrationServiceTestStore{})
	})
	if injectErr != nil {
		t.Fatalf("inject test store: %v", injectErr)
	}
}

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

func TestEnginePolicyScheduleForEngine(t *testing.T) {
	tests := []struct {
		name                 string
		engine               model.CollaborationEngineType
		expectedEngine       model.CollaborationEngineType
		parallel             bool
		roles                string
		convergenceMechanism string
	}{
		{
			name:                 "expert hierarchy",
			engine:               model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_HIERARCHY,
			expectedEngine:       model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_HIERARCHY,
			parallel:             false,
			roles:                "architect,planner,executor,verifier,risk",
			convergenceMechanism: "expert_hierarchy_serial_review_then_authority_signoff",
		},
		{
			name:                 "roundtable",
			engine:               model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_ROUNDTABLE,
			expectedEngine:       model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_ROUNDTABLE,
			parallel:             true,
			roles:                "planner,architect,risk,verifier,executor",
			convergenceMechanism: "roundtable_parallel_proposals_then_authority_signoff",
		},
		{
			name:                 "debate judge",
			engine:               model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_DEBATE_JUDGE,
			expectedEngine:       model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_DEBATE_JUDGE,
			parallel:             false,
			roles:                "planner,risk,verifier",
			convergenceMechanism: "debate_then_integrator_judge_signoff",
		},
		{
			name:                 "swarm",
			engine:               model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_SWARM,
			expectedEngine:       model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_SWARM,
			parallel:             true,
			roles:                "executor,executor,executor,verifier,risk",
			convergenceMechanism: "swarm_parallel_execution_then_integrator_merge",
		},
		{
			name:                 "hierarchy",
			engine:               model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_HIERARCHY,
			expectedEngine:       model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_HIERARCHY,
			parallel:             false,
			roles:                "planner,executor,verifier",
			convergenceMechanism: "hierarchical_serial_execution_then_integrator_signoff",
		},
		{
			name:                 "expert mesh",
			engine:               model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_MESH,
			expectedEngine:       model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_MESH,
			parallel:             true,
			roles:                "architect,planner,risk,verifier,executor",
			convergenceMechanism: "expert_mesh_parallel_review_then_integrator_merge",
		},
		{
			name:                 "unspecified falls back to expert hierarchy",
			engine:               model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_UNSPECIFIED,
			expectedEngine:       model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_HIERARCHY,
			parallel:             false,
			roles:                "architect,planner,executor,verifier,risk",
			convergenceMechanism: "expert_hierarchy_serial_review_then_authority_signoff",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			schedule := enginePolicyScheduleForEngine(tt.engine)
			if schedule.Engine != tt.expectedEngine {
				t.Fatalf("expected schedule engine %v, got %v", tt.expectedEngine, schedule.Engine)
			}
			if schedule.Parallel != tt.parallel {
				t.Fatalf("expected parallel=%v, got %v", tt.parallel, schedule.Parallel)
			}
			if roles := strings.Join(schedule.DefaultRoles, ","); roles != tt.roles {
				t.Fatalf("expected default roles %q, got %q", tt.roles, roles)
			}
			if schedule.ConvergenceMechanism != tt.convergenceMechanism {
				t.Fatalf("expected convergence mechanism %q, got %q", tt.convergenceMechanism, schedule.ConvergenceMechanism)
			}
		})
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
		nil,
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
	if synth.Role != collaborationRoleIntegrator {
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
		nil,
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

func TestBuildCollaborationTaskNodesUsesEnginePolicyScheduleRoles(t *testing.T) {
	now := time.Date(2026, 7, 1, 10, 0, 0, 0, time.UTC)
	nodes := buildCollaborationTaskNodes(
		"task-schedule",
		"Ship deterministic schedule policy.",
		model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_SWARM,
		[]string{"agent-a", "agent-b", "agent-c", "agent-d", "agent-e"},
		"agent-judge",
		nil,
		now,
	)

	if len(nodes) != 6 {
		t.Fatalf("expected five schedule nodes plus synthesis, got %d", len(nodes))
	}
	roles := make([]string, 0, 5)
	for index := 0; index < 5; index++ {
		roles = append(roles, nodes[index].Role)
	}
	if got := strings.Join(roles, ","); got != "executor,executor,executor,verifier,risk" {
		t.Fatalf("expected swarm schedule roles, got %q", got)
	}
	if nodes[5].Role != collaborationRoleIntegrator {
		t.Fatalf("expected synthesis role, got %q", nodes[5].Role)
	}
}

func TestBuildCollaborationTaskNodesUsesTypedProviderRoles(t *testing.T) {
	now := time.Date(2026, 7, 1, 10, 0, 0, 0, time.UTC)
	nodes := buildCollaborationTaskNodes(
		"task-typed-provider",
		"Ship typed provider plan.",
		model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_MESH,
		[]string{"agent-lead", "agent-risk"},
		"agent-lead",
		&model.TaskProviderPlan{
			Providers: []*model.TaskProviderSpec{
				{AgentId: "agent-lead", Role: "architect"},
				{AgentId: "agent-risk", Role: "risk-reviewer"},
			},
		},
		now,
	)

	if len(nodes) != 3 {
		t.Fatalf("expected two provider nodes plus synthesis, got %d", len(nodes))
	}
	if nodes[0].Role != "architect" || nodes[1].Role != "risk" {
		t.Fatalf("expected typed provider roles, got %q / %q", nodes[0].Role, nodes[1].Role)
	}
	if nodes[2].Role != collaborationRoleIntegrator {
		t.Fatalf("expected synthesizer role, got %q", nodes[2].Role)
	}
}

func TestProviderPlanFromCreateTaskRequestUsesTypedPlan(t *testing.T) {
	req := &model.CreateCollaborationTaskRequest{
		Meta: map[string]string{"agent_ids": `["agent-lead","agent-risk"]`},
		ProviderPlan: &model.TaskProviderPlan{
			Source:             "typed_request",
			SynthesizerAgentId: "agent-judge",
			Providers: []*model.TaskProviderSpec{
				{AgentId: "agent-lead", ProviderId: "openai", Model: "gpt-4.1", Role: "architect"},
				{AgentId: "agent-risk", ProviderId: "anthropic", Model: "claude-4", Role: "risk-reviewer"},
			},
		},
	}

	plan, agentIDs, err := providerPlanFromCreateTaskRequest(req, copyStringMap(req.GetMeta()))
	if err != nil {
		t.Fatalf("provider plan from typed request: %v", err)
	}
	if got := strings.Join(agentIDs, ","); got != "agent-lead,agent-risk" {
		t.Fatalf("unexpected typed provider agent ids: %s", got)
	}
	if plan.GetSource() != "typed_request" || plan.GetSynthesizerAgentId() != "agent-judge" {
		t.Fatalf("unexpected typed provider plan: %+v", plan)
	}
	if plan.GetProviders()[0].GetRole() != "architect" ||
		plan.GetProviders()[1].GetRole() != "risk" ||
		plan.GetProviders()[1].GetProviderId() != "anthropic" {
		t.Fatalf("unexpected typed provider specs: %+v", plan.GetProviders())
	}
}

func TestProviderPlanFromCreateTaskRequestRejectsUnknownAgentRole(t *testing.T) {
	req := &model.CreateCollaborationTaskRequest{
		ProviderPlan: &model.TaskProviderPlan{
			Providers: []*model.TaskProviderSpec{{
				AgentId: "agent-unknown",
				Role:    "shadow-admin",
			}},
		},
	}

	if _, _, err := providerPlanFromCreateTaskRequest(req, copyStringMap(req.GetMeta())); err == nil ||
		!strings.Contains(err.Error(), "known Atelier AgentRole") {
		t.Fatalf("expected unknown AgentRole rejection, got %v", err)
	}
}

func TestProviderPlanFromCreateTaskRequestRejectsMetaConflict(t *testing.T) {
	req := &model.CreateCollaborationTaskRequest{
		Meta: map[string]string{"agent_ids": `["agent-legacy"]`},
		ProviderPlan: &model.TaskProviderPlan{
			Providers: []*model.TaskProviderSpec{{AgentId: "agent-typed"}},
		},
	}

	if _, _, err := providerPlanFromCreateTaskRequest(req, copyStringMap(req.GetMeta())); err == nil {
		t.Fatal("expected typed provider plan conflict with legacy meta.agent_ids")
	}
}

func TestProviderPlanFromCreateTaskRequestBuildsLegacyFallback(t *testing.T) {
	req := &model.CreateCollaborationTaskRequest{
		Meta: map[string]string{
			"agent_ids": `["agent-a","agent-b"]`,
			"run_model": "gpt-4.1",
		},
	}

	plan, agentIDs, err := providerPlanFromCreateTaskRequest(req, copyStringMap(req.GetMeta()))
	if err != nil {
		t.Fatalf("provider plan from legacy meta: %v", err)
	}
	if plan.GetSource() != "legacy_meta" {
		t.Fatalf("expected legacy source, got %+v", plan)
	}
	if got := strings.Join(agentIDs, ","); got != "agent-a,agent-b" {
		t.Fatalf("unexpected legacy agent ids: %s", got)
	}
	if plan.GetProviders()[0].GetRole() != "planner" ||
		plan.GetProviders()[0].GetModel() != "gpt-4.1" ||
		plan.GetProviders()[1].GetRole() != "executor" {
		t.Fatalf("unexpected legacy provider plan: %+v", plan.GetProviders())
	}
}

func TestApplyCollaborationPlanConstraintsRequiresIntegratorForParallelEngine(t *testing.T) {
	meta := map[string]string{}
	err := applyCollaborationPlanConstraints(
		meta,
		model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_MESH,
		&model.TaskProviderPlan{},
		"workspace-1",
	)
	if err == nil {
		t.Fatal("expected parallel engine to require an integrator identity")
	}

	meta = map[string]string{}
	if err := applyCollaborationPlanConstraints(
		meta,
		model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_MESH,
		&model.TaskProviderPlan{SynthesizerAgentId: "agent-integrator"},
		"workspace-1",
	); err != nil {
		t.Fatalf("apply parallel constraints: %v", err)
	}
	if meta["task_graph_parallel_policy"] != collaborationParallelPolicyIntegratorRequired ||
		meta["integrator_required"] != "true" ||
		meta["integrator_agent_id"] != "agent-integrator" ||
		meta["workspace_ref"] != "workspace-1" ||
		meta["supervisor_loop"] != collaborationSupervisorLoopEventBus ||
		meta["replan_policy"] != collaborationReplanPolicyBeforeB10 ||
		meta["resume_anchor_policy"] != collaborationResumeAnchorLatestAccepted {
		t.Fatalf("unexpected parallel collaboration constraints: %+v", meta)
	}
	policy := (&model.TaskProviderPlan{SynthesizerAgentId: "unused"}).GetOrchestrationPolicy()
	if policy != nil {
		t.Fatalf("sanity check expected empty policy, got %+v", policy)
	}
	plan := &model.TaskProviderPlan{SynthesizerAgentId: "agent-integrator"}
	meta = map[string]string{}
	if err := applyCollaborationPlanConstraints(
		meta,
		model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_MESH,
		plan,
		"workspace-1",
	); err != nil {
		t.Fatalf("apply typed parallel constraints: %v", err)
	}
	policy = plan.GetOrchestrationPolicy()
	if policy.GetTaskGraphParallelPolicy() != model.TaskGraphParallelPolicy_TASK_GRAPH_PARALLEL_POLICY_INTEGRATOR_REQUIRED ||
		policy.GetIntegratorAgentId() != "agent-integrator" ||
		policy.GetSupervisorLoop() != model.SupervisorLoopKind_SUPERVISOR_LOOP_KIND_STATION_EVENT_BUS ||
		policy.GetReplanPolicy() != model.ReplanPolicyKind_REPLAN_POLICY_KIND_BEFORE_B10_FROM_RESUME_ANCHOR ||
		policy.GetResumeAnchorPolicy() != model.ResumeAnchorPolicyKind_RESUME_ANCHOR_POLICY_KIND_LATEST_ACCEPTED_CHECKPOINT ||
		policy.GetWorkspaceRef() != "workspace-1" {
		t.Fatalf("unexpected typed orchestration policy: %+v", policy)
	}
}

func TestApplyCollaborationPlanConstraintsMarksSerialOnlyForSequentialEngine(t *testing.T) {
	meta := map[string]string{"integrator_agent_id": "stale"}
	if err := applyCollaborationPlanConstraints(
		meta,
		model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_HIERARCHY,
		&model.TaskProviderPlan{},
		"",
	); err != nil {
		t.Fatalf("apply serial constraints: %v", err)
	}
	if meta["task_graph_parallel_policy"] != collaborationParallelPolicySerialOnly ||
		meta["integrator_required"] != "false" {
		t.Fatalf("unexpected serial collaboration constraints: %+v", meta)
	}
	if _, ok := meta["integrator_agent_id"]; ok {
		t.Fatalf("serial collaboration must not keep integrator agent id: %+v", meta)
	}
	plan := &model.TaskProviderPlan{}
	if err := applyCollaborationPlanConstraints(
		map[string]string{},
		model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_HIERARCHY,
		plan,
		"",
	); err != nil {
		t.Fatalf("apply typed serial constraints: %v", err)
	}
	if got := plan.GetOrchestrationPolicy().GetTaskGraphParallelPolicy(); got != model.TaskGraphParallelPolicy_TASK_GRAPH_PARALLEL_POLICY_SERIAL_ONLY {
		t.Fatalf("expected typed serial parallel policy, got %v", got)
	}
}

func TestTaskProviderPlanRecordFromProto(t *testing.T) {
	now := time.Date(2026, 7, 4, 12, 0, 0, 0, time.UTC)
	record, err := taskProviderPlanRecordFromProto("task-provider-plan", &model.TaskProviderPlan{
		Source: "typed_request",
		Providers: []*model.TaskProviderSpec{{
			AgentId:    "agent-lead",
			ProviderId: "openai",
			Model:      "gpt-4.1",
			Role:       "architect",
		}},
	}, now)
	if err != nil {
		t.Fatalf("provider plan record: %v", err)
	}
	if record.TaskID != "task-provider-plan" ||
		record.Source != "typed_request" ||
		record.Status != "active" ||
		record.CreatedAt != now ||
		!strings.HasPrefix(record.ProviderPlanID, "provider_plan_") ||
		!strings.Contains(record.PlanJSON, `"agentId":"agent-lead"`) ||
		!strings.Contains(record.PlanJSON, `"providerId":"openai"`) {
		t.Fatalf("unexpected provider plan record: %+v", record)
	}
}

func TestDirectRunRecordFromProviderPlanCreatesStationOwnedEntity(t *testing.T) {
	now := time.Date(2026, 7, 5, 11, 0, 0, 0, time.UTC)
	task := &persistence.CollaborationTask{
		ID:          "task-direct-run",
		Title:       "Run direct model",
		Description: "Station owned DirectRun entity",
		WorkspaceID: "peers-touch",
	}
	record, err := directRunRecordFromProviderPlan(task, "actor-1", &model.TaskProviderPlan{
		Source:             "atelier.direct_run.intent",
		SynthesizerAgentId: "agent-direct",
		Providers: []*model.TaskProviderSpec{{
			AgentId:         "agent-direct",
			ProviderId:      "openai",
			Model:           "gpt-4.1",
			ReasoningEffort: "high",
			Role:            "executor",
		}},
	}, map[string]string{
		"direct_run_state": "pending_station_provider_route",
		"budget_ref":       "budget-direct",
		"policy_ref":       "policy-direct",
	}, now)
	if err != nil {
		t.Fatalf("direct run record: %v", err)
	}
	if record == nil {
		t.Fatal("expected DirectRun record")
	}
	if !strings.HasPrefix(record.DirectRunID, "direct_run_") ||
		record.TaskID != task.ID ||
		record.ProviderID != "openai" ||
		record.ModelIntent != "gpt-4.1" ||
		record.BudgetRef != "budget-direct" ||
		record.PolicyRef != "policy-direct" ||
		record.State != "pending_station_provider_route" ||
		record.Source != "atelier.direct_run.intent" ||
		record.CreatedAt != now ||
		record.UpdatedAt != now {
		t.Fatalf("unexpected DirectRun record: %+v", record)
	}
	if !strings.Contains(record.InputSnapshotJSON, `"model_intent":"gpt-4.1"`) ||
		!strings.Contains(record.InputSnapshotJSON, `"provider_id":"openai"`) ||
		!strings.Contains(record.InputSnapshotJSON, `"actor_ptid":"actor-1"`) ||
		!strings.Contains(record.InputSnapshotJSON, `"attachments":[]`) {
		t.Fatalf("expected DirectRun input snapshot to preserve Station intent, got %s", record.InputSnapshotJSON)
	}
}

func TestDirectRunRecordFromProviderPlanPreservesHostStorageAttachments(t *testing.T) {
	now := time.Date(2026, 7, 5, 11, 2, 0, 0, time.UTC)
	task := &persistence.CollaborationTask{
		ID:          "task-direct-run-attachments",
		Title:       "Run direct model with attachments",
		Description: "Station owned DirectRun attachment metadata",
		WorkspaceID: "peers-touch",
	}
	record, err := directRunRecordFromProviderPlan(task, "actor-1", directRunTestProviderPlan(), map[string]string{
		directRunHostStorageAttachmentsMetaKey: `[{"host_storage_ref":"host-storage://task-direct-run-attachments/input/image-1","mime":"image/png","size":42,"sha256":"sha256:abcdef"}]`,
	}, now)
	if err != nil {
		t.Fatalf("direct run record with attachments: %v", err)
	}
	var snapshot struct {
		Attachments []directRunInputSnapshotAttachment `json:"attachments"`
	}
	if err := json.Unmarshal([]byte(record.InputSnapshotJSON), &snapshot); err != nil {
		t.Fatalf("decode input snapshot: %v", err)
	}
	if len(snapshot.Attachments) != 1 ||
		snapshot.Attachments[0].HostStorageRef != "host-storage://task-direct-run-attachments/input/image-1" ||
		snapshot.Attachments[0].Mime != "image/png" ||
		snapshot.Attachments[0].Size != 42 ||
		snapshot.Attachments[0].Sha256 != "sha256:abcdef" {
		t.Fatalf("expected Host-owned attachment metadata in input snapshot, got %+v", snapshot.Attachments)
	}
}

func TestDirectRunRecordFromProviderPlanRejectsRawAttachmentInputs(t *testing.T) {
	now := time.Date(2026, 7, 5, 11, 3, 0, 0, time.UTC)
	task := &persistence.CollaborationTask{
		ID:          "task-direct-run-raw-attachments",
		Title:       "Run direct model with raw attachments",
		Description: "Station owned DirectRun attachment metadata",
		WorkspaceID: "peers-touch",
	}
	cases := map[string]string{
		"raw_path":         `[{"host_storage_ref":"host-storage://task/file","mime":"image/png","size":42,"sha256":"sha256:abcdef","raw_path":"/tmp/image.png"}]`,
		"url":              `[{"host_storage_ref":"host-storage://task/file","mime":"image/png","size":42,"sha256":"sha256:abcdef","url":"https://example.test/image.png"}]`,
		"base64":           `[{"host_storage_ref":"host-storage://task/file","mime":"image/png","size":42,"sha256":"sha256:abcdef","base64":"AAAA"}]`,
		"content":          `[{"host_storage_ref":"host-storage://task/file","mime":"text/plain","size":42,"sha256":"sha256:abcdef","content":"raw"}]`,
		"write_intent":     `[{"host_storage_ref":"host-storage://task/file","mime":"image/png","size":42,"sha256":"sha256:abcdef","write_intent":"input_snapshot.write"}]`,
		"non_host_ref":     `[{"host_storage_ref":"https://example.test/file","mime":"image/png","size":42,"sha256":"sha256:abcdef"}]`,
		"negative_size":    `[{"host_storage_ref":"host-storage://task/file","mime":"image/png","size":-1,"sha256":"sha256:abcdef"}]`,
		"missing_checksum": `[{"host_storage_ref":"host-storage://task/file","mime":"image/png","size":42,"sha256":""}]`,
		"inline_data_uri":  `[{"host_storage_ref":"host-storage://task/file","mime":"image/png","size":42,"sha256":"sha256:abcdef","data_uri":"data:image/png;base64,AAAA"}]`,
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			record, err := directRunRecordFromProviderPlan(task, "actor-1", directRunTestProviderPlan(), map[string]string{
				directRunHostStorageAttachmentsMetaKey: raw,
			}, now)
			if err == nil {
				t.Fatalf("expected invalid attachment input to be rejected, got record %+v", record)
			}
		})
	}
}

func TestDirectRunLifecycleRecordsFromProviderPlanCreatesNoSessionTaskRunMarker(t *testing.T) {
	now := time.Date(2026, 7, 5, 11, 5, 0, 0, time.UTC)
	task := &persistence.CollaborationTask{
		ID:          "task-direct-run-lifecycle",
		Title:       "Run direct model",
		Description: "Station owned DirectRun lifecycle",
		WorkspaceID: "peers-touch",
	}
	records, err := directRunLifecycleRecordsFromProviderPlan(task, "actor-1", &model.TaskProviderPlan{
		Source:             "atelier.direct_run.intent",
		SynthesizerAgentId: "agent-direct",
		Providers: []*model.TaskProviderSpec{{
			AgentId:         "agent-direct",
			ProviderId:      "openai",
			Model:           "gpt-4.1",
			ReasoningEffort: "high",
			Role:            "executor",
		}},
	}, map[string]string{
		"direct_run_state": "pending_station_provider_route",
		"budget_ref":       "budget-direct",
		"policy_ref":       "policy-direct",
	}, now)
	if err != nil {
		t.Fatalf("direct run lifecycle records: %v", err)
	}
	if records == nil || records.Run == nil || records.Task == nil || records.Step == nil {
		t.Fatalf("expected DirectRun, TaskRun and ExecutionStep records, got %+v", records)
	}
	if records.Task.TaskID != task.ID ||
		records.Task.Surface != int32(model.TaskSurface_TASK_SURFACE_DIRECT_RUN) ||
		records.Task.ConversationID != "" ||
		records.Task.Status != int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING) ||
		records.Task.OwnerActorPTID != "actor-1" {
		t.Fatalf("unexpected DirectRun TaskRun marker: %+v", records.Task)
	}
	if !strings.Contains(records.Task.MetaJSON, `"runtime_kind":"direct_run_no_session"`) ||
		!strings.Contains(records.Task.MetaJSON, `"direct_run_id":"`) ||
		!strings.Contains(records.Task.MetaJSON, `"trace_id":"`) {
		t.Fatalf("expected DirectRun TaskRun meta to keep runtime references, got %s", records.Task.MetaJSON)
	}
	if !strings.HasPrefix(records.Step.StepID, "direct_run_step_") ||
		records.Step.TaskID != task.ID ||
		records.Step.AgentID != "agent-direct" ||
		records.Step.Status != int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING) ||
		records.Step.EligibleExecutors != model.ExecutorKind_EXECUTOR_KIND_STATION_HOSTED.String() {
		t.Fatalf("unexpected DirectRun ExecutionStep marker: %+v", records.Step)
	}
}

func TestValidateDirectRunRuntimePreflightRejectsMissingTraceRef(t *testing.T) {
	records := directRunPreflightFixture()
	records.Run.TraceID = ""

	if err := validateDirectRunRuntimePreflight(records); err == nil {
		t.Fatal("expected DirectRun runtime preflight to reject missing trace ref")
	}
}

func TestValidateDirectRunRuntimePreflightRejectsStartedStep(t *testing.T) {
	records := directRunPreflightFixture()
	records.Step.Status = int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING)
	records.Step.TurnID = "turn-already-started"

	if err := validateDirectRunRuntimePreflight(records); err == nil {
		t.Fatal("expected DirectRun runtime preflight to reject started step")
	}
}

func TestIsDirectRunTaskForRecoverySplitsNormalCollaborationRecovery(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "direct_run_recovery_split")
	now := time.Date(2026, 7, 5, 11, 8, 0, 0, time.UTC)
	if err := db.Create(&persistence.DirectRun{
		DirectRunID:       "direct_run_recovery",
		TaskID:            "task-direct-run-recovery",
		ProviderID:        "openai",
		ModelIntent:       "gpt-4.1",
		InputSnapshotJSON: "{}",
		BudgetRef:         "budget-direct",
		PolicyRef:         "policy-direct",
		TraceID:           "trace-direct",
		State:             "pending_station_provider_route",
		Source:            collaborationProviderPlanSourceDirectRun,
		CreatedAt:         now,
		UpdatedAt:         now,
	}).Error; err != nil {
		t.Fatalf("seed DirectRun: %v", err)
	}

	direct, err := isDirectRunTaskForRecovery(context.Background(), db, "task-direct-run-recovery")
	if err != nil {
		t.Fatalf("inspect DirectRun recovery split: %v", err)
	}
	if !direct {
		t.Fatal("expected DirectRun task to be split away from normal collaboration recovery")
	}

	normal, err := isDirectRunTaskForRecovery(context.Background(), db, "task-normal-collaboration")
	if err != nil {
		t.Fatalf("inspect normal recovery split: %v", err)
	}
	if normal {
		t.Fatal("expected normal collaboration task to stay eligible for normal recovery")
	}
}

func TestDirectRunLifecycleMarkerPersistsDurableTaskCreatedEvent(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "direct_run_lifecycle_marker_event")
	now := time.Date(2026, 7, 5, 11, 6, 0, 0, time.UTC)
	task := &persistence.CollaborationTask{
		ID:            "task-direct-run-marker",
		Title:         "Run direct model",
		Description:   "Station owned DirectRun marker",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		GoalOwnerPTID: "actor-1",
		WorkspaceID:   "peers-touch",
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	records, err := directRunLifecycleRecordsFromProviderPlan(task, "actor-1", &model.TaskProviderPlan{
		Source:             "atelier.direct_run.intent",
		SynthesizerAgentId: "agent-direct",
		Providers: []*model.TaskProviderSpec{{
			AgentId:    "agent-direct",
			ProviderId: "openai",
			Model:      "gpt-4.1",
			Role:       "executor",
		}},
	}, map[string]string{"direct_run_state": "pending_station_provider_route"}, now)
	if err != nil {
		t.Fatalf("direct run lifecycle records: %v", err)
	}
	writer := NewTaskEventWriter()
	if err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(task).Error; err != nil {
			return err
		}
		if err := tx.Create(records.Run).Error; err != nil {
			return err
		}
		if err := tx.Create(records.Task).Error; err != nil {
			return err
		}
		if err := tx.Create(records.Step).Error; err != nil {
			return err
		}
		_, err := writer.appendTx(context.Background(), tx, "", task.ID, records.Step.StepID, "", string(domain.EventTypeCollaborationTaskCreated), directRunCreatedEventPayload(records))
		return err
	}); err != nil {
		t.Fatalf("persist DirectRun marker transaction: %v", err)
	}
	var taskRun persistence.TaskRun
	if err := db.First(&taskRun, "task_id = ?", task.ID).Error; err != nil {
		t.Fatalf("load task run marker: %v", err)
	}
	if taskRun.Surface != int32(model.TaskSurface_TASK_SURFACE_DIRECT_RUN) || taskRun.ConversationID != "" {
		t.Fatalf("expected DirectRun no-session TaskRun marker, got %+v", taskRun)
	}
	var event persistence.TaskEvent
	if err := db.First(&event, "task_id = ?", task.ID).Error; err != nil {
		t.Fatalf("load DirectRun marker event: %v", err)
	}
	if event.EventType != int32(model.TaskEventType_TASK_EVENT_TYPE_TASK_CREATED) || event.StepID != records.Step.StepID || event.EventSeq != 1 {
		t.Fatalf("expected durable DirectRun TASK_CREATED event, got %+v", event)
	}
	if !strings.Contains(event.Payload, `"surface_name":"TASK_SURFACE_DIRECT_RUN"`) ||
		!strings.Contains(event.Payload, `"runtime_kind":"direct_run_no_session"`) ||
		!strings.Contains(event.Payload, `"runtime_preflight":"passed"`) ||
		!strings.Contains(event.Payload, `"provider_execution":"not_started"`) {
		t.Fatalf("expected DirectRun marker event payload, got %s", event.Payload)
	}
}

func TestExecutePendingDirectRunSuccessPersistsProviderArtifactGateAndTraceHooks(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "direct_run_provider_success")
	injectOrchestrationServiceTestStore(t, db)
	records := seedDirectRunRuntimeFixture(t, db, "task-direct-run-success", "openai-direct", "", "")
	if err := db.Model(&persistence.AgentProvider{}).
		Where("id = ?", "openai-direct").
		Update("config", json.RawMessage(`{"pricing":{"input_token_usd":0.001,"output_token_usd":0.002}}`)).Error; err != nil {
		t.Fatalf("seed provider pricing config: %v", err)
	}
	executor := &fakeDirectRunProviderExecutor{resp: &ProviderCallResponse{
		Content:         "## Direct answer\n\nStation-owned DirectRun result.",
		Model:           "gpt-4.1",
		Provider:        "openai",
		InputTokens:     12,
		OutputTokens:    34,
		BilledMoney:     0.09,
		BillingSource:   "provider.response.invoice",
		BillingCurrency: "USD",
		FinishReason:    "stop",
		Streamed:        true,
	}}
	svc := NewOrchestrationService(nil, nil, nil)
	svc.eventWriter = NewTaskEventWriter()
	svc.directRunProvider = executor

	if err := svc.executePendingDirectRunAfterCanvasReadiness(context.Background(), "actor-1", records.Run.TaskID, "test"); err != nil {
		t.Fatalf("execute DirectRun success: %v", err)
	}
	if executor.calls != 1 {
		t.Fatalf("expected one provider call, got %d", executor.calls)
	}
	var run persistence.DirectRun
	if err := db.First(&run, "direct_run_id = ?", records.Run.DirectRunID).Error; err != nil {
		t.Fatalf("load direct run: %v", err)
	}
	if run.State != "succeeded" {
		t.Fatalf("expected DirectRun succeeded, got %q", run.State)
	}
	var taskRun persistence.TaskRun
	if err := db.First(&taskRun, "task_id = ?", records.Run.TaskID).Error; err != nil {
		t.Fatalf("load task run: %v", err)
	}
	if taskRun.Surface != int32(model.TaskSurface_TASK_SURFACE_DIRECT_RUN) || taskRun.ConversationID != "" ||
		taskRun.Status != int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED) {
		t.Fatalf("expected completed no-session DirectRun task run, got %+v", taskRun)
	}
	var artifact persistence.TaskArtifact
	if err := db.First(&artifact, "task_id = ? AND kind = ?", records.Run.TaskID, "direct_run.provider_response").Error; err != nil {
		t.Fatalf("load direct run artifact: %v", err)
	}
	if artifact.URI != stationArtifactURI(records.Run.TaskID, artifact.ArtifactID) || !strings.HasPrefix(artifact.Checksum, "sha256:") {
		t.Fatalf("expected artifact evidence policy fields, got %+v", artifact)
	}
	var gate persistence.TaskGateResult
	if err := db.First(&gate, "task_id = ? AND status = ?", records.Run.TaskID, "passed").Error; err != nil {
		t.Fatalf("load direct run gate result: %v", err)
	}
	if gate.ProducedBy != "station.direct_run" || !strings.Contains(gate.ArtifactIDsJSON, artifact.ArtifactID) {
		t.Fatalf("expected direct run gate linked to artifact, got %+v", gate)
	}
	var blob persistence.TaskArtifactBlob
	if err := db.First(&blob, "artifact_id = ?", artifact.ArtifactID).Error; err != nil {
		t.Fatalf("load direct run artifact blob: %v", err)
	}
	if !strings.Contains(blob.BodyText, "Station-owned DirectRun result") {
		t.Fatalf("expected provider body stored out of projection, got %q", blob.BodyText)
	}
	var usage persistence.TaskBudgetUsage
	if err := db.First(&usage, "task_id = ? AND direct_run_id = ?", records.Run.TaskID, records.Run.DirectRunID).Error; err != nil {
		t.Fatalf("load direct run budget usage: %v", err)
	}
	if usage.InputTokens != 12 || usage.OutputTokens != 34 || usage.TotalTokens != 46 ||
		usage.BudgetID != records.Run.BudgetRef || usage.Source != "station.direct_run" ||
		usage.EventID != artifact.EventID {
		t.Fatalf("expected direct run token usage ledger linked to artifact event, got %+v", usage)
	}
	if usage.EstimatedMoney < 0.0799 || usage.EstimatedMoney > 0.0801 {
		t.Fatalf("expected direct run estimated money from provider pricing config, got %+v", usage)
	}
	if usage.UsedMoney < 0.0899 || usage.UsedMoney > 0.0901 ||
		usage.ProviderBilledMoney < 0.0899 || usage.ProviderBilledMoney > 0.0901 ||
		usage.ProviderBillingSource != "provider.response.invoice" ||
		usage.ProviderBillingCurrency != "USD" {
		t.Fatalf("expected direct run money usage from provider-reported billing, got %+v", usage)
	}
	if usage.InputTokenPrice != 0.001 || usage.OutputTokenPrice != 0.002 || usage.PricingSource != "provider.config.pricing" {
		t.Fatalf("expected direct run pricing catalog snapshot, got %+v", usage)
	}
}

func TestDirectRunProviderPricingResolvesModelCatalogSnapshot(t *testing.T) {
	provider := &persistence.AgentProvider{
		ID: "openai-direct",
		Config: json.RawMessage(`{
			"pricing_catalog": {
				"source": "station.provider_pricing_catalog",
				"version": "2026-07-05",
				"models": {
					"gpt-4.1": {
						"input_token_usd": 0.003,
						"output_token_usd": 0.004
					}
				}
			},
			"pricing": {
				"input_token_usd": 0.001,
				"output_token_usd": 0.002
			}
		}`),
	}

	pricing := directRunProviderPricing(provider, "gpt-4.1")
	if pricing.InputTokenPrice != 0.003 || pricing.OutputTokenPrice != 0.004 ||
		pricing.Source != "station.provider_pricing_catalog@2026-07-05:gpt-4.1" {
		t.Fatalf("expected model catalog pricing snapshot, got %+v", pricing)
	}
	if money := pricing.moneyUsage(10, 20); money < 0.1099 || money > 0.1101 {
		t.Fatalf("expected model catalog money usage, got %.6f", money)
	}
}

func TestExecutePendingDirectRunProviderFailurePersistsFailureArtifact(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "direct_run_provider_failure")
	injectOrchestrationServiceTestStore(t, db)
	records := seedDirectRunRuntimeFixture(t, db, "task-direct-run-failure", "openai-direct", "", "")
	executor := &fakeDirectRunProviderExecutor{err: fmt.Errorf("provider unavailable")}
	svc := NewOrchestrationService(nil, nil, nil)
	svc.eventWriter = NewTaskEventWriter()
	svc.directRunProvider = executor

	if err := svc.executePendingDirectRunAfterCanvasReadiness(context.Background(), "actor-1", records.Run.TaskID, "test"); err == nil {
		t.Fatal("expected provider failure error")
	}
	if executor.calls != 1 {
		t.Fatalf("expected one provider call, got %d", executor.calls)
	}
	var run persistence.DirectRun
	if err := db.First(&run, "direct_run_id = ?", records.Run.DirectRunID).Error; err != nil {
		t.Fatalf("load direct run: %v", err)
	}
	if run.State != "failed" {
		t.Fatalf("expected DirectRun failed, got %q", run.State)
	}
	var artifact persistence.TaskArtifact
	if err := db.First(&artifact, "task_id = ? AND kind = ?", records.Run.TaskID, "direct_run.failure").Error; err != nil {
		t.Fatalf("load failure artifact: %v", err)
	}
	var event persistence.TaskEvent
	if err := db.First(&event, "task_id = ? AND event_type = ?", records.Run.TaskID, int32(model.TaskEventType_TASK_EVENT_TYPE_STEP_FAILED)).Error; err != nil {
		t.Fatalf("load step failed event: %v", err)
	}
	if !strings.Contains(event.Payload, "provider unavailable") {
		t.Fatalf("expected failure summary in event payload, got %s", event.Payload)
	}
}

func TestExecutePendingDirectRunCreatesCLICodingProviderHandoffWithoutProviderCall(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "direct_run_cli_provider")
	injectOrchestrationServiceTestStore(t, db)
	records := seedDirectRunRuntimeFixture(t, db, "task-direct-run-cli", "cli-direct", "cli", "cli")
	if err := db.Model(&persistence.AgentProvider{}).
		Where("id = ?", "cli-direct").
		Updates(map[string]interface{}{
			"cli_command": "traecli exec --skip-git-repo-check -",
			"protocol":    "cli",
		}).Error; err != nil {
		t.Fatalf("seed CLI provider command: %v", err)
	}
	executor := &fakeDirectRunProviderExecutor{}
	svc := NewOrchestrationService(nil, nil, nil)
	svc.eventWriter = NewTaskEventWriter()
	svc.directRunProvider = executor

	if err := svc.executePendingDirectRunAfterCanvasReadiness(context.Background(), "actor-1", records.Run.TaskID, "test"); err != nil {
		t.Fatalf("execute DirectRun CLI rejection: %v", err)
	}
	if executor.calls != 0 {
		t.Fatalf("expected no provider call for CLI provider, got %d", executor.calls)
	}
	var run persistence.DirectRun
	if err := db.First(&run, "direct_run_id = ?", records.Run.DirectRunID).Error; err != nil {
		t.Fatalf("load direct run: %v", err)
	}
	if run.State != "awaiting_desktop_coding_provider" {
		t.Fatalf("expected desktop CodingProvider handoff state, got %q", run.State)
	}
	var taskRun persistence.TaskRun
	if err := db.First(&taskRun, "task_id = ?", records.Run.TaskID).Error; err != nil {
		t.Fatalf("load task run: %v", err)
	}
	if taskRun.Status != int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED) {
		t.Fatalf("expected paused task run for CLI DirectRun, got %+v", taskRun)
	}
	var interrupt persistence.InterruptRequest
	if err := db.First(&interrupt, "task_id = ? AND interrupt_type = ?", records.Run.TaskID, "direct_run_desktop_coding_provider_handoff").Error; err != nil {
		t.Fatalf("load CLI interrupt: %v", err)
	}
	if interrupt.Status != int32(model.InterruptStatus_INTERRUPT_STATUS_PENDING) {
		t.Fatalf("expected pending CLI interrupt, got %+v", interrupt)
	}
	for _, marker := range []string{
		`"adapter":"desktop_coding_provider"`,
		`"handoff_kind":"desktop_executor_required"`,
		`"handoff_owner":"desktop_runtime"`,
		`"executor_kind":"EXECUTOR_KIND_DESKTOP_DEVICE"`,
		`"cli_command_configured":true`,
		`"cli_command_ref":"agent_provider.cli_command"`,
	} {
		if !strings.Contains(interrupt.PayloadJSON, marker) {
			t.Fatalf("expected CLI handoff payload to contain %s, got %s", marker, interrupt.PayloadJSON)
		}
	}
	if strings.Contains(interrupt.PayloadJSON, "traecli exec") {
		t.Fatalf("CLI handoff payload must not expose raw CLI command, got %s", interrupt.PayloadJSON)
	}
	var gate persistence.TaskGateResult
	if err := db.First(&gate, "task_id = ? AND status = ? AND blocking = ?", records.Run.TaskID, "failed", true).Error; err != nil {
		t.Fatalf("load CLI handoff gate: %v", err)
	}
	if !strings.Contains(gate.PayloadJSON, `"adapter":"desktop_coding_provider"`) ||
		!strings.Contains(gate.PayloadJSON, `"interrupt_type":"direct_run_desktop_coding_provider_handoff"`) {
		t.Fatalf("expected blocking gate to carry CLI handoff evidence, got %s", gate.PayloadJSON)
	}
}

func TestExecutePendingDirectRunBudgetPolicyPreflightEscalatesBeforeProviderCall(t *testing.T) {
	tests := []struct {
		name          string
		configure     func(t *testing.T, db *gorm.DB, records *directRunLifecycleRecords)
		wantState     string
		wantInterrupt string
	}{
		{
			name: "time budget exceeded",
			configure: func(t *testing.T, db *gorm.DB, records *directRunLifecycleRecords) {
				t.Helper()
				startedAt := time.Now().Add(-2 * time.Second)
				if err := db.Model(&persistence.CollaborationTask{}).
					Where("id = ?", records.Run.TaskID).
					Updates(map[string]interface{}{
						"started_at":     startedAt,
						"budget_time_ms": int64(1000),
					}).Error; err != nil {
					t.Fatalf("set exceeded budget: %v", err)
				}
			},
			wantState:     "budget_blocked",
			wantInterrupt: "direct_run_budget_exceeded",
		},
		{
			name: "token budget exceeded",
			configure: func(t *testing.T, db *gorm.DB, records *directRunLifecycleRecords) {
				t.Helper()
				if err := db.Model(&persistence.CollaborationTask{}).
					Where("id = ?", records.Run.TaskID).
					Update("budget_tokens", float64(46)).Error; err != nil {
					t.Fatalf("set token budget: %v", err)
				}
				if err := db.Create(&persistence.TaskBudgetUsage{
					BudgetUsageID: "usage-existing",
					TaskID:        records.Run.TaskID,
					StepID:        records.Step.StepID,
					BudgetID:      records.Run.BudgetRef,
					DirectRunID:   records.Run.DirectRunID,
					ProviderID:    records.Run.ProviderID,
					Model:         records.Run.ModelIntent,
					InputTokens:   12,
					OutputTokens:  34,
					TotalTokens:   46,
					Source:        "station.direct_run",
					CreatedAt:     time.Now(),
				}).Error; err != nil {
					t.Fatalf("seed token budget usage: %v", err)
				}
			},
			wantState:     "budget_blocked",
			wantInterrupt: "direct_run_budget_exceeded",
		},
		{
			name: "money budget exceeded",
			configure: func(t *testing.T, db *gorm.DB, records *directRunLifecycleRecords) {
				t.Helper()
				if err := db.Model(&persistence.CollaborationTask{}).
					Where("id = ?", records.Run.TaskID).
					Update("budget_money", float64(0.08)).Error; err != nil {
					t.Fatalf("set money budget: %v", err)
				}
				if err := db.Create(&persistence.TaskBudgetUsage{
					BudgetUsageID: "usage-money-existing",
					TaskID:        records.Run.TaskID,
					StepID:        records.Step.StepID,
					BudgetID:      records.Run.BudgetRef,
					DirectRunID:   records.Run.DirectRunID,
					ProviderID:    records.Run.ProviderID,
					Model:         records.Run.ModelIntent,
					InputTokens:   12,
					OutputTokens:  34,
					TotalTokens:   46,
					UsedMoney:     0.08,
					Source:        "station.direct_run",
					CreatedAt:     time.Now(),
				}).Error; err != nil {
					t.Fatalf("seed money budget usage: %v", err)
				}
			},
			wantState:     "budget_blocked",
			wantInterrupt: "direct_run_budget_exceeded",
		},
		{
			name: "policy hard deny",
			configure: func(t *testing.T, db *gorm.DB, records *directRunLifecycleRecords) {
				t.Helper()
				if err := db.Create(&persistence.AtelierPolicy{
					PolicyProjectionID: projectStateMachinePolicyProjectionID(records.Run.TaskID, records.Run.PolicyRef),
					PolicyID:           records.Run.PolicyRef,
					TaskID:             records.Run.TaskID,
					HardDeny:           true,
					CreatedAt:          time.Now(),
					UpdatedAt:          time.Now(),
				}).Error; err != nil {
					t.Fatalf("create hard deny policy: %v", err)
				}
			},
			wantState:     "policy_blocked",
			wantInterrupt: "direct_run_policy_denied",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := openResumeCollaborationTaskDB(t, "direct_run_runtime_"+strings.ReplaceAll(tt.name, " ", "_"))
			injectOrchestrationServiceTestStore(t, db)
			records := seedDirectRunRuntimeFixture(t, db, "task-"+strings.ReplaceAll(tt.name, " ", "-"), "openai-direct", "", "")
			tt.configure(t, db, records)
			executor := &fakeDirectRunProviderExecutor{}
			svc := NewOrchestrationService(nil, nil, nil)
			svc.eventWriter = NewTaskEventWriter()
			svc.directRunProvider = executor

			if err := svc.executePendingDirectRunAfterCanvasReadiness(context.Background(), "actor-1", records.Run.TaskID, "test"); err != nil {
				t.Fatalf("execute DirectRun preflight block: %v", err)
			}
			if executor.calls != 0 {
				t.Fatalf("expected no provider call after %s preflight, got %d", tt.name, executor.calls)
			}
			var run persistence.DirectRun
			if err := db.First(&run, "direct_run_id = ?", records.Run.DirectRunID).Error; err != nil {
				t.Fatalf("load direct run: %v", err)
			}
			if run.State != tt.wantState {
				t.Fatalf("expected DirectRun state %q, got %q", tt.wantState, run.State)
			}
			var taskRun persistence.TaskRun
			if err := db.First(&taskRun, "task_id = ?", records.Run.TaskID).Error; err != nil {
				t.Fatalf("load task run: %v", err)
			}
			if taskRun.Status != int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED) {
				t.Fatalf("expected paused DirectRun task run, got %+v", taskRun)
			}
			var interrupt persistence.InterruptRequest
			if err := db.First(&interrupt, "task_id = ? AND interrupt_type = ?", records.Run.TaskID, tt.wantInterrupt).Error; err != nil {
				t.Fatalf("load runtime interrupt: %v", err)
			}
			if interrupt.Status != int32(model.InterruptStatus_INTERRUPT_STATUS_PENDING) || !strings.Contains(interrupt.PayloadJSON, records.Run.TraceID) {
				t.Fatalf("expected pending runtime interrupt with trace ref, got %+v", interrupt)
			}
			var gate persistence.TaskGateResult
			if err := db.First(&gate, "task_id = ? AND status = ? AND blocking = ?", records.Run.TaskID, "failed", true).Error; err != nil {
				t.Fatalf("load runtime blocking gate: %v", err)
			}
			if gate.ProducedBy != "station.direct_run" || !strings.Contains(gate.PayloadJSON, tt.wantInterrupt) {
				t.Fatalf("expected blocking direct run gate linked to interrupt, got %+v", gate)
			}
		})
	}
}

func seedDirectRunRuntimeFixture(t *testing.T, db *gorm.DB, taskID string, providerID string, sourceType string, runtimeKind string) *directRunLifecycleRecords {
	t.Helper()
	now := time.Date(2026, 7, 5, 12, 0, 0, 0, time.UTC)
	if sourceType == "" {
		sourceType = "openai"
	}
	if runtimeKind == "" {
		runtimeKind = "station"
	}
	task := &persistence.CollaborationTask{
		ID:            taskID,
		Title:         "Run direct model",
		Description:   "Answer directly from a Station-owned DirectRun provider.",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		GoalOwnerPTID: "actor-1",
		WorkspaceID:   "peers-touch",
		MetaJSON:      "{}",
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	records, err := directRunLifecycleRecordsFromProviderPlan(task, "actor-1", &model.TaskProviderPlan{
		Source:             collaborationProviderPlanSourceDirectRun,
		SynthesizerAgentId: "agent-direct",
		Providers: []*model.TaskProviderSpec{{
			AgentId:         "agent-direct",
			ProviderId:      providerID,
			Model:           "gpt-4.1",
			Role:            "executor",
			ReasoningEffort: "medium",
		}},
	}, map[string]string{"direct_run_state": "pending_station_provider_route"}, now)
	if err != nil {
		t.Fatalf("build direct run fixture: %v", err)
	}
	if err := db.Create(&persistence.AgentProvider{
		ID:          providerID,
		Name:        providerID,
		SourceType:  sourceType,
		RuntimeKind: runtimeKind,
		CheckModel:  "gpt-4.1",
		Enabled:     true,
		CreatedAt:   now,
		UpdatedAt:   now,
	}).Error; err != nil {
		t.Fatalf("create provider fixture: %v", err)
	}
	writer := NewTaskEventWriter()
	if err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(task).Error; err != nil {
			return err
		}
		if err := tx.Create(records.Run).Error; err != nil {
			return err
		}
		if err := tx.Create(records.Task).Error; err != nil {
			return err
		}
		if err := tx.Create(records.Step).Error; err != nil {
			return err
		}
		_, err := writer.appendTx(context.Background(), tx, "", task.ID, records.Step.StepID, "", string(domain.EventTypeCollaborationTaskCreated), directRunCreatedEventPayload(records))
		return err
	}); err != nil {
		t.Fatalf("persist direct run fixture: %v", err)
	}
	return records
}

func directRunPreflightFixture() *directRunLifecycleRecords {
	now := time.Date(2026, 7, 5, 11, 7, 0, 0, time.UTC)
	return &directRunLifecycleRecords{
		Run: &persistence.DirectRun{
			DirectRunID:       "direct_run_test",
			TaskID:            "task-direct-run-preflight",
			ProviderID:        "openai",
			ModelIntent:       "gpt-4.1",
			InputSnapshotJSON: "{}",
			BudgetRef:         "budget-direct",
			PolicyRef:         "policy-direct",
			TraceID:           "trace-direct",
			State:             "pending_station_provider_route",
			Source:            collaborationProviderPlanSourceDirectRun,
			CreatedAt:         now,
			UpdatedAt:         now,
		},
		Task: &persistence.TaskRun{
			TaskID:         "task-direct-run-preflight",
			Surface:        int32(model.TaskSurface_TASK_SURFACE_DIRECT_RUN),
			Status:         int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
			OwnerActorPTID: "actor-1",
			ConversationID: "",
			CreatedAt:      now,
			StartedAt:      now,
			UpdatedAt:      now,
		},
		Step: &persistence.ExecutionStep{
			StepID:            "direct_run_step_test",
			TaskID:            "task-direct-run-preflight",
			AgentID:           "agent-direct",
			Status:            int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING),
			Attempt:           1,
			EligibleExecutors: model.ExecutorKind_EXECUTOR_KIND_STATION_HOSTED.String(),
			StartedAt:         now,
		},
	}
}

func TestDirectRunRecordFromProviderPlanRejectsMissingModel(t *testing.T) {
	now := time.Date(2026, 7, 5, 11, 10, 0, 0, time.UTC)
	task := &persistence.CollaborationTask{ID: "task-direct-run-invalid"}
	if _, err := directRunRecordFromProviderPlan(task, "actor-1", &model.TaskProviderPlan{
		Source: "atelier.direct_run.intent",
		Providers: []*model.TaskProviderSpec{{
			AgentId: "agent-direct",
		}},
	}, nil, now); err == nil {
		t.Fatal("expected DirectRun without model intent to be rejected")
	}
}

func TestLoadRuntimeProviderOverrideForNodeUsesPersistedPlan(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "provider_plan_runtime_override")
	now := time.Date(2026, 7, 5, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-provider-runtime",
		Title:         "DirectRun runtime provider override",
		Description:   "Use Station provider plan at runtime.",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		GoalOwnerPTID: "actor-1",
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	node := persistence.CollaborationTaskNode{
		ID:        "node-provider-runtime",
		TaskID:    task.ID,
		AgentID:   "agent-direct",
		Role:      "executor",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING),
		StartedAt: now,
		EndedAt:   now,
	}
	planJSON, err := protojson.Marshal(&model.TaskProviderPlan{
		Source:             "atelier.direct_run.intent",
		SynthesizerAgentId: "agent-direct",
		Providers: []*model.TaskProviderSpec{{
			AgentId:         "agent-direct",
			ProviderId:      "openai",
			Model:           "gpt-4.1",
			ReasoningEffort: "high",
			Role:            "executor",
		}},
	})
	if err != nil {
		t.Fatalf("marshal provider plan: %v", err)
	}
	if seedErr := db.Create(&persistence.TaskProviderPlan{
		ProviderPlanID: "provider-plan-runtime",
		TaskID:         task.ID,
		Source:         "atelier.direct_run.intent",
		Status:         "active",
		PlanJSON:       string(planJSON),
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; seedErr != nil {
		t.Fatalf("seed provider plan: %v", seedErr)
	}

	runtimeProvider, err := loadRuntimeProviderOverrideForNode(context.Background(), db, &task, &node)
	if err != nil {
		t.Fatalf("load runtime provider override: %v", err)
	}
	if runtimeProvider.ProviderID != "openai" ||
		runtimeProvider.Model != "gpt-4.1" ||
		runtimeProvider.ReasoningEffort != "high" ||
		runtimeProvider.Source != "atelier.direct_run.intent" {
		t.Fatalf("unexpected runtime provider override: %+v", runtimeProvider)
	}

	svc := &OrchestrationService{}
	agent := &domain.Agent{
		AgentID:    "agent-direct",
		Name:       "Direct agent",
		ProviderID: "default-provider",
		ModelName:  "default-model",
		Effort:     "low",
		ConfigJSON: "{}",
	}
	cfg := svc.turnConfigForNode("actor-1", &task, &node, agent, runtimeProvider)
	if cfg.Provider != "openai" || cfg.Model != "gpt-4.1" || cfg.Effort != "high" {
		t.Fatalf("expected TurnConfig to use provider plan override, got %+v", cfg)
	}
	if err := svc.ensureNodeConversation(context.Background(), db, "actor-1", &task, &node, agent, runtimeProvider); err != nil {
		t.Fatalf("ensure node conversation: %v", err)
	}
	var conversation persistence.Conversation
	if err := db.First(&conversation, "id = ?", node.ID).Error; err != nil {
		t.Fatalf("load conversation: %v", err)
	}
	if conversation.ProviderID != "openai" || conversation.ModelName == nil || *conversation.ModelName != "gpt-4.1" {
		t.Fatalf("expected conversation to use provider plan override, got %+v model=%v", conversation, conversation.ModelName)
	}
	if !strings.Contains(string(conversation.Meta), `"provider_plan_source":"atelier.direct_run.intent"`) {
		t.Fatalf("expected conversation meta to record provider plan source, got %s", string(conversation.Meta))
	}
}

func TestReadyCollaborationNodesRespectsPrerequisites(t *testing.T) {
	nodes := []persistence.CollaborationTaskNode{
		{ID: "node-a", AgentID: "agent-a", Status: int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING)},
		{ID: "node-b", AgentID: "agent-b", Status: int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING), PrerequisiteNodeIDs: "node-a"},
		{ID: "node-c", AgentID: "agent-c", Status: int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING), PrerequisiteNodeIDs: "missing-node"},
		{ID: "node-s", AgentID: "agent-j", Role: collaborationRoleIntegrator, Status: int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING), PrerequisiteNodeIDs: "node-a,node-b"},
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
		{ID: "node-s", AgentID: "agent-j", Role: collaborationRoleIntegrator, Status: int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING), PrerequisiteNodeIDs: "node-a"},
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

func TestAgentExecutorKindRequiresExplicitExecutorCapability(t *testing.T) {
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
			name:   "cli command does not imply desktop executor",
			config: `{"cliCommand":"traecli exec --skip-git-repo-check -"}`,
			want:   model.ExecutorKind_EXECUTOR_KIND_STATION_HOSTED,
		},
		{
			name:   "runtime kind does not imply desktop executor",
			config: `{"runtimeKind":"cli"}`,
			want:   model.ExecutorKind_EXECUTOR_KIND_STATION_HOSTED,
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
			goal_owner_ptid text NOT NULL,
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
		ID:            "task-lease",
		GoalOwnerPTID: "actor-1",
		Title:         "Lease claim",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
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

func TestResumeCollaborationTaskTxResumesPausedTaskWithoutRunningNode(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "resume_paused_no_running")
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-resume",
		Title:         "Resume task",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED),
		MetaJSON:      `{"existing":"kept"}`,
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	nodes := []persistence.CollaborationTaskNode{
		{
			ID:        "node-complete",
			TaskID:    task.ID,
			AgentID:   "agent-1",
			Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
			StartedAt: now,
			EndedAt:   now,
		},
		{
			ID:        "node-pending",
			TaskID:    task.ID,
			AgentID:   "agent-2",
			Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING),
			StartedAt: now,
			EndedAt:   now,
		},
	}
	seedResumeCollaborationTask(t, db, task, nodes)

	var resumed bool
	if err := db.Transaction(func(tx *gorm.DB) error {
		_, _, didResume, err := resumeCollaborationTaskTx(context.Background(), tx, "actor-1", task.ID, "atelier.escalation.resolve")
		resumed = didResume
		return err
	}); err != nil {
		t.Fatalf("resume paused task: %v", err)
	}
	if !resumed {
		t.Fatal("expected paused task without running nodes to resume")
	}

	var updated persistence.CollaborationTask
	if err := db.First(&updated, "id = ?", task.ID).Error; err != nil {
		t.Fatalf("load updated task: %v", err)
	}
	if got := model.CollaborationTaskStatus(updated.Status); got != model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING {
		t.Fatalf("expected task status RUNNING, got %v", got)
	}
	meta := map[string]string{}
	if err := json.Unmarshal([]byte(updated.MetaJSON), &meta); err != nil {
		t.Fatalf("decode resume meta: %v", err)
	}
	if meta["existing"] != "kept" {
		t.Fatalf("expected existing meta to be preserved, got %#v", meta)
	}
	if meta["resume_state"] != "ready" || meta["resume_reason"] != "atelier.escalation.resolve" {
		t.Fatalf("unexpected resume meta: %#v", meta)
	}
	if strings.TrimSpace(meta["resume_requested_at"]) == "" {
		t.Fatalf("expected resume_requested_at in meta, got %#v", meta)
	}
}

func TestResumeCollaborationTaskTxRejectsPausedTaskWithRunningNode(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "resume_paused_running_node")
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-running-node",
		Title:         "Running node",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED),
		MetaJSON:      `{"existing":"kept"}`,
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	nodes := []persistence.CollaborationTaskNode{
		{
			ID:        "node-running",
			TaskID:    task.ID,
			AgentID:   "agent-1",
			Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
			StartedAt: now,
			EndedAt:   now,
		},
	}
	seedResumeCollaborationTask(t, db, task, nodes)

	var resumed bool
	err := db.Transaction(func(tx *gorm.DB) error {
		_, _, didResume, err := resumeCollaborationTaskTx(context.Background(), tx, "actor-1", task.ID, "atelier.escalation.resolve")
		resumed = didResume
		return err
	})
	if err == nil {
		t.Fatal("expected paused task with running node to reject guarded resume")
	}
	if resumed {
		t.Fatal("expected guarded resume to avoid duplicate execution")
	}

	var updated persistence.CollaborationTask
	if loadErr := db.First(&updated, "id = ?", task.ID).Error; loadErr != nil {
		t.Fatalf("load updated task: %v", loadErr)
	}
	if got := model.CollaborationTaskStatus(updated.Status); got != model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED {
		t.Fatalf("expected task to remain PAUSED, got %v", got)
	}
	if updated.MetaJSON != task.MetaJSON {
		t.Fatalf("expected meta to remain unchanged, got %q", updated.MetaJSON)
	}
}

func TestCanResumeCollaborationTaskTxRejectsPausedTaskWithRunningNodeWithoutMutation(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "can_resume_paused_running_node")
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-can-resume-running-node",
		Title:         "Running node preflight",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED),
		MetaJSON:      `{"existing":"kept"}`,
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	nodes := []persistence.CollaborationTaskNode{
		{
			ID:        "node-running",
			TaskID:    task.ID,
			AgentID:   "agent-1",
			Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
			StartedAt: now,
			EndedAt:   now,
		},
	}
	seedResumeCollaborationTask(t, db, task, nodes)

	err := db.Transaction(func(tx *gorm.DB) error {
		return canResumeCollaborationTaskTx(context.Background(), tx, "actor-1", task.ID)
	})
	if err == nil {
		t.Fatal("expected resume preflight to reject paused task with running node")
	}

	var updated persistence.CollaborationTask
	if loadErr := db.First(&updated, "id = ?", task.ID).Error; loadErr != nil {
		t.Fatalf("load updated task: %v", loadErr)
	}
	if got := model.CollaborationTaskStatus(updated.Status); got != model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED {
		t.Fatalf("expected task to remain PAUSED, got %v", got)
	}
	if updated.MetaJSON != task.MetaJSON {
		t.Fatalf("expected preflight to leave meta unchanged, got %q", updated.MetaJSON)
	}
}

func TestCanResumeCollaborationTaskTxAllowsPausedTaskWithoutMutation(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "can_resume_paused_no_running")
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-can-resume",
		Title:         "Can resume task",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED),
		MetaJSON:      `{"existing":"kept"}`,
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	nodes := []persistence.CollaborationTaskNode{
		{
			ID:        "node-pending",
			TaskID:    task.ID,
			AgentID:   "agent-1",
			Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING),
			StartedAt: now,
			EndedAt:   now,
		},
	}
	seedResumeCollaborationTask(t, db, task, nodes)

	if err := db.Transaction(func(tx *gorm.DB) error {
		return canResumeCollaborationTaskTx(context.Background(), tx, "actor-1", task.ID)
	}); err != nil {
		t.Fatalf("expected resume preflight to allow paused task without running node: %v", err)
	}

	var updated persistence.CollaborationTask
	if err := db.First(&updated, "id = ?", task.ID).Error; err != nil {
		t.Fatalf("load updated task: %v", err)
	}
	if got := model.CollaborationTaskStatus(updated.Status); got != model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED {
		t.Fatalf("expected preflight not to change task status, got %v", got)
	}
	if updated.MetaJSON != task.MetaJSON {
		t.Fatalf("expected preflight to leave meta unchanged, got %q", updated.MetaJSON)
	}
}

func TestResolveCollaborationInterruptTxResumesPausedTaskAndPersistsResolvedEvent(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "resolve_interrupt_resumes")
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-resolve-interrupt",
		Title:         "Resolve interrupt",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED),
		MetaJSON:      `{"existing":"kept"}`,
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	nodes := []persistence.CollaborationTaskNode{
		{
			ID:        "node-pending",
			TaskID:    task.ID,
			AgentID:   "agent-1",
			Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING),
			StartedAt: now,
			EndedAt:   now,
		},
	}
	seedResumeCollaborationTask(t, db, task, nodes)

	writer := NewTaskEventWriter()
	var resumed bool
	if err := db.Transaction(func(tx *gorm.DB) error {
		_, _, didResume, _, err := resolveCollaborationInterruptTx(
			context.Background(),
			tx,
			writer,
			"actor-1",
			task.ID,
			"atelier.escalation.resolve",
			string(domain.EventTypeCollaborationInterruptResolved),
			map[string]interface{}{
				"interrupt_id":        "decision_1",
				"block_kind":          "decision_resolved",
				"choice":              "继续执行",
				"resume_payload_json": `{"choice":"继续执行"}`,
			},
		)
		resumed = didResume
		return err
	}); err != nil {
		t.Fatalf("resolve collaboration interrupt: %v", err)
	}
	if !resumed {
		t.Fatal("expected paused task to resume")
	}

	var updated persistence.CollaborationTask
	if err := db.First(&updated, "id = ?", task.ID).Error; err != nil {
		t.Fatalf("load updated task: %v", err)
	}
	if got := model.CollaborationTaskStatus(updated.Status); got != model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING {
		t.Fatalf("expected task status RUNNING, got %v", got)
	}
	var events []persistence.TaskEvent
	if err := db.Where("task_id = ?", task.ID).Order("event_seq ASC").Find(&events).Error; err != nil {
		t.Fatalf("load task events: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected one resolved event, got %+v", events)
	}
	if got := model.TaskEventType(events[0].EventType); got != model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_RESOLVED {
		t.Fatalf("expected interrupt resolved event, got %v", got)
	}
	if events[0].EventSeq != 1 {
		t.Fatalf("expected first event seq 1, got %d", events[0].EventSeq)
	}
	var interrupt persistence.InterruptRequest
	if err := db.First(&interrupt, "interrupt_id = ?", "decision_1").Error; err != nil {
		t.Fatalf("load interrupt request: %v", err)
	}
	if interrupt.Status != int32(model.InterruptStatus_INTERRUPT_STATUS_RESOLVED) {
		t.Fatalf("expected interrupt resolved, got %d", interrupt.Status)
	}
	if interrupt.ResumePayloadJSON != `{"choice":"继续执行"}` {
		t.Fatalf("unexpected resume payload: %q", interrupt.ResumePayloadJSON)
	}
	if interrupt.ResolvedAt == nil {
		t.Fatal("expected resolved_at to be set")
	}
}

func TestResolveCollaborationInterruptTxAcceptsGateBlockedTask(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "resolve_gate_block_accept")
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-gate-accept",
		Title:         "Gate accept",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED),
		MetaJSON: mergeStringMapJSON("", map[string]string{
			"gate_blocked":         "true",
			"gate_blocked_id":      "gate-block",
			"gate_blocked_summary": "gate failed",
			"gate_blocked_node":    "node-gate",
		}),
		CreatedAt: now,
		StartedAt: now,
		EndedAt:   now,
	}
	nodes := []persistence.CollaborationTaskNode{{
		ID:        "node-gate",
		TaskID:    task.ID,
		AgentID:   "agent-1",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
		StartedAt: now,
		EndedAt:   now,
	}}
	seedResumeCollaborationTask(t, db, task, nodes)
	seedTaskGatePlan(t, db, "plan-block", task.ID, "node-gate", model.TaskGateBlockingLevel_TASK_GATE_BLOCKING_LEVEL_BLOCK, "failed")
	if err := db.Model(&persistence.TaskGatePlan{}).Where("gate_plan_id = ?", "plan-block").Update("status", "blocked").Error; err != nil {
		t.Fatalf("mark gate plan blocked: %v", err)
	}

	writer := NewTaskEventWriter()
	var resumed bool
	if err := db.Transaction(func(tx *gorm.DB) error {
		_, _, didResume, _, err := resolveCollaborationInterruptTx(
			context.Background(),
			tx,
			writer,
			"actor-1",
			task.ID,
			"atelier.escalation.resolve",
			string(domain.EventTypeCollaborationInterruptResolved),
			map[string]interface{}{
				"interrupt_id":         "decision_accept",
				"block_kind":           "decision_resolved",
				"choice":               "接受风险",
				"gate_recovery_action": "accept",
				"resume_payload_json":  `{"gate_recovery_action":"accept"}`,
			},
		)
		resumed = didResume
		return err
	}); err != nil {
		t.Fatalf("resolve gate accept: %v", err)
	}
	if !resumed {
		t.Fatal("expected accepted gate to resume task")
	}
	assertGateRecoveryState(t, db, task.ID, "accepted", model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING, "accept")
}

func TestResolveCollaborationInterruptTxRerunsGateBlockedNode(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "resolve_gate_block_rerun")
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-gate-rerun",
		Title:         "Gate rerun",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED),
		MetaJSON: mergeStringMapJSON("", map[string]string{
			"gate_blocked":         "true",
			"gate_blocked_id":      "gate-block",
			"gate_blocked_summary": "gate failed",
			"gate_blocked_node":    "node-gate",
		}),
		CreatedAt: now,
		StartedAt: now,
		EndedAt:   now,
	}
	nodes := []persistence.CollaborationTaskNode{{
		ID:            "node-gate",
		TaskID:        task.ID,
		AgentID:       "agent-1",
		Status:        int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
		ResultSummary: "old result",
		StartedAt:     now,
		EndedAt:       now,
	}}
	seedResumeCollaborationTask(t, db, task, nodes)
	seedTaskGatePlan(t, db, "plan-block", task.ID, "node-gate", model.TaskGateBlockingLevel_TASK_GATE_BLOCKING_LEVEL_BLOCK, "failed")
	if err := db.Model(&persistence.TaskGatePlan{}).Where("gate_plan_id = ?", "plan-block").Update("status", "blocked").Error; err != nil {
		t.Fatalf("mark gate plan blocked: %v", err)
	}

	writer := NewTaskEventWriter()
	if err := db.Transaction(func(tx *gorm.DB) error {
		_, _, _, _, err := resolveCollaborationInterruptTx(
			context.Background(),
			tx,
			writer,
			"actor-1",
			task.ID,
			"atelier.escalation.resolve",
			string(domain.EventTypeCollaborationInterruptResolved),
			map[string]interface{}{
				"interrupt_id":         "decision_rerun",
				"block_kind":           "decision_resolved",
				"choice":               "复跑",
				"gate_recovery_action": "rerun",
				"resume_payload_json":  `{"gate_recovery_action":"rerun"}`,
			},
		)
		return err
	}); err != nil {
		t.Fatalf("resolve gate rerun: %v", err)
	}
	assertGateRecoveryState(t, db, task.ID, "active", model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING, "rerun")
	var node persistence.CollaborationTaskNode
	if err := db.First(&node, "id = ?", "node-gate").Error; err != nil {
		t.Fatalf("load rerun node: %v", err)
	}
	if got := model.TaskNodeStatus(node.Status); got != model.TaskNodeStatus_TASK_NODE_STATUS_PENDING || node.ResultSummary != "" {
		t.Fatalf("expected blocked node reset to pending, got status=%v summary=%q", got, node.ResultSummary)
	}
}

func TestResolveCollaborationInterruptTxRoutesHumanDecisionGateRerun(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "resolve_human_decision_route_gate_rerun")
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-human-route-gate",
		Title:         "Human route gate",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED),
		MetaJSON: mergeStringMapJSON("", map[string]string{
			"gate_blocked":      "true",
			"gate_blocked_id":   "gate-block",
			"gate_blocked_node": "node-gate",
		}),
		CreatedAt: now,
		StartedAt: now,
		EndedAt:   now,
	}
	nodes := []persistence.CollaborationTaskNode{{
		ID:            "node-gate",
		TaskID:        task.ID,
		AgentID:       "agent-1",
		Status:        int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
		ResultSummary: "stale result",
		StartedAt:     now,
		EndedAt:       now,
	}}
	seedResumeCollaborationTask(t, db, task, nodes)
	seedTaskGatePlan(t, db, "plan-block", task.ID, "node-gate", model.TaskGateBlockingLevel_TASK_GATE_BLOCKING_LEVEL_BLOCK, "failed")
	if err := db.Model(&persistence.TaskGatePlan{}).Where("gate_plan_id = ?", "plan-block").Update("status", "blocked").Error; err != nil {
		t.Fatalf("mark gate plan blocked: %v", err)
	}
	if err := db.Create(&persistence.InterruptRequest{
		InterruptID:   "decision_route_rerun",
		TaskID:        task.ID,
		InterruptType: "human_decision",
		Status:        int32(model.InterruptStatus_INTERRUPT_STATUS_PENDING),
		PayloadJSON: mustJSONString(map[string]interface{}{
			"interrupt_id":      "decision_route_rerun",
			"reason":            "gate_blocked",
			"gate_id":           "gate-block",
			"node_id":           "node-gate",
			"question":          "Gate failed. What should Station do?",
			"rollback_impact":   "Only the blocked node will be reset.",
			"recommendation":    "rerun_failed_node",
			"evidence_refs":     []string{"artifact://task-human-route-gate/gate/body"},
			"spent":             "10m",
			"block_kind":        "decision",
			"human_decision_id": "decision_route_rerun",
			"options": []map[string]string{{
				"id":     "retry-node",
				"label":  "复跑失败节点",
				"action": "rerun_failed_node",
			}},
		}),
		CreatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed pending human decision: %v", err)
	}

	writer := NewTaskEventWriter()
	if err := db.Transaction(func(tx *gorm.DB) error {
		_, _, _, _, err := resolveCollaborationInterruptTx(
			context.Background(),
			tx,
			writer,
			"actor-1",
			task.ID,
			"atelier.escalation.resolve",
			string(domain.EventTypeCollaborationInterruptResolved),
			map[string]interface{}{
				"interrupt_id": "decision_route_rerun",
				"block_kind":   "decision_resolved",
				"choice":       "复跑失败节点",
			},
		)
		return err
	}); err != nil {
		t.Fatalf("resolve routed human decision: %v", err)
	}
	assertGateRecoveryState(t, db, task.ID, "active", model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING, "rerun")
	var node persistence.CollaborationTaskNode
	if err := db.First(&node, "id = ?", "node-gate").Error; err != nil {
		t.Fatalf("load rerun node: %v", err)
	}
	if got := model.TaskNodeStatus(node.Status); got != model.TaskNodeStatus_TASK_NODE_STATUS_PENDING || node.ResultSummary != "" {
		t.Fatalf("expected routed gate decision to reset node, got status=%v summary=%q", got, node.ResultSummary)
	}
	var event persistence.TaskEvent
	if err := db.First(&event, "task_id = ?", task.ID).Error; err != nil {
		t.Fatalf("load resolved event: %v", err)
	}
	eventPayload := map[string]interface{}{}
	if err := json.Unmarshal([]byte(event.Payload), &eventPayload); err != nil {
		t.Fatalf("decode resolved event payload: %v", err)
	}
	if eventPayload["human_decision_reason"] != "gate_blocked" ||
		eventPayload["human_decision_action"] != "rerun_failed_node" ||
		eventPayload["gate_recovery_action"] != "rerun" ||
		eventPayload["human_decision_route"] != "station.orchestration" ||
		eventPayload["gate_id"] != "gate-block" ||
		eventPayload["node_id"] != "node-gate" {
		t.Fatalf("resolved event missing typed human decision route: %+v", eventPayload)
	}
}

func TestResolveCollaborationInterruptTxRoutesHumanDecisionBudgetContinue(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "resolve_human_decision_route_budget_continue")
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-human-route-budget",
		Title:         "Budget route",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED),
		MetaJSON:      `{"budget_blocked":"true","budget_ref":"budget-direct"}`,
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	seedResumeCollaborationTask(t, db, task, []persistence.CollaborationTaskNode{{
		ID:        "node-budget",
		TaskID:    task.ID,
		AgentID:   "agent-1",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING),
		StartedAt: now,
		EndedAt:   now,
	}})
	if err := db.Create(&persistence.InterruptRequest{
		InterruptID:   "decision_budget_continue",
		TaskID:        task.ID,
		InterruptType: "direct_run_budget_exceeded",
		Status:        int32(model.InterruptStatus_INTERRUPT_STATUS_PENDING),
		PayloadJSON: mustJSONString(map[string]interface{}{
			"interrupt_id":      "decision_budget_continue",
			"reason":            "budget",
			"budget_ref":        "budget-direct",
			"question":          "Budget exceeded before provider execution. Continue?",
			"rollback_impact":   "Station keeps budget recovery and provider resume ownership.",
			"block_kind":        "decision",
			"human_decision_id": "decision_budget_continue",
			"options": []map[string]string{{
				"id":     "continue-budget",
				"label":  "继续执行",
				"action": "continue",
			}},
		}),
		CreatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed pending budget decision: %v", err)
	}

	writer := NewTaskEventWriter()
	var resumed bool
	if err := db.Transaction(func(tx *gorm.DB) error {
		_, _, didResume, _, err := resolveCollaborationInterruptTx(
			context.Background(),
			tx,
			writer,
			"actor-1",
			task.ID,
			"atelier.escalation.resolve",
			string(domain.EventTypeCollaborationInterruptResolved),
			map[string]interface{}{
				"interrupt_id": "decision_budget_continue",
				"block_kind":   "decision_resolved",
				"choice":       "继续执行",
			},
		)
		resumed = didResume
		return err
	}); err != nil {
		t.Fatalf("resolve routed budget decision: %v", err)
	}
	if !resumed {
		t.Fatal("expected budget continue decision to resume Station-owned execution")
	}
	var updated persistence.CollaborationTask
	if err := db.First(&updated, "id = ?", task.ID).Error; err != nil {
		t.Fatalf("load updated budget task: %v", err)
	}
	if got := model.CollaborationTaskStatus(updated.Status); got != model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING {
		t.Fatalf("expected budget task RUNNING after continue, got %v", got)
	}
	var interrupt persistence.InterruptRequest
	if err := db.First(&interrupt, "interrupt_id = ?", "decision_budget_continue").Error; err != nil {
		t.Fatalf("load budget interrupt: %v", err)
	}
	if interrupt.Status != int32(model.InterruptStatus_INTERRUPT_STATUS_RESOLVED) ||
		interrupt.ResumePayloadJSON == "" ||
		strings.Contains(interrupt.ResumePayloadJSON, "budget.write") ||
		strings.Contains(interrupt.ResumePayloadJSON, "provider.invoke") ||
		strings.Contains(interrupt.ResumePayloadJSON, "runtime.execute") {
		t.Fatalf("expected reference-only resolved budget interrupt, got %+v", interrupt)
	}
	var event persistence.TaskEvent
	if err := db.First(&event, "task_id = ?", task.ID).Error; err != nil {
		t.Fatalf("load budget resolved event: %v", err)
	}
	eventPayload := map[string]interface{}{}
	if err := json.Unmarshal([]byte(event.Payload), &eventPayload); err != nil {
		t.Fatalf("decode budget resolved event payload: %v", err)
	}
	if eventPayload["human_decision_route"] != "station.orchestration" ||
		eventPayload["human_decision_reason"] != "budget" ||
		eventPayload["human_decision_action"] != "continue" ||
		eventPayload["human_decision_transition"] != "escalated->executing" ||
		eventPayload["resume_action"] != "continue" {
		t.Fatalf("budget decision event missing typed Station route: %+v", eventPayload)
	}
	payloadJSON := string(event.Payload)
	for _, forbidden := range []string{"budget.write", "budget.resume", "provider.invoke", "runtime.execute", "shell.execute", "input_snapshot"} {
		if strings.Contains(payloadJSON, forbidden) {
			t.Fatalf("budget decision event must remain reference-only; found %q in %s", forbidden, payloadJSON)
		}
	}
}

func TestResolveCollaborationInterruptTxRejectsPolicyContinueRoute(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "resolve_human_decision_route_policy_continue")
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-human-route-policy",
		Title:         "Policy route",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED),
		MetaJSON:      `{"policy_blocked":"true"}`,
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	seedResumeCollaborationTask(t, db, task, []persistence.CollaborationTaskNode{{
		ID:        "node-policy",
		TaskID:    task.ID,
		AgentID:   "agent-1",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING),
		StartedAt: now,
		EndedAt:   now,
	}})
	if err := db.Create(&persistence.InterruptRequest{
		InterruptID:   "decision_policy_continue",
		TaskID:        task.ID,
		InterruptType: "human_decision",
		Status:        int32(model.InterruptStatus_INTERRUPT_STATUS_PENDING),
		PayloadJSON: mustJSONString(map[string]interface{}{
			"interrupt_id": "decision_policy_continue",
			"reason":       "policy",
			"question":     "Policy hard deny. Continue?",
			"options": []map[string]string{{
				"id":     "continue",
				"label":  "继续执行",
				"action": "continue",
			}},
		}),
		CreatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed pending policy decision: %v", err)
	}

	writer := NewTaskEventWriter()
	err := db.Transaction(func(tx *gorm.DB) error {
		_, _, _, _, txErr := resolveCollaborationInterruptTx(
			context.Background(),
			tx,
			writer,
			"actor-1",
			task.ID,
			"atelier.escalation.resolve",
			string(domain.EventTypeCollaborationInterruptResolved),
			map[string]interface{}{
				"interrupt_id": "decision_policy_continue",
				"block_kind":   "decision_resolved",
				"choice":       "继续执行",
			},
		)
		return txErr
	})
	if err == nil || !strings.Contains(err.Error(), "policy human decision route cannot continue hard deny") {
		t.Fatalf("expected policy route rejection, got %v", err)
	}
	var eventCount int64
	if countErr := db.Model(&persistence.TaskEvent{}).Where("task_id = ?", task.ID).Count(&eventCount).Error; countErr != nil {
		t.Fatalf("count task events: %v", countErr)
	}
	if eventCount != 0 {
		t.Fatalf("expected rejected policy route to persist no events, got %d", eventCount)
	}
	var interrupt persistence.InterruptRequest
	if err := db.First(&interrupt, "interrupt_id = ?", "decision_policy_continue").Error; err != nil {
		t.Fatalf("load policy interrupt: %v", err)
	}
	if interrupt.Status != int32(model.InterruptStatus_INTERRUPT_STATUS_PENDING) {
		t.Fatalf("expected policy interrupt to remain pending, got %d", interrupt.Status)
	}
}

func TestResolveCollaborationInterruptTxCancelsGateBlockedTask(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "resolve_gate_block_cancel")
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-gate-cancel",
		Title:         "Gate cancel",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED),
		MetaJSON: mergeStringMapJSON("", map[string]string{
			"gate_blocked":         "true",
			"gate_blocked_id":      "gate-block",
			"gate_blocked_summary": "gate failed",
			"gate_blocked_node":    "node-gate",
		}),
		CreatedAt: now,
		StartedAt: now,
		EndedAt:   now,
	}
	nodes := []persistence.CollaborationTaskNode{
		{
			ID:        "node-gate",
			TaskID:    task.ID,
			AgentID:   "agent-1",
			Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
			StartedAt: now,
			EndedAt:   now,
		},
		{
			ID:        "node-pending",
			TaskID:    task.ID,
			AgentID:   "agent-2",
			Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING),
			StartedAt: now,
			EndedAt:   now,
		},
	}
	seedResumeCollaborationTask(t, db, task, nodes)
	seedTaskGatePlan(t, db, "plan-block", task.ID, "node-gate", model.TaskGateBlockingLevel_TASK_GATE_BLOCKING_LEVEL_BLOCK, "failed")
	if err := db.Model(&persistence.TaskGatePlan{}).Where("gate_plan_id = ?", "plan-block").Update("status", "blocked").Error; err != nil {
		t.Fatalf("mark gate plan blocked: %v", err)
	}

	writer := NewTaskEventWriter()
	var resumed bool
	if err := db.Transaction(func(tx *gorm.DB) error {
		_, _, didResume, _, err := resolveCollaborationInterruptTx(
			context.Background(),
			tx,
			writer,
			"actor-1",
			task.ID,
			"atelier.escalation.resolve",
			string(domain.EventTypeCollaborationInterruptResolved),
			map[string]interface{}{
				"interrupt_id":         "decision_cancel",
				"block_kind":           "decision_resolved",
				"choice":               "取消",
				"gate_recovery_action": "cancel",
				"resume_payload_json":  `{"gate_recovery_action":"cancel"}`,
			},
		)
		resumed = didResume
		return err
	}); err != nil {
		t.Fatalf("resolve gate cancel: %v", err)
	}
	if resumed {
		t.Fatal("expected cancelled gate recovery not to resume execution")
	}
	assertGateRecoveryState(t, db, task.ID, "cancelled", model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_CANCELLED, "cancel")
	var pending persistence.CollaborationTaskNode
	if err := db.First(&pending, "id = ?", "node-pending").Error; err != nil {
		t.Fatalf("load pending node: %v", err)
	}
	if got := model.TaskNodeStatus(pending.Status); got != model.TaskNodeStatus_TASK_NODE_STATUS_SKIPPED {
		t.Fatalf("expected pending node skipped after cancel, got %v", got)
	}
}

func TestResolveCollaborationInterruptTxRejectsGateBlockedTaskWithActiveLease(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "resolve_gate_active_lease")
	now := time.Now().UTC()
	task := persistence.CollaborationTask{
		ID:            "task-gate-active-lease",
		Title:         "Gate active lease",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED),
		MetaJSON: mergeStringMapJSON("", map[string]string{
			"gate_blocked":         "true",
			"gate_blocked_id":      "gate-block",
			"gate_blocked_summary": "gate failed",
			"gate_blocked_node":    "node-gate",
		}),
		CreatedAt: now,
		StartedAt: now,
		EndedAt:   now,
	}
	nodes := []persistence.CollaborationTaskNode{{
		ID:        "node-gate",
		TaskID:    task.ID,
		AgentID:   "agent-1",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
		StartedAt: now,
		EndedAt:   now,
	}}
	seedResumeCollaborationTask(t, db, task, nodes)
	if err := db.Create(&persistence.ExecutorLease{
		LeaseID:      "lease-active",
		TaskID:       task.ID,
		StepID:       "node-gate",
		ExecutorID:   "executor-1",
		ExecutorKind: int32(model.ExecutorKind_EXECUTOR_KIND_DESKTOP_DEVICE),
		Status:       executorLeaseStatusActive,
		AcquiredAt:   now,
		HeartbeatAt:  now,
		ExpiresAt:    now.Add(time.Minute),
	}).Error; err != nil {
		t.Fatalf("seed active lease: %v", err)
	}

	writer := NewTaskEventWriter()
	err := db.Transaction(func(tx *gorm.DB) error {
		_, _, _, _, err := resolveCollaborationInterruptTx(
			context.Background(),
			tx,
			writer,
			"actor-1",
			task.ID,
			"atelier.escalation.resolve",
			string(domain.EventTypeCollaborationInterruptResolved),
			map[string]interface{}{
				"interrupt_id":         "decision_active_lease",
				"block_kind":           "decision_resolved",
				"choice":               "继续执行",
				"gate_recovery_action": "continue",
				"resume_payload_json":  `{"gate_recovery_action":"continue"}`,
			},
		)
		return err
	})
	if err == nil {
		t.Fatal("expected active executor lease to reject gate recovery")
	}
	var eventCount int64
	if countErr := db.Model(&persistence.TaskEvent{}).Where("task_id = ?", task.ID).Count(&eventCount).Error; countErr != nil {
		t.Fatalf("count task events: %v", countErr)
	}
	if eventCount != 0 {
		t.Fatalf("expected rejected recovery to persist no events, got %d", eventCount)
	}
}

func TestResolveCollaborationInterruptTxExpiresStaleLeaseBeforeGateRecovery(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "resolve_gate_expired_lease")
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-gate-expired-lease",
		Title:         "Gate expired lease",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED),
		MetaJSON: mergeStringMapJSON("", map[string]string{
			"gate_blocked":         "true",
			"gate_blocked_id":      "gate-block",
			"gate_blocked_summary": "gate failed",
			"gate_blocked_node":    "node-gate",
		}),
		CreatedAt: now,
		StartedAt: now,
		EndedAt:   now,
	}
	nodes := []persistence.CollaborationTaskNode{{
		ID:        "node-gate",
		TaskID:    task.ID,
		AgentID:   "agent-1",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
		StartedAt: now,
		EndedAt:   now,
	}}
	seedResumeCollaborationTask(t, db, task, nodes)
	seedTaskGatePlan(t, db, "plan-block", task.ID, "node-gate", model.TaskGateBlockingLevel_TASK_GATE_BLOCKING_LEVEL_BLOCK, "failed")
	if err := db.Model(&persistence.TaskGatePlan{}).Where("gate_plan_id = ?", "plan-block").Update("status", "blocked").Error; err != nil {
		t.Fatalf("mark gate plan blocked: %v", err)
	}
	if err := db.Create(&persistence.ExecutorLease{
		LeaseID:      "lease-expired",
		TaskID:       task.ID,
		StepID:       "node-gate",
		ExecutorID:   "executor-1",
		ExecutorKind: int32(model.ExecutorKind_EXECUTOR_KIND_DESKTOP_DEVICE),
		Status:       executorLeaseStatusActive,
		AcquiredAt:   now,
		HeartbeatAt:  now,
		ExpiresAt:    time.Now().Add(-time.Minute),
	}).Error; err != nil {
		t.Fatalf("seed expired lease: %v", err)
	}

	writer := NewTaskEventWriter()
	if err := db.Transaction(func(tx *gorm.DB) error {
		_, _, _, _, err := resolveCollaborationInterruptTx(
			context.Background(),
			tx,
			writer,
			"actor-1",
			task.ID,
			"atelier.escalation.resolve",
			string(domain.EventTypeCollaborationInterruptResolved),
			map[string]interface{}{
				"interrupt_id":         "decision_expired_lease",
				"block_kind":           "decision_resolved",
				"choice":               "继续执行",
				"gate_recovery_action": "continue",
				"resume_payload_json":  `{"gate_recovery_action":"continue"}`,
			},
		)
		return err
	}); err != nil {
		t.Fatalf("resolve gate expired lease: %v", err)
	}
	assertGateRecoveryState(t, db, task.ID, "continued", model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING, "continue")
	var lease persistence.ExecutorLease
	if err := db.First(&lease, "lease_id = ?", "lease-expired").Error; err != nil {
		t.Fatalf("load expired lease: %v", err)
	}
	if lease.Status != executorLeaseStatusExpired {
		t.Fatalf("expected stale lease marked expired, got %q", lease.Status)
	}
}

func TestResolveCollaborationInterruptTxRejectsPausedTaskWithRunningNodeWithoutEvent(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "resolve_interrupt_rejects_running_node")
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-resolve-running-node",
		Title:         "Resolve running node",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED),
		MetaJSON:      `{"existing":"kept"}`,
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	nodes := []persistence.CollaborationTaskNode{
		{
			ID:        "node-running",
			TaskID:    task.ID,
			AgentID:   "agent-1",
			Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
			StartedAt: now,
			EndedAt:   now,
		},
	}
	seedResumeCollaborationTask(t, db, task, nodes)

	writer := NewTaskEventWriter()
	err := db.Transaction(func(tx *gorm.DB) error {
		_, _, _, _, err := resolveCollaborationInterruptTx(
			context.Background(),
			tx,
			writer,
			"actor-1",
			task.ID,
			"atelier.escalation.resolve",
			string(domain.EventTypeCollaborationInterruptResolved),
			map[string]interface{}{
				"interrupt_id":        "decision_1",
				"block_kind":          "decision_resolved",
				"choice":              "继续执行",
				"resume_payload_json": `{"choice":"继续执行"}`,
			},
		)
		return err
	})
	if err == nil {
		t.Fatal("expected resolve interrupt to reject paused task with running node")
	}
	var updated persistence.CollaborationTask
	if loadErr := db.First(&updated, "id = ?", task.ID).Error; loadErr != nil {
		t.Fatalf("load updated task: %v", loadErr)
	}
	if got := model.CollaborationTaskStatus(updated.Status); got != model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED {
		t.Fatalf("expected task to remain PAUSED, got %v", got)
	}
	var eventCount int64
	if countErr := db.Model(&persistence.TaskEvent{}).Where("task_id = ?", task.ID).Count(&eventCount).Error; countErr != nil {
		t.Fatalf("count task events: %v", countErr)
	}
	if eventCount != 0 {
		t.Fatalf("expected rejected resolve to persist no events, got %d", eventCount)
	}
	var interruptCount int64
	if countErr := db.Model(&persistence.InterruptRequest{}).Where("task_id = ?", task.ID).Count(&interruptCount).Error; countErr != nil {
		t.Fatalf("count interrupt requests: %v", countErr)
	}
	if interruptCount != 0 {
		t.Fatalf("expected rejected resolve to persist no interrupt requests, got %d", interruptCount)
	}
}

func TestResolveCollaborationInterruptWithLiveResumeTxWakesWaitingTurn(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "resolve_interrupt_live_waiter")
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-live-resume",
		Title:         "Resolve live waiter",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED),
		MetaJSON:      `{"existing":"kept"}`,
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	nodes := []persistence.CollaborationTaskNode{
		{
			ID:        "node-running",
			TaskID:    task.ID,
			AgentID:   "agent-1",
			Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
			StartedAt: now,
			EndedAt:   now,
		},
	}
	seedResumeCollaborationTask(t, db, task, nodes)

	writer := NewTaskEventWriter()
	if err := db.Transaction(func(tx *gorm.DB) error {
		_, err := writer.appendTx(
			context.Background(),
			tx,
			"",
			task.ID,
			"node-running",
			"turn-running",
			string(domain.EventTypeCollaborationInterruptRequested),
			map[string]interface{}{
				"interrupt_id":   "decision_live",
				"interrupt_type": "human_decision",
				"question":       "Continue?",
			},
		)
		return err
	}); err != nil {
		t.Fatalf("seed interrupt request: %v", err)
	}

	broker := NewLiveResumeBroker()
	resultCh, cleanup, err := broker.Register(task.ID, "node-running", "turn-running", "decision_live")
	if err != nil {
		t.Fatalf("register live resume waiter: %v", err)
	}
	defer cleanup()

	var resumed bool
	var liveDecision LiveResumeDecision
	if err := db.Transaction(func(tx *gorm.DB) error {
		var txErr error
		_, _, resumed, _, liveDecision, txErr = resolveCollaborationInterruptWithLiveResumeTx(
			context.Background(),
			tx,
			writer,
			"actor-1",
			task.ID,
			"atelier.escalation.resolve",
			string(domain.EventTypeCollaborationInterruptResolved),
			map[string]interface{}{
				"interrupt_id":        "decision_live",
				"block_kind":          "decision_resolved",
				"choice":              "继续执行",
				"resume_payload_json": `{"choice":"继续执行"}`,
			},
			broker,
		)
		return txErr
	}); err != nil {
		t.Fatalf("resolve live interrupt: %v", err)
	}
	if resumed {
		t.Fatal("expected live resume to wake existing turn without starting a new execution loop")
	}
	if liveDecision.InterruptID != "decision_live" || liveDecision.StepID != "node-running" || liveDecision.TurnID != "turn-running" {
		t.Fatalf("unexpected live decision: %+v", liveDecision)
	}
	if err := broker.Resolve(liveDecision); err != nil {
		t.Fatalf("deliver live decision: %v", err)
	}
	select {
	case delivered := <-resultCh:
		if delivered.EventSeq != 2 || delivered.ResumePayloadJSON != `{"choice":"继续执行"}` {
			t.Fatalf("unexpected delivered decision: %+v", delivered)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for live resume decision")
	}

	var updated persistence.CollaborationTask
	if err := db.First(&updated, "id = ?", task.ID).Error; err != nil {
		t.Fatalf("load updated task: %v", err)
	}
	if got := model.CollaborationTaskStatus(updated.Status); got != model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING {
		t.Fatalf("expected task status RUNNING, got %v", got)
	}
	var events []persistence.TaskEvent
	if err := db.Where("task_id = ?", task.ID).Order("event_seq ASC").Find(&events).Error; err != nil {
		t.Fatalf("load task events: %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("expected requested and resolved events, got %+v", events)
	}
	if got := model.TaskEventType(events[1].EventType); got != model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_RESOLVED {
		t.Fatalf("expected interrupt resolved event, got %v", got)
	}
	if events[1].StepID != "node-running" || events[1].TurnID != "turn-running" {
		t.Fatalf("expected resolved event to keep live step/turn linkage, got %+v", events[1])
	}
	var interrupt persistence.InterruptRequest
	if err := db.First(&interrupt, "interrupt_id = ?", "decision_live").Error; err != nil {
		t.Fatalf("load interrupt request: %v", err)
	}
	if interrupt.Status != int32(model.InterruptStatus_INTERRUPT_STATUS_RESOLVED) || interrupt.ResumePayloadJSON != `{"choice":"继续执行"}` {
		t.Fatalf("expected resolved interrupt lifecycle, got %+v", interrupt)
	}
	if err := markCollaborationResumeContextConsumed(context.Background(), db, "decision_live", liveDecision.StepID, liveDecision.TurnID); err != nil {
		t.Fatalf("mark live resume consumed: %v", err)
	}
	var consumed persistence.InterruptRequest
	if err := db.First(&consumed, "interrupt_id = ?", "decision_live").Error; err != nil {
		t.Fatalf("load consumed interrupt: %v", err)
	}
	if consumed.ConsumedAt == nil || consumed.ConsumedStepID != "node-running" || consumed.ConsumedTurnID != "turn-running" {
		t.Fatalf("expected consumed live resume context, got %+v", consumed)
	}
}

func TestStationHumanDecisionResumeToolConsumesLiveDecision(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "station_human_decision_resume_tool")
	injectOrchestrationServiceTestStore(t, db)
	now := time.Date(2026, 7, 6, 10, 0, 0, 0, time.UTC)
	if err := db.Create(&persistence.InterruptRequest{
		InterruptID:   "decision_tool",
		TaskID:        "task-live-tool",
		StepID:        "node-live-tool",
		TurnID:        "turn-live-tool",
		InterruptType: "human_decision",
		Status:        int32(model.InterruptStatus_INTERRUPT_STATUS_PENDING),
		PayloadJSON:   `{"question":"Continue live provider turn?"}`,
		CreatedAt:     now,
	}).Error; err != nil {
		t.Fatalf("seed pending interrupt: %v", err)
	}

	broker := NewLiveResumeBroker()
	svc := NewTurnService(nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	svc.SetLiveResumeBroker(broker)
	resultCh := make(chan struct {
		output string
		err    error
	}, 1)
	go func() {
		output, err := svc.executeStationHumanDecisionResumeTool(
			context.Background(),
			&TurnConfig{TaskID: "task-live-tool", StepID: "node-live-tool"},
			"turn-live-tool",
			toolCallEntry{
				ToolName:  "station_human_decision_resume",
				Arguments: `{"interrupt_id":"decision_tool"}`,
			},
		)
		resultCh <- struct {
			output string
			err    error
		}{output: output, err: err}
	}()

	deadline := time.Now().Add(time.Second)
	for !broker.HasWaiter("task-live-tool", "decision_tool") {
		if time.Now().After(deadline) {
			t.Fatal("timed out waiting for live resume waiter")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := broker.Resolve(LiveResumeDecision{
		TaskID:            "task-live-tool",
		StepID:            "node-live-tool",
		TurnID:            "turn-live-tool",
		InterruptID:       "decision_tool",
		EventID:           "event-resolved",
		EventSeq:          2,
		ResumePayloadJSON: `{"choice":"继续执行"}`,
	}); err != nil {
		t.Fatalf("resolve live decision: %v", err)
	}

	select {
	case result := <-resultCh:
		if result.err != nil {
			t.Fatalf("resume tool failed: %v", result.err)
		}
		if !strings.Contains(result.output, `"resume_source":"station.live_resume_broker"`) ||
			!strings.Contains(result.output, `"event_seq":2`) {
			t.Fatalf("unexpected resume tool output: %s", result.output)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for resume tool result")
	}

	var consumed persistence.InterruptRequest
	if err := db.First(&consumed, "interrupt_id = ?", "decision_tool").Error; err != nil {
		t.Fatalf("load consumed interrupt: %v", err)
	}
	if consumed.ConsumedAt == nil || consumed.ConsumedStepID != "node-live-tool" || consumed.ConsumedTurnID != "turn-live-tool" {
		t.Fatalf("expected live resume interrupt to be consumed, got %+v", consumed)
	}
}

func TestTaskEventWriterAppendTxPersistsInterruptLifecycle(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "interrupt_lifecycle_writer")
	writer := NewTaskEventWriter()
	if err := db.Transaction(func(tx *gorm.DB) error {
		_, err := writer.appendTx(
			context.Background(),
			tx,
			"",
			"task-interrupt-lifecycle",
			"step-1",
			"turn-1",
			string(domain.EventTypeCollaborationInterruptRequested),
			map[string]interface{}{
				"interrupt_id":   "decision_1",
				"interrupt_type": "human_decision",
				"question":       "Continue?",
			},
		)
		return err
	}); err != nil {
		t.Fatalf("append interrupt requested: %v", err)
	}
	var pending persistence.InterruptRequest
	if err := db.First(&pending, "interrupt_id = ?", "decision_1").Error; err != nil {
		t.Fatalf("load pending interrupt: %v", err)
	}
	if pending.Status != int32(model.InterruptStatus_INTERRUPT_STATUS_PENDING) {
		t.Fatalf("expected pending interrupt, got %d", pending.Status)
	}
	if pending.StepID != "step-1" || pending.TurnID != "turn-1" {
		t.Fatalf("expected step/turn linkage, got %+v", pending)
	}

	if err := db.Transaction(func(tx *gorm.DB) error {
		_, err := writer.appendTx(
			context.Background(),
			tx,
			"",
			"task-interrupt-lifecycle",
			"step-1",
			"turn-1",
			string(domain.EventTypeCollaborationInterruptResolved),
			map[string]interface{}{
				"interrupt_id":        "decision_1",
				"block_kind":          "decision_resolved",
				"resume_payload_json": `{"choice":"继续执行"}`,
			},
		)
		return err
	}); err != nil {
		t.Fatalf("append interrupt resolved: %v", err)
	}
	var resolved persistence.InterruptRequest
	if err := db.First(&resolved, "interrupt_id = ?", "decision_1").Error; err != nil {
		t.Fatalf("load resolved interrupt: %v", err)
	}
	if resolved.Status != int32(model.InterruptStatus_INTERRUPT_STATUS_RESOLVED) {
		t.Fatalf("expected resolved interrupt, got %d", resolved.Status)
	}
	if resolved.ResumePayloadJSON != `{"choice":"继续执行"}` || resolved.ResolvedAt == nil {
		t.Fatalf("expected resume payload and resolved timestamp, got %+v", resolved)
	}
}

func TestTaskEventWriterAppendTxPersistsTaskArtifactStore(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "artifact_store_writer")
	writer := NewTaskEventWriter()
	if err := db.Transaction(func(tx *gorm.DB) error {
		_, err := writer.appendTx(
			context.Background(),
			tx,
			"",
			"task-artifact-store",
			"step-artifact",
			"turn-artifact",
			string(domain.EventTypeCollaborationArtifactCreated),
			map[string]interface{}{
				"block_kind":   "artifact",
				"artifact_id":  "artifact-report",
				"run_id":       "run-provider",
				"kind":         "markdown",
				"name":         "Provider report",
				"uri":          "artifact://task-artifact-store/artifact-report",
				"checksum":     validArtifactChecksum,
				"produced_by":  "executor-1",
				"refs":         []string{"artifact-input", "artifact-source"},
				"markdown":     "## Report",
				"result_trace": "kept in payload",
			},
		)
		return err
	}); err != nil {
		t.Fatalf("append artifact event: %v", err)
	}
	var artifact persistence.TaskArtifact
	if err := db.First(&artifact, "artifact_id = ?", "artifact-report").Error; err != nil {
		t.Fatalf("load artifact store row: %v", err)
	}
	if artifact.TaskID != "task-artifact-store" ||
		artifact.StepID != "step-artifact" ||
		artifact.TurnID != "turn-artifact" ||
		artifact.EventSeq != 1 ||
		artifact.RunID != "run-provider" ||
		artifact.Kind != "markdown" ||
		artifact.Name != "Provider report" ||
		artifact.URI != "artifact://task-artifact-store/artifact-report" ||
		artifact.Checksum != validArtifactChecksum ||
		artifact.ProducedBy != "executor-1" {
		t.Fatalf("unexpected artifact store row: %+v", artifact)
	}
	if artifact.RefsJSON != `["artifact-input","artifact-source"]` {
		t.Fatalf("expected artifact refs to be indexed, got %s", artifact.RefsJSON)
	}
	if !strings.Contains(artifact.PayloadJSON, `"result_trace":"kept in payload"`) {
		t.Fatalf("expected raw payload to be preserved, got %s", artifact.PayloadJSON)
	}
	if strings.Contains(artifact.PayloadJSON, "## Report") || strings.Contains(artifact.PayloadJSON, `"markdown":`) {
		t.Fatalf("expected artifact payload to omit detached body, got %s", artifact.PayloadJSON)
	}
	var event persistence.TaskEvent
	if err := db.First(&event, "task_id = ?", "task-artifact-store").Error; err != nil {
		t.Fatalf("load artifact event: %v", err)
	}
	if strings.Contains(event.Payload, "## Report") || strings.Contains(event.Payload, `"markdown":`) {
		t.Fatalf("expected outbox payload to omit detached body, got %s", event.Payload)
	}
	for _, marker := range []string{
		`"body_ref":"artifact://task-artifact-store/artifact-report/body"`,
		`"body_kind":"markdown"`,
		`"body_retention_policy":"task_lifetime"`,
		`"preview_hint":"metadata_only"`,
		`"preview_target"`,
		`"mode":"sandbox_manifest"`,
		`"sandbox_ref":"atelier-sandbox://task-artifact-store/artifact-report/preview"`,
		`"body_ref":"artifact://task-artifact-store/artifact-report/body"`,
	} {
		if !strings.Contains(event.Payload, marker) {
			t.Fatalf("expected sanitized outbox payload to contain %s, got %s", marker, event.Payload)
		}
	}
	var blob persistence.TaskArtifactBlob
	if err := db.First(&blob, "blob_id = ?", "artifact-report:markdown").Error; err != nil {
		t.Fatalf("load artifact blob: %v", err)
	}
	if blob.TaskID != "task-artifact-store" ||
		blob.StepID != "step-artifact" ||
		blob.TurnID != "turn-artifact" ||
		blob.EventID != event.ID ||
		blob.EventSeq != event.EventSeq ||
		blob.BodyKind != "markdown" ||
		blob.BodyURI != "artifact://task-artifact-store/artifact-report/body" ||
		blob.RetentionPolicy != "task_lifetime" ||
		blob.RetentionStatus != "active" ||
		blob.BodyText != "## Report" ||
		blob.ByteSize != int64(len("## Report")) ||
		!strings.HasPrefix(blob.ContentHash, "sha256:") {
		t.Fatalf("unexpected artifact blob: %+v", blob)
	}
}

func TestTaskEventWriterAppendTxRejectsArtifactWithoutID(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "artifact_store_rejects_missing_id")
	writer := NewTaskEventWriter()
	err := db.Transaction(func(tx *gorm.DB) error {
		_, appendErr := writer.appendTx(
			context.Background(),
			tx,
			"",
			"task-artifact-store",
			"step-artifact",
			"turn-artifact",
			string(domain.EventTypeCollaborationArtifactCreated),
			map[string]interface{}{
				"block_kind": "artifact",
				"name":       "missing id",
			},
		)
		return appendErr
	})
	if err == nil {
		t.Fatal("expected artifact without artifact_id to be rejected")
	}
	var eventCount int64
	if countErr := db.Model(&persistence.TaskEvent{}).Where("task_id = ?", "task-artifact-store").Count(&eventCount).Error; countErr != nil {
		t.Fatalf("count task events: %v", countErr)
	}
	if eventCount != 0 {
		t.Fatalf("expected rejected artifact to roll back task event, got %d", eventCount)
	}
}

func TestTaskEventWriterAppendTxRejectsArtifactInvalidRefs(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "artifact_store_rejects_invalid_refs")
	writer := NewTaskEventWriter()
	err := db.Transaction(func(tx *gorm.DB) error {
		_, appendErr := writer.appendTx(
			context.Background(),
			tx,
			"",
			"task-artifact-store",
			"step-artifact",
			"turn-artifact",
			string(domain.EventTypeCollaborationArtifactCreated),
			map[string]interface{}{
				"block_kind":  "artifact",
				"artifact_id": "artifact-report",
				"uri":         "artifact://task-artifact-store/artifact-report",
				"checksum":    validArtifactChecksum,
				"refs":        []interface{}{"artifact-input", 42},
			},
		)
		return appendErr
	})
	if err == nil {
		t.Fatal("expected artifact invalid refs to be rejected")
	}
	var eventCount int64
	if countErr := db.Model(&persistence.TaskEvent{}).Where("task_id = ?", "task-artifact-store").Count(&eventCount).Error; countErr != nil {
		t.Fatalf("count task events: %v", countErr)
	}
	if eventCount != 0 {
		t.Fatalf("expected rejected artifact refs to roll back task event, got %d", eventCount)
	}
}

func TestCollaborationProjectionEventsFromNodeResultMeta(t *testing.T) {
	events, err := collaborationProjectionEventsFromNodeResultMeta(
		"task-provider",
		"node-provider",
		"executor-1",
		map[string]string{
			nodeResultArtifactsMetaKey: `[{
				"artifact_id":"artifact-report",
				"name":"Provider report",
				"kind":"markdown",
						"uri":"artifact://task-provider/artifact-report",
						"checksum":"sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
				"markdown":"## Report",
				"paths":["reports/provider.md"]
			}]`,
			nodeResultGatesMetaKey: `[{
				"gate_id":"gate-typecheck",
				"name":"Typecheck",
				"status":"passed",
				"summary":"tsc passed",
				"checks":[{"name":"tsc","status":"passed","detail":"tsc --noEmit"}],
				"artifactIds":["artifact-report"]
			}]`,
		},
	)
	if err != nil {
		t.Fatalf("parse node result projection events: %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("expected artifact and gate events, got %+v", events)
	}
	if events[0].EventType != domain.EventTypeCollaborationArtifactCreated {
		t.Fatalf("expected artifact event, got %s", events[0].EventType)
	}
	if events[0].Payload["block_kind"] != "artifact" ||
		events[0].Payload["source"] != "desktop_executor.node_result" ||
		events[0].Payload["task_id"] != "task-provider" ||
		events[0].Payload["node_id"] != "node-provider" ||
		events[0].Payload["produced_by"] != "executor-1" {
		t.Fatalf("unexpected artifact payload: %+v", events[0].Payload)
	}
	if events[1].EventType != domain.EventTypeCollaborationGateResult {
		t.Fatalf("expected gate event, got %s", events[1].EventType)
	}
	if events[1].Payload["block_kind"] != "gate_result" ||
		events[1].Payload["source"] != "desktop_executor.node_result" ||
		events[1].Payload["task_id"] != "task-provider" ||
		events[1].Payload["node_id"] != "node-provider" ||
		events[1].Payload["produced_by"] != "executor-1" {
		t.Fatalf("unexpected gate payload: %+v", events[1].Payload)
	}
}

func TestCollaborationProjectionEventsFromTypedNodeResultRequest(t *testing.T) {
	events, decision, err := collaborationProjectionEventsFromNodeResultRequest(
		"task-provider",
		"node-provider",
		"executor-1",
		&model.SubmitCollaborationNodeResultRequest{
			TaskId: "task-provider",
			NodeId: "node-provider",
			Artifacts: []*model.TaskArtifactRef{{
				ArtifactId: "artifact-report",
				Name:       "Provider report",
				Kind:       "markdown",
				Uri:        "artifact://task-provider/artifact-report",
				Checksum:   "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
				Refs:       []string{"artifact-input"},
			}},
			Gates: []*model.TaskGateResult{{
				GateId:      "gate-typecheck",
				Name:        "Typecheck",
				Status:      "failed",
				Summary:     "typecheck failed",
				ArtifactIds: []string{"artifact-report"},
				Blocking:    true,
				Checks: []*model.TaskGateCheck{{
					Name:   "tsc",
					Status: "failed",
					Detail: "tsc --noEmit",
				}},
			}},
		},
	)
	if err != nil {
		t.Fatalf("parse typed node result projection events: %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("expected typed artifact and gate events, got %+v", events)
	}
	if events[0].Payload["artifact_id"] != "artifact-report" ||
		events[0].Payload["produced_by"] != "executor-1" ||
		events[0].Payload["block_kind"] != "artifact" {
		t.Fatalf("unexpected typed artifact payload: %+v", events[0].Payload)
	}
	if events[1].Payload["gate_id"] != "gate-typecheck" ||
		events[1].Payload["blocking"] != true ||
		events[1].Payload["block_kind"] != "gate_result" {
		t.Fatalf("unexpected typed gate payload: %+v", events[1].Payload)
	}
	if !decision.Blocked || decision.GateID != "gate-typecheck" {
		t.Fatalf("expected blocking gate decision, got %+v", decision)
	}
}

func TestSubmitCollaborationNodeResultTypedFixturePersistsArtifactGateIndexes(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "submit_node_result_typed_fixture")
	injectOrchestrationServiceTestStore(t, db)
	now := time.Now().UTC()
	seedDesktopExecutorAgent(t, db, "actor-1", "agent-provider", now)
	task := persistence.CollaborationTask{
		ID:            "task-submit-typed",
		Title:         "Submit typed node result",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	node := persistence.CollaborationTaskNode{
		ID:        "node-submit-typed",
		TaskID:    task.ID,
		AgentID:   "agent-provider",
		Role:      "executor",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
		StartedAt: now,
		EndedAt:   now,
	}
	lease := persistence.ExecutorLease{
		LeaseID:      "lease-submit-typed",
		TaskID:       task.ID,
		StepID:       node.ID,
		ExecutorID:   "executor-desktop-1",
		ExecutorKind: int32(model.ExecutorKind_EXECUTOR_KIND_DESKTOP_DEVICE),
		Status:       executorLeaseStatusActive,
		AcquiredAt:   now,
		HeartbeatAt:  now,
		ExpiresAt:    now.Add(time.Minute),
	}
	seedResumeCollaborationTask(t, db, task, []persistence.CollaborationTaskNode{node})
	if err := db.Create(&lease).Error; err != nil {
		t.Fatalf("create lease: %v", err)
	}

	svc := NewOrchestrationService(NewAgentService(), nil, nil)
	taskResult, nodesResult, err := svc.submitCollaborationNodeResultAfterCanvasReadiness(context.Background(), "actor-1", &model.SubmitCollaborationNodeResultRequest{
		TaskId:        task.ID,
		NodeId:        node.ID,
		LeaseId:       lease.LeaseID,
		ExecutorId:    lease.ExecutorID,
		TurnId:        "turn-submit-typed",
		ResultSummary: "desktop executor produced typed evidence",
		Status:        "completed",
		Artifacts: []*model.TaskArtifactRef{{
			ArtifactId: "artifact-report",
			Kind:       "markdown",
			Name:       "Provider report",
			Uri:        "artifact://task-submit-typed/artifact-report",
			Checksum:   validArtifactChecksum,
			Refs:       []string{"artifact-input", "artifact-source"},
			Paths:      []string{"reports/provider.md"},
			Markdown:   "## Report",
			Meta:       `{"run_id":"run-provider"}`,
			Size:       "9",
		}},
		Gates: []*model.TaskGateResult{{
			GatePlanId:  "plan-submit-typed",
			GateId:      "gate-typecheck",
			Name:        "Typecheck",
			Status:      "failed",
			Summary:     "tsc failed",
			ArtifactIds: []string{"artifact-report"},
			Blocking:    true,
			Checks: []*model.TaskGateCheck{{
				Name:   "tsc",
				Status: "failed",
				Detail: "tsc --noEmit",
			}},
		}},
	})
	if err != nil {
		t.Fatalf("submit typed node result: %v", err)
	}
	if taskResult.GetStatus() != model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED {
		t.Fatalf("expected blocking gate to pause task, got %v", taskResult.GetStatus())
	}
	if len(nodesResult) != 1 || nodesResult[0].GetStatus() != model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED {
		t.Fatalf("expected completed node result, got %+v", nodesResult)
	}

	var storedTask persistence.CollaborationTask
	if err := db.First(&storedTask, "id = ?", task.ID).Error; err != nil {
		t.Fatalf("load task: %v", err)
	}
	if model.CollaborationTaskStatus(storedTask.Status) != model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED ||
		!strings.Contains(storedTask.MetaJSON, `"gate_blocked":"true"`) ||
		!strings.Contains(storedTask.MetaJSON, `"gate_blocked_id":"gate-typecheck"`) {
		t.Fatalf("expected task blocked by typed gate, got %+v meta=%s", storedTask, storedTask.MetaJSON)
	}
	var storedLease persistence.ExecutorLease
	if err := db.First(&storedLease, "lease_id = ?", lease.LeaseID).Error; err != nil {
		t.Fatalf("load lease: %v", err)
	}
	if storedLease.Status != executorLeaseStatusReleased {
		t.Fatalf("expected released lease, got %+v", storedLease)
	}
	var records []persistence.TaskEvent
	if err := db.Where("task_id = ?", task.ID).Order("event_seq ASC").Find(&records).Error; err != nil {
		t.Fatalf("load task events: %v", err)
	}
	if len(records) != 5 {
		t.Fatalf("expected node, artifact, gate, interrupt, lease events, got %+v", records)
	}
	wantTypes := []model.TaskEventType{
		model.TaskEventType_TASK_EVENT_TYPE_STEP_COMPLETED,
		model.TaskEventType_TASK_EVENT_TYPE_ARTIFACT_CREATED,
		model.TaskEventType_TASK_EVENT_TYPE_GATE_RESULT,
		model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_REQUESTED,
		model.TaskEventType_TASK_EVENT_TYPE_EXECUTOR_RELEASED,
	}
	for index, record := range records {
		if got := model.TaskEventType(record.EventType); got != wantTypes[index] {
			t.Fatalf("expected event type %v at index %d, got %v", wantTypes[index], index, got)
		}
		if record.EventSeq != int64(index+1) {
			t.Fatalf("expected seq %d, got %d", index+1, record.EventSeq)
		}
	}
	interruptPayload := map[string]interface{}{}
	if err := json.Unmarshal([]byte(records[3].Payload), &interruptPayload); err != nil {
		t.Fatalf("decode blocking gate interrupt payload: %v", err)
	}
	if interruptPayload["source"] != "station.gate_runner" ||
		interruptPayload["interrupt_type"] != "human_decision" ||
		interruptPayload["reason"] != "gate_blocked" ||
		interruptPayload["gate_id"] != "gate-typecheck" ||
		interruptPayload["node_id"] != node.ID {
		t.Fatalf("unexpected blocking gate escalation payload: %+v", interruptPayload)
	}
	options, ok := interruptPayload["options"].([]interface{})
	if !ok || len(options) != 4 {
		t.Fatalf("expected typed human decision options, got %+v", interruptPayload["options"])
	}
	firstOption, ok := options[0].(map[string]interface{})
	if !ok || firstOption["action"] != "rerun_failed_node" || firstOption["recommended"] != true {
		t.Fatalf("expected recommended rerun_failed_node option, got %+v", firstOption)
	}
	var interrupt persistence.InterruptRequest
	if err := db.First(&interrupt, "task_id = ? AND interrupt_type = ?", task.ID, "human_decision").Error; err != nil {
		t.Fatalf("load blocking gate pending interrupt: %v", err)
	}
	if interrupt.Status != int32(model.InterruptStatus_INTERRUPT_STATUS_PENDING) ||
		!strings.Contains(interrupt.PayloadJSON, `"action":"rerun_failed_node"`) {
		t.Fatalf("unexpected blocking gate pending interrupt: %+v payload=%s", interrupt, interrupt.PayloadJSON)
	}
	var artifact persistence.TaskArtifact
	if err := db.First(&artifact, "artifact_id = ?", "artifact-report").Error; err != nil {
		t.Fatalf("load artifact index: %v", err)
	}
	if artifact.TaskID != task.ID ||
		artifact.StepID != node.ID ||
		artifact.URI != "artifact://task-submit-typed/artifact-report" ||
		artifact.Checksum != validArtifactChecksum ||
		artifact.ProducedBy != lease.ExecutorID ||
		artifact.RefsJSON != `["artifact-input","artifact-source"]` {
		t.Fatalf("unexpected artifact index: %+v", artifact)
	}
	if strings.Contains(artifact.PayloadJSON, "## Report") || strings.Contains(artifact.PayloadJSON, `"markdown":`) {
		t.Fatalf("expected artifact index payload to redact body, got %s", artifact.PayloadJSON)
	}
	var blob persistence.TaskArtifactBlob
	if err := db.First(&blob, "artifact_id = ?", "artifact-report").Error; err != nil {
		t.Fatalf("load artifact blob: %v", err)
	}
	if blob.BodyText != "## Report" || blob.BodyURI != "artifact://task-submit-typed/artifact-report/body" {
		t.Fatalf("unexpected artifact blob: %+v", blob)
	}
	var gate persistence.TaskGateResult
	if err := db.First(&gate, "gate_id = ?", "gate-typecheck").Error; err != nil {
		t.Fatalf("load gate result index: %v", err)
	}
	if gate.TaskID != task.ID ||
		gate.StepID != node.ID ||
		gate.GatePlanID != "plan-submit-typed" ||
		gate.Status != "failed" ||
		!gate.Blocking ||
		gate.ProducedBy != lease.ExecutorID ||
		!strings.Contains(gate.ArtifactIDsJSON, "artifact-report") ||
		!strings.Contains(gate.ChecksJSON, "tsc") {
		t.Fatalf("unexpected gate result index: %+v", gate)
	}
}

func TestSubmitCollaborationNodeResultRejectsTypedInvalidArtifactRefsBeforeMutation(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "submit_node_result_invalid_refs")
	injectOrchestrationServiceTestStore(t, db)
	now := time.Now().UTC()
	seedDesktopExecutorAgent(t, db, "actor-1", "agent-provider", now)
	task := persistence.CollaborationTask{
		ID:            "task-submit-invalid-refs",
		Title:         "Submit invalid refs",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	node := persistence.CollaborationTaskNode{
		ID:        "node-submit-invalid-refs",
		TaskID:    task.ID,
		AgentID:   "agent-provider",
		Role:      "executor",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
		StartedAt: now,
		EndedAt:   now,
	}
	lease := persistence.ExecutorLease{
		LeaseID:      "lease-submit-invalid-refs",
		TaskID:       task.ID,
		StepID:       node.ID,
		ExecutorID:   "executor-desktop-1",
		ExecutorKind: int32(model.ExecutorKind_EXECUTOR_KIND_DESKTOP_DEVICE),
		Status:       executorLeaseStatusActive,
		AcquiredAt:   now,
		HeartbeatAt:  now,
		ExpiresAt:    now.Add(time.Minute),
	}
	seedResumeCollaborationTask(t, db, task, []persistence.CollaborationTaskNode{node})
	if err := db.Create(&lease).Error; err != nil {
		t.Fatalf("create lease: %v", err)
	}
	svc := NewOrchestrationService(NewAgentService(), nil, nil)

	for _, refs := range [][]string{
		{"artifact-report"},
		{"artifact://task-submit-invalid-refs/artifact-input"},
		{""},
	} {
		_, _, err := svc.submitCollaborationNodeResultAfterCanvasReadiness(context.Background(), "actor-1", &model.SubmitCollaborationNodeResultRequest{
			TaskId:        task.ID,
			NodeId:        node.ID,
			LeaseId:       lease.LeaseID,
			ExecutorId:    lease.ExecutorID,
			TurnId:        "turn-submit-invalid-refs",
			ResultSummary: "invalid refs should be rejected",
			Status:        "completed",
			Artifacts: []*model.TaskArtifactRef{{
				ArtifactId: "artifact-report",
				Kind:       "markdown",
				Name:       "Provider report",
				Uri:        "artifact://task-submit-invalid-refs/artifact-report",
				Checksum:   validArtifactChecksum,
				Refs:       refs,
			}},
		})
		if err == nil {
			t.Fatalf("expected typed artifact refs %q to be rejected", refs)
		}
	}
	var storedNode persistence.CollaborationTaskNode
	if err := db.First(&storedNode, "id = ?", node.ID).Error; err != nil {
		t.Fatalf("load node: %v", err)
	}
	if model.TaskNodeStatus(storedNode.Status) != model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING {
		t.Fatalf("expected node to remain running, got %+v", storedNode)
	}
	var storedLease persistence.ExecutorLease
	if err := db.First(&storedLease, "lease_id = ?", lease.LeaseID).Error; err != nil {
		t.Fatalf("load lease: %v", err)
	}
	if storedLease.Status != executorLeaseStatusActive {
		t.Fatalf("expected lease to remain active, got %+v", storedLease)
	}
	var eventCount int64
	if err := db.Model(&persistence.TaskEvent{}).Where("task_id = ?", task.ID).Count(&eventCount).Error; err != nil {
		t.Fatalf("count task events: %v", err)
	}
	if eventCount != 0 {
		t.Fatalf("expected invalid typed refs to leave outbox empty, got %d events", eventCount)
	}
}

func TestGateRunnerAppendsBlockingGateResultOutbox(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "gate_runner_blocking_outbox")
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-gate-runner",
		Title:         "Gate runner",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	node := persistence.CollaborationTaskNode{
		ID:        "node-gate-runner",
		TaskID:    task.ID,
		AgentID:   "agent-runner",
		Role:      "executor",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
		StartedAt: now,
		EndedAt:   now,
	}
	seedResumeCollaborationTask(t, db, task, []persistence.CollaborationTaskNode{node})

	runner := NewGateRunner(nil)
	writer := NewTaskEventWriter()
	var decision nodeResultGateDecision
	if err := db.Transaction(func(tx *gorm.DB) error {
		_, gateDecision, err := runner.RunAndAppendTx(
			context.Background(),
			tx,
			writer,
			node.AgentID,
			GateRunRequest{
				Task:        &task,
				Node:        &node,
				ProducedBy:  "station.gate_runner",
				GateID:      "gate-contract",
				Name:        "Contract Gate",
				Blocking:    true,
				ArtifactIDs: []string{"artifact-report"},
				Checks: []GateCheck{{
					Name:   "contract",
					Type:   "failed",
					Detail: "contract gate failed",
				}},
			},
		)
		decision = gateDecision
		return err
	}); err != nil {
		t.Fatalf("append gate runner result: %v", err)
	}
	if !decision.Blocked || decision.GateID != "gate-contract" {
		t.Fatalf("expected blocking gate decision, got %+v", decision)
	}

	var records []persistence.TaskEvent
	if err := db.Where("task_id = ?", task.ID).Order("event_seq ASC").Find(&records).Error; err != nil {
		t.Fatalf("load task events: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("expected one gate result event, got %+v", records)
	}
	if got := model.TaskEventType(records[0].EventType); got != model.TaskEventType_TASK_EVENT_TYPE_GATE_RESULT {
		t.Fatalf("expected gate result event type, got %v", got)
	}
	payload := map[string]interface{}{}
	if err := json.Unmarshal([]byte(records[0].Payload), &payload); err != nil {
		t.Fatalf("decode gate payload: %v", err)
	}
	if payload["source"] != "station.gate_runner" ||
		payload["gate_id"] != "gate-contract" ||
		payload["status"] != "failed" ||
		payload["blocking"] != true {
		t.Fatalf("unexpected gate runner payload: %+v", payload)
	}
	var indexed persistence.TaskGateResult
	if err := db.First(&indexed, "event_id = ?", records[0].ID).Error; err != nil {
		t.Fatalf("load indexed gate result: %v", err)
	}
	if indexed.TaskID != task.ID ||
		indexed.StepID != node.ID ||
		indexed.EventSeq != records[0].EventSeq ||
		indexed.GateID != "gate-contract" ||
		indexed.Status != "failed" ||
		!indexed.Blocking ||
		indexed.ProducedBy != "station.gate_runner" ||
		!strings.Contains(indexed.ArtifactIDsJSON, "artifact-report") ||
		!strings.Contains(indexed.ChecksJSON, "contract") {
		t.Fatalf("unexpected indexed gate result: %+v", indexed)
	}
}

func TestTaskEventWriterIndexesLegacyGateResultTurnEvent(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "gate_result_legacy_index")
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-legacy-gate",
		Title:         "Legacy gate",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	node := persistence.CollaborationTaskNode{
		ID:        "node-legacy-gate",
		TaskID:    task.ID,
		AgentID:   "agent-legacy",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
		StartedAt: now,
		EndedAt:   now,
	}
	seedResumeCollaborationTask(t, db, task, []persistence.CollaborationTaskNode{node})

	writer := NewTaskEventWriter()
	var record *persistence.TaskEvent
	if err := db.Transaction(func(tx *gorm.DB) error {
		var err error
		record, err = writer.appendTx(
			context.Background(),
			tx,
			"evt-legacy-gate",
			task.ID,
			node.ID,
			"turn-1",
			string(domain.EventTypeAgentTurnCompleted),
			map[string]interface{}{
				"block_kind":      "gate_result",
				"gate_id":         "gate-legacy",
				"gate_plan_id":    "plan-legacy",
				"name":            "Legacy Gate",
				"status":          "passed",
				"summary":         "legacy gate passed",
				"artifactIds":     []interface{}{"artifact-legacy"},
				"checks":          []interface{}{map[string]interface{}{"name": "legacy", "status": "passed"}},
				"produced_by":     "legacy.turn",
				"unrelated_field": "kept in payload",
			},
		)
		return err
	}); err != nil {
		t.Fatalf("append legacy gate result: %v", err)
	}
	if got := model.TaskEventType(record.EventType); got != model.TaskEventType_TASK_EVENT_TYPE_TURN_EVENT {
		t.Fatalf("expected legacy turn event type, got %v", got)
	}

	var indexed persistence.TaskGateResult
	if err := db.First(&indexed, "gate_result_id = ?", "evt-legacy-gate").Error; err != nil {
		t.Fatalf("load legacy indexed gate result: %v", err)
	}
	if indexed.TaskID != task.ID ||
		indexed.StepID != node.ID ||
		indexed.TurnID != "turn-1" ||
		indexed.EventSeq != record.EventSeq ||
		indexed.GateID != "gate-legacy" ||
		indexed.GatePlanID != "plan-legacy" ||
		indexed.Status != "passed" ||
		indexed.Blocking ||
		indexed.ProducedBy != "legacy.turn" ||
		!strings.Contains(indexed.ArtifactIDsJSON, "artifact-legacy") ||
		!strings.Contains(indexed.ChecksJSON, "legacy") ||
		!strings.Contains(indexed.PayloadJSON, "unrelated_field") {
		t.Fatalf("unexpected legacy indexed gate result: %+v", indexed)
	}
}

func TestPurgeAtelierTaskRecordsTxDeletesDurableIndexes(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "purge_atelier_indexes")
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-purge-indexes",
		Title:         "Purge indexes",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_CANCELLED),
		MetaJSON:      `{"atelier_status":"deleted"}`,
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	otherTask := persistence.CollaborationTask{
		ID:            "task-keep-indexes",
		Title:         "Keep indexes",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	seedResumeCollaborationTask(t, db, task, []persistence.CollaborationTaskNode{{
		ID:        "node-purge",
		TaskID:    task.ID,
		AgentID:   "agent-1",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
		StartedAt: now,
		EndedAt:   now,
	}})
	seedResumeCollaborationTask(t, db, otherTask, []persistence.CollaborationTaskNode{{
		ID:        "node-keep",
		TaskID:    otherTask.ID,
		AgentID:   "agent-1",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING),
		StartedAt: now,
		EndedAt:   now,
	}})
	if err := db.Create(&persistence.TaskEvent{
		ID:        "evt-purge",
		TaskID:    task.ID,
		EventSeq:  1,
		EventType: int32(model.TaskEventType_TASK_EVENT_TYPE_GATE_RESULT),
		Payload:   `{"block_kind":"gate_result","gate_id":"gate-purge"}`,
		CreatedAt: now,
	}).Error; err != nil {
		t.Fatalf("seed task event: %v", err)
	}
	if err := db.Create(&persistence.InterruptRequest{
		InterruptID: "interrupt-purge",
		TaskID:      task.ID,
		Status:      int32(model.InterruptStatus_INTERRUPT_STATUS_PENDING),
		CreatedAt:   now,
	}).Error; err != nil {
		t.Fatalf("seed interrupt request: %v", err)
	}
	if err := db.Create(&persistence.TaskArtifact{
		ArtifactID: "artifact-purge",
		TaskID:     task.ID,
		EventID:    "evt-purge",
		EventSeq:   1,
		CreatedAt:  now,
	}).Error; err != nil {
		t.Fatalf("seed task artifact: %v", err)
	}
	if err := db.Create(&persistence.TaskArtifactBlob{
		BlobID:          "artifact-purge:markdown",
		ArtifactID:      "artifact-purge",
		TaskID:          task.ID,
		EventID:         "evt-purge",
		EventSeq:        1,
		BodyKind:        "markdown",
		BodyURI:         "artifact://task-purge-indexes/artifact-purge/body",
		ContentHash:     "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		ByteSize:        9,
		RetentionPolicy: "task_lifetime",
		RetentionStatus: "active",
		BodyText:        "## Purge",
		CreatedAt:       now,
	}).Error; err != nil {
		t.Fatalf("seed task artifact blob: %v", err)
	}
	if err := db.Create(&persistence.TaskBudgetUsage{
		BudgetUsageID: "budget-usage-purge",
		TaskID:        task.ID,
		StepID:        "node-purge",
		EventID:       "evt-purge",
		EventSeq:      1,
		BudgetID:      "budget-purge",
		DirectRunID:   "direct-run-purge",
		ProviderID:    "agent-1",
		Model:         "gpt-4.1",
		InputTokens:   10,
		OutputTokens:  20,
		TotalTokens:   30,
		Source:        "station.direct_run",
		CreatedAt:     now,
	}).Error; err != nil {
		t.Fatalf("seed task budget usage: %v", err)
	}
	if err := db.Create(&persistence.TaskProviderPlan{
		ProviderPlanID: "provider-plan-purge",
		TaskID:         task.ID,
		Source:         "typed_request",
		Status:         "active",
		PlanJSON:       `{"providers":[{"agentId":"agent-1"}]}`,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed provider plan: %v", err)
	}
	if err := db.Create(&persistence.DirectRun{
		DirectRunID:       "direct-run-purge",
		TaskID:            task.ID,
		ProviderID:        "agent-1",
		ModelIntent:       "gpt-4.1",
		InputSnapshotJSON: `{"task_id":"task-purge-indexes"}`,
		BudgetRef:         "budget-purge",
		PolicyRef:         "policy-purge",
		TraceID:           "trace-purge",
		State:             "pending_station_provider_route",
		Source:            "atelier.direct_run.intent",
		CreatedAt:         now,
		UpdatedAt:         now,
	}).Error; err != nil {
		t.Fatalf("seed direct run: %v", err)
	}
	if err := db.Create(&persistence.TaskGatePlan{
		GatePlanID: "plan-purge",
		TaskID:     task.ID,
		StepID:     "node-purge",
		Status:     "blocked",
		PlanJSON:   "{}",
		CreatedAt:  now,
		UpdatedAt:  now,
	}).Error; err != nil {
		t.Fatalf("seed gate plan: %v", err)
	}
	if err := db.Create(&persistence.TaskGateResult{
		GateResultID: "evt-purge",
		TaskID:       task.ID,
		StepID:       "node-purge",
		EventID:      "evt-purge",
		EventSeq:     1,
		GateID:       "gate-purge",
		Status:       "failed",
		Blocking:     true,
		CreatedAt:    now,
	}).Error; err != nil {
		t.Fatalf("seed gate result: %v", err)
	}
	if err := db.Create(&persistence.TaskGateResult{
		GateResultID: "evt-keep",
		TaskID:       otherTask.ID,
		EventID:      "evt-keep",
		EventSeq:     1,
		GateID:       "gate-keep",
		Status:       "passed",
		CreatedAt:    now,
	}).Error; err != nil {
		t.Fatalf("seed kept gate result: %v", err)
	}
	if err := db.Create(&persistence.ProjectBlocker{
		BlockerID:      "blocker-purge",
		TaskID:         task.ID,
		Scope:          "project",
		Owner:          "verifier",
		Severity:       "block",
		State:          "open",
		SourceEventID:  "evt-purge",
		SourceEventSeq: 1,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed project blocker: %v", err)
	}
	if err := db.Create(&persistence.ProjectResidualRisk{
		RiskID:         "risk-purge",
		TaskID:         task.ID,
		Description:    "purge risk",
		State:          "logged",
		Owner:          "risk",
		SourceEventID:  "evt-purge",
		SourceEventSeq: 1,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed project residual risk: %v", err)
	}
	if err := db.Create(&persistence.ProjectState{
		ProjectID:      "project-purge",
		TaskID:         task.ID,
		ProjectState:   "executing",
		MilestoneState: "active",
		SourceEventID:  "evt-purge",
		SourceEventSeq: 1,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed project state: %v", err)
	}
	if err := db.Create(&persistence.AtelierMilestone{
		MilestoneID:                "milestone-purge",
		TaskID:                     task.ID,
		Title:                      "Purge milestone",
		State:                      "active",
		TaskIDsJSON:                `["node-purge"]`,
		AcceptancePredicateIDsJSON: `["predicate-purge"]`,
		SourceEventID:              "evt-purge",
		SourceEventSeq:             1,
		CreatedAt:                  now,
		UpdatedAt:                  now,
	}).Error; err != nil {
		t.Fatalf("seed atelier milestone: %v", err)
	}
	if err := db.Create(&persistence.AtelierTaskGraphNode{
		NodeID:          "node-purge",
		TaskID:          task.ID,
		MilestoneID:     "milestone-purge",
		Title:           "Purge node",
		State:           "todo",
		AgentRole:       "executor",
		ArtifactIDsJSON: `["artifact-purge"]`,
		GateIDsJSON:     `["gate-purge"]`,
		SourceEventID:   "evt-purge",
		SourceEventSeq:  1,
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Error; err != nil {
		t.Fatalf("seed atelier task graph node: %v", err)
	}
	if err := db.Create(&persistence.AtelierTaskGraphEdge{
		EdgeID:         "edge-purge",
		TaskID:         task.ID,
		FromID:         "node-prereq",
		ToID:           "node-purge",
		Type:           "blocks",
		SourceEventID:  "evt-purge",
		SourceEventSeq: 1,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed atelier task graph edge: %v", err)
	}
	if err := db.Create(&persistence.AtelierPolicy{
		PolicyProjectionID: "task-purge:policy-purge",
		PolicyID:           "policy-purge",
		TaskID:             task.ID,
		HardDeny:           true,
		SourceEventID:      "evt-purge",
		SourceEventSeq:     1,
		CreatedAt:          now,
		UpdatedAt:          now,
	}).Error; err != nil {
		t.Fatalf("seed atelier policy: %v", err)
	}
	if err := db.Create(&persistence.AtelierPolicyRule{
		RuleID:         "policy-purge:default",
		PolicyID:       "policy-purge",
		TaskID:         task.ID,
		Scope:          "project",
		Expr:           "policy_hard_deny == true",
		Severity:       "block",
		SourceEventID:  "evt-purge",
		SourceEventSeq: 1,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed atelier policy rule: %v", err)
	}
	if err := db.Create(&persistence.AtelierDefect{
		DefectID:       "defect-purge",
		TaskID:         task.ID,
		Source:         "gate",
		State:          "proposed",
		EvidenceRef:    "artifact-purge",
		Summary:        "purge defect",
		ExpectedChange: "fix purge",
		TargetRefsJSON: `["node-purge"]`,
		SourceEventID:  "evt-purge",
		SourceEventSeq: 1,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed atelier defect: %v", err)
	}
	accepted := true
	if err := db.Create(&persistence.AcceptancePredicate{
		PredicateID:    "predicate-purge",
		TaskID:         task.ID,
		Scope:          "project",
		Level:          "L1",
		Evaluator:      "verifier",
		Expr:           "typecheck.passed",
		LastEval:       &accepted,
		SourceEventID:  "evt-purge",
		SourceEventSeq: 1,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("seed acceptance predicate: %v", err)
	}

	if err := db.Transaction(func(tx *gorm.DB) error {
		return purgeAtelierTaskRecordsTx(context.Background(), tx, "actor-1", task.ID)
	}); err != nil {
		t.Fatalf("purge task records: %v", err)
	}

	for _, item := range []struct {
		label string
		model interface{}
		where string
	}{
		{label: "task", model: &persistence.CollaborationTask{}, where: "id = ?"},
		{label: "node", model: &persistence.CollaborationTaskNode{}, where: "task_id = ?"},
		{label: "event", model: &persistence.TaskEvent{}, where: "task_id = ?"},
		{label: "interrupt", model: &persistence.InterruptRequest{}, where: "task_id = ?"},
		{label: "artifact", model: &persistence.TaskArtifact{}, where: "task_id = ?"},
		{label: "artifact blob", model: &persistence.TaskArtifactBlob{}, where: "task_id = ?"},
		{label: "budget usage", model: &persistence.TaskBudgetUsage{}, where: "task_id = ?"},
		{label: "provider plan", model: &persistence.TaskProviderPlan{}, where: "task_id = ?"},
		{label: "direct run", model: &persistence.DirectRun{}, where: "task_id = ?"},
		{label: "gate plan", model: &persistence.TaskGatePlan{}, where: "task_id = ?"},
		{label: "gate result", model: &persistence.TaskGateResult{}, where: "task_id = ?"},
		{label: "atelier milestone", model: &persistence.AtelierMilestone{}, where: "task_id = ?"},
		{label: "atelier task graph node", model: &persistence.AtelierTaskGraphNode{}, where: "task_id = ?"},
		{label: "atelier task graph edge", model: &persistence.AtelierTaskGraphEdge{}, where: "task_id = ?"},
		{label: "atelier policy", model: &persistence.AtelierPolicy{}, where: "task_id = ?"},
		{label: "atelier policy rule", model: &persistence.AtelierPolicyRule{}, where: "task_id = ?"},
		{label: "atelier defect", model: &persistence.AtelierDefect{}, where: "task_id = ?"},
		{label: "project state", model: &persistence.ProjectState{}, where: "task_id = ?"},
		{label: "acceptance predicate", model: &persistence.AcceptancePredicate{}, where: "task_id = ?"},
		{label: "project blocker", model: &persistence.ProjectBlocker{}, where: "task_id = ?"},
		{label: "project residual risk", model: &persistence.ProjectResidualRisk{}, where: "task_id = ?"},
	} {
		var count int64
		if err := db.Model(item.model).Where(item.where, task.ID).Count(&count).Error; err != nil {
			t.Fatalf("count %s records: %v", item.label, err)
		}
		if count != 0 {
			t.Fatalf("expected purged %s records, got %d", item.label, count)
		}
	}
	var keptGateResults int64
	if err := db.Model(&persistence.TaskGateResult{}).Where("task_id = ?", otherTask.ID).Count(&keptGateResults).Error; err != nil {
		t.Fatalf("count kept gate results: %v", err)
	}
	if keptGateResults != 1 {
		t.Fatalf("expected unrelated gate result to remain, got %d", keptGateResults)
	}
}

func TestGateRunnerPassedGateDoesNotBlock(t *testing.T) {
	task := &persistence.CollaborationTask{ID: "task-gate-pass"}
	node := &persistence.CollaborationTaskNode{ID: "node-gate-pass", TaskID: task.ID, AgentID: "agent-runner"}
	result, err := NewGateRunner(nil).Run(context.Background(), GateRunRequest{
		Task:     task,
		Node:     node,
		GateID:   "gate-contract",
		Name:     "Contract Gate",
		Blocking: true,
		Checks: []GateCheck{{
			Name: "contract",
			Type: "passed",
		}},
	})
	if err != nil {
		t.Fatalf("run gate: %v", err)
	}
	if result.Decision.Blocked {
		t.Fatalf("expected passed blocking gate not to block, got %+v", result.Decision)
	}
	if result.Event.EventType != domain.EventTypeCollaborationGateResult ||
		result.Payload["status"] != "passed" ||
		result.Payload["source"] != "station.gate_runner" {
		t.Fatalf("unexpected gate result: %+v", result)
	}
}

func TestCollaborationProjectionEventsFromNodeResultMetaRejectsInvalidTypes(t *testing.T) {
	_, err := collaborationProjectionEventsFromNodeResultMeta(
		"task-provider",
		"node-provider",
		"executor-1",
		map[string]string{
			nodeResultArtifactsMetaKey: `{"artifact_id":"artifact-report","paths":[42]}`,
		},
	)
	if err == nil {
		t.Fatal("expected invalid artifact paths to be rejected")
	}

	_, err = collaborationProjectionEventsFromNodeResultMeta(
		"task-provider",
		"node-provider",
		"executor-1",
		map[string]string{
			nodeResultGatesMetaKey: `{"gate_id":"gate-typecheck","checks":[{"name":"tsc","status":true}]}`,
		},
	)
	if err == nil {
		t.Fatal("expected invalid gate check status to be rejected")
	}

	_, err = collaborationProjectionEventsFromNodeResultMeta(
		"task-provider",
		"node-provider",
		"executor-1",
		map[string]string{
			nodeResultArtifactsMetaKey: `{"artifact_id":"artifact-report","refs":[42]}`,
		},
	)
	if err == nil {
		t.Fatal("expected invalid artifact refs to be rejected")
	}
}

func TestCollaborationProjectionEventsFromNodeResultMetaRejectsArtifactPolicy(t *testing.T) {
	_, err := collaborationProjectionEventsFromNodeResultMeta(
		"task-provider",
		"node-provider",
		"executor-1",
		map[string]string{
			nodeResultArtifactsMetaKey: `{"artifact_id":"artifact-report","kind":"markdown","checksum":"sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}`,
		},
	)
	if err == nil {
		t.Fatal("expected artifact without uri to be rejected")
	}

	_, err = collaborationProjectionEventsFromNodeResultMeta(
		"task-provider",
		"node-provider",
		"executor-1",
		map[string]string{
			nodeResultArtifactsMetaKey: `{"artifact_id":"artifact-report","kind":"markdown","uri":"artifact://task-provider/artifact-report","checksum":"sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","refs":["artifact-report"]}`,
		},
	)
	if err == nil {
		t.Fatal("expected artifact self-ref to be rejected")
	}
}

func TestNodeResultProjectionEventsMapToAtelierArtifactAndGate(t *testing.T) {
	events, err := collaborationProjectionEventsFromNodeResultMeta(
		"task-provider",
		"node-provider",
		"executor-1",
		map[string]string{
			nodeResultArtifactsMetaKey: `{"artifact_id":"artifact-report","name":"Provider report","kind":"markdown","uri":"artifact://task-provider/artifact-report","checksum":"sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","markdown":"## Report"}`,
			nodeResultGatesMetaKey:     `{"gate_id":"gate-typecheck","name":"Typecheck","status":"passed","summary":"tsc passed","artifactIds":["artifact-report"]}`,
		},
	)
	if err != nil {
		t.Fatalf("parse node result projection events: %v", err)
	}
	artifactPayload, _ := json.Marshal(events[0].Payload)
	artifactEvent := &model.TaskEvent{
		EventId:     "evt-artifact",
		TaskId:      "task-provider",
		EventSeq:    1,
		Type:        model.TaskEventType_TASK_EVENT_TYPE_ARTIFACT_CREATED,
		PayloadJson: string(artifactPayload),
	}
	artifactProjection, ok := BuildAtelierProjectionEvent(artifactEvent)
	if !ok {
		t.Fatal("expected artifact event to project")
	}
	if artifactProjection.Patch.Kind != "artifact.upsert" ||
		artifactProjection.Patch.Artifact == nil ||
		artifactProjection.Patch.Artifact.ID != "artifact-report" {
		t.Fatalf("unexpected artifact projection: %+v", artifactProjection.Patch)
	}

	gatePayload, _ := json.Marshal(events[1].Payload)
	gateEvent := &model.TaskEvent{
		EventId:     "evt-gate",
		TaskId:      "task-provider",
		EventSeq:    2,
		Type:        model.TaskEventType_TASK_EVENT_TYPE_TURN_EVENT,
		PayloadJson: string(gatePayload),
	}
	gateProjection, ok := BuildAtelierProjectionEvent(gateEvent)
	if !ok {
		t.Fatal("expected gate event to project")
	}
	if gateProjection.Patch.Kind != "gate.upsert" ||
		gateProjection.Patch.Gate == nil ||
		gateProjection.Patch.Gate.ID != "gate-typecheck" ||
		gateProjection.Patch.Gate.ArtifactIDs[0] != "artifact-report" {
		t.Fatalf("unexpected gate projection: %+v", gateProjection.Patch)
	}
}

func TestAppendNodeResultTaskEventsTxPersistsOrderedOutbox(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "node_result_projection_outbox")
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-provider",
		Title:         "Provider result",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	node := persistence.CollaborationTaskNode{
		ID:        "node-provider",
		TaskID:    task.ID,
		AgentID:   "agent-provider",
		Role:      "executor",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
		StartedAt: now,
		EndedAt:   now,
	}
	lease := persistence.ExecutorLease{
		LeaseID:      "lease-provider",
		TaskID:       task.ID,
		StepID:       node.ID,
		ExecutorID:   "executor-1",
		ExecutorKind: int32(model.ExecutorKind_EXECUTOR_KIND_DESKTOP_DEVICE),
		Status:       executorLeaseStatusReleased,
		AcquiredAt:   now,
		HeartbeatAt:  now,
		ExpiresAt:    now.Add(time.Minute),
	}
	seedResumeCollaborationTask(t, db, task, []persistence.CollaborationTaskNode{node})
	projectionEvents, err := collaborationProjectionEventsFromNodeResultMeta(task.ID, node.ID, lease.ExecutorID, map[string]string{
		nodeResultArtifactsMetaKey: `{"artifact_id":"artifact-report","name":"Provider report","kind":"markdown","uri":"artifact://task-provider/artifact-report","checksum":"sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","markdown":"## Report"}`,
		nodeResultGatesMetaKey:     `{"gate_id":"gate-typecheck","name":"Typecheck","status":"passed","summary":"tsc passed"}`,
	})
	if err != nil {
		t.Fatalf("parse projection events: %v", err)
	}
	writer := NewTaskEventWriter()
	if err := db.Transaction(func(tx *gorm.DB) error {
		events, err := appendNodeResultTaskEventsTx(
			context.Background(),
			tx,
			writer,
			&task,
			&node,
			&lease,
			domain.EventTypeCollaborationNodeCompleted,
			"turn-provider",
			"provider completed",
			"completed",
			nil,
			projectionEvents,
		)
		if err != nil {
			return err
		}
		if len(events) != 4 {
			t.Fatalf("expected node, artifact, gate, lease events, got %+v", events)
		}
		return nil
	}); err != nil {
		t.Fatalf("append node result events: %v", err)
	}
	var records []persistence.TaskEvent
	if err := db.Where("task_id = ?", task.ID).Order("event_seq ASC").Find(&records).Error; err != nil {
		t.Fatalf("load task events: %v", err)
	}
	if len(records) != 4 {
		t.Fatalf("expected four task events, got %+v", records)
	}
	wantTypes := []model.TaskEventType{
		model.TaskEventType_TASK_EVENT_TYPE_STEP_COMPLETED,
		model.TaskEventType_TASK_EVENT_TYPE_ARTIFACT_CREATED,
		model.TaskEventType_TASK_EVENT_TYPE_GATE_RESULT,
		model.TaskEventType_TASK_EVENT_TYPE_EXECUTOR_RELEASED,
	}
	for index, record := range records {
		if record.EventSeq != int64(index+1) {
			t.Fatalf("expected event seq %d, got %d", index+1, record.EventSeq)
		}
		if got := model.TaskEventType(record.EventType); got != wantTypes[index] {
			t.Fatalf("expected event type %v at index %d, got %v", wantTypes[index], index, got)
		}
		if record.StepID != node.ID {
			t.Fatalf("expected node step id %q, got %q", node.ID, record.StepID)
		}
	}
}

func TestRequestCollaborationInterruptTxPersistsPendingInterruptAndEvent(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "request_interrupt_pending")
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-request-interrupt",
		Title:         "Request interrupt",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		MetaJSON:      `{"existing":"kept"}`,
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	seedResumeCollaborationTask(t, db, task, nil)

	writer := NewTaskEventWriter()
	if err := db.Transaction(func(tx *gorm.DB) error {
		_, _, err := requestCollaborationInterruptTx(
			context.Background(),
			tx,
			writer,
			"actor-1",
			task.ID,
			string(domain.EventTypeCollaborationInterruptRequested),
			map[string]interface{}{
				"interrupt_id":   "decision_1",
				"interrupt_type": "human_decision",
				"question":       "Continue?",
			},
		)
		return err
	}); err != nil {
		t.Fatalf("request collaboration interrupt: %v", err)
	}

	var events []persistence.TaskEvent
	if err := db.Where("task_id = ?", task.ID).Order("event_seq ASC").Find(&events).Error; err != nil {
		t.Fatalf("load task events: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected one requested event, got %+v", events)
	}
	if got := model.TaskEventType(events[0].EventType); got != model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_REQUESTED {
		t.Fatalf("expected interrupt requested event, got %v", got)
	}
	var interrupt persistence.InterruptRequest
	if err := db.First(&interrupt, "interrupt_id = ?", "decision_1").Error; err != nil {
		t.Fatalf("load pending interrupt: %v", err)
	}
	if interrupt.TaskID != task.ID || interrupt.Status != int32(model.InterruptStatus_INTERRUPT_STATUS_PENDING) {
		t.Fatalf("unexpected pending interrupt: %+v", interrupt)
	}
}

func TestRunCollaborationSupervisorTickTxRequestsWorkspaceConflictReplan(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "supervisor_workspace_conflict_replan")
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-supervisor-conflict",
		Title:         "Supervisor conflict",
		GoalOwnerPTID: "actor-1",
		WorkspaceID:   "workspace-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		MetaJSON: mergeStringMapJSON("", map[string]string{
			"workspace_conflict": "true",
		}),
		CreatedAt: now.Add(-time.Hour),
		StartedAt: now.Add(-time.Hour),
		EndedAt:   now.Add(-time.Hour),
	}
	nodes := []persistence.CollaborationTaskNode{
		{
			ID:        "node-done",
			TaskID:    task.ID,
			AgentID:   "agent-done",
			Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
			StartedAt: now.Add(-50 * time.Minute),
			EndedAt:   now.Add(-40 * time.Minute),
		},
		{
			ID:        "node-blocked",
			TaskID:    task.ID,
			AgentID:   "agent-blocked",
			Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_FAILED),
			StartedAt: now.Add(-30 * time.Minute),
			EndedAt:   now.Add(-20 * time.Minute),
		},
	}
	seedResumeCollaborationTask(t, db, task, nodes)
	if err := db.Create(&persistence.TaskCheckpoint{
		CheckpointID: "ckpt-accepted-1",
		TaskID:       task.ID,
		EventSeq:     12,
		StateJSON:    `{"accepted":true}`,
		CreatedAt:    now.Add(-time.Minute),
	}).Error; err != nil {
		t.Fatalf("create checkpoint: %v", err)
	}

	writer := NewTaskEventWriter()
	var requested bool
	var record *persistence.TaskEvent
	if err := db.Transaction(func(tx *gorm.DB) error {
		var txErr error
		_, record, requested, txErr = runCollaborationSupervisorTickTxAfterCanvasReadiness(context.Background(), tx, writer, "actor-1", task.ID, now)
		return txErr
	}); err != nil {
		t.Fatalf("run supervisor tick: %v", err)
	}
	if !requested || record == nil {
		t.Fatal("expected supervisor tick to request replan")
	}
	if got := model.TaskEventType(record.EventType); got != model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_REQUESTED {
		t.Fatalf("expected interrupt requested event, got %v", got)
	}
	payload := map[string]interface{}{}
	if err := json.Unmarshal([]byte(record.Payload), &payload); err != nil {
		t.Fatalf("decode supervisor payload: %v", err)
	}
	if payload["source"] != "station.supervisor.tick" ||
		payload["interrupt_type"] != collaborationSupervisorInterruptReplan ||
		payload["reason"] != "workspace_conflict" ||
		payload["replan_reason"] != "workspace_conflict" ||
		payload["resume_anchor_checkpoint_id"] != "ckpt-accepted-1" {
		t.Fatalf("unexpected supervisor replan payload: %+v", payload)
	}
	options, ok := payload["options"].([]interface{})
	if !ok || len(options) != 3 {
		t.Fatalf("expected typed supervisor human decision options, got %+v", payload["options"])
	}
	firstOption, ok := options[0].(map[string]interface{})
	if !ok || firstOption["action"] != "replan" || firstOption["recommended"] != true {
		t.Fatalf("expected recommended replan option, got %+v", firstOption)
	}
	diff, ok := payload["task_graph_diff"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected task_graph_diff in supervisor payload, got %+v", payload)
	}
	if diff["version"] != "atelier.task_graph_diff/v0" ||
		diff["scope"] != "blocked_subgraph" ||
		diff["reason"] != "workspace_conflict" ||
		diff["requires_goal_owner_approval"] != true {
		t.Fatalf("unexpected task graph diff: %+v", diff)
	}
	if got := fmt.Sprint(diff["affected_node_ids"]); got != "[node-blocked]" {
		t.Fatalf("expected failed node to be affected, got %s", got)
	}
	if got := fmt.Sprint(diff["retained_node_ids"]); got != "[node-done]" {
		t.Fatalf("expected completed node to be retained, got %s", got)
	}
	anchor, ok := diff["resume_anchor"].(map[string]interface{})
	if !ok || anchor["checkpoint_id"] != "ckpt-accepted-1" {
		t.Fatalf("expected resume anchor in task graph diff, got %+v", diff)
	}
	var stored persistence.CollaborationTask
	if err := db.First(&stored, "id = ?", task.ID).Error; err != nil {
		t.Fatalf("load task: %v", err)
	}
	if got := model.CollaborationTaskStatus(stored.Status); got != model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED {
		t.Fatalf("expected supervisor to pause task for replan decision, got %v", got)
	}
	meta := map[string]string{}
	if err := json.Unmarshal([]byte(stored.MetaJSON), &meta); err != nil {
		t.Fatalf("decode task meta: %v", err)
	}
	if meta["supervisor_state"] != "replan_requested" ||
		meta["replan_required"] != "true" ||
		meta["replan_reason"] != "workspace_conflict" ||
		meta["task_graph_diff_status"] != "proposed" ||
		meta["resume_anchor_checkpoint_id"] != "ckpt-accepted-1" ||
		meta["resume_anchor_event_seq"] != "12" {
		t.Fatalf("unexpected supervisor task meta: %+v", meta)
	}
	var interrupt persistence.InterruptRequest
	if err := db.First(&interrupt, "task_id = ? AND interrupt_type = ?", task.ID, collaborationSupervisorInterruptReplan).Error; err != nil {
		t.Fatalf("load supervisor interrupt: %v", err)
	}
	if interrupt.Status != int32(model.InterruptStatus_INTERRUPT_STATUS_PENDING) {
		t.Fatalf("expected pending supervisor interrupt, got %+v", interrupt)
	}
}

func TestRunCollaborationSupervisorTickTxSkipsDuplicatePendingReplan(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "supervisor_duplicate_replan")
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-supervisor-duplicate",
		Title:         "Supervisor duplicate",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		MetaJSON: mergeStringMapJSON("", map[string]string{
			"workspace_conflict": "true",
		}),
		CreatedAt: now,
		StartedAt: now,
		EndedAt:   now,
	}
	seedResumeCollaborationTask(t, db, task, nil)
	if err := db.Create(&persistence.InterruptRequest{
		InterruptID:   "supervisor-existing",
		TaskID:        task.ID,
		InterruptType: collaborationSupervisorInterruptReplan,
		Status:        int32(model.InterruptStatus_INTERRUPT_STATUS_PENDING),
		PayloadJSON:   `{"source":"station.supervisor.tick"}`,
		CreatedAt:     now,
	}).Error; err != nil {
		t.Fatalf("create pending supervisor interrupt: %v", err)
	}

	writer := NewTaskEventWriter()
	var requested bool
	if err := db.Transaction(func(tx *gorm.DB) error {
		var txErr error
		_, _, requested, txErr = runCollaborationSupervisorTickTxAfterCanvasReadiness(context.Background(), tx, writer, "actor-1", task.ID, now)
		return txErr
	}); err != nil {
		t.Fatalf("run supervisor tick: %v", err)
	}
	if requested {
		t.Fatal("expected duplicate pending supervisor replan to be skipped")
	}
	var eventCount int64
	if err := db.Model(&persistence.TaskEvent{}).Where("task_id = ?", task.ID).Count(&eventCount).Error; err != nil {
		t.Fatalf("count task events: %v", err)
	}
	if eventCount != 0 {
		t.Fatalf("expected no duplicate supervisor event, got %d", eventCount)
	}
}

func TestResolveCollaborationInterruptTxAppliesSupervisorReplanDiff(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "supervisor_replan_apply")
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-supervisor-replan-apply",
		Title:         "Supervisor replan apply",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED),
		MetaJSON: mergeStringMapJSON("", map[string]string{
			"supervisor_state":       "replan_requested",
			"replan_required":        "true",
			"task_graph_diff_status": "proposed",
		}),
		CreatedAt: now,
		StartedAt: now,
		EndedAt:   now,
	}
	nodes := []persistence.CollaborationTaskNode{
		{
			ID:            "node-retained",
			TaskID:        task.ID,
			AgentID:       "agent-retained",
			Status:        int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
			ResultSummary: "keep this result",
			StartedAt:     now,
			EndedAt:       now,
		},
		{
			ID:            "node-affected",
			TaskID:        task.ID,
			AgentID:       "agent-affected",
			Status:        int32(model.TaskNodeStatus_TASK_NODE_STATUS_FAILED),
			ResultSummary: "stale failed result",
			StartedAt:     now,
			EndedAt:       now,
		},
	}
	seedResumeCollaborationTask(t, db, task, nodes)
	interruptID := "supervisor-replan-apply-1"
	if err := db.Create(&persistence.InterruptRequest{
		InterruptID:   interruptID,
		TaskID:        task.ID,
		InterruptType: collaborationSupervisorInterruptReplan,
		Status:        int32(model.InterruptStatus_INTERRUPT_STATUS_PENDING),
		PayloadJSON: mustJSONString(map[string]interface{}{
			"interrupt_id":   interruptID,
			"interrupt_type": collaborationSupervisorInterruptReplan,
			"task_graph_diff": map[string]interface{}{
				"version":                      "atelier.task_graph_diff/v0",
				"scope":                        "blocked_subgraph",
				"task_id":                      task.ID,
				"affected_node_ids":            []string{"node-affected"},
				"retained_node_ids":            []string{"node-retained"},
				"requires_goal_owner_approval": true,
				"proposed_actions": []map[string]interface{}{
					{"action": "requeue_blocked_subgraph", "node_ids": []string{"node-affected"}},
				},
			},
		}),
		CreatedAt: now,
	}).Error; err != nil {
		t.Fatalf("create supervisor interrupt: %v", err)
	}

	writer := NewTaskEventWriter()
	payload := map[string]interface{}{
		"interrupt_id":        interruptID,
		"interrupt_type":      collaborationSupervisorInterruptReplan,
		"resume_payload_json": `{"choice":"replan"}`,
	}
	var resumed bool
	if err := db.Transaction(func(tx *gorm.DB) error {
		var txErr error
		_, _, resumed, _, txErr = resolveCollaborationInterruptTx(
			context.Background(),
			tx,
			writer,
			"actor-1",
			task.ID,
			"approve supervisor replan",
			string(domain.EventTypeCollaborationInterruptResolved),
			payload,
		)
		return txErr
	}); err != nil {
		t.Fatalf("resolve supervisor replan: %v", err)
	}
	if !resumed {
		t.Fatal("expected supervisor replan approval to resume task")
	}
	var storedTask persistence.CollaborationTask
	if err := db.First(&storedTask, "id = ?", task.ID).Error; err != nil {
		t.Fatalf("load task: %v", err)
	}
	if got := model.CollaborationTaskStatus(storedTask.Status); got != model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING {
		t.Fatalf("expected task running after replan apply, got %v", got)
	}
	meta := map[string]string{}
	if err := json.Unmarshal([]byte(storedTask.MetaJSON), &meta); err != nil {
		t.Fatalf("decode task meta: %v", err)
	}
	if meta["supervisor_state"] != "replan_applied" ||
		meta["replan_required"] != "false" ||
		meta["task_graph_diff_status"] != "applied" ||
		meta["task_graph_diff_applied_node_ids"] != "node-affected" ||
		meta["resume_state"] != "ready" {
		t.Fatalf("unexpected replan apply meta: %+v", meta)
	}
	var affected persistence.CollaborationTaskNode
	if err := db.First(&affected, "id = ?", "node-affected").Error; err != nil {
		t.Fatalf("load affected node: %v", err)
	}
	if got := model.TaskNodeStatus(affected.Status); got != model.TaskNodeStatus_TASK_NODE_STATUS_PENDING || affected.ResultSummary != "" {
		t.Fatalf("expected affected node reset to pending, got %+v", affected)
	}
	var retained persistence.CollaborationTaskNode
	if err := db.First(&retained, "id = ?", "node-retained").Error; err != nil {
		t.Fatalf("load retained node: %v", err)
	}
	if got := model.TaskNodeStatus(retained.Status); got != model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED || retained.ResultSummary != "keep this result" {
		t.Fatalf("expected retained node unchanged, got %+v", retained)
	}
	var resolved persistence.InterruptRequest
	if err := db.First(&resolved, "interrupt_id = ?", interruptID).Error; err != nil {
		t.Fatalf("load resolved interrupt: %v", err)
	}
	if resolved.Status != int32(model.InterruptStatus_INTERRUPT_STATUS_RESOLVED) || resolved.ResumePayloadJSON != `{"choice":"replan"}` {
		t.Fatalf("expected resolved supervisor interrupt, got %+v", resolved)
	}
}

func TestResolveCollaborationInterruptTxRejectsSupervisorReplanWithoutPendingInterrupt(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "supervisor_replan_apply_missing_interrupt")
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-supervisor-replan-missing",
		Title:         "Supervisor replan missing",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED),
		MetaJSON: mergeStringMapJSON("", map[string]string{
			"supervisor_state":       "replan_requested",
			"replan_required":        "true",
			"task_graph_diff_status": "proposed",
		}),
		CreatedAt: now,
		StartedAt: now,
		EndedAt:   now,
	}
	node := persistence.CollaborationTaskNode{
		ID:            "node-affected",
		TaskID:        task.ID,
		AgentID:       "agent-affected",
		Status:        int32(model.TaskNodeStatus_TASK_NODE_STATUS_FAILED),
		ResultSummary: "stale failed result",
		StartedAt:     now,
		EndedAt:       now,
	}
	seedResumeCollaborationTask(t, db, task, []persistence.CollaborationTaskNode{node})

	writer := NewTaskEventWriter()
	err := db.Transaction(func(tx *gorm.DB) error {
		_, _, _, _, txErr := resolveCollaborationInterruptTx(
			context.Background(),
			tx,
			writer,
			"actor-1",
			task.ID,
			"approve supervisor replan",
			string(domain.EventTypeCollaborationInterruptResolved),
			map[string]interface{}{
				"interrupt_id":        "missing-supervisor-replan",
				"interrupt_type":      collaborationSupervisorInterruptReplan,
				"resume_payload_json": `{"choice":"replan"}`,
			},
		)
		return txErr
	})
	if err == nil || !strings.Contains(err.Error(), "pending supervisor replan interrupt is required") {
		t.Fatalf("expected missing pending supervisor replan error, got %v", err)
	}
	var eventCount int64
	if countErr := db.Model(&persistence.TaskEvent{}).Where("task_id = ?", task.ID).Count(&eventCount).Error; countErr != nil {
		t.Fatalf("count task events: %v", countErr)
	}
	if eventCount != 0 {
		t.Fatalf("expected no resolved event on rejected replan apply, got %d", eventCount)
	}
	var storedNode persistence.CollaborationTaskNode
	if err := db.First(&storedNode, "id = ?", node.ID).Error; err != nil {
		t.Fatalf("load node: %v", err)
	}
	if got := model.TaskNodeStatus(storedNode.Status); got != model.TaskNodeStatus_TASK_NODE_STATUS_FAILED || storedNode.ResultSummary != "stale failed result" {
		t.Fatalf("expected node unchanged after rejected apply, got %+v", storedNode)
	}
}

func TestRunCollaborationSupervisorSweepRequestsEligibleTasks(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "supervisor_sweep_requests")
	injectOrchestrationServiceTestStore(t, db)
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	conflictTask := persistence.CollaborationTask{
		ID:            "task-supervisor-sweep-conflict",
		Title:         "Supervisor sweep conflict",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		MetaJSON: mergeStringMapJSON("", map[string]string{
			"workspace_conflict": "true",
		}),
		CreatedAt: now.Add(-4 * time.Hour),
		StartedAt: now.Add(-4 * time.Hour),
		EndedAt:   now.Add(-4 * time.Hour),
	}
	cleanTask := persistence.CollaborationTask{
		ID:            "task-supervisor-sweep-clean",
		Title:         "Supervisor sweep clean",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		MetaJSON:      `{}`,
		CreatedAt:     now.Add(-3 * time.Hour),
		StartedAt:     now.Add(-3 * time.Hour),
		EndedAt:       now.Add(-3 * time.Hour),
	}
	duplicateTask := persistence.CollaborationTask{
		ID:            "task-supervisor-sweep-duplicate",
		Title:         "Supervisor sweep duplicate",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED),
		MetaJSON: mergeStringMapJSON("", map[string]string{
			"workspace_conflict": "true",
		}),
		CreatedAt: now.Add(-2 * time.Hour),
		StartedAt: now.Add(-2 * time.Hour),
		EndedAt:   now.Add(-2 * time.Hour),
	}
	terminalTask := persistence.CollaborationTask{
		ID:            "task-supervisor-sweep-terminal",
		Title:         "Supervisor sweep terminal",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED),
		MetaJSON: mergeStringMapJSON("", map[string]string{
			"workspace_conflict": "true",
		}),
		CreatedAt: now.Add(-time.Hour),
		StartedAt: now.Add(-time.Hour),
		EndedAt:   now.Add(-time.Hour),
	}
	seedResumeCollaborationTask(t, db, conflictTask, nil)
	seedResumeCollaborationTask(t, db, cleanTask, nil)
	seedResumeCollaborationTask(t, db, duplicateTask, nil)
	seedResumeCollaborationTask(t, db, terminalTask, nil)
	if err := db.Create(&persistence.InterruptRequest{
		InterruptID:   "supervisor-existing-sweep",
		TaskID:        duplicateTask.ID,
		InterruptType: collaborationSupervisorInterruptReplan,
		Status:        int32(model.InterruptStatus_INTERRUPT_STATUS_PENDING),
		PayloadJSON:   `{"source":"station.supervisor.tick"}`,
		CreatedAt:     now,
	}).Error; err != nil {
		t.Fatalf("create duplicate interrupt: %v", err)
	}

	svc := NewOrchestrationService(nil, nil, nil)
	result, err := svc.runCollaborationSupervisorSweepAfterCanvasReadiness(context.Background(), "actor-1", 10)
	if err != nil {
		t.Fatalf("run supervisor sweep: %v", err)
	}
	if result.Scanned != 3 || result.Requested != 1 || result.Skipped != 2 {
		t.Fatalf("unexpected sweep result: %+v", result)
	}
	if len(result.RequestedTaskIDs) != 1 || result.RequestedTaskIDs[0] != conflictTask.ID {
		t.Fatalf("unexpected requested task ids: %+v", result.RequestedTaskIDs)
	}
	var eventCount int64
	if err := db.Model(&persistence.TaskEvent{}).
		Where("task_id IN ?", []string{conflictTask.ID, cleanTask.ID, duplicateTask.ID, terminalTask.ID}).
		Count(&eventCount).Error; err != nil {
		t.Fatalf("count supervisor events: %v", err)
	}
	if eventCount != 1 {
		t.Fatalf("expected one supervisor event from sweep, got %d", eventCount)
	}
	var storedConflict persistence.CollaborationTask
	if err := db.First(&storedConflict, "id = ?", conflictTask.ID).Error; err != nil {
		t.Fatalf("load conflict task: %v", err)
	}
	if got := model.CollaborationTaskStatus(storedConflict.Status); got != model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED {
		t.Fatalf("expected conflict task paused for supervisor replan, got %v", got)
	}
	var storedClean persistence.CollaborationTask
	if err := db.First(&storedClean, "id = ?", cleanTask.ID).Error; err != nil {
		t.Fatalf("load clean task: %v", err)
	}
	if got := model.CollaborationTaskStatus(storedClean.Status); got != model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING {
		t.Fatalf("expected clean task to remain running, got %v", got)
	}
}

func TestSchedulerExecuteCollaborationSupervisorSweepRequestsEligibleTasks(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "scheduler_supervisor_sweep")
	injectOrchestrationServiceTestStore(t, db)
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-scheduled-supervisor-conflict",
		Title:         "Scheduled supervisor conflict",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		MetaJSON: mergeStringMapJSON("", map[string]string{
			"workspace_conflict": "true",
		}),
		CreatedAt: now,
		StartedAt: now,
		EndedAt:   now,
	}
	seedResumeCollaborationTask(t, db, task, nil)
	scheduler := NewSchedulerService(nil, nil, nil, nil)
	scheduler.SetOrchestrationService(NewOrchestrationService(nil, nil, nil))

	if err := scheduler.executeCollaborationSupervisorSweepAfterCanvasReadiness(
		context.Background(),
		"actor-1",
	); err != nil {
		t.Fatalf("expected scheduler core sweep to succeed, got %v", err)
	}
	var event persistence.TaskEvent
	if err := db.First(&event, "task_id = ?", task.ID).Error; err != nil {
		t.Fatalf("load scheduled supervisor event: %v", err)
	}
	if got := model.TaskEventType(event.EventType); got != model.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_REQUESTED {
		t.Fatalf("expected scheduled supervisor interrupt event, got %v", got)
	}
}

func TestSchedulerCollaborationSupervisorSweepRequiresOrchestrationService(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "scheduler_supervisor_requires_orchestration")
	injectOrchestrationServiceTestStore(t, db)
	scheduler := NewSchedulerService(nil, nil, nil, nil)

	err := scheduler.executeCollaborationSupervisorSweepAfterCanvasReadiness(
		context.Background(),
		"actor-1",
	)
	if err == nil || err.Error() != "orchestration service is not configured" {
		t.Fatalf("expected missing orchestration service error, got %v", err)
	}
	var eventCount int64
	if err := db.Model(&persistence.TaskEvent{}).Count(&eventCount).Error; err != nil {
		t.Fatalf("count task events: %v", err)
	}
	if eventCount != 0 {
		t.Fatalf("expected no task events without orchestration service, got %d", eventCount)
	}
}

func TestCollaborationSupervisorDecisionDetectsMaxFixLoops(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "supervisor_max_fix_loops")
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-supervisor-fix-loop",
		Title:         "Supervisor fix loop",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		MetaJSON: mergeStringMapJSON("", map[string]string{
			"fix_loop_count": "3",
			"max_fix_loops":  "3",
		}),
		CreatedAt: now,
		StartedAt: now,
		EndedAt:   now,
	}
	seedResumeCollaborationTask(t, db, task, nil)

	decision, err := collaborationSupervisorDecisionTx(context.Background(), db, &task, now)
	if err != nil {
		t.Fatalf("supervisor decision: %v", err)
	}
	if !decision.Required || decision.Reason != "max_fix_loops" {
		t.Fatalf("expected max_fix_loops replan decision, got %+v", decision)
	}
}

func TestResumeCollaborationTaskTxRunningTaskIsNoop(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "resume_running_noop")
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-running",
		Title:         "Running task",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		MetaJSON:      `{"existing":"kept"}`,
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	seedResumeCollaborationTask(t, db, task, nil)

	var resumed bool
	if err := db.Transaction(func(tx *gorm.DB) error {
		_, _, didResume, err := resumeCollaborationTaskTx(context.Background(), tx, "actor-1", task.ID, "agent.collaboration.resume")
		resumed = didResume
		return err
	}); err != nil {
		t.Fatalf("resume running task: %v", err)
	}
	if resumed {
		t.Fatal("expected running task resume to be a no-op")
	}

	var updated persistence.CollaborationTask
	if err := db.First(&updated, "id = ?", task.ID).Error; err != nil {
		t.Fatalf("load updated task: %v", err)
	}
	if got := model.CollaborationTaskStatus(updated.Status); got != model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING {
		t.Fatalf("expected task to remain RUNNING, got %v", got)
	}
	if updated.MetaJSON != task.MetaJSON {
		t.Fatalf("expected meta to remain unchanged, got %q", updated.MetaJSON)
	}
}

func TestResumeCollaborationTaskTxRejectsTerminalTask(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "resume_terminal_reject")
	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-terminal",
		Title:         "Terminal task",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED),
		MetaJSON:      `{"existing":"kept"}`,
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	seedResumeCollaborationTask(t, db, task, nil)

	var resumed bool
	err := db.Transaction(func(tx *gorm.DB) error {
		_, _, didResume, err := resumeCollaborationTaskTx(context.Background(), tx, "actor-1", task.ID, "agent.collaboration.resume")
		resumed = didResume
		return err
	})
	if err == nil {
		t.Fatal("expected terminal task to reject resume")
	}
	if resumed {
		t.Fatal("expected terminal task not to resume")
	}

	var updated persistence.CollaborationTask
	if loadErr := db.First(&updated, "id = ?", task.ID).Error; loadErr != nil {
		t.Fatalf("load updated task: %v", loadErr)
	}
	if got := model.CollaborationTaskStatus(updated.Status); got != model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_COMPLETED {
		t.Fatalf("expected task to remain COMPLETED, got %v", got)
	}
	if updated.MetaJSON != task.MetaJSON {
		t.Fatalf("expected meta to remain unchanged, got %q", updated.MetaJSON)
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

func openResumeCollaborationTaskDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+name+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	for _, statement := range []string{
		`CREATE TABLE agent_collaboration_tasks (
			id text PRIMARY KEY,
			title text NOT NULL,
			description text,
			engine_type integer NOT NULL DEFAULT 0,
			status integer NOT NULL,
			goal_owner_ptid text NOT NULL,
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
		`CREATE TABLE agent_task_events (
                        id text PRIMARY KEY,
                        task_id text NOT NULL,
                        step_id text,
                        turn_id text,
                        event_seq integer NOT NULL,
                        event_type integer NOT NULL,
                        payload text,
                        created_at datetime NOT NULL
                )`,
		`CREATE TABLE agent_task_runs (
                          task_id text PRIMARY KEY,
                          title text,
                          description text,
                          surface integer NOT NULL,
                          status integer NOT NULL,
                          owner_actor_ptid text NOT NULL,
                          workspace_id text,
                          conversation_id text,
                          root_turn_id text,
                          current_checkpoint_id text,
                          meta_json text,
                          created_at datetime NOT NULL,
                          started_at datetime NOT NULL,
                          updated_at datetime NOT NULL,
                          ended_at datetime,
                          goal_id text NOT NULL DEFAULT '',
                          goal_node_id text NOT NULL DEFAULT '',
                          root_step_id text NOT NULL DEFAULT ''
                  )`,
		`CREATE TABLE agent_execution_steps (
                          step_id text PRIMARY KEY,
                          task_id text NOT NULL,
                          parent_step_id text,
                          agent_id text NOT NULL,
                          role text,
                          description text,
                          status integer NOT NULL,
                          turn_id text,
                          attempt integer NOT NULL DEFAULT 1,
                          attempt_id text NOT NULL DEFAULT '',
                          eligible_executors text,
                          result_summary text,
                          started_at datetime NOT NULL,
                          ended_at datetime
                  )`,
		`CREATE TABLE agent_growth_events (
						id text PRIMARY KEY,
						agent_id text NOT NULL,
						event_type text NOT NULL,
						category text NOT NULL,
						target text,
						details text,
						outcome text,
						created_at datetime NOT NULL
				)`,
		`CREATE TABLE agent_memories (
						id text PRIMARY KEY,
						agent_id text NOT NULL,
						target text NOT NULL,
						layer text NOT NULL DEFAULT 'preference',
						session_id text NOT NULL DEFAULT '',
						content text NOT NULL,
						summary text NOT NULL DEFAULT '',
						relevance real NOT NULL DEFAULT 0,
						source_turn_id text,
						source text NOT NULL DEFAULT 'turn',
						source_review_id text,
						is_frozen boolean NOT NULL DEFAULT false,
						trust_score real NOT NULL DEFAULT 0.5,
						retrieval_count integer NOT NULL DEFAULT 0,
						last_accessed_at datetime,
						helpful_count integer NOT NULL DEFAULT 0,
						harmful_count integer NOT NULL DEFAULT 0,
						created_at datetime NOT NULL,
						updated_at datetime NOT NULL
				)`,
		`CREATE TABLE agent_memory_rollback_snapshots (
						id text PRIMARY KEY,
						agent_id text NOT NULL,
						turn_id text,
						trigger text NOT NULL,
						content text NOT NULL,
						created_at datetime NOT NULL
				)`,
		`CREATE TABLE agent_task_checkpoints (
						checkpoint_id text PRIMARY KEY,
						task_id text NOT NULL,
						event_seq integer NOT NULL,
						state_json text,
						versions_json text,
						pending_writes_cursor text,
						created_at datetime NOT NULL
				)`,
		`CREATE TABLE agent_interrupt_requests (
                        interrupt_id text PRIMARY KEY,
                        task_id text NOT NULL,
                        step_id text,
                        turn_id text,
                        interrupt_type text,
                        status integer NOT NULL,
                        payload_json text,
                        resume_payload_json text,
                        created_at datetime NOT NULL,
                        resolved_at datetime,
                        consumed_at datetime,
                        consumed_step_id text,
                        consumed_turn_id text
                )`,
		`CREATE TABLE agent_task_artifacts (
                          artifact_id text PRIMARY KEY,
                          task_id text NOT NULL,
                          step_id text,
                          turn_id text,
                          event_id text,
						  event_seq integer NOT NULL DEFAULT 0,
                          run_id text,
                          kind text,
                          name text,
                          uri text,
                          checksum text,
                          produced_by text,
						  refs_json text,
                          payload_json text,
                          created_at datetime NOT NULL
                  )`,
		`CREATE TABLE agent_task_budget_usages (
                                  budget_usage_id text PRIMARY KEY,
                                  task_id text NOT NULL,
                                  step_id text,
                                  event_id text,
                                  event_seq integer NOT NULL DEFAULT 0,
                                  budget_id text,
                                  direct_run_id text,
                                  provider_id text,
                                  model text,
                                  input_tokens integer NOT NULL DEFAULT 0,
                                  output_tokens integer NOT NULL DEFAULT 0,
                                  total_tokens integer NOT NULL DEFAULT 0,
                                  used_money real NOT NULL DEFAULT 0,
								  estimated_money real NOT NULL DEFAULT 0,
								  provider_billed_money real NOT NULL DEFAULT 0,
								  provider_billing_source text,
								  provider_billing_currency text,
                                  input_token_price real NOT NULL DEFAULT 0,
                                  output_token_price real NOT NULL DEFAULT 0,
                                  pricing_source text,
                                  source text,
                                  payload_json text,
                                  created_at datetime NOT NULL
                  )`,
		`CREATE TABLE agent_task_gate_plans (
				  gate_plan_id text PRIMARY KEY,
				  task_id text NOT NULL,
				  step_id text,
				  source text,
				  status text,
				  plan_json text,
				  created_at datetime NOT NULL,
				  updated_at datetime NOT NULL
		  )`,
		`CREATE TABLE agent_task_provider_plans (
                                  provider_plan_id text PRIMARY KEY,
                                  task_id text NOT NULL,
                                  source text,
                                  status text,
                                  plan_json text,
                                  created_at datetime NOT NULL,
                                  updated_at datetime NOT NULL
                  )`,
		`CREATE TABLE agent_direct_runs (
                                  direct_run_id text PRIMARY KEY,
                                  task_id text,
                                  goal_id text,
                                  goal_node_id text,
                                  step_id text,
                                  attempt_id text,
                                  provider_id text NOT NULL,
                                  model_intent text NOT NULL,
                                  input_snapshot_json text,
                                  budget_ref text,
                                  policy_ref text,
                                  trace_id text,
                                  state text,
                                  source text,
                                  created_at datetime NOT NULL,
                                  updated_at datetime NOT NULL
                  )`,
		`CREATE TABLE agent_conversations (
                                  id text PRIMARY KEY,
                                  agent_id text,
                                  actor_ptid text NOT NULL,
                                  title text NOT NULL,
                                  description text,
                                  provider_id text NOT NULL,
                                  model_name text,
                                  status text NOT NULL,
                                  parent_id text,
                                  config_json text,
                                  meta text,
                                  active_branch_message_id text NOT NULL DEFAULT '',
                                  runtime_binding blob,
                                  queued_turn_count integer NOT NULL DEFAULT 0,
                                  version integer NOT NULL DEFAULT 1,
                                  created_at datetime NOT NULL,
                                  updated_at datetime NOT NULL
                  )`,
		`CREATE TABLE agent_task_artifact_blobs (
                                  blob_id text PRIMARY KEY,
                                  artifact_id text NOT NULL,
                                  task_id text NOT NULL,
                                  step_id text,
                                  turn_id text,
                                  event_id text,
                                  event_seq integer NOT NULL DEFAULT 0,
                                  body_kind text,
                                  body_uri text,
                                  content_hash text,
                                  byte_size integer NOT NULL DEFAULT 0,
                                  retention_policy text,
                                  retention_status text,
                                  body_text text,
                                  created_at datetime NOT NULL,
                                  expires_at datetime
                  )`,
		`CREATE TABLE agent_task_gate_results (
                                  gate_result_id text PRIMARY KEY,
                                  task_id text NOT NULL,
                                  step_id text,
                                  turn_id text,
                                  event_id text,
                                  event_seq integer NOT NULL DEFAULT 0,
                                  gate_id text,
                                  gate_plan_id text,
                                  name text,
                                  status text,
                                  summary text,
                                  blocking boolean NOT NULL DEFAULT false,
                                  artifact_ids_json text,
                                  checks_json text,
                                  produced_by text,
                                  payload_json text,
                                  created_at datetime NOT NULL
                  )`,
		`CREATE TABLE agent_project_states (
                                  project_id text PRIMARY KEY,
                                  task_id text NOT NULL,
                                  project_state text,
                                  milestone_state text,
                                  source_event_id text,
                                  source_event_seq integer NOT NULL DEFAULT 0,
                                  payload_json text,
                                  created_at datetime NOT NULL,
                                  updated_at datetime NOT NULL
                  )`,
		`CREATE TABLE agent_acceptance_predicates (
                                  predicate_id text PRIMARY KEY,
                                  task_id text NOT NULL,
                                  scope text,
                                  level text,
                                  evaluator text,
                                  expr text,
                                  last_eval boolean,
                                  human_signoff boolean NOT NULL DEFAULT false,
                                  source_event_id text,
                                  source_event_seq integer NOT NULL DEFAULT 0,
                                  payload_json text,
                                  created_at datetime NOT NULL,
                                  updated_at datetime NOT NULL
                  )`,
		`CREATE TABLE agent_atelier_milestones (
                                  milestone_id text PRIMARY KEY,
                                  task_id text NOT NULL,
                                  parent_id text,
                                  title text,
                                  state text,
                                  task_ids_json text,
                                  acceptance_predicate_ids_json text,
                                  depends_on_json text,
                                  source_event_id text,
                                  source_event_seq integer NOT NULL DEFAULT 0,
                                  payload_json text,
                                  created_at datetime NOT NULL,
                                  updated_at datetime NOT NULL
                  )`,
		`CREATE TABLE agent_atelier_task_graph_nodes (
                                  node_id text PRIMARY KEY,
                                  task_id text NOT NULL,
                                  milestone_id text,
                                  title text,
                                  state text,
                                  agent_role text,
                                  artifact_ids_json text,
                                  gate_ids_json text,
                                  source_event_id text,
                                  source_event_seq integer NOT NULL DEFAULT 0,
                                  payload_json text,
                                  created_at datetime NOT NULL,
                                  updated_at datetime NOT NULL
                  )`,
		`CREATE TABLE agent_atelier_task_graph_edges (
                                  edge_id text PRIMARY KEY,
                                  task_id text NOT NULL,
                                  from_id text,
                                  to_id text,
                                  type text,
                                  source_event_id text,
                                  source_event_seq integer NOT NULL DEFAULT 0,
                                  payload_json text,
                                  created_at datetime NOT NULL,
                                  updated_at datetime NOT NULL
                  )`,
		`CREATE TABLE agent_atelier_policies (
                                  policy_projection_id text PRIMARY KEY,
                                  policy_id text NOT NULL,
                                  task_id text NOT NULL,
                                  hard_deny boolean NOT NULL DEFAULT false,
                                  source_event_id text,
                                  source_event_seq integer NOT NULL DEFAULT 0,
                                  payload_json text,
                                  created_at datetime NOT NULL,
                                  updated_at datetime NOT NULL
                  )`,
		`CREATE TABLE agent_atelier_policy_rules (
                                  rule_id text PRIMARY KEY,
                                  policy_id text NOT NULL,
                                  task_id text NOT NULL,
                                  scope text,
                                  expr text,
                                  severity text,
                                  source_event_id text,
                                  source_event_seq integer NOT NULL DEFAULT 0,
                                  payload_json text,
                                  created_at datetime NOT NULL,
                                  updated_at datetime NOT NULL
                  )`,
		`CREATE TABLE agent_atelier_defects (
                                  defect_id text PRIMARY KEY,
                                  task_id text NOT NULL,
                                  source text,
                                  state text,
                                  evidence_ref text,
                                  summary text,
                                  expected_change text,
                                  target_refs_json text,
                                  source_event_id text,
                                  source_event_seq integer NOT NULL DEFAULT 0,
                                  payload_json text,
                                  created_at datetime NOT NULL,
                                  updated_at datetime NOT NULL
                  )`,
		`CREATE TABLE agent_project_blockers (
                                  blocker_id text PRIMARY KEY,
                                  task_id text NOT NULL,
                                  scope text,
                                  owner text,
                                  severity text,
                                  state text,
                                  evidence_ref text,
                                  reason text,
                                  source_event_id text,
                                  source_event_seq integer NOT NULL DEFAULT 0,
                                  payload_json text,
                                  created_at datetime NOT NULL,
                                  updated_at datetime NOT NULL
                  )`,
		`CREATE TABLE agent_project_residual_risks (
                                  risk_id text PRIMARY KEY,
                                  task_id text NOT NULL,
                                  description text,
                                  state text,
                                  evidence_ref text,
                                  owner text,
                                  source_event_id text,
                                  source_event_seq integer NOT NULL DEFAULT 0,
                                  payload_json text,
                                  created_at datetime NOT NULL,
                                  updated_at datetime NOT NULL
                  )`,
		`CREATE TABLE agent_providers (
                                  id text PRIMARY KEY,
                                  actor_ptid varchar(36) NOT NULL DEFAULT '',
                                  name text NOT NULL,
                                  display_name varchar(256),
                                  base_url text,
                                  key_vaults text,
                                  config text,
                                  hidden_models text,
                                  source_type text,
                                  check_model text,
                                  runtime_kind text,
                                  cli_command text,
                                  models_command text,
                                  protocol text,
                                  enabled boolean NOT NULL DEFAULT true,
                                  version bigint NOT NULL DEFAULT 1,
                                  created_at datetime NOT NULL,
                                  updated_at datetime NOT NULL
                  )`,
		`CREATE TABLE agents (
                                  id text PRIMARY KEY,
                                  name text NOT NULL,
                                  title text,
                                  description text,
                                  provider_id text,
                                  model_name text,
                                  effort text,
                                  thinking_mode text NOT NULL DEFAULT 'auto',
                                  visibility text NOT NULL,
                                  owner_actor_ptid text NOT NULL,
                                  config_json text,
                                  version bigint NOT NULL DEFAULT 1,
                                  created_at datetime NOT NULL,
                                  updated_at datetime NOT NULL
                  )`,
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatalf("create test table: %v", err)
		}
	}
	return db
}

func seedResumeCollaborationTask(t *testing.T, db *gorm.DB, task persistence.CollaborationTask, nodes []persistence.CollaborationTaskNode) {
	t.Helper()
	if err := db.Create(&task).Error; err != nil {
		t.Fatalf("create task: %v", err)
	}
	if len(nodes) > 0 {
		if err := db.Create(&nodes).Error; err != nil {
			t.Fatalf("create nodes: %v", err)
		}
	}
}

func seedDesktopExecutorAgent(t *testing.T, db *gorm.DB, actorPTID string, agentID string, now time.Time) {
	t.Helper()
	if err := db.Create(&persistence.Agent{
		ID:             agentID,
		Name:           agentID,
		Visibility:     string(domain.AgentVisibilityPrivate),
		OwnerActorPTID: actorPTID,
		ConfigJSON:     `{"executorKind":"desktop_device"}`,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatalf("create desktop executor agent: %v", err)
	}
}

func seedTaskGatePlan(t *testing.T, db *gorm.DB, gatePlanID string, taskID string, nodeID string, level model.TaskGateBlockingLevel, checkType string) {
	t.Helper()
	planJSON, err := protojson.Marshal(&model.TaskGatePlan{
		GatePlanId: gatePlanID,
		TaskId:     taskID,
		StepId:     nodeID,
		Source:     "station.gate_runner",
		Status:     "active",
		Gates: []*model.TaskGateSpec{{
			GateId:        "gate-" + strings.TrimPrefix(gatePlanID, "plan-"),
			Name:          "Persisted Gate",
			BlockingLevel: level,
			Checks: []*model.TaskGateCheckSpec{{
				CheckId:   "check-" + strings.TrimPrefix(gatePlanID, "plan-"),
				Name:      "persisted",
				CheckType: checkType,
			}},
		}},
	})
	if err != nil {
		t.Fatalf("marshal gate plan: %v", err)
	}
	now := time.Now()
	if err := db.Create(&persistence.TaskGatePlan{
		GatePlanID: gatePlanID,
		TaskID:     taskID,
		StepID:     nodeID,
		Source:     "station.gate_runner",
		Status:     "active",
		PlanJSON:   string(planJSON),
		CreatedAt:  now,
		UpdatedAt:  now,
	}).Error; err != nil {
		t.Fatalf("create gate plan: %v", err)
	}
}

func assertGateRecoveryState(t *testing.T, db *gorm.DB, taskID string, planStatus string, taskStatus model.CollaborationTaskStatus, action string) {
	t.Helper()
	var task persistence.CollaborationTask
	if err := db.First(&task, "id = ?", taskID).Error; err != nil {
		t.Fatalf("load recovered task: %v", err)
	}
	if got := model.CollaborationTaskStatus(task.Status); got != taskStatus {
		t.Fatalf("expected task status %v, got %v", taskStatus, got)
	}
	meta := map[string]string{}
	if err := json.Unmarshal([]byte(task.MetaJSON), &meta); err != nil {
		t.Fatalf("decode recovered meta: %v", err)
	}
	if meta["gate_blocked"] != "false" || meta["gate_blocked_id"] != "" || meta["gate_blocked_summary"] != "" {
		t.Fatalf("expected gate blocked meta cleared, got %+v", meta)
	}
	if meta["gate_recovery_action"] != action || strings.TrimSpace(meta["gate_recovered_at"]) == "" {
		t.Fatalf("unexpected gate recovery meta: %+v", meta)
	}
	var plan persistence.TaskGatePlan
	if err := db.First(&plan, "task_id = ?", taskID).Error; err != nil {
		t.Fatalf("load recovered gate plan: %v", err)
	}
	if plan.Status != planStatus {
		t.Fatalf("expected gate plan status %q, got %q", planStatus, plan.Status)
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

func TestBlockingGateMetaSurvivesDesktopExecutorMetaUpdate(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "blocking_gate_meta_update")
	now := time.Now()
	task := persistence.CollaborationTask{
		ID:            "task-blocked",
		Title:         "blocked",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED),
		MetaJSON: mergeStringMapJSON("", map[string]string{
			"gate_blocked":         "true",
			"gate_blocked_id":      "gate-typecheck",
			"gate_blocked_summary": "typecheck failed",
		}),
		CreatedAt: now,
		StartedAt: now,
		EndedAt:   now,
	}
	seedResumeCollaborationTask(t, db, task, nil)

	service := &OrchestrationService{}
	service.updateTaskMeta(context.Background(), db, &task, map[string]string{
		"desktop_executor_state": "submitted_node_result",
		"desktop_executor_node":  "node-provider",
	})

	meta := map[string]string{}
	if err := json.Unmarshal([]byte(task.MetaJSON), &meta); err != nil {
		t.Fatalf("decode task meta: %v", err)
	}
	if meta["gate_blocked"] != "true" ||
		meta["gate_blocked_id"] != "gate-typecheck" ||
		meta["desktop_executor_state"] != "submitted_node_result" {
		t.Fatalf("expected gate-blocked and desktop meta to coexist, got %+v", meta)
	}
}

func TestRunActiveTaskGatePlanTxExecutesPersistedPlan(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "active_gate_plan_execute")
	now := time.Now()
	task := persistence.CollaborationTask{
		ID:            "task-gate-plan-active",
		Title:         "gate plan active",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	node := persistence.CollaborationTaskNode{
		ID:        "node-gate-plan-active",
		TaskID:    task.ID,
		AgentID:   "agent-runner",
		Role:      "verifier",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
		StartedAt: now,
		EndedAt:   now,
	}
	seedResumeCollaborationTask(t, db, task, []persistence.CollaborationTaskNode{node})
	seedTaskGatePlan(t, db, "plan-warn", task.ID, node.ID, model.TaskGateBlockingLevel_TASK_GATE_BLOCKING_LEVEL_WARN, "failed")

	var events []collaborationProjectionEvent
	var decision nodeResultGateDecision
	if err := db.Transaction(func(tx *gorm.DB) error {
		var err error
		events, decision, err = runActiveTaskGatePlanTx(context.Background(), tx, &task, &node)
		return err
	}); err != nil {
		t.Fatalf("run active gate plan: %v", err)
	}
	if decision.Blocked {
		t.Fatalf("expected warn gate not to block, got %+v", decision)
	}
	if len(events) != 1 || events[0].Payload["gate_plan_id"] != "plan-warn" || events[0].Payload["status"] != "failed" {
		t.Fatalf("unexpected gate plan events: %+v", events)
	}
	var plan persistence.TaskGatePlan
	if err := db.First(&plan, "gate_plan_id = ?", "plan-warn").Error; err != nil {
		t.Fatalf("load gate plan: %v", err)
	}
	if plan.Status != "executed" {
		t.Fatalf("expected plan executed, got %q", plan.Status)
	}
}

func TestRunActiveTaskGatePlanTxBlocksPersistedPlan(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "active_gate_plan_blocked")
	now := time.Now()
	task := persistence.CollaborationTask{
		ID:            "task-gate-plan-blocked",
		Title:         "gate plan blocked",
		GoalOwnerPTID: "actor-1",
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	node := persistence.CollaborationTaskNode{
		ID:        "node-gate-plan-blocked",
		TaskID:    task.ID,
		AgentID:   "agent-runner",
		Role:      "verifier",
		Status:    int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
		StartedAt: now,
		EndedAt:   now,
	}
	seedResumeCollaborationTask(t, db, task, []persistence.CollaborationTaskNode{node})
	seedTaskGatePlan(t, db, "plan-block", task.ID, node.ID, model.TaskGateBlockingLevel_TASK_GATE_BLOCKING_LEVEL_BLOCK, "failed")

	var decision nodeResultGateDecision
	if err := db.Transaction(func(tx *gorm.DB) error {
		_, gateDecision, err := runActiveTaskGatePlanTx(context.Background(), tx, &task, &node)
		decision = gateDecision
		return err
	}); err != nil {
		t.Fatalf("run active gate plan: %v", err)
	}
	if !decision.Blocked || decision.GateID != "gate-block" {
		t.Fatalf("expected blocking gate decision, got %+v", decision)
	}
	var plan persistence.TaskGatePlan
	if err := db.First(&plan, "gate_plan_id = ?", "plan-block").Error; err != nil {
		t.Fatalf("load gate plan: %v", err)
	}
	if plan.Status != "blocked" {
		t.Fatalf("expected plan blocked, got %q", plan.Status)
	}
}

func TestCollaborationResumeContextIsInjectedAndConsumed(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "resume_context_consumed")
	resolvedAt := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	if err := db.Create(&persistence.InterruptRequest{
		InterruptID:       "decision-1",
		TaskID:            "task-resume-context",
		InterruptType:     "human_decision",
		Status:            int32(model.InterruptStatus_INTERRUPT_STATUS_RESOLVED),
		PayloadJSON:       `{"question":"是否继续？"}`,
		ResumePayloadJSON: `{"choice":"继续执行","block_id":"decision-1"}`,
		CreatedAt:         resolvedAt.Add(-time.Minute),
		ResolvedAt:        &resolvedAt,
	}).Error; err != nil {
		t.Fatalf("seed resolved interrupt: %v", err)
	}

	resumeContext, err := loadCollaborationResumeContext(context.Background(), db, "task-resume-context")
	if err != nil {
		t.Fatalf("load resume context: %v", err)
	}
	if resumeContext == nil || resumeContext.InterruptID != "decision-1" {
		t.Fatalf("expected resume context decision-1, got %+v", resumeContext)
	}

	prompt := appendCollaborationResumeContext("Base prompt.", resumeContext)
	required := []string{
		"Base prompt.",
		"Resolved human interrupt context:",
		"interrupt_id: decision-1",
		"human_decision",
		`{"question":"是否继续？"}`,
		`{"choice":"继续执行","block_id":"decision-1"}`,
		"authoritative input",
	}
	for _, value := range required {
		if !strings.Contains(prompt, value) {
			t.Fatalf("expected prompt to contain %q, got:\n%s", value, prompt)
		}
	}

	if err := markCollaborationResumeContextConsumed(context.Background(), db, "decision-1", "node-1", "turn-1"); err != nil {
		t.Fatalf("mark consumed: %v", err)
	}

	var consumed persistence.InterruptRequest
	if err := db.First(&consumed, "interrupt_id = ?", "decision-1").Error; err != nil {
		t.Fatalf("load consumed interrupt: %v", err)
	}
	if consumed.ConsumedAt == nil || consumed.ConsumedStepID != "node-1" || consumed.ConsumedTurnID != "turn-1" {
		t.Fatalf("expected consumed marker, got %+v", consumed)
	}

	resumeContext, err = loadCollaborationResumeContext(context.Background(), db, "task-resume-context")
	if err != nil {
		t.Fatalf("reload resume context: %v", err)
	}
	if resumeContext != nil {
		t.Fatalf("expected consumed resume context to be skipped, got %+v", resumeContext)
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
			Role:          collaborationRoleIntegrator,
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
		{ID: "node-s", AgentID: "agent-judge", Role: collaborationRoleIntegrator, Status: int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED), ResultSummary: "Final."},
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
		{ID: "node-s", AgentID: "agent-judge", Role: collaborationRoleIntegrator, Status: int32(model.TaskNodeStatus_TASK_NODE_STATUS_FAILED), ResultSummary: "No final."},
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

func TestEnginePolicyEvaluationReachesWithAuthoritySignoffAndResolvedObjection(t *testing.T) {
	task := &persistence.CollaborationTask{
		ID:       "task-engine-reached",
		MetaJSON: mergeStringMapJSON("", map[string]string{"engine_policy_runtime": "enabled", "engine_policy_authority_role": "goal_owner"}),
	}
	nodes := []persistence.CollaborationTaskNode{
		{Role: "risk", ResultSummary: `{"role":"risk","stance":"objection","text":"API quota risk.","evidenceRef":"risk:quota"}`},
		{Role: "architect", ResultSummary: `{"role":"architect","stance":"counter","text":"Backoff resolves quota risk."}`},
		{Role: "goal_owner", ResultSummary: `{"role":"goal_owner","stance":"signoff","text":"Approved."}`},
	}

	result := evaluateCollaborationEnginePolicy(task, nodes)
	if !result.Enabled || result.Phase != enginePolicyPhaseReached || !result.AuthoritySignoff || result.PendingObjections != 0 {
		t.Fatalf("expected reached consensus, got %+v", result)
	}
	meta := enginePolicyEvaluationMeta(result)
	if meta["engine_policy_phase"] != "reached" || meta["engine_policy_authority_signoff"] != "true" {
		t.Fatalf("unexpected engine policy meta: %#v", meta)
	}
}

func TestEnginePolicyEvaluationAwaitsHumanForEvidenceBackedObjection(t *testing.T) {
	task := &persistence.CollaborationTask{
		ID:       "task-engine-awaiting",
		MetaJSON: mergeStringMapJSON("", map[string]string{"engine_policy_runtime": "enabled", "engine_policy_authority_role": "goal_owner"}),
	}
	nodes := []persistence.CollaborationTaskNode{
		{Role: "risk", ResultSummary: `{"role":"risk","stance":"objection","text":"Cost risk.","evidenceRef":"risk:cost"}`},
		{Role: "goal_owner", ResultSummary: `{"role":"goal_owner","stance":"signoff","text":"Escalate for budget.","escalates":true}`},
	}

	result := evaluateCollaborationEnginePolicy(task, nodes)
	if result.Phase != enginePolicyPhaseAwaitingHuman || result.AuthoritySignoff || result.PendingObjections != 1 {
		t.Fatalf("expected awaiting human with one pending evidence objection, got %+v", result)
	}
	if result.HardVetoObjections != 1 {
		t.Fatalf("expected risk objection to count as hard veto, got %+v", result)
	}
}

func TestEnginePolicyEvaluationDowngradesObjectionWithoutEvidence(t *testing.T) {
	task := &persistence.CollaborationTask{
		ID:       "task-engine-concern",
		MetaJSON: mergeStringMapJSON("", map[string]string{"engine_policy_runtime": "enabled", "engine_policy_authority_role": "goal_owner"}),
	}
	nodes := []persistence.CollaborationTaskNode{
		{Role: "risk", ResultSummary: `{"role":"risk","stance":"objection","text":"I am uneasy."}`},
		{Role: "goal_owner", ResultSummary: `{"role":"goal_owner","stance":"signoff","text":"Approved."}`},
	}

	result := evaluateCollaborationEnginePolicy(task, nodes)
	if result.Phase != enginePolicyPhaseReached || result.PendingObjections != 0 || result.DowngradedConcerns != 1 {
		t.Fatalf("expected evidence-less objection to be downgraded, got %+v", result)
	}
}

func TestEnginePolicyEvaluationCountsVerifierAcceptanceVeto(t *testing.T) {
	task := &persistence.CollaborationTask{
		ID:       "task-engine-verifier-veto",
		MetaJSON: mergeStringMapJSON("", map[string]string{"engine_policy_runtime": "enabled", "engine_policy_authority_role": "goal_owner"}),
	}
	nodes := []persistence.CollaborationTaskNode{
		{Role: "verifier", ResultSummary: `{"role":"verifier","stance":"objection","text":"Acceptance evidence is missing.","evidenceRef":"acceptance:missing"}`},
		{Role: "goal_owner", ResultSummary: `{"role":"goal_owner","stance":"signoff","text":"Approved."}`},
	}

	result := evaluateCollaborationEnginePolicy(task, nodes)
	if result.Phase != enginePolicyPhaseAwaitingHuman || result.PendingObjections != 1 || result.AcceptanceVetoes != 1 {
		t.Fatalf("expected verifier acceptance veto to block consensus, got %+v", result)
	}
	meta := enginePolicyEvaluationMeta(result)
	if meta["engine_policy_acceptance_vetoes"] != "1" {
		t.Fatalf("expected acceptance veto metadata, got %#v", meta)
	}
}

func TestEnginePolicyEvaluationIgnoresExecutorJudgment(t *testing.T) {
	task := &persistence.CollaborationTask{
		ID:       "task-engine-executor-judgment",
		MetaJSON: mergeStringMapJSON("", map[string]string{"engine_policy_runtime": "enabled", "engine_policy_authority_role": "goal_owner"}),
	}
	nodes := []persistence.CollaborationTaskNode{
		{Role: "executor", ResultSummary: `{"role":"executor","stance":"objection","text":"Executor cannot veto acceptance.","evidenceRef":"executor:veto"}`},
		{Role: "executor", ResultSummary: `{"role":"executor","stance":"signoff","text":"Executor cannot approve."}`},
		{Role: "goal_owner", ResultSummary: `{"role":"goal_owner","stance":"signoff","text":"Approved."}`},
	}

	result := evaluateCollaborationEnginePolicy(task, nodes)
	if result.Phase != enginePolicyPhaseReached || result.PendingObjections != 0 || result.DowngradedConcerns != 2 {
		t.Fatalf("expected executor judgment to be downgraded and non-blocking, got %+v", result)
	}
}

func TestEnginePolicyEvaluationRejectsNonTerminalSignoff(t *testing.T) {
	task := &persistence.CollaborationTask{
		ID:       "task-engine-non-terminal-signoff",
		MetaJSON: mergeStringMapJSON("", map[string]string{"engine_policy_runtime": "enabled", "engine_policy_authority_role": "risk"}),
	}
	nodes := []persistence.CollaborationTaskNode{
		{Role: "risk", ResultSummary: `{"role":"risk","stance":"signoff","text":"Risk cannot terminally approve."}`},
	}

	result := evaluateCollaborationEnginePolicy(task, nodes)
	if result.Phase != enginePolicyPhaseAwaitingHuman || result.AuthoritySignoff {
		t.Fatalf("expected non-terminal signoff role to be ignored, got %+v", result)
	}
}

func TestEnginePolicyEvaluationPrefersDurableTaskEvents(t *testing.T) {
	task := &persistence.CollaborationTask{
		ID:       "task-engine-event-source",
		MetaJSON: mergeStringMapJSON("", map[string]string{"engine_policy_runtime": "enabled", "engine_policy_authority_role": "goal_owner"}),
	}
	nodes := []persistence.CollaborationTaskNode{
		{Role: "goal_owner", ResultSummary: `{"role":"goal_owner","stance":"signoff","text":"Node summary would approve."}`},
	}
	events := []persistence.TaskEvent{
		{
			EventSeq: 1,
			Payload: mustJSONString(map[string]interface{}{
				"role": "risk",
				"engine_policy_turn": map[string]interface{}{
					"role":        "risk",
					"stance":      "objection",
					"text":        "Durable event objection blocks approval.",
					"evidenceRef": "risk:event",
				},
			}),
		},
	}

	result := evaluateCollaborationEnginePolicy(task, nodes, events...)
	if result.Phase != enginePolicyPhaseAwaitingHuman || result.PendingObjections != 1 || result.AuthoritySignoff {
		t.Fatalf("expected durable event source to override node summary, got %+v", result)
	}
}

func TestNodeEventPayloadPersistsEnginePolicyTurn(t *testing.T) {
	task := &persistence.CollaborationTask{ID: "task-engine-payload"}
	node := &persistence.CollaborationTaskNode{ID: "node-risk", AgentID: "agent-risk", Role: "risk"}

	payload := nodeEventPayload(task, node, "turn-risk", `{"role":"risk","stance":"objection","text":"Quota risk.","evidenceRef":"risk:quota"}`, nil)
	turn, ok := payload["engine_policy_turn"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected engine_policy_turn payload, got %#v", payload)
	}
	if turn["stance"] != "objection" || turn["evidenceRef"] != "risk:quota" {
		t.Fatalf("unexpected engine policy turn payload: %#v", turn)
	}
}

func TestNodeEventPayloadPersistsTypedEnginePolicyTurn(t *testing.T) {
	task := &persistence.CollaborationTask{ID: "task-engine-typed-payload"}
	node := &persistence.CollaborationTaskNode{ID: "node-risk", AgentID: "agent-risk", Role: "risk"}

	payload := nodeEventPayload(task, node, "turn-risk", "plain summary", &model.EnginePolicyTurn{
		Role:        "risk",
		Stance:      model.EnginePolicyStance_ENGINE_POLICY_STANCE_OBJECTION,
		Text:        "Typed quota risk.",
		EvidenceRef: "risk:typed",
	})
	turn, ok := payload["engine_policy_turn"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected typed engine_policy_turn payload, got %#v", payload)
	}
	if turn["stance"] != "objection" || turn["evidenceRef"] != "risk:typed" || turn["text"] != "Typed quota risk." {
		t.Fatalf("unexpected typed engine policy turn payload: %#v", turn)
	}
}

func TestTaskEventRecordToProtoExposesTypedEnginePolicyTurn(t *testing.T) {
	record := &persistence.TaskEvent{
		ID:        "event-engine-policy-turn",
		TaskID:    "task-engine",
		StepID:    "node-risk",
		TurnID:    "turn-risk",
		EventSeq:  42,
		EventType: int32(model.TaskEventType_TASK_EVENT_TYPE_STEP_COMPLETED),
		Payload: `{
			"role":"risk",
			"result_summary":"fallback summary",
			"engine_policy_turn":{
				"role":"risk",
				"stance":"objection",
				"text":"Typed risk objection.",
				"evidenceRef":"risk:typed",
				"escalates":true
			}
		}`,
	}

	event := taskEventRecordToProto(record)
	turn := event.GetEnginePolicyTurn()
	if turn == nil {
		t.Fatalf("expected typed engine policy turn on task event")
	}
	if turn.GetRole() != "risk" ||
		turn.GetStance() != model.EnginePolicyStance_ENGINE_POLICY_STANCE_OBJECTION ||
		turn.GetText() != "Typed risk objection." ||
		turn.GetEvidenceRef() != "risk:typed" ||
		!turn.GetEscalates() {
		t.Fatalf("unexpected task event engine policy turn: %+v", turn)
	}
}

func TestTaskEventRecordToProtoDoesNotInferEnginePolicyTurnFromSummary(t *testing.T) {
	record := &persistence.TaskEvent{
		ID:        "event-engine-policy-summary",
		TaskID:    "task-engine",
		StepID:    "node-risk",
		TurnID:    "turn-risk",
		EventSeq:  43,
		EventType: int32(model.TaskEventType_TASK_EVENT_TYPE_STEP_COMPLETED),
		Payload:   `{"role":"risk","result_summary":"{\"role\":\"risk\",\"stance\":\"objection\",\"text\":\"summary only\",\"evidenceRef\":\"risk:summary\"}"}`,
	}

	event := taskEventRecordToProto(record)
	if event.GetEnginePolicyTurn() != nil {
		t.Fatalf("expected no typed turn when durable payload lacks explicit engine_policy_turn, got %+v", event.GetEnginePolicyTurn())
	}
}

func TestTaskEventRecordToProtoExposesTypedCollaborationSessionEvent(t *testing.T) {
	record := &persistence.TaskEvent{
		ID:        "event-session-lifecycle",
		TaskID:    "task-session",
		StepID:    "node-risk",
		TurnID:    "turn-risk",
		EventSeq:  44,
		EventType: int32(model.TaskEventType_TASK_EVENT_TYPE_STEP_COMPLETED),
		Payload: `{
                        "role":"risk",
                        "result_summary":"fallback summary",
                        "collaboration_session_event":{
                                "type":"convergence_evaluated",
                                "phase":"awaiting_human",
                                "role":"risk",
                                "engineType":"roundtable",
                                "roundIndex":2,
                                "convergenceMechanism":"terminal_signoff && pending_authority_objections == 0",
                                "evidenceRef":"risk:typed-session",
                                "summary":"Risk veto keeps session awaiting human.",
                                "requiresHuman":true
                        }
                }`,
	}

	event := taskEventRecordToProto(record)
	sessionEvent := event.GetCollaborationSessionEvent()
	if sessionEvent == nil {
		t.Fatalf("expected typed collaboration session event on task event")
	}
	if sessionEvent.GetType() != model.CollaborationSessionEventType_COLLABORATION_SESSION_EVENT_TYPE_CONVERGENCE_EVALUATED ||
		sessionEvent.GetPhase() != model.CollaborationSessionPhase_COLLABORATION_SESSION_PHASE_AWAITING_HUMAN ||
		sessionEvent.GetRole() != "risk" ||
		sessionEvent.GetEngineType() != model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_ROUNDTABLE ||
		sessionEvent.GetRoundIndex() != 2 ||
		sessionEvent.GetConvergenceMechanism() != "terminal_signoff && pending_authority_objections == 0" ||
		sessionEvent.GetEvidenceRef() != "risk:typed-session" ||
		sessionEvent.GetSummary() != "Risk veto keeps session awaiting human." ||
		!sessionEvent.GetRequiresHuman() {
		t.Fatalf("unexpected task event collaboration session event: %+v", sessionEvent)
	}
}

func TestTaskEventRecordToProtoDoesNotInferCollaborationSessionEventFromSummary(t *testing.T) {
	record := &persistence.TaskEvent{
		ID:        "event-session-summary",
		TaskID:    "task-session",
		StepID:    "node-risk",
		TurnID:    "turn-risk",
		EventSeq:  45,
		EventType: int32(model.TaskEventType_TASK_EVENT_TYPE_STEP_COMPLETED),
		Payload:   `{"role":"risk","result_summary":"{\"type\":\"awaiting_human\",\"phase\":\"awaiting_human\",\"summary\":\"summary only\"}"}`,
	}

	event := taskEventRecordToProto(record)
	if event.GetCollaborationSessionEvent() != nil {
		t.Fatalf("expected no typed session event when durable payload lacks explicit collaboration_session_event, got %+v", event.GetCollaborationSessionEvent())
	}
}

func TestValidateEnginePolicyTurnProtoRejectsInvalidTypedTurn(t *testing.T) {
	cases := []struct {
		name string
		turn *model.EnginePolicyTurn
		want string
	}{
		{
			name: "unspecified stance",
			turn: &model.EnginePolicyTurn{Role: "risk", Text: "risk"},
			want: "stance",
		},
		{
			name: "empty role",
			turn: &model.EnginePolicyTurn{Stance: model.EnginePolicyStance_ENGINE_POLICY_STANCE_OBJECTION, Text: "risk"},
			want: "role",
		},
		{
			name: "empty text",
			turn: &model.EnginePolicyTurn{Role: "risk", Stance: model.EnginePolicyStance_ENGINE_POLICY_STANCE_OBJECTION},
			want: "text",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			reason := validateEnginePolicyTurnProto(tc.turn)
			if !strings.Contains(reason, tc.want) {
				t.Fatalf("expected validation reason containing %q, got %q", tc.want, reason)
			}
		})
	}
	if reason := validateEnginePolicyTurnProto(&model.EnginePolicyTurn{
		Role:   "risk",
		Stance: model.EnginePolicyStance_ENGINE_POLICY_STANCE_OBJECTION,
		Text:   "Quota risk.",
	}); reason != "" {
		t.Fatalf("expected valid typed turn, got %q", reason)
	}
}

func TestEnginePolicyLoadErrorMetaPausesAwaitingHuman(t *testing.T) {
	meta := enginePolicyLoadErrorMeta(errors.New("event store unavailable"))
	if meta["engine_policy_phase"] != enginePolicyPhaseAwaitingHuman ||
		meta["engine_policy_source"] != "agent_task_events" ||
		!strings.Contains(meta["engine_policy_error"], "event store unavailable") {
		t.Fatalf("unexpected engine policy load error meta: %#v", meta)
	}
}

func TestFinishExecutedTaskPausesForEnginePolicyAwaitingHuman(t *testing.T) {
	db := openResumeCollaborationTaskDB(t, "engine_policy_finish_pauses")
	now := time.Date(2026, 7, 6, 10, 0, 0, 0, time.UTC)
	task := persistence.CollaborationTask{
		ID:            "task-engine-finish",
		Title:         "Engine policy finish",
		EngineType:    int32(model.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_ROUNDTABLE),
		Status:        int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		GoalOwnerPTID: "actor-1",
		MetaJSON:      mergeStringMapJSON("", map[string]string{"engine_policy_runtime": "enabled", "engine_policy_authority_role": "goal_owner"}),
		CreatedAt:     now,
		StartedAt:     now,
		EndedAt:       now,
	}
	nodes := []persistence.CollaborationTaskNode{
		{
			ID:            "node-risk",
			TaskID:        task.ID,
			AgentID:       "agent-risk",
			Role:          "risk",
			Status:        int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
			ResultSummary: `{"role":"goal_owner","stance":"signoff","text":"Node summary would approve."}`,
			StartedAt:     now,
			EndedAt:       now,
		},
	}
	seedResumeCollaborationTask(t, db, task, nodes)
	if err := db.Create(&persistence.TaskEvent{
		ID:        "evt-engine-objection",
		TaskID:    task.ID,
		StepID:    "node-risk",
		EventSeq:  1,
		EventType: int32(model.TaskEventType_TASK_EVENT_TYPE_STEP_COMPLETED),
		Payload: mustJSONString(map[string]interface{}{
			"role": "risk",
			"engine_policy_turn": map[string]interface{}{
				"role":        "risk",
				"stance":      "objection",
				"text":        "Durable objection blocks finish.",
				"evidenceRef": "risk:durable",
			},
		}),
		CreatedAt: now,
	}).Error; err != nil {
		t.Fatalf("create engine policy event: %v", err)
	}

	svc := &OrchestrationService{}
	_, _ = svc.finishExecutedTask(context.Background(), db, "actor-1", &task, nodes, false)

	var stored persistence.CollaborationTask
	if err := db.Where("id = ?", task.ID).First(&stored).Error; err != nil {
		t.Fatalf("load stored task: %v", err)
	}
	if got := model.CollaborationTaskStatus(stored.Status); got != model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED {
		t.Fatalf("expected EnginePolicy awaiting_human to pause task, got %v", got)
	}
	meta := map[string]string{}
	if err := json.Unmarshal([]byte(stored.MetaJSON), &meta); err != nil {
		t.Fatalf("decode task meta: %v", err)
	}
	if meta["engine_policy_phase"] != enginePolicyPhaseAwaitingHuman ||
		meta["engine_policy_pending_objections"] != "1" ||
		meta["engine_policy_source"] != "" ||
		meta["acceptance_verdict"] != "" {
		t.Fatalf("unexpected EnginePolicy finish meta: %+v", meta)
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
		{AgentID: "agent-judge", Role: collaborationRoleIntegrator, Status: int32(model.TaskNodeStatus_TASK_NODE_STATUS_PENDING)},
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
