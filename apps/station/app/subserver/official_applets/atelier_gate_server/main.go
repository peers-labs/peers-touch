package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	agentdomain "github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	agentevent "github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/event"
	agentmodel "github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	agentservice "github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

const (
	gateActorID                            = "atelier-real-product-gate-actor"
	gateAgentID                            = "atelier-real-product-gate-agent"
	gateTaskID                             = "atelier-real-product-gate-task"
	gateDecisionID                         = "atelier-real-product-gate-decision"
	gateBlockingDecisionID                 = "atelier-real-product-gate-blocking-decision"
	gateArtifactID                         = "atelier-real-product-gate-artifact"
	gateBlockingGateID                     = "atelier-real-product-blocking-gate"
	gateBlockingNodeID                     = "atelier-real-product-gate-node"
	gateScenarioArtifactGate               = "artifact_gate_blocking"
	gateScenarioLiveResume                 = "live_resume_provider"
	gateRecoveryActionEnv                  = "PEERS_ATELIER_GATE_RECOVERY_ACTION"
	gateFailureScenarioEnv                 = "PEERS_ATELIER_GATE_EVENT_REPLAY_FAILURE_SCENARIO"
	gateLiveResumeNodeID                   = "atelier-real-product-live-resume-node"
	gateLiveResumeProviderID               = "atelier-live-resume-provider"
	gateControlledProviderName             = "openai"
	gateControlledProviderModel            = "atelier-live-resume-model"
	gateArtifactRerunProviderFinalResponse = "Atelier artifact gate rerun provider recovery completed through Station orchestration."
	gateArtifactBodyText                   = "# Atelier blocking gate evidence\n\nStation-owned safe text artifact body for product-window fetch evidence.\n"
	gateArtifactBodyKind                   = "markdown"
	atelierMount                           = "/applets/atelier"
	agentEventAPI                          = "/sub-agent/agent/events/subscribe"
	providerCapabilitiesAPI                = "/sub-agent/agent/atelier/provider/capabilities"
)

type sqliteStore struct {
	db *gorm.DB
}

func (s *sqliteStore) Init(context.Context, ...option.Option) error { return nil }
func (s *sqliteStore) RDS(context.Context, ...store.RDSDMLOption) (*gorm.DB, error) {
	return s.db, nil
}
func (s *sqliteStore) Name() string { return "atelier-real-product-gate-store" }

type gateAtelierRuntime struct {
	projection    *agentservice.AtelierProjectionService
	orchestration *agentservice.OrchestrationService
	turn          *agentservice.TurnService
}

func createAtelierProjectionTables(db *gorm.DB) error {
	statements := []string{
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
		`CREATE TABLE agent_task_checkpoints (
			checkpoint_id text PRIMARY KEY,
			task_id text NOT NULL,
			event_seq integer NOT NULL,
			state_json text,
			versions_json text,
			pending_writes_cursor text,
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
	}
	for _, statement := range statements {
		if err := db.Exec(statement).Error; err != nil {
			return err
		}
	}
	return nil
}

func createAtelierOrchestrationTables(db *gorm.DB) error {
	statements := []string{
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
			eligible_executors text,
			result_summary text,
			started_at datetime NOT NULL,
			ended_at datetime
		)`,
		`CREATE TABLE agent_conversations (
                        id text PRIMARY KEY,
                        agent_id text,
                        user_id text NOT NULL,
                        title text NOT NULL,
                        description text,
                        provider_id text NOT NULL,
                        model_name text,
                        status text NOT NULL,
                        parent_id text,
                        config_json text,
                        meta text,
                        created_at datetime NOT NULL,
                        updated_at datetime NOT NULL
                )`,
		`CREATE TABLE agent_turns (
                        id text PRIMARY KEY,
                        conversation_id text NOT NULL,
                        agent_id text NOT NULL,
                        user_input text,
                        final_response text,
                        tool_iterations integer NOT NULL DEFAULT 0,
                        status text NOT NULL,
                        started_at datetime NOT NULL,
                        ended_at datetime
                )`,
		`CREATE TABLE agent_messages (
                        id text PRIMARY KEY,
                        conversation_id text NOT NULL,
                        turn_id text,
                        model_name text,
                        role text NOT NULL,
                        content text,
                        reasoning_json text,
                        tool_calls_json text,
                        metadata_json text,
                        error_json text,
                        created_at datetime NOT NULL,
                        updated_at datetime NOT NULL
                )`,
		`CREATE TABLE agent_turn_traces (
                        id text PRIMARY KEY,
                        turn_id text NOT NULL,
                        system_prompt_hash text,
                        memory_snapshot_hash text,
                        skill_index_hash text,
                        skills_loaded text,
                        tool_calls text,
                        provider_calls text,
                        review_triggered boolean NOT NULL DEFAULT false,
                        errors_classified text,
                        compression_triggered boolean NOT NULL DEFAULT false,
                        compression_before integer,
                        compression_after integer,
                        delegation_results text,
                        knowledge_chunks text
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
		`CREATE TABLE agent_memory_events (
                        id text PRIMARY KEY,
                        type text NOT NULL,
                        memory_id text NOT NULL DEFAULT '',
                        session_id text NOT NULL DEFAULT '',
                        agent_id text NOT NULL DEFAULT '',
                        layer text NOT NULL DEFAULT '',
                        detail text NOT NULL DEFAULT '',
                        latency_ms integer NOT NULL DEFAULT 0,
                        created_at datetime NOT NULL
                )`,
		`CREATE TABLE agent_skills (
                        id text PRIMARY KEY,
                        agent_id text NOT NULL,
                        name text NOT NULL,
                        description text NOT NULL,
                        category text,
                        platforms text,
                        conditions text,
                        content text NOT NULL,
                        source text,
                        trust_level text NOT NULL DEFAULT 'community',
                        scan_verdict text,
                        enabled boolean NOT NULL DEFAULT true,
                        version integer NOT NULL DEFAULT 1,
                        view_count integer NOT NULL DEFAULT 0,
                        apply_count integer NOT NULL DEFAULT 0,
                        patch_count integer NOT NULL DEFAULT 0,
                        last_used_at datetime,
                        created_at datetime NOT NULL,
                        updated_at datetime NOT NULL
                )`,
		`CREATE TABLE agent_providers (
                        id text PRIMARY KEY,
                        name text NOT NULL,
                        key_vaults text,
                        config text,
                        source_type text,
                        check_model text,
                        runtime_kind text,
                        cli_command text,
                        protocol text,
                        enabled boolean NOT NULL DEFAULT true,
                        created_at datetime NOT NULL,
                        updated_at datetime NOT NULL
                )`,
		`CREATE TABLE agent_credential_pool (
                        id text PRIMARY KEY,
                        provider text NOT NULL,
                        label text,
                        auth_type text NOT NULL,
                        priority integer NOT NULL DEFAULT 0,
                        source text NOT NULL,
                        status text NOT NULL DEFAULT 'active',
                        request_count integer NOT NULL DEFAULT 0,
                        exhausted_at datetime,
                        cooldown_until datetime,
                        created_at datetime NOT NULL,
                        updated_at datetime NOT NULL
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
	}
	for _, statement := range statements {
		if err := db.Exec(statement).Error; err != nil {
			return err
		}
	}
	return nil
}

type replayProbe struct {
	mu                          sync.Mutex
	requests                    []replayProbeRequest
	closedBeforeFirstReplayOnce bool
}

type replayProbeRequest struct {
	AgentID       string  `json:"agentId"`
	TaskID        string  `json:"taskId"`
	AfterEventSeq int64   `json:"afterEventSeq"`
	ReplayedSeqs  []int64 `json:"replayedSeqs"`
}

type createProbe struct {
	mu       sync.Mutex
	requests []createProbeRequest
}

type resolveProbe struct {
	mu       sync.Mutex
	requests []resolveProbeRequest
}

type createProbeRequest struct {
	Goal              string `json:"goal"`
	TaskID            string `json:"taskId"`
	SelectedTaskID    string `json:"selectedTaskId"`
	TaskCount         int    `json:"taskCount"`
	NodeCount         int    `json:"nodeCount"`
	EventCount        int    `json:"eventCount"`
	ProviderPlanCount int    `json:"providerPlanCount"`
}

type resolveProbeRequest struct {
	TaskID                  string `json:"taskId"`
	BlockID                 string `json:"blockId"`
	Choice                  string `json:"choice"`
	TaskStatus              int32  `json:"taskStatus"`
	ResolvedEventCount      int    `json:"resolvedEventCount"`
	PendingInterrupts       int    `json:"pendingInterrupts"`
	ResolvedInterrupts      int    `json:"resolvedInterrupts"`
	HumanDecisionRoute      string `json:"humanDecisionRoute"`
	HumanDecisionAction     string `json:"humanDecisionAction"`
	HumanDecisionReason     string `json:"humanDecisionReason"`
	HumanDecisionTransition string `json:"humanDecisionTransition"`
}

type providerProbe struct {
	mu       sync.Mutex
	requests []providerProbeRequest
}

type providerProbeRequest struct {
	CallIndex    int    `json:"callIndex"`
	Scenario     string `json:"scenario"`
	Model        string `json:"model"`
	MessageCount int    `json:"messageCount"`
	WaitTool     bool   `json:"waitTool"`
	Final        bool   `json:"final"`
}

func (p *createProbe) record(request createProbeRequest) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.requests = append(p.requests, request)
}

