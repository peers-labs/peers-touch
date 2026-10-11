package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

const (
	agentFencingTaskID  = "ncp-agent-fencing-task"
	agentFencingAgentID = "ncp-agent-fencing-agent"
)

func agentFencingNodeIdentity(suffix string) (string, string) {
	upper := strings.ToUpper(suffix)
	nodeID := strings.TrimSpace(
		os.Getenv("NCP_CLUSTER_NODE_" + upper + "_ID"),
	)
	incarnation := strings.TrimSpace(
		os.Getenv("NCP_CLUSTER_NODE_" + upper + "_INCARNATION"),
	)
	if nodeID == "" {
		nodeID = "agent-node-" + suffix
	}
	if incarnation == "" {
		incarnation = "agent-incarnation-" + suffix
	}
	return nodeID, incarnation
}

type agentFencingProcessResult struct {
	Role                    string `json:"role"`
	ProcessID               int    `json:"processId"`
	TaskID                  string `json:"taskId,omitempty"`
	StepID                  string `json:"stepId,omitempty"`
	LeaseID                 string `json:"leaseId,omitempty"`
	OwnerNodePeerID         string `json:"ownerNodePeerId,omitempty"`
	OwnerIncarnation        string `json:"ownerIncarnation,omitempty"`
	FencingToken            uint64 `json:"fencingToken,omitempty"`
	LeaseStatus             string `json:"leaseStatus,omitempty"`
	StepStatus              int32  `json:"stepStatus,omitempty"`
	StaleCompletionRejected bool   `json:"staleCompletionRejected,omitempty"`
	CheckpointCount         int64  `json:"checkpointCount,omitempty"`
	ExternalRecoveryState   string `json:"externalRecoveryState,omitempty"`
}

type runningAgentFencingProcess struct {
	command      *exec.Cmd
	output       bytes.Buffer
	readyPath    string
	takeoverPath string
	finalPath    string
}

