package service

import (
	"testing"
	"time"
)

func TestLiveResumeBrokerDeliversDecision(t *testing.T) {
	broker := NewLiveResumeBroker()
	resultCh, cleanup, err := broker.Register("task_1", "step_1", "turn_1", "decision_1")
	if err != nil {
		t.Fatalf("register failed: %v", err)
	}
	defer cleanup()

	if err := broker.Resolve(LiveResumeDecision{
		TaskID:            "task_1",
		StepID:            "step_1",
		TurnID:            "turn_1",
		InterruptID:       "decision_1",
		ResumePayloadJSON: `{"choice":"continue"}`,
	}); err != nil {
		t.Fatalf("resolve failed: %v", err)
	}

	select {
	case decision := <-resultCh:
		if decision.ResumePayloadJSON != `{"choice":"continue"}` {
			t.Fatalf("unexpected decision: %#v", decision)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for live resume decision")
	}
}

func TestLiveResumeBrokerRejectsDuplicateAndMissingWaiter(t *testing.T) {
	broker := NewLiveResumeBroker()
	if _, _, err := broker.Register("task_1", "step_1", "turn_1", ""); err == nil {
		t.Fatal("expected missing interrupt_id error")
	}
	_, cleanup, err := broker.Register("task_1", "step_1", "turn_1", "decision_1")
	if err != nil {
		t.Fatalf("register failed: %v", err)
	}
	defer cleanup()

	if _, _, err := broker.Register("task_1", "step_2", "turn_2", "decision_1"); err == nil {
		t.Fatal("expected duplicate waiter error")
	}
	if err := broker.Resolve(LiveResumeDecision{TaskID: "task_1", InterruptID: "missing"}); err == nil {
		t.Fatal("expected missing waiter error")
	}
}