func (p *createProbe) snapshot() []createProbeRequest {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]createProbeRequest(nil), p.requests...)
}

func (p *resolveProbe) record(request resolveProbeRequest) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.requests = append(p.requests, request)
}

func (p *resolveProbe) snapshot() []resolveProbeRequest {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]resolveProbeRequest(nil), p.requests...)
}

func (p *providerProbe) record(request providerProbeRequest) {
	p.mu.Lock()
	defer p.mu.Unlock()
	request.CallIndex = len(p.requests) + 1
	p.requests = append(p.requests, request)
}

func (p *providerProbe) snapshot() []providerProbeRequest {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]providerProbeRequest(nil), p.requests...)
}

func (p *replayProbe) record(request replayProbeRequest) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.requests = append(p.requests, request)
}

func (p *replayProbe) snapshot() []replayProbeRequest {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]replayProbeRequest(nil), p.requests...)
}

func (p *replayProbe) consumeCloseBeforeFirstReplay(afterEventSeq int64) bool {
	if afterEventSeq > 0 || strings.TrimSpace(os.Getenv("PEERS_ATELIER_GATE_CLOSE_BEFORE_FIRST_REPLAY")) != "1" {
		return false
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closedBeforeFirstReplayOnce {
		return false
	}
	p.closedBeforeFirstReplayOnce = true
	return true
}

func main() {
	if err := run(context.Background()); err != nil {
		os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
	secret, err := randomSecret()
	if err != nil {
		return err
	}
	coreauth.Init(coreauth.Config{Secret: secret, AccessTTL: time.Hour})
	provider := coreauth.NewJWTProvider(secret, time.Hour)
	_, token, err := provider.Authenticate(ctx, coreauth.Credentials{
		SubjectID: gateActorID,
		SessionID: "atelier-real-product-gate-session",
	})
	if err != nil {
		return err
	}

	db, err := gorm.Open(sqlite.Open("file:atelier-real-product-gate?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		return err
	}
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	sqlDB.SetMaxOpenConns(1)
	if err := db.Exec(`CREATE TABLE agent_collaboration_tasks (
		id text PRIMARY KEY,
		title text NOT NULL,
		description text,
		engine_type integer NOT NULL DEFAULT 0,
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
	)`).Error; err != nil {
		return err
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
		return err
	}
	if err := db.Exec(`CREATE TABLE agent_task_runs (
		task_id text PRIMARY KEY,
		title text,
		description text,
		surface integer NOT NULL,
		status integer NOT NULL,
		owner_actor_id text NOT NULL,
		workspace_id text,
		conversation_id text,
		root_turn_id text,
		current_checkpoint_id text,
		meta_json text,
		created_at datetime NOT NULL,
		started_at datetime NOT NULL,
		updated_at datetime NOT NULL,
		ended_at datetime
	)`).Error; err != nil {
		return err
	}
	if err := db.Exec(`CREATE TABLE agent_interrupt_requests (
		interrupt_id text PRIMARY KEY,
		task_id text NOT NULL,
		step_id text,
		turn_id text,
		interrupt_type text,
		status integer NOT NULL,
		payload_json text,
		resume_payload_json text,
		created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
		resolved_at datetime,
		consumed_at datetime,
		consumed_step_id text,
		consumed_turn_id text
	)`).Error; err != nil {
		return err
	}
	if err := createAtelierProjectionTables(db); err != nil {
		return err
	}
	if err := createAtelierOrchestrationTables(db); err != nil {
		return err
	}
	if err := db.Exec(`CREATE TABLE agents (
		id text PRIMARY KEY,
		name text NOT NULL,
		title text,
		description text,
		provider_id text,
		model_name text,
		effort text,
		visibility text NOT NULL,
		owner_actor_id text NOT NULL,
		config_json text,
		created_at datetime NOT NULL,
		updated_at datetime NOT NULL
	)`).Error; err != nil {
		return err
	}
	now := time.Now().UTC()
	scenario := strings.TrimSpace(os.Getenv("PEERS_ATELIER_GATE_SCENARIO"))
	recoveryAction := strings.TrimSpace(os.Getenv(gateRecoveryActionEnv))
	agentConfig := `{"executorKind":"desktop_device"}`
	agentProviderID := ""
	agentModelName := ""
	if scenario == gateScenarioArtifactGate && recoveryAction == "rerun_failed_node" {
		agentConfig = `{"executorKind":"station_hosted"}`
		agentProviderID = gateControlledProviderName
		agentModelName = gateControlledProviderModel
	}
	if err := db.Exec(`INSERT INTO agents (
		id, name, title, description, provider_id, model_name, effort,
		visibility, owner_actor_id, config_json, created_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		gateAgentID,
		"Atelier Product Window Gate Agent",
		"Atelier Product Window Gate Agent",
		"Desktop executor fixture for Atelier product-window createFromGoal gate",
		agentProviderID,
		agentModelName,
		"",
		string(agentdomain.AgentVisibilityPrivate),
		gateActorID,
		agentConfig,
		now,
		now,
	).Error; err != nil {
		return err
	}
	decisionID := gateDecisionID
	taskStatus := int32(agentmodel.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING)
	taskMetaValues := map[string]string{
		"agent_ids":      fmt.Sprintf(`["%s"]`, gateAgentID),
		"atelier_status": "active",
		"project":        "peers-touch",
		"source":         "atelier.product-window-gate",
	}
	if scenario == gateScenarioArtifactGate {
		decisionID = gateBlockingDecisionID
		taskStatus = int32(agentmodel.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED)
		taskMetaValues["gate_blocked"] = "true"
		taskMetaValues["gate_blocked_id"] = gateBlockingGateID
		taskMetaValues["gate_blocked_summary"] = "Atelier product-window blocking gate failed."
		taskMetaValues["gate_blocked_node"] = gateBlockingNodeID
	} else if scenario == gateScenarioLiveResume {
		taskStatus = int32(agentmodel.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_PAUSED)
		taskMetaValues["resume_state"] = "awaiting_live_human_decision"
		taskMetaValues["live_resume_interrupt_id"] = decisionID
	}
	taskMeta, err := json.Marshal(taskMetaValues)
	if err != nil {
		return err
	}
	if err := db.Exec(`INSERT INTO agent_collaboration_tasks (
                id, title, description, engine_type, status, goal_owner_id, workspace_id,
                budget_tokens, budget_money, budget_time_ms, meta_json, created_at, started_at, ended_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		gateTaskID,
		"Atelier Real Product Gate",
		"Seed task for Atelier real product event replay gate",
		int32(agentmodel.CollaborationEngineType_COLLABORATION_ENGINE_TYPE_EXPERT_HIERARCHY),
		taskStatus,
		gateActorID,
		"peers-touch",
		float64(32000),
		float64(0),
		int64(0),
		string(taskMeta),
		now,
		now,
		now,
	).Error; err != nil {
		return err
	}
	if err := db.Exec(`INSERT INTO agent_task_runs (
		task_id, title, description, surface, status, owner_actor_id, workspace_id,
		conversation_id, root_turn_id, current_checkpoint_id, meta_json, created_at, started_at, updated_at, ended_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		gateTaskID,
		"Atelier Real Product Gate",
		"Seed task for Atelier real product event replay gate",
		1,
		taskStatus,
		gateActorID,
		"",
		"atelier-real-product-gate-conversation",
		"",
		"",
		"{}",
		now,
		now,
		now,
		nil,
	).Error; err != nil {
		return err
	}
	if scenario == gateScenarioArtifactGate {
		if err := db.Exec(`INSERT INTO agent_collaboration_task_nodes (
                        id, task_id, parent_node_id, agent_id, role, description, status,
                        prerequisite_node_ids, result_summary, started_at, ended_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			gateBlockingNodeID,
			gateTaskID,
			"",
			gateAgentID,
			"Verifier",
			"Atelier product-window blocking gate node",
			int32(agentmodel.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED),
			"[]",
			"Artifact produced; blocking gate failed for recovery proof.",
			now,
			now,
		).Error; err != nil {
			return err
		}
		gatePlanJSON, err := json.Marshal(map[string]any{
			"gatePlanId": "atelier-real-product-blocking-plan",
			"taskId":     gateTaskID,
			"stepId":     gateBlockingNodeID,
			"status":     "blocked",
			"gates": []map[string]any{{
				"gateId":        gateBlockingGateID,
				"name":          "Atelier Product Blocking Gate",
				"blockingLevel": "block",
			}},
		})
		if err != nil {
			return err
		}
		if err := db.Exec(`INSERT INTO agent_task_gate_plans (
                        gate_plan_id, task_id, step_id, source, status, plan_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			"atelier-real-product-blocking-plan",
			gateTaskID,
			gateBlockingNodeID,
			"station.gate_runner",
			"blocked",
			string(gatePlanJSON),
			now,
			now,
		).Error; err != nil {
			return err
		}
	} else if scenario == gateScenarioLiveResume {
		if err := db.Exec(`INSERT INTO agent_collaboration_task_nodes (
                        id, task_id, parent_node_id, agent_id, role, description, status,
                        prerequisite_node_ids, result_summary, started_at, ended_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			gateLiveResumeNodeID,
			gateTaskID,
			"",
			gateAgentID,
			"Executor",
			"Atelier product-window live resume provider node",
			int32(agentmodel.TaskNodeStatus_TASK_NODE_STATUS_RUNNING),
			"[]",
			"Station provider turn is waiting for human decision resume.",
			now,
			now,
		).Error; err != nil {
			return err
		}
	}
	seededEvents := []struct {
		id        string
		seq       int64
		eventType agentmodel.TaskEventType
		payload   map[string]any
	}{
		{
			id:        "atelier-real-product-event-1",
			seq:       1,
			eventType: agentmodel.TaskEventType_TASK_EVENT_TYPE_TASK_CREATED,
			payload: map[string]any{
				"agent_id": gateAgentID,
				"task_id":  gateTaskID,
				"text":     "Atelier real product projection replay",
			},
		},
		{
			id:        "atelier-real-product-event-2",
			seq:       2,
			eventType: agentmodel.TaskEventType_TASK_EVENT_TYPE_TASK_CREATED,
			payload: map[string]any{
				"agent_id": gateAgentID,
				"task_id":  gateTaskID,
				"text":     "Atelier real product cursor replay",
			},
		},
		{
			id:        "atelier-real-product-event-3",
			seq:       3,
			eventType: agentmodel.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_REQUESTED,
			payload: map[string]any{
				"agent_id":              gateAgentID,
				"task_id":               gateTaskID,
				"block_kind":            "human_decision",
				"interrupt_id":          decisionID,
				"block_id":              decisionID,
				"interrupt_type":        "human_decision",
				"human_decision_reason": "budget",
				"question":              "继续 Atelier product-window decision resolve gate?",
				"description":           "Station pending human decision for Atelier product-window P3-05 gate",
				"spent_so_far":          "controlled product-window certification",
				"rollback_impact":       "No provider execution is started by the applet; Station guarded resume owns the transition.",
				"options": []map[string]any{
					{"id": "continue", "text": "继续执行", "action": "continue", "recommended": true},
					{"id": "cancel", "text": "取消任务", "action": "cancel", "recommended": false},
				},
			},
		},
	}
	if scenario == gateScenarioArtifactGate {
		artifactBodyHash := gateArtifactBodyHash(gateArtifactBodyText)
		artifactBodyRef := fmt.Sprintf("artifact://%s/%s/body", gateTaskID, gateArtifactID)
		seededEvents = []struct {
			id        string
			seq       int64
			eventType agentmodel.TaskEventType
			payload   map[string]any
		}{
			{
				id:        "atelier-real-product-artifact-gate-event-1",
				seq:       1,
				eventType: agentmodel.TaskEventType_TASK_EVENT_TYPE_TASK_CREATED,
				payload: map[string]any{
					"agent_id": gateAgentID,
					"task_id":  gateTaskID,
					"text":     "Atelier product-window artifact/gate recovery scenario",
				},
			},
			{
				id:        "atelier-real-product-artifact-gate-event-2",
				seq:       2,
				eventType: agentmodel.TaskEventType_TASK_EVENT_TYPE_ARTIFACT_CREATED,
				payload: map[string]any{
					"agent_id":              gateAgentID,
					"task_id":               gateTaskID,
					"node_id":               gateBlockingNodeID,
					"block_kind":            "artifact",
					"artifact_id":           gateArtifactID,
					"id":                    gateArtifactID,
					"name":                  "Atelier blocking gate evidence",
					"kind":                  "markdown",
					"uri":                   fmt.Sprintf("artifact://%s/%s", gateTaskID, gateArtifactID),
					"checksum":              "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
					"produced_by":           "station.gate_runner",
					"preview_hint":          "markdown",
					"body_ref":              artifactBodyRef,
					"body_kind":             gateArtifactBodyKind,
					"body_size":             len([]byte(gateArtifactBodyText)),
					"body_hash":             artifactBodyHash,
					"body_retention_policy": "station_managed",
					"body_retention_status": "active",
				},
			},
			{
				id:        "atelier-real-product-artifact-gate-event-3",
				seq:       3,
				eventType: agentmodel.TaskEventType_TASK_EVENT_TYPE_GATE_RESULT,
				payload: map[string]any{
					"agent_id":     gateAgentID,
					"task_id":      gateTaskID,
					"node_id":      gateBlockingNodeID,
					"block_kind":   "gate_result",
					"source":       "station.gate_runner",
					"gate_id":      gateBlockingGateID,
					"gate_plan_id": "atelier-real-product-blocking-plan",
					"name":         "Atelier Product Blocking Gate",
					"status":       "failed",
					"summary":      "Blocking gate failed for Atelier product-window recovery proof.",
					"blocking":     true,
					"artifact_ids": []string{gateArtifactID},
					"checks": []map[string]any{{
						"name":   "typecheck",
						"status": "failed",
						"detail": "Controlled Station GateRunner fixture failure.",
					}},
				},
			},
			{
				id:        "atelier-real-product-artifact-gate-event-4",
				seq:       4,
				eventType: agentmodel.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_REQUESTED,
				payload: map[string]any{
					"agent_id":              gateAgentID,
					"task_id":               gateTaskID,
					"block_kind":            "human_decision",
					"interrupt_id":          decisionID,
					"block_id":              decisionID,
					"interrupt_type":        "human_decision",
					"reason":                "gate_blocked",
					"human_decision_reason": "gate_blocked",
					"gate_id":               gateBlockingGateID,
					"node_id":               gateBlockingNodeID,
					"question":              "Station blocking gate failed. Choose the Station recovery route.",
					"description":           "Station-owned blocking gate recovery proof for Atelier product-window P3-06.",
					"rollback_impact":       "No applet-owned execution is started; Station guarded recovery owns the transition.",
					"options": []map[string]any{
						{"id": "rerun_failed_node", "text": "Rerun failed node", "action": "rerun_failed_node", "recommended": true},
						{"id": "accept_risk", "text": "Accept risk", "action": "accept_risk", "recommended": false},
						{"id": "continue", "text": "Continue", "action": "continue", "recommended": false},
						{"id": "cancel", "text": "Cancel task", "action": "cancel", "recommended": false},
					},
				},
			},
		}
	}
	if scenario == gateScenarioArtifactGate {
		artifactBodyRef := fmt.Sprintf("artifact://%s/%s/body", gateTaskID, gateArtifactID)
		artifactPayload, err := json.Marshal(map[string]any{
			"bodyRef":         artifactBodyRef,
			"bodyHash":        gateArtifactBodyHash(gateArtifactBodyText),
			"bodySize":        len([]byte(gateArtifactBodyText)),
			"bodyKind":        gateArtifactBodyKind,
			"previewHint":     "markdown",
			"retentionPolicy": "station_managed",
			"retentionStatus": "active",
		})
		if err != nil {
			return err
		}
		if err := db.Exec(`INSERT INTO agent_task_artifacts (
			artifact_id, task_id, step_id, turn_id, event_id, event_seq, run_id,
			kind, name, uri, checksum, produced_by, refs_json, payload_json, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			gateArtifactID,
			gateTaskID,
			gateBlockingNodeID,
			"",
			"atelier-real-product-artifact-gate-event-2",
			int64(2),
			"",
			"markdown",
			"Atelier blocking gate evidence",
			fmt.Sprintf("artifact://%s/%s", gateTaskID, gateArtifactID),
			gateArtifactBodyHash(gateArtifactBodyText),
			"station.gate_runner",
			"[]",
			string(artifactPayload),
			now,
		).Error; err != nil {
			return err
		}
		if err := db.Exec(`INSERT INTO agent_task_artifact_blobs (
                        blob_id, artifact_id, task_id, step_id, turn_id, event_id, event_seq,
                        body_kind, body_uri, content_hash, byte_size, retention_policy,
                        retention_status, body_text, created_at, expires_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			"atelier-real-product-gate-artifact-body",
			gateArtifactID,
			gateTaskID,
			gateBlockingNodeID,
			"",
			"atelier-real-product-artifact-gate-event-2",
			int64(2),
			gateArtifactBodyKind,
			artifactBodyRef,
			gateArtifactBodyHash(gateArtifactBodyText),
			int64(len([]byte(gateArtifactBodyText))),
			"station_managed",
			"active",
			gateArtifactBodyText,
			now,
			nil,
		).Error; err != nil {
			return err
		}
	}
	for _, seededEvent := range seededEvents {
		eventPayload, err := json.Marshal(seededEvent.payload)
		if err != nil {
			return err
		}
		eventStepID := ""
		if scenario == gateScenarioLiveResume && seededEvent.eventType == agentmodel.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_REQUESTED {
			eventStepID = gateLiveResumeNodeID
		}
		if err := db.Exec(`INSERT INTO agent_task_events (
                        id, task_id, step_id, turn_id, event_seq, event_type, payload, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			seededEvent.id,
			gateTaskID,
			eventStepID,
			"",
			seededEvent.seq,
			int32(seededEvent.eventType),
			string(eventPayload),
			now,
		).Error; err != nil {
			return err
		}
		if seededEvent.eventType == agentmodel.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_REQUESTED {
			if err := db.Exec(`INSERT INTO agent_interrupt_requests (
				interrupt_id, task_id, step_id, turn_id, interrupt_type, status,
				payload_json, resume_payload_json, created_at, resolved_at, consumed_at,
				consumed_step_id, consumed_turn_id
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				decisionID,
				gateTaskID,
				eventStepID,
				"",
				"human_decision",
				int32(agentmodel.InterruptStatus_INTERRUPT_STATUS_PENDING),
				string(eventPayload),
				"",
				now,
				nil,
				nil,
				"",
				"",
			).Error; err != nil {
				return err
			}
		}
	}
	if err := store.InjectStore(ctx, &sqliteStore{db: db}); err != nil && !errors.Is(err, store.ErrStoreAlreadyInjected) {
		return err
	}

	probe := &replayProbe{}
	createdProbe := &createProbe{}
	resolvedProbe := &resolveProbe{}
	runtime := newGateAtelierRuntime()
	projectionService := runtime.projection
	providerProbe := &providerProbe{}
	eventStreamService := agentservice.NewEventStreamService(noopEventBus{})
	authenticated := httpadapter.RequireJWT(provider)(ctx, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		subject := coreauth.GetSubject(request.Context())
		if subject == nil || strings.TrimSpace(subject.ID) == "" {
			http.Error(response, "authenticated subject is missing", http.StatusUnauthorized)
			return
		}
		switch {
		case request.Method == http.MethodGet && request.URL.Path == atelierMount+"/v1/workspace":
			snapshot, err := projectionService.LoadWorkspace(request.Context(), subject.ID, &agentservice.LoadAtelierWorkspaceRequest{})
			if err != nil {
				http.Error(response, err.Error(), http.StatusInternalServerError)
				return
			}
			response.Header().Set("Content-Type", "application/json")
			response.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(response).Encode(snapshot)
		case request.Method == http.MethodPost && request.URL.Path == atelierMount+"/v1/projects":
			handleCreateProject(response, request, db, projectionService, subject.ID, createdProbe)
		case request.Method == http.MethodPost && request.URL.Path == atelierMount+"/v1/escalations:resolve":
			handleResolveDecision(response, request, db, projectionService, subject.ID, resolvedProbe)
		case request.Method == http.MethodPost && request.URL.Path == atelierMount+"/v1/artifact/body/fetch":
			handleFetchArtifactBody(response, request, projectionService, subject.ID)
		case request.Method == http.MethodPost && request.URL.Path == "/sub-agent/agent/atelier/artifact/body/fetch":
			handleFetchArtifactBody(response, request, projectionService, subject.ID)
		case request.Method == http.MethodPost && request.URL.Path == agentEventAPI:
			handleEventReplay(response, request, eventStreamService, subject.ID, probe)
		case request.Method == http.MethodPost && request.URL.Path == providerCapabilitiesAPI:
			handleProviderCapabilities(response, request, projectionService, subject.ID)
		default:
			http.NotFound(response, request)
		}
	}))

	mux := http.NewServeMux()
	mux.Handle(atelierMount+"/", authenticated)
	mux.Handle(agentEventAPI, authenticated)
	mux.Handle(providerCapabilitiesAPI, authenticated)
	mux.Handle("/sub-agent/agent/atelier/artifact/body/fetch", authenticated)
	mux.HandleFunc("/__atelier_gate/replay_probe", func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		response.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(response).Encode(map[string]any{"requests": probe.snapshot()})
	})
	mux.HandleFunc("/__atelier_gate/create_probe", func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		response.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(response).Encode(map[string]any{"requests": createdProbe.snapshot()})
	})
	mux.HandleFunc("/__atelier_gate/resolve_probe", func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		response.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(response).Encode(map[string]any{"requests": resolvedProbe.snapshot()})
	})
	mux.HandleFunc("/__atelier_gate/artifact_gate_probe", func(response http.ResponseWriter, _ *http.Request) {
		handleArtifactGateProbe(response, db, providerProbe)
	})
	mux.HandleFunc("/__atelier_gate/provider/v1/chat/completions", func(response http.ResponseWriter, request *http.Request) {
		handleLiveResumeProvider(response, request, providerProbe)
	})
	mux.HandleFunc("/__atelier_gate/provider_probe", func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		response.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(response).Encode(map[string]any{"requests": providerProbe.snapshot()})
	})
	mux.HandleFunc("/__atelier_gate/live_resume_probe", func(response http.ResponseWriter, _ *http.Request) {
		handleLiveResumeProbe(response, db, providerProbe)
	})
	mux.HandleFunc("/healthz", func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		response.WriteHeader(http.StatusOK)
		response.Write([]byte(`{"ok":true}`))
	})

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	baseURL := "http://" + listener.Addr().String()
	if (scenario == gateScenarioArtifactGate && strings.TrimSpace(os.Getenv(gateRecoveryActionEnv)) == "rerun_failed_node") ||
		scenario == gateScenarioLiveResume {
		if err := seedLiveResumeProviderRuntime(db, baseURL, now); err != nil {
			return err
		}
	}

	server := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	errCh := make(chan error, 1)
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()
	if scenario == gateScenarioLiveResume {
		go runLiveResumeProviderTurn(context.Background(), runtime.turn)
	}

	ready := map[string]string{
		"baseUrl": baseURL,
		"token":   token.Value,
		"agentId": gateAgentID,
		"taskId":  gateTaskID,
	}
	payload, err := json.Marshal(ready)
	if err != nil {
		return err
	}
	os.Stdout.Write(append(payload, '\n'))

	signalCh := make(chan os.Signal, 1)
	signal.Notify(signalCh, os.Interrupt, syscall.SIGTERM)
	select {
	case err := <-errCh:
		return err
	case <-signalCh:
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return server.Shutdown(shutdownCtx)
	}
}

