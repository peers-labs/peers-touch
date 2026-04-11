package domain

import "time"

const (
	MaxConcurrentChildren = 3
	MaxDelegationDepth    = 2
)

var DelegateBlockedTools = []string{
	"delegate_task",
	"clarify",
	"memory",
	"send_message",
	"execute_code",
}

type DelegationStatus string

const (
	DelegationStatusCompleted DelegationStatus = "completed"
	DelegationStatusFailed    DelegationStatus = "failed"
	DelegationStatusTimeout   DelegationStatus = "timeout"
)

type DelegationTask struct {
	TaskID         string
	ParentTurnID   string
	Description    string
	RequestedTools []string
	Depth          int
}

type DelegationResult struct {
	TaskID          string
	ParentTurnID    string
	TaskDescription string
	ChildToolset    []string
	Status          DelegationStatus
	ResultSummary   string
	ToolIterations  int
	StartedAt       time.Time
	EndedAt         *time.Time
}

func ComputeChildToolset(parentTools, requestedTools []string) []string {
	parentSet := make(map[string]struct{}, len(parentTools))
	for _, t := range parentTools {
		parentSet[t] = struct{}{}
	}

	blockedSet := make(map[string]struct{}, len(DelegateBlockedTools))
	for _, t := range DelegateBlockedTools {
		blockedSet[t] = struct{}{}
	}

	var result []string
	for _, t := range requestedTools {
		if _, blocked := blockedSet[t]; blocked {
			continue
		}
		if _, allowed := parentSet[t]; allowed {
			result = append(result, t)
		}
	}
	return result
}