func TestPostgresCrossProcessAgentFencing(t *testing.T) {
	database, dsn := openAgentFencingPostgres(t)
	if err := database.AutoMigrate(persistence.AllModels()...); err != nil {
		t.Fatal(err)
	}
	if err := persistence.MigrateExecutorLeaseFencing(database); err != nil {
		t.Fatal(err)
	}

	runtimeRoot := t.TempDir()
	holder := startAgentFencingHolderProcess(t, dsn, runtimeRoot)
	ready := waitAgentFencingResult(t, holder.readyPath)
	nodeA, incarnationA := agentFencingNodeIdentity("a")
	nodeB, incarnationB := agentFencingNodeIdentity("b")
	if ready.OwnerNodePeerID != nodeA ||
		ready.OwnerIncarnation != incarnationA ||
		ready.FencingToken != 1 {
		t.Fatalf("node A did not publish the initial authority: %+v", ready)
	}

	watcher := startAgentFencingWatcherProcess(t, dsn, runtimeRoot)
	healthy := waitAgentFencingResult(t, watcher.readyPath)
	if healthy.LeaseID != ready.LeaseID ||
		ready.ProcessID <= 0 ||
		healthy.ProcessID <= 0 ||
		healthy.ProcessID == ready.ProcessID ||
		healthy.OwnerNodePeerID != ready.OwnerNodePeerID ||
		healthy.FencingToken != ready.FencingToken ||
		healthy.StepStatus != int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING) {
		t.Fatalf("node B interrupted healthy foreign work: %+v", healthy)
	}

	if result := database.Model(&persistence.ExecutorLease{}).
		Where("lease_id = ? AND status = ?", ready.LeaseID, executorLeaseStatusActive).
		Update("expires_at", gorm.Expr("CURRENT_TIMESTAMP - INTERVAL '1 second'")); result.Error != nil ||
		result.RowsAffected != 1 {
		t.Fatalf(
			"expire node A lease: rows=%d err=%v",
			result.RowsAffected,
			result.Error,
		)
	}
	takeover := waitAgentFencingResult(t, watcher.takeoverPath)
	if takeover.OwnerNodePeerID != nodeB ||
		takeover.OwnerIncarnation != incarnationB ||
		takeover.FencingToken != ready.FencingToken+1 ||
		takeover.StepStatus != int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING) {
		t.Fatalf("node B takeover is invalid: %+v", takeover)
	}

	if err := os.WriteFile(
		filepath.Join(runtimeRoot, "finish"),
		[]byte("resume"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	stale := holder.wait(t)
	if !stale.StaleCompletionRejected ||
		stale.StepStatus != int32(model.TaskNodeStatus_TASK_NODE_STATUS_RUNNING) {
		t.Fatalf("resumed stale node A committed after takeover: %+v", stale)
	}

	if err := os.WriteFile(
		filepath.Join(runtimeRoot, "finish-b"),
		[]byte("finish"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	completed := watcher.wait(t)
	if completed.StepStatus != int32(model.TaskNodeStatus_TASK_NODE_STATUS_COMPLETED) ||
		completed.CheckpointCount != 1 ||
		completed.LeaseStatus != executorLeaseStatusReleased ||
		completed.FencingToken != takeover.FencingToken ||
		completed.ExternalRecoveryState != persistence.ToolBatchStatusOpen {
		t.Fatalf("takeover completion did not converge once: %+v", completed)
	}

	if path := os.Getenv("NCP_AGENT_RESULT_PATH"); path != "" {
		report := map[string]any{
			"artifactKind": "ncp-agent-fencing-process-result",
			"status":       "passed",
			"scenarios": map[string]any{
				"NCP-G06-HEALTHY": map[string]any{
					"ownerProcessId":    ready.ProcessID,
					"observerProcessId": healthy.ProcessID,
					"ownerNodePeerId":   healthy.OwnerNodePeerID,
					"ownerIncarnation":  healthy.OwnerIncarnation,
					"fencingToken":      healthy.FencingToken,
					"healthyPreserved":  true,
				},
				"NCP-G06-TAKEOVER": map[string]any{
					"ownerNodePeerId":  takeover.OwnerNodePeerID,
					"ownerIncarnation": takeover.OwnerIncarnation,
					"fencingToken":     takeover.FencingToken,
					"tokenAdvanced":    true,
				},
				"NCP-G06-STALE": map[string]any{
					"staleCompletionRejected": stale.StaleCompletionRejected,
					"terminalRecordCount":     completed.CheckpointCount,
					"externalRecoveryState":   completed.ExternalRecoveryState,
				},
			},
		}
		encoded, err := json.MarshalIndent(report, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, append(encoded, '\n'), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestPostgresAgentFencingProcessHelper(t *testing.T) {
	role := strings.TrimSpace(os.Getenv("NCP_AGENT_HELPER_ROLE"))
	if role == "" {
		t.Skip("not an Agent fencing helper process")
	}
	dsn := strings.TrimSpace(os.Getenv("NCP_AGENT_POSTGRES_DSN"))
	if dsn == "" {
		t.Fatal("Agent fencing PostgreSQL DSN is missing")
	}
	database, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDatabase, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDatabase.Close()
	injectOrchestrationServiceTestStore(t, database)

	nodeID := strings.TrimSpace(os.Getenv("NCP_AGENT_NODE_ID"))
	incarnation := strings.TrimSpace(os.Getenv("NCP_AGENT_INCARNATION"))
	service := NewChatTaskService(nil, ChatTaskExecutorIdentity{
		NodeID:      nodeID,
		Incarnation: incarnation,
	})
	switch role {
	case "hold":
		runAgentFencingHolderHelper(t, database, service)
	case "watch":
		runAgentFencingWatcherHelper(t, database, service)
	case "recover":
		if err := service.RecoverRunningChatTasks(context.Background()); err != nil {
			t.Fatal(err)
		}
		printAgentFencingResult(loadAgentFencingResult(t, database, role))
	case "finish":
		stepID := strings.TrimSpace(os.Getenv("NCP_AGENT_STEP_ID"))
		authority, err := service.LoadOwnedChatStepLeaseAuthority(
			context.Background(),
			agentFencingTaskID,
			stepID,
		)
		if err != nil {
			t.Fatal(err)
		}
		if err := service.FinishChatStep(
			context.Background(),
			agentFencingTaskID,
			stepID,
			"ncp-agent-fencing-turn",
			"completed by takeover owner",
			authority.LeaseID,
			authority.FencingToken,
		); err != nil {
			t.Fatal(err)
		}
		printAgentFencingResult(loadAgentFencingResult(t, database, role))
	default:
		t.Fatalf("unknown Agent fencing helper role %q", role)
	}
}

func runAgentFencingWatcherHelper(
	t *testing.T,
	database *gorm.DB,
	service *ChatTaskService,
) {
	if err := service.RecoverRunningChatTasks(context.Background()); err != nil {
		t.Fatal(err)
	}
	ready := loadAgentFencingResult(t, database, "watch-ready")
	writeAgentFencingResult(
		t,
		strings.TrimSpace(os.Getenv("NCP_AGENT_READY_PATH")),
		ready,
	)

	deadline := time.Now().Add(30 * time.Second)
	var takeover agentFencingProcessResult
	for {
		if err := service.RecoverRunningChatTasks(context.Background()); err != nil {
			t.Fatal(err)
		}
		takeover = loadAgentFencingResult(t, database, "watch-takeover")
		if takeover.OwnerNodePeerID == service.nodeID &&
			takeover.OwnerIncarnation == service.nodeIncarnation &&
			takeover.FencingToken > ready.FencingToken {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("timed out waiting for node B takeover")
		}
		time.Sleep(20 * time.Millisecond)
	}
	writeAgentFencingResult(
		t,
		strings.TrimSpace(os.Getenv("NCP_AGENT_TAKEOVER_PATH")),
		takeover,
	)

	waitForAgentFencingFile(
		t,
		strings.TrimSpace(os.Getenv("NCP_AGENT_FINISH_BARRIER")),
	)
	if err := service.FinishChatStep(
		context.Background(),
		agentFencingTaskID,
		takeover.StepID,
		"ncp-agent-fencing-turn",
		"completed by takeover owner",
		takeover.LeaseID,
		takeover.FencingToken,
	); err != nil {
		t.Fatal(err)
	}
	completed := loadAgentFencingResult(t, database, "watch-final")
	writeAgentFencingResult(
		t,
		strings.TrimSpace(os.Getenv("NCP_AGENT_FINAL_PATH")),
		completed,
	)
	printAgentFencingResult(completed)
}

func runAgentFencingHolderHelper(
	t *testing.T,
	database *gorm.DB,
	service *ChatTaskService,
) {
	now := time.Now().UTC()
	task := &persistence.TaskRun{
		TaskID:         agentFencingTaskID,
		Surface:        int32(model.TaskSurface_TASK_SURFACE_CHAT),
		Status:         int32(model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING),
		OwnerActorPTID: "ptid:person:ncp-agent",
		ConversationID: "ncp-agent-fencing-conversation",
		CreatedAt:      now,
		StartedAt:      now,
		UpdatedAt:      now,
	}
	if err := database.Create(task).Error; err != nil {
		t.Fatal(err)
	}
	authority, err := service.BeginChatStep(
		context.Background(),
		task.TaskID,
		agentFencingAgentID,
		"hold fenced work",
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&persistence.ToolBatch{
		ID:             "ncp-agent-fencing-batch",
		ActorID:        task.OwnerActorPTID,
		TurnID:         "ncp-agent-fencing-turn",
		AttemptID:      "ncp-agent-fencing-attempt",
		ConversationID: task.ConversationID,
		AgentID:        agentFencingAgentID,
		Provider:       "ncp-provider",
		Model:          "ncp-model",
		SystemPrompt:   "ncp",
		Iteration:      1,
		TaskID:         task.TaskID,
		StepID:         authority.StepID,
		Status:         persistence.ToolBatchStatusOpen,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	ready := loadAgentFencingResult(t, database, "hold-ready")
	readyPath := strings.TrimSpace(os.Getenv("NCP_AGENT_READY_PATH"))
	writeAgentFencingResult(t, readyPath, ready)

	barrier := strings.TrimSpace(os.Getenv("NCP_AGENT_FINISH_BARRIER"))
	deadline := time.Now().Add(30 * time.Second)
	for {
		if _, err := os.Stat(barrier); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("timed out waiting to resume node A")
		}
		time.Sleep(20 * time.Millisecond)
	}
	finishErr := service.FinishChatStep(
		context.Background(),
		task.TaskID,
		authority.StepID,
		"ncp-agent-fencing-turn",
		"stale completion",
		authority.LeaseID,
		authority.FencingToken,
	)
	result := loadAgentFencingResult(t, database, "hold-final")
	result.StaleCompletionRejected = finishErr != nil
	finalPath := strings.TrimSpace(os.Getenv("NCP_AGENT_FINAL_PATH"))
	writeAgentFencingResult(t, finalPath, result)
	printAgentFencingResult(result)
}

func loadAgentFencingResult(
	t *testing.T,
	database *gorm.DB,
	role string,
) agentFencingProcessResult {
	t.Helper()
	var step persistence.ExecutionStep
	if err := database.First(
		&step,
		"task_id = ?",
		agentFencingTaskID,
	).Error; err != nil {
		t.Fatal(err)
	}
	var lease persistence.ExecutorLease
	if err := database.Where("step_id = ?", step.StepID).
		Order("fencing_token DESC").
		First(&lease).Error; err != nil {
		t.Fatal(err)
	}
	var checkpointCount int64
	if err := database.Model(&persistence.TaskCheckpoint{}).
		Where("task_id = ?", agentFencingTaskID).
		Count(&checkpointCount).Error; err != nil {
		t.Fatal(err)
	}
	var batch persistence.ToolBatch
	if err := database.First(
		&batch,
		"id = ?",
		"ncp-agent-fencing-batch",
	).Error; err != nil {
		t.Fatal(err)
	}
	return agentFencingProcessResult{
		Role:                  role,
		ProcessID:             os.Getpid(),
		TaskID:                step.TaskID,
		StepID:                step.StepID,
		LeaseID:               lease.LeaseID,
		OwnerNodePeerID:       lease.OwnerNodePeerID,
		OwnerIncarnation:      lease.OwnerIncarnation,
		FencingToken:          lease.FencingToken,
		LeaseStatus:           lease.Status,
		StepStatus:            step.Status,
		CheckpointCount:       checkpointCount,
		ExternalRecoveryState: batch.Status,
	}
}

func openAgentFencingPostgres(t *testing.T) (*gorm.DB, string) {
	t.Helper()
	dsn := strings.TrimSpace(os.Getenv("NCP_AGENT_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("NCP_AGENT_POSTGRES_DSN is not configured")
	}
	database, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDatabase, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = sqlDatabase.Close()
	})
	injectOrchestrationServiceTestStore(t, database)
	return database, dsn
}

func startAgentFencingHolderProcess(
	t *testing.T,
	dsn string,
	runtimeRoot string,
) *runningAgentFencingProcess {
	t.Helper()
	nodeID, incarnation := agentFencingNodeIdentity("a")
	process := &runningAgentFencingProcess{
		command: exec.Command(
			os.Args[0],
			"-test.run=^TestPostgresAgentFencingProcessHelper$",
			"-test.count=1",
		),
		readyPath: filepath.Join(runtimeRoot, "ready.json"),
		finalPath: filepath.Join(runtimeRoot, "final.json"),
	}
	process.command.Env = agentFencingProcessEnvironment(
		dsn,
		"hold",
		nodeID,
		incarnation,
		map[string]string{
			"NCP_AGENT_READY_PATH":     process.readyPath,
			"NCP_AGENT_FINAL_PATH":     process.finalPath,
			"NCP_AGENT_FINISH_BARRIER": filepath.Join(runtimeRoot, "finish"),
		},
	)
	process.command.Stdout = &process.output
	process.command.Stderr = &process.output
	if err := process.command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if process.command.ProcessState == nil && process.command.Process != nil {
			_ = process.command.Process.Kill()
			_, _ = process.command.Process.Wait()
		}
	})
	waitForAgentFencingFile(t, process.readyPath)
	return process
}

func startAgentFencingWatcherProcess(
	t *testing.T,
	dsn string,
	runtimeRoot string,
) *runningAgentFencingProcess {
	t.Helper()
	nodeID, incarnation := agentFencingNodeIdentity("b")
	process := &runningAgentFencingProcess{
		command: exec.Command(
			os.Args[0],
			"-test.run=^TestPostgresAgentFencingProcessHelper$",
			"-test.count=1",
		),
		readyPath:    filepath.Join(runtimeRoot, "ready-b.json"),
		takeoverPath: filepath.Join(runtimeRoot, "takeover-b.json"),
		finalPath:    filepath.Join(runtimeRoot, "final-b.json"),
	}
	process.command.Env = agentFencingProcessEnvironment(
		dsn,
		"watch",
		nodeID,
		incarnation,
		map[string]string{
			"NCP_AGENT_READY_PATH":     process.readyPath,
			"NCP_AGENT_TAKEOVER_PATH":  process.takeoverPath,
			"NCP_AGENT_FINAL_PATH":     process.finalPath,
			"NCP_AGENT_FINISH_BARRIER": filepath.Join(runtimeRoot, "finish-b"),
		},
	)
	process.command.Stdout = &process.output
	process.command.Stderr = &process.output
	if err := process.command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if process.command.ProcessState == nil && process.command.Process != nil {
			_ = process.command.Process.Kill()
			_, _ = process.command.Process.Wait()
		}
	})
	waitForAgentFencingFile(t, process.readyPath)
	return process
}

func (p *runningAgentFencingProcess) wait(
	t *testing.T,
) agentFencingProcessResult {
	t.Helper()
	if err := p.command.Wait(); err != nil {
		t.Fatalf("Agent holder process failed: %v\n%s", err, p.output.String())
	}
	return waitAgentFencingResult(t, p.finalPath)
}

func runAgentFencingProcess(
	t *testing.T,
	dsn string,
	role string,
	nodeID string,
	incarnation string,
	extra map[string]string,
) agentFencingProcessResult {
	t.Helper()
	command := exec.Command(
		os.Args[0],
		"-test.run=^TestPostgresAgentFencingProcessHelper$",
		"-test.count=1",
	)
	command.Env = agentFencingProcessEnvironment(
		dsn,
		role,
		nodeID,
		incarnation,
		extra,
	)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("Agent fencing helper failed: %v\n%s", err, output)
	}
	for _, line := range strings.Split(string(output), "\n") {
		if !strings.HasPrefix(line, "NCP_AGENT_RESULT ") {
			continue
		}
		var result agentFencingProcessResult
		if err := json.Unmarshal(
			[]byte(strings.TrimPrefix(line, "NCP_AGENT_RESULT ")),
			&result,
		); err != nil {
			t.Fatal(err)
		}
		return result
	}
	t.Fatalf("Agent fencing helper emitted no result:\n%s", output)
	return agentFencingProcessResult{}
}

func agentFencingProcessEnvironment(
	dsn string,
	role string,
	nodeID string,
	incarnation string,
	extra map[string]string,
) []string {
	environment := append(
		os.Environ(),
		"NCP_AGENT_HELPER_ROLE="+role,
		"NCP_AGENT_POSTGRES_DSN="+dsn,
		"NCP_AGENT_NODE_ID="+nodeID,
		"NCP_AGENT_INCARNATION="+incarnation,
	)
	for key, value := range extra {
		environment = append(environment, key+"="+value)
	}
	return environment
}

func waitAgentFencingResult(
	t *testing.T,
	path string,
) agentFencingProcessResult {
	t.Helper()
	waitForAgentFencingFile(t, path)
	encoded, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var result agentFencingProcessResult
	if err := json.Unmarshal(encoded, &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func waitForAgentFencingFile(t *testing.T, path string) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for {
		if info, err := os.Stat(path); err == nil && info.Size() > 0 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", path)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func writeAgentFencingResult(
	t *testing.T,
	path string,
	result agentFencingProcessResult,
) {
	t.Helper()
	encoded, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, append(encoded, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
}

func printAgentFencingResult(result agentFencingProcessResult) {
	encoded, _ := json.Marshal(result)
	fmt.Println("NCP_AGENT_RESULT " + string(encoded))
}
