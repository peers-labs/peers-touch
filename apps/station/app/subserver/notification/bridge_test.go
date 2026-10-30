package notification

import (
	"errors"
	"testing"
)

func TestBridgeUnregisteredReturnsSentinel(t *testing.T) {
	// The global service is process-wide; when this package's own
	// SubServer has not initialized it in this test binary, producers
	// must observe the typed sentinel instead of a silent no-op.
	globalBridge.mu.Lock()
	previous := globalBridge.service
	globalBridge.service = nil
	globalBridge.mu.Unlock()
	t.Cleanup(func() {
		globalBridge.mu.Lock()
		globalBridge.service = previous
		globalBridge.mu.Unlock()
	})

	err := NewBridge().Produce(
		"ptid:recipient", "ptid:author", 210, 1,
		"social-comment", "1", "", "", "g", nil,
	)
	if !errors.Is(err, ErrBridgeUnregistered) {
		t.Fatalf("expected ErrBridgeUnregistered, got %v", err)
	}
}
