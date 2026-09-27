package accessgate

import (
	"slices"
	"testing"
)

func TestCancellableAttemptStatuses(t *testing.T) {
	for _, status := range []string{
		attemptStatusPending,
		attemptStatusActionRequired,
		attemptStatusBlocked,
		attemptStatusFailed,
	} {
		if !slices.Contains(cancellableAttemptStatuses, status) {
			t.Fatalf("status %q must remain cancellable", status)
		}
	}

	for _, status := range []string{
		attemptStatusGranted,
		attemptStatusCancelled,
		attemptStatusExpired,
	} {
		if slices.Contains(cancellableAttemptStatuses, status) {
			t.Fatalf("terminal status %q must not be cancellable", status)
		}
	}
}
