package service

import (
	"strings"
	"testing"

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
}
