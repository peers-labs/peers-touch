package service

import (
	"testing"
	"time"
)

func TestLocalToolBrokerDeliversResult(t *testing.T) {
	broker := NewLocalToolBroker()
	resultCh, cleanup, err := broker.Register("turn_1", "call_1")
	if err != nil {
		t.Fatalf("register failed: %v", err)
	}
	defer cleanup()

	if err := broker.Submit(LocalToolResult{
		TurnID:  "turn_1",
		CallID:  "call_1",
		Content: "done",
	}); err != nil {
		t.Fatalf("submit failed: %v", err)
	}

	select {
	case result := <-resultCh:
		if result.Content != "done" || result.IsError {
			t.Fatalf("unexpected result: %#v", result)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for local tool result")
	}
}

func TestLocalToolBrokerRejectsMissingWaiter(t *testing.T) {
	broker := NewLocalToolBroker()
	err := broker.Submit(LocalToolResult{TurnID: "turn_1", CallID: "missing"})
	if err == nil {
		t.Fatal("expected missing waiter error")
	}
}