func newGateAtelierRuntime() *gateAtelierRuntime {
	eventBus := agentevent.NewMemoryEventBus()
	growthMetricsSvc := agentservice.NewGrowthMetricsService()
	diagnosticSvc := agentservice.NewGrowthDiagnosticService()
	growthMetricsSvc.SetDiagnosticService(diagnosticSvc)

	agentSvc := agentservice.NewAgentService()
	memorySvc := agentservice.NewMemoryService(growthMetricsSvc)
	skillGuardSvc := agentservice.NewSkillsGuardService()
	skillSvc := agentservice.NewSkillService(skillGuardSvc, growthMetricsSvc)
	errorClassifierSvc := agentservice.NewErrorClassifierService()
	promptAssemblySvc := agentservice.NewPromptAssemblyService(memorySvc, skillSvc)
	compressionSvc := agentservice.NewCompressionService()
	promptCachingSvc := agentservice.NewPromptCachingService()
	providerSvc := agentservice.NewProviderService(promptCachingSvc)
	credentialPoolSvc := agentservice.NewCredentialPoolService()
	delegationSvc := agentservice.NewDelegationService()
	toolRegistrySvc := agentservice.NewToolRegistryService(memorySvc, skillSvc)
	convSvc := agentservice.NewConversationService()
	reviewSvc := agentservice.NewReviewService(
		credentialPoolSvc,
		errorClassifierSvc,
		providerSvc,
		memorySvc,
		skillSvc,
		toolRegistrySvc,
		growthMetricsSvc,
	)
	turnSvc := agentservice.NewTurnService(
		errorClassifierSvc,
		memorySvc,
		skillSvc,
		promptAssemblySvc,
		compressionSvc,
		providerSvc,
		credentialPoolSvc,
		delegationSvc,
		toolRegistrySvc,
		reviewSvc,
		growthMetricsSvc,
		convSvc,
	)
	turnSvc.SetEventBus(eventBus)
	orchestrationSvc := agentservice.NewOrchestrationService(agentSvc, turnSvc, toolRegistrySvc)
	orchestrationSvc.SetEventBus(eventBus)
	return &gateAtelierRuntime{
		projection:    agentservice.NewAtelierProjectionService(orchestrationSvc),
		orchestration: orchestrationSvc,
		turn:          turnSvc,
	}
}

