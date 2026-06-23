package service

import (
	"context"
	"fmt"
	"sync"
)

type LocalToolResult struct {
	TurnID  string
	CallID  string
	Content string
	IsError bool
}

type LocalToolBroker struct {
	mu      sync.Mutex
	waiters map[string]chan LocalToolResult
}

func NewLocalToolBroker() *LocalToolBroker {
	return &LocalToolBroker{
		waiters: make(map[string]chan LocalToolResult),
	}
}

func (b *LocalToolBroker) Register(turnID, callID string) (<-chan LocalToolResult, func(), error) {
	key := localToolResultKey(turnID, callID)
	resultCh := make(chan LocalToolResult, 1)

	b.mu.Lock()
	if _, exists := b.waiters[key]; exists {
		b.mu.Unlock()
		return nil, nil, fmt.Errorf("duplicate local tool waiter: turn_id=%s call_id=%s", turnID, callID)
	}
	b.waiters[key] = resultCh
	b.mu.Unlock()

	cleanup := func() {
		b.mu.Lock()
		delete(b.waiters, key)
		b.mu.Unlock()
	}

	return resultCh, cleanup, nil
}

func (b *LocalToolBroker) Await(ctx context.Context, turnID, callID string) (LocalToolResult, error) {
	resultCh, cleanup, err := b.Register(turnID, callID)
	if err != nil {
		return LocalToolResult{}, err
	}
	defer cleanup()

	select {
	case result := <-resultCh:
		return result, nil
	case <-ctx.Done():
		return LocalToolResult{}, ctx.Err()
	}
}

func (b *LocalToolBroker) Submit(result LocalToolResult) error {
	key := localToolResultKey(result.TurnID, result.CallID)

	b.mu.Lock()
	resultCh, ok := b.waiters[key]
	b.mu.Unlock()
	if !ok {
		return fmt.Errorf("local tool waiter not found: turn_id=%s call_id=%s", result.TurnID, result.CallID)
	}

	select {
	case resultCh <- result:
		return nil
	default:
		return fmt.Errorf("local tool waiter already has a result: turn_id=%s call_id=%s", result.TurnID, result.CallID)
	}
}

func localToolResultKey(turnID, callID string) string {
	return turnID + ":" + callID
}
