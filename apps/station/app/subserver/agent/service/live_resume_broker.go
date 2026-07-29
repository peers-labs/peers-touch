package service

import (
	"context"
	"fmt"
	"strings"
	"sync"
)

type LiveResumeDecision struct {
	TaskID            string
	StepID            string
	TurnID            string
	InterruptID       string
	Reason            string
	PayloadJSON       string
	ResumePayloadJSON string
	EventID           string
	EventSeq          int64
}

type LiveResumeBroker struct {
	mu      sync.Mutex
	waiters map[string]chan LiveResumeDecision
}

func NewLiveResumeBroker() *LiveResumeBroker {
	return &LiveResumeBroker{waiters: map[string]chan LiveResumeDecision{}}
}

func (b *LiveResumeBroker) Register(taskID, stepID, turnID, interruptID string) (<-chan LiveResumeDecision, func(), error) {
	if b == nil {
		return nil, nil, fmt.Errorf("live resume broker is not configured")
	}
	key := liveResumeKey(taskID, interruptID)
	if strings.TrimSpace(taskID) == "" || strings.TrimSpace(interruptID) == "" {
		return nil, nil, fmt.Errorf("task_id and interrupt_id are required")
	}
	ch := make(chan LiveResumeDecision, 1)
	b.mu.Lock()
	if _, exists := b.waiters[key]; exists {
		b.mu.Unlock()
		return nil, nil, fmt.Errorf("duplicate live resume waiter: task_id=%s interrupt_id=%s", taskID, interruptID)
	}
	b.waiters[key] = ch
	b.mu.Unlock()

	cleanup := func() {
		b.mu.Lock()
		delete(b.waiters, key)
		b.mu.Unlock()
	}
	return ch, cleanup, nil
}

func (b *LiveResumeBroker) Await(ctx context.Context, taskID, stepID, turnID, interruptID string) (LiveResumeDecision, error) {
	ch, cleanup, err := b.Register(taskID, stepID, turnID, interruptID)
	if err != nil {
		return LiveResumeDecision{}, err
	}
	defer cleanup()
	select {
	case decision := <-ch:
		if strings.TrimSpace(decision.StepID) == "" {
			decision.StepID = strings.TrimSpace(stepID)
		}
		if strings.TrimSpace(decision.TurnID) == "" {
			decision.TurnID = strings.TrimSpace(turnID)
		}
		return decision, nil
	case <-ctx.Done():
		return LiveResumeDecision{}, ctx.Err()
	}
}

func (b *LiveResumeBroker) HasWaiter(taskID, interruptID string) bool {
	if b == nil {
		return false
	}
	key := liveResumeKey(taskID, interruptID)
	b.mu.Lock()
	_, ok := b.waiters[key]
	b.mu.Unlock()
	return ok
}

func (b *LiveResumeBroker) Resolve(decision LiveResumeDecision) error {
	if b == nil {
		return fmt.Errorf("live resume broker is not configured")
	}
	key := liveResumeKey(decision.TaskID, decision.InterruptID)
	b.mu.Lock()
	ch, ok := b.waiters[key]
	b.mu.Unlock()
	if !ok {
		return fmt.Errorf("live resume waiter not found: task_id=%s interrupt_id=%s", decision.TaskID, decision.InterruptID)
	}
	select {
	case ch <- decision:
		return nil
	default:
		return fmt.Errorf("live resume waiter already has decision: task_id=%s interrupt_id=%s", decision.TaskID, decision.InterruptID)
	}
}

func liveResumeKey(taskID, interruptID string) string {
	return strings.TrimSpace(taskID) + ":" + strings.TrimSpace(interruptID)
}