func seedLiveResumeProviderRuntime(db *gorm.DB, baseURL string, now time.Time) error {
	providerConfig, err := json.Marshal(map[string]any{
		"base_url": strings.TrimRight(baseURL, "/") + "/__atelier_gate/provider/v1",
	})
	if err != nil {
		return err
	}
	if err := db.Exec(`INSERT INTO agent_providers (
                id, name, key_vaults, config, source_type, check_model, runtime_kind,
                cli_command, protocol, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		gateLiveResumeProviderID,
		"Atelier Live Resume Controlled Provider",
		`{"api_key":"atelier-live-resume-token"}`,
		[]byte(providerConfig),
		"openai",
		"atelier-live-resume-model",
		"station",
		"",
		"openai_compatible",
		true,
		now,
		now,
	).Error; err != nil {
		return err
	}
	if err := db.Exec(`INSERT INTO agent_credential_pool (
                id, provider, label, auth_type, priority, source, status,
                request_count, exhausted_at, cooldown_until, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		gateLiveResumeProviderID,
		"openai",
		"Atelier live resume credential",
		"api_key",
		1,
		"controlled_gate",
		"active",
		0,
		nil,
		nil,
		now,
		now,
	).Error; err != nil {
		return err
	}
	conversationModel := "atelier-live-resume-model"
	if err := db.Exec(`INSERT INTO agent_conversations (
                id, agent_id, user_id, title, description, provider_id, model_name,
                status, parent_id, config_json, meta, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"atelier-live-resume-conversation",
		gateAgentID,
		gateActorID,
		"Atelier live resume provider turn",
		"",
		gateControlledProviderName,
		conversationModel,
		"active",
		nil,
		"{}",
		"{}",
		now,
		now,
	).Error; err != nil {
		return err
	}
	return nil
}

func runLiveResumeProviderTurn(ctx context.Context, turnSvc *agentservice.TurnService) {
	if turnSvc == nil {
		return
	}
	_, _ = turnSvc.ExecuteTurn(ctx, &agentservice.TurnConfig{
		AgentID:           gateAgentID,
		ConversationID:    "atelier-live-resume-conversation",
		Identity:          "Atelier live resume controlled executor",
		AgentConfigPrompt: "Use station_human_decision_resume when asked to wait for a Station-owned human decision.",
		Platform:          "station",
		AvailableTools:    []string{"station_human_decision_resume"},
		ContextWindowSize: 8000,
		MaxRetries:        1,
		Provider:          "openai",
		Model:             "atelier-live-resume-model",
		TaskID:            gateTaskID,
		StepID:            gateLiveResumeNodeID,
	}, "Wait for the Station human decision interrupt and then complete the provider turn.")
}

func gateArtifactBodyHash(text string) string {
	sum := sha256.Sum256([]byte(text))
	return fmt.Sprintf("sha256:%x", sum[:])
}

func handleCreateProject(response http.ResponseWriter, request *http.Request, db *gorm.DB, projectionService *agentservice.AtelierProjectionService, actorID string, probe *createProbe) {
	var input agentservice.CreateAtelierProjectFromGoalRequest
	if request.Body != nil {
		body, err := io.ReadAll(request.Body)
		if err != nil {
			http.Error(response, err.Error(), http.StatusBadRequest)
			return
		}
		if len(body) > 0 {
			if err := json.Unmarshal(body, &input); err != nil {
				http.Error(response, err.Error(), http.StatusBadRequest)
				return
			}
		}
	}
	snapshot, err := projectionService.CreateProjectFromGoal(request.Context(), actorID, &input)
	if err != nil {
		http.Error(response, err.Error(), http.StatusInternalServerError)
		return
	}
	taskID := strings.TrimSpace(snapshot.SelectedTaskID)
	requestRecord := createProbeRequest{
		Goal:           strings.TrimSpace(input.Goal),
		TaskID:         taskID,
		SelectedTaskID: taskID,
		TaskCount:      len(snapshot.Workspace.Tasks),
	}
	if taskID != "" {
		_ = db.Raw(`SELECT COUNT(*) FROM agent_collaboration_task_nodes WHERE task_id = ?`, taskID).Scan(&requestRecord.NodeCount).Error
		_ = db.Raw(`SELECT COUNT(*) FROM agent_task_events WHERE task_id = ?`, taskID).Scan(&requestRecord.EventCount).Error
		_ = db.Raw(`SELECT COUNT(*) FROM agent_task_provider_plans WHERE task_id = ?`, taskID).Scan(&requestRecord.ProviderPlanCount).Error
	}
	probe.record(requestRecord)
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(response).Encode(snapshot)
}

func handleResolveDecision(response http.ResponseWriter, request *http.Request, db *gorm.DB, projectionService *agentservice.AtelierProjectionService, actorID string, probe *resolveProbe) {
	var input agentservice.ResolveAtelierDecisionRequest
	if request.Body != nil {
		body, err := io.ReadAll(request.Body)
		if err != nil {
			http.Error(response, err.Error(), http.StatusBadRequest)
			return
		}
		if len(body) > 0 {
			if err := json.Unmarshal(body, &input); err != nil {
				http.Error(response, err.Error(), http.StatusBadRequest)
				return
			}
		}
	}
	snapshot, err := projectionService.ResolveDecision(request.Context(), actorID, &input)
	if err != nil {
		http.Error(response, err.Error(), http.StatusInternalServerError)
		return
	}
	requestRecord := resolveProbeRequest{
		TaskID:  strings.TrimSpace(input.TaskID),
		BlockID: strings.TrimSpace(input.BlockID),
		Choice:  strings.TrimSpace(input.Choice),
	}
	_ = db.Raw(`SELECT status FROM agent_collaboration_tasks WHERE id = ?`, requestRecord.TaskID).Scan(&requestRecord.TaskStatus).Error
	_ = db.Raw(`SELECT COUNT(*) FROM agent_task_events WHERE task_id = ? AND event_type = ?`, requestRecord.TaskID, int32(agentmodel.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_RESOLVED)).Scan(&requestRecord.ResolvedEventCount).Error
	_ = db.Raw(`SELECT COUNT(*) FROM agent_interrupt_requests WHERE task_id = ? AND interrupt_id = ? AND status = ?`, requestRecord.TaskID, requestRecord.BlockID, int32(agentmodel.InterruptStatus_INTERRUPT_STATUS_PENDING)).Scan(&requestRecord.PendingInterrupts).Error
	_ = db.Raw(`SELECT COUNT(*) FROM agent_interrupt_requests WHERE task_id = ? AND interrupt_id = ? AND status = ?`, requestRecord.TaskID, requestRecord.BlockID, int32(agentmodel.InterruptStatus_INTERRUPT_STATUS_RESOLVED)).Scan(&requestRecord.ResolvedInterrupts).Error
	var resolvedPayload string
	_ = db.Raw(`SELECT payload FROM agent_task_events WHERE task_id = ? AND event_type = ? ORDER BY event_seq DESC LIMIT 1`, requestRecord.TaskID, int32(agentmodel.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_RESOLVED)).Scan(&resolvedPayload).Error
	if strings.TrimSpace(resolvedPayload) != "" {
		payload := map[string]any{}
		_ = json.Unmarshal([]byte(resolvedPayload), &payload)
		requestRecord.HumanDecisionRoute = strings.TrimSpace(fmt.Sprint(payload["human_decision_route"]))
		requestRecord.HumanDecisionAction = strings.TrimSpace(fmt.Sprint(payload["human_decision_action"]))
		requestRecord.HumanDecisionReason = strings.TrimSpace(fmt.Sprint(payload["human_decision_reason"]))
		requestRecord.HumanDecisionTransition = strings.TrimSpace(fmt.Sprint(payload["human_decision_transition"]))
	}
	probe.record(requestRecord)
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(response).Encode(snapshot)
}

func handleFetchArtifactBody(response http.ResponseWriter, request *http.Request, projectionService *agentservice.AtelierProjectionService, actorID string) {
	var input agentservice.FetchAtelierArtifactBodyRequest
	if request.Body != nil {
		body, err := io.ReadAll(request.Body)
		if err != nil {
			http.Error(response, err.Error(), http.StatusBadRequest)
			return
		}
		if len(body) > 0 {
			if err := json.Unmarshal(body, &input); err != nil {
				http.Error(response, err.Error(), http.StatusBadRequest)
				return
			}
		}
	}
	body, err := projectionService.FetchArtifactBody(request.Context(), actorID, &input)
	if err != nil {
		http.Error(response, err.Error(), http.StatusInternalServerError)
		return
	}
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(response).Encode(body)
}

func handleLiveResumeProvider(response http.ResponseWriter, request *http.Request, probe *providerProbe) {
	var input struct {
		Model    string `json:"model"`
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
	}
	if request.Body != nil {
		body, err := io.ReadAll(request.Body)
		if err != nil {
			http.Error(response, err.Error(), http.StatusBadRequest)
			return
		}
		if len(body) > 0 {
			_ = json.Unmarshal(body, &input)
		}
	}
	sawToolResult := false
	for _, message := range input.Messages {
		if message.Role == "tool" && strings.Contains(message.Content, "station.live_resume_broker") {
			sawToolResult = true
			break
		}
	}
	if isArtifactRerunProviderRequest(input.Messages) {
		probe.record(providerProbeRequest{
			Scenario:     "artifact_gate_rerun",
			Model:        input.Model,
			MessageCount: len(input.Messages),
			Final:        true,
		})
		writeOpenAIChatCompletion(response, input.Model, gateArtifactRerunProviderFinalResponse)
		return
	}
	if !sawToolResult {
		probe.record(providerProbeRequest{
			Scenario:     "live_resume",
			Model:        input.Model,
			MessageCount: len(input.Messages),
			WaitTool:     true,
		})
		content := fmt.Sprintf(
			`<tool_call>{"name":"station_human_decision_resume","arguments":{"interrupt_id":"%s","task_id":"%s"}}</tool_call>`,
			gateDecisionID,
			gateTaskID,
		)
		writeOpenAIChatCompletion(response, input.Model, content)
		return
	}
	probe.record(providerProbeRequest{
		Scenario:     "live_resume",
		Model:        input.Model,
		MessageCount: len(input.Messages),
		Final:        true,
	})
	writeOpenAIChatCompletion(response, input.Model, "Atelier live resume provider turn completed after Station human decision.")
}

func isArtifactRerunProviderRequest(messages []struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}) bool {
	for _, message := range messages {
		content := strings.ToLower(message.Content)
		if strings.Contains(content, "atelier product-window blocking gate node") ||
			strings.Contains(content, "artifact produced; blocking gate failed for recovery proof") {
			return true
		}
	}
	return false
}

func writeOpenAIChatCompletion(response http.ResponseWriter, model string, content string) {
	if strings.TrimSpace(model) == "" {
		model = "atelier-live-resume-model"
	}
	response.Header().Set("Content-Type", "text/event-stream")
	response.Header().Set("Cache-Control", "no-cache")
	response.WriteHeader(http.StatusOK)
	delta, _ := json.Marshal(map[string]any{
		"id":      "atelier-live-resume-provider-response",
		"object":  "chat.completion.chunk",
		"created": time.Now().Unix(),
		"model":   model,
		"choices": []map[string]any{{
			"index": 0,
			"delta": map[string]any{
				"content": content,
			},
		}},
	})
	finish, _ := json.Marshal(map[string]any{
		"id":      "atelier-live-resume-provider-response",
		"object":  "chat.completion.chunk",
		"created": time.Now().Unix(),
		"model":   model,
		"choices": []map[string]any{{
			"index":         0,
			"delta":         map[string]any{},
			"finish_reason": "stop",
		}},
	})
	_, _ = fmt.Fprintf(response, "data: %s\n\n", delta)
	_, _ = fmt.Fprintf(response, "data: %s\n\n", finish)
	_, _ = fmt.Fprint(response, "data: [DONE]\n\n")
	if flusher, ok := response.(http.Flusher); ok {
		flusher.Flush()
	}
}

func handleLiveResumeProbe(response http.ResponseWriter, db *gorm.DB, providerProbe *providerProbe) {
	probe := map[string]any{
		"taskId":        gateTaskID,
		"interruptId":   gateDecisionID,
		"nodeId":        gateLiveResumeNodeID,
		"providerCalls": providerProbe.snapshot(),
	}
	var taskStatus int32
	_ = db.Raw(`SELECT status FROM agent_collaboration_tasks WHERE id = ?`, gateTaskID).Scan(&taskStatus).Error
	probe["taskStatus"] = taskStatus
	var turnStatus string
	var finalResponse string
	_ = db.Raw(`SELECT status FROM agent_turns WHERE conversation_id = ? ORDER BY started_at DESC LIMIT 1`, "atelier-live-resume-conversation").Scan(&turnStatus).Error
	_ = db.Raw(`SELECT final_response FROM agent_turns WHERE conversation_id = ? ORDER BY started_at DESC LIMIT 1`, "atelier-live-resume-conversation").Scan(&finalResponse).Error
	probe["turnStatus"] = strings.TrimSpace(turnStatus)
	probe["finalResponse"] = strings.TrimSpace(finalResponse)
	var resolvedInterrupts int
	var consumedInterrupts int
	_ = db.Raw(`SELECT COUNT(*) FROM agent_interrupt_requests WHERE task_id = ? AND interrupt_id = ? AND status = ?`, gateTaskID, gateDecisionID, int32(agentmodel.InterruptStatus_INTERRUPT_STATUS_RESOLVED)).Scan(&resolvedInterrupts).Error
	_ = db.Raw(`SELECT COUNT(*) FROM agent_interrupt_requests WHERE task_id = ? AND interrupt_id = ? AND consumed_at IS NOT NULL`, gateTaskID, gateDecisionID).Scan(&consumedInterrupts).Error
	probe["resolvedInterrupts"] = resolvedInterrupts
	probe["consumedInterrupts"] = consumedInterrupts
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(response).Encode(probe)
}

func handleArtifactGateProbe(response http.ResponseWriter, db *gorm.DB, providerProbe *providerProbe) {
	probe := map[string]any{
		"taskId":     gateTaskID,
		"artifactId": gateArtifactID,
		"gateId":     gateBlockingGateID,
		"decisionId": gateBlockingDecisionID,
	}
	providerCalls := providerProbe.snapshot()
	probe["providerCalls"] = providerCalls
	var turnStatus string
	var finalResponse string
	_ = db.Raw(`SELECT status FROM agent_turns WHERE conversation_id = ? ORDER BY started_at DESC LIMIT 1`, gateBlockingNodeID).Scan(&turnStatus).Error
	_ = db.Raw(`SELECT final_response FROM agent_turns WHERE conversation_id = ? ORDER BY started_at DESC LIMIT 1`, gateBlockingNodeID).Scan(&finalResponse).Error
	probe["turnStatus"] = strings.TrimSpace(turnStatus)
	probe["finalResponse"] = strings.TrimSpace(finalResponse)
	var nodeCompletedEvents int
	_ = db.Raw(`SELECT COUNT(*) FROM agent_task_events WHERE task_id = ? AND step_id = ? AND event_type = ?`, gateTaskID, gateBlockingNodeID, int32(agentmodel.TaskEventType_TASK_EVENT_TYPE_STEP_COMPLETED)).Scan(&nodeCompletedEvents).Error
	probe["nodeCompletedEvents"] = nodeCompletedEvents
	var taskCompletedEvents int
	_ = db.Raw(`SELECT COUNT(*) FROM agent_task_events WHERE task_id = ? AND event_type = ?`, gateTaskID, int32(agentmodel.TaskEventType_TASK_EVENT_TYPE_TASK_STATUS_CHANGED)).Scan(&taskCompletedEvents).Error
	probe["taskCompletedEvents"] = taskCompletedEvents
	var taskStatus int32
	_ = db.Raw(`SELECT status FROM agent_collaboration_tasks WHERE id = ?`, gateTaskID).Scan(&taskStatus).Error
	var nodeStatus int32
	_ = db.Raw(`SELECT status FROM agent_collaboration_task_nodes WHERE id = ?`, gateBlockingNodeID).Scan(&nodeStatus).Error
	var gatePlanStatus string
	_ = db.Raw(`SELECT status FROM agent_task_gate_plans WHERE task_id = ? AND plan_json LIKE ? ORDER BY updated_at DESC LIMIT 1`, gateTaskID, fmt.Sprintf("%%%s%%", gateBlockingGateID)).Scan(&gatePlanStatus).Error
	var artifactEventCount int
	_ = db.Raw(`SELECT COUNT(*) FROM agent_task_events WHERE task_id = ? AND event_type = ? AND payload LIKE ?`, gateTaskID, int32(agentmodel.TaskEventType_TASK_EVENT_TYPE_ARTIFACT_CREATED), fmt.Sprintf("%%%s%%", gateArtifactID)).Scan(&artifactEventCount).Error
	var failedGateEventCount int
	_ = db.Raw(`SELECT COUNT(*) FROM agent_task_events WHERE task_id = ? AND event_type = ? AND payload LIKE ? AND payload LIKE ?`, gateTaskID, int32(agentmodel.TaskEventType_TASK_EVENT_TYPE_GATE_RESULT), fmt.Sprintf("%%%s%%", gateBlockingGateID), `%"status":"failed"%`).Scan(&failedGateEventCount).Error
	var pendingInterrupts int
	_ = db.Raw(`SELECT COUNT(*) FROM agent_interrupt_requests WHERE task_id = ? AND interrupt_id = ? AND status = ?`, gateTaskID, gateBlockingDecisionID, int32(agentmodel.InterruptStatus_INTERRUPT_STATUS_PENDING)).Scan(&pendingInterrupts).Error
	var resolvedInterrupts int
	_ = db.Raw(`SELECT COUNT(*) FROM agent_interrupt_requests WHERE task_id = ? AND interrupt_id = ? AND status = ?`, gateTaskID, gateBlockingDecisionID, int32(agentmodel.InterruptStatus_INTERRUPT_STATUS_RESOLVED)).Scan(&resolvedInterrupts).Error
	var resolvedPayload string
	_ = db.Raw(`SELECT payload FROM agent_task_events WHERE task_id = ? AND event_type = ? ORDER BY event_seq DESC LIMIT 1`, gateTaskID, int32(agentmodel.TaskEventType_TASK_EVENT_TYPE_INTERRUPT_RESOLVED)).Scan(&resolvedPayload).Error
	if strings.TrimSpace(resolvedPayload) != "" {
		payload := map[string]any{}
		_ = json.Unmarshal([]byte(resolvedPayload), &payload)
		probe["humanDecisionRoute"] = strings.TrimSpace(fmt.Sprint(payload["human_decision_route"]))
		probe["humanDecisionAction"] = strings.TrimSpace(fmt.Sprint(payload["human_decision_action"]))
		probe["humanDecisionReason"] = strings.TrimSpace(fmt.Sprint(payload["human_decision_reason"]))
		probe["gateRecoveryAction"] = strings.TrimSpace(fmt.Sprint(payload["gate_recovery_action"]))
	}
	probe["taskStatus"] = taskStatus
	probe["nodeStatus"] = nodeStatus
	probe["gatePlanStatus"] = strings.TrimSpace(gatePlanStatus)
	probe["artifactEventCount"] = artifactEventCount
	probe["failedGateEventCount"] = failedGateEventCount
	probe["pendingInterrupts"] = pendingInterrupts
	probe["resolvedInterrupts"] = resolvedInterrupts
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(response).Encode(probe)
}

func handleProviderCapabilities(response http.ResponseWriter, request *http.Request, projectionService *agentservice.AtelierProjectionService, actorID string) {
	var input agentservice.ListAtelierProviderCapabilitiesRequest
	if request.Body != nil {
		body, err := io.ReadAll(request.Body)
		if err != nil {
			http.Error(response, err.Error(), http.StatusBadRequest)
			return
		}
		if len(body) > 0 {
			if err := json.Unmarshal(body, &input); err != nil {
				http.Error(response, err.Error(), http.StatusBadRequest)
				return
			}
		}
	}
	capabilities, err := projectionService.ProviderCapabilities(request.Context(), actorID, &input)
	if err != nil {
		http.Error(response, err.Error(), http.StatusInternalServerError)
		return
	}
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(response).Encode(capabilities)
}

func handleEventReplay(response http.ResponseWriter, request *http.Request, eventStreamService *agentservice.EventStreamService, actorID string, probe *replayProbe) {
	var input struct {
		AgentID       string `json:"agent_id"`
		TaskID        string `json:"task_id"`
		AfterEventSeq int64  `json:"after_event_seq"`
	}
	if request.Body != nil {
		body, err := io.ReadAll(request.Body)
		if err != nil {
			http.Error(response, err.Error(), http.StatusBadRequest)
			return
		}
		if len(body) > 0 {
			if err := json.Unmarshal(body, &input); err != nil {
				http.Error(response, err.Error(), http.StatusBadRequest)
				return
			}
		}
	}
	if strings.TrimSpace(input.AgentID) == "" {
		http.Error(response, "agent_id is required", http.StatusBadRequest)
		return
	}
	if handleEventReplayFailureScenario(response) {
		probe.record(replayProbeRequest{
			AgentID:       input.AgentID,
			TaskID:        input.TaskID,
			AfterEventSeq: input.AfterEventSeq,
			ReplayedSeqs:  []int64{},
		})
		return
	}
	response.Header().Set("Content-Type", "text/event-stream")
	response.Header().Set("Cache-Control", "no-cache")
	response.Header().Set("Connection", "keep-alive")
	response.Header().Set("X-Accel-Buffering", "no")
	response.WriteHeader(http.StatusOK)
	_, _ = response.Write([]byte("event: connected\ndata: {\"status\":\"connected\"}\n\n"))
	if flusher, ok := response.(http.Flusher); ok {
		flusher.Flush()
	}
	if probe.consumeCloseBeforeFirstReplay(input.AfterEventSeq) {
		probe.record(replayProbeRequest{
			AgentID:       input.AgentID,
			TaskID:        input.TaskID,
			AfterEventSeq: input.AfterEventSeq,
			ReplayedSeqs:  []int64{},
		})
		return
	}
	replayEvents, err := eventStreamService.ReplayTaskEvents(request.Context(), actorID, input.AgentID, input.TaskID, input.AfterEventSeq)
	if err != nil {
		data, _ := json.Marshal(map[string]string{"error": err.Error()})
		_, _ = response.Write([]byte(fmt.Sprintf("event: error\ndata: %s\n\n", string(data))))
		return
	}
	replayedSeqs := make([]int64, 0, len(replayEvents))
	for _, event := range replayEvents {
		if seq, ok := eventSequence(event); ok {
			replayedSeqs = append(replayedSeqs, seq)
		}
		data := agentservice.SerializeEvent(event)
		_, _ = response.Write([]byte(fmt.Sprintf("event: %s\ndata: %s\n\n", event.EventType, string(data))))
		if flusher, ok := response.(http.Flusher); ok {
			flusher.Flush()
		}
		if shouldCloseAfterFirstReplayEvent(input.AfterEventSeq) {
			probe.record(replayProbeRequest{
				AgentID:       input.AgentID,
				TaskID:        input.TaskID,
				AfterEventSeq: input.AfterEventSeq,
				ReplayedSeqs:  append([]int64(nil), replayedSeqs...),
			})
			return
		}
	}
	probe.record(replayProbeRequest{
		AgentID:       input.AgentID,
		TaskID:        input.TaskID,
		AfterEventSeq: input.AfterEventSeq,
		ReplayedSeqs:  replayedSeqs,
	})
}

func handleEventReplayFailureScenario(response http.ResponseWriter) bool {
	switch strings.TrimSpace(os.Getenv(gateFailureScenarioEnv)) {
	case "":
		return false
	case "auth-denied":
		http.Error(response, "PERMISSION_DENIED Atelier projection subscription denied", http.StatusForbidden)
		return true
	case "disconnected":
		http.Error(response, "NETWORK_DISCONNECTED Atelier projection stream disconnected", http.StatusServiceUnavailable)
		return true
	case "timeout":
		time.Sleep(1500 * time.Millisecond)
		http.Error(response, "TIMEOUT Atelier projection subscription timed out", http.StatusGatewayTimeout)
		return true
	default:
		http.Error(response, "UNKNOWN Atelier projection subscription failure scenario", http.StatusInternalServerError)
		return true
	}
}

func shouldCloseAfterFirstReplayEvent(afterEventSeq int64) bool {
	return afterEventSeq <= 0 && strings.TrimSpace(os.Getenv("PEERS_ATELIER_GATE_CLOSE_AFTER_FIRST_REPLAY")) == "1"
}

func eventSequence(event agentdomain.DomainEvent) (int64, bool) {
	if event.Metadata == nil {
		return 0, false
	}
	seq, err := strconv.ParseInt(strings.TrimSpace(event.Metadata["event_seq"]), 10, 64)
	if err != nil {
		return 0, false
	}
	return seq, true
}

type noopEventBus struct{}

func (noopEventBus) Publish(context.Context, agentdomain.DomainEvent) error { return nil }
func (noopEventBus) Subscribe(string, agentdomain.EventHandler)             {}
func (noopEventBus) SubscribeAll(agentdomain.EventHandler)                  {}
func (noopEventBus) Unsubscribe(string, agentdomain.EventHandler)           {}

func randomSecret() (string, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw[:]), nil
}
