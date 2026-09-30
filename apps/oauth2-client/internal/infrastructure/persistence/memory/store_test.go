package memory

import (
	"context"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
)

func TestRecordAuthorizationFailureDistinguishesOccurrences(t *testing.T) {
	store := NewStore()
	first := time.Date(2026, 9, 1, 1, 0, 0, 0, time.UTC)
	record := func(occurredAt time.Time) {
		t.Helper()
		if err := store.RecordAuthorizationFailure(context.Background(), entity.AuthorizationFailure{
			State:           "repeated-failure-state",
			Provider:        valueobject.ProviderGitHub,
			CodeFingerprint: "code-fingerprint",
			ErrorCode:       "provider_unavailable",
			OccurredAt:      occurredAt,
		}); err != nil {
			t.Fatal(err)
		}
	}
	record(first)
	record(first)
	record(first.Add(time.Second))

	snapshot, err := store.AdminSnapshot(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Events) != 2 ||
		snapshot.Events[0].EventID == snapshot.Events[1].EventID {
		t.Fatalf("distinct failure occurrences were collapsed: %#v", snapshot.Events)
	}
}
