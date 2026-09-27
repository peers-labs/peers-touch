package events

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCallResolutionSchemaSupportsCanonicalDirectSessionIdentity(t *testing.T) {
	now := time.Date(2026, time.September, 23, 4, 0, 0, 0, time.UTC)
	store := newTestCallResolutionStore(t, now)
	callerPTID := "ptid:" + strings.Repeat("a", 250)
	calleePTID := "ptid:" + strings.Repeat("b", 250)
	sessionULID := callerPTID + "-" + calleePTID
	callID := testCallID(t, now)

	statement := &gorm.Statement{DB: store.db}
	if err := statement.Parse(&callResolutionModel{}); err != nil {
		t.Fatal(err)
	}
	field := statement.Schema.LookUpField("SessionULID")
	if field == nil || field.Size < len(sessionULID) {
		t.Fatalf(
			"session_ulid schema size = %v, want at least %d",
			field,
			len(sessionULID),
		)
	}

	result, err := store.open(
		context.Background(),
		callerPTID,
		calleePTID,
		sessionULID,
		callID,
		callRequestDigest(
			callerPTID,
			calleePTID,
			sessionULID,
			callID,
			[]byte("sealed-request"),
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.record.SessionULID != sessionULID {
		t.Fatalf(
			"stored session_ulid length = %d, want %d",
			len(result.record.SessionULID),
			len(sessionULID),
		)
	}
}

func TestCallResolutionFirstTerminalActionWinsAndWinnerRetryIsIdempotent(t *testing.T) {
	now := time.Date(2026, time.September, 23, 4, 0, 0, 0, time.UTC)
	store := newTestCallResolutionStore(t, now)
	callID := testCallID(t, now)
	openTestCall(t, store, callID)

	first, err := store.resolve(
		context.Background(),
		"ptid:bob",
		"ptid:alice",
		"conversation-1",
		callID,
		"bob-mobile",
		"accept",
	)
	if err != nil {
		t.Fatal(err)
	}
	if !first.won || first.record.State != callStateAccepted {
		t.Fatalf("first terminal action = %#v, want accepted winner", first)
	}

	retry, err := store.resolve(
		context.Background(),
		"ptid:bob",
		"ptid:alice",
		"conversation-1",
		callID,
		"bob-mobile",
		"accept",
	)
	if err != nil {
		t.Fatal(err)
	}
	if !retry.idempotent || retry.record.WinningDeviceID != "bob-mobile" {
		t.Fatalf("winner retry = %#v, want idempotent bob-mobile", retry)
	}

	conflict, err := store.resolve(
		context.Background(),
		"ptid:bob",
		"ptid:alice",
		"conversation-1",
		callID,
		"bob-desktop",
		"reject",
	)
	if !errors.Is(err, errCallResolutionConflict) {
		t.Fatalf("loser error = %v, want conflict", err)
	}
	if conflict.record.WinningDeviceID != "bob-mobile" {
		t.Fatalf("winner = %q, want bob-mobile", conflict.record.WinningDeviceID)
	}
}

func TestCallResolutionSurvivesRepositoryRestart(t *testing.T) {
	now := time.Date(2026, time.September, 23, 4, 0, 0, 0, time.UTC)
	database := openCallResolutionDatabase(t)
	first := newCallResolutionStore(database)
	first.now = func() time.Time { return now }
	if err := first.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	callID := testCallID(t, now)
	openTestCall(t, first, callID)
	if _, err := first.resolve(
		context.Background(),
		"ptid:bob",
		"ptid:alice",
		"conversation-1",
		callID,
		"bob-desktop",
		"reject",
	); err != nil {
		t.Fatal(err)
	}

	restarted := newCallResolutionStore(database)
	restarted.now = func() time.Time { return now.Add(time.Second) }
	result, err := restarted.getForActor(
		context.Background(),
		"ptid:alice",
		callID,
	)
	if err != nil {
		t.Fatal(err)
	}
	record := result.record
	if record.State != callStateRejected || record.WinningDeviceID != "bob-desktop" {
		t.Fatalf("restarted projection = %#v", record)
	}
}

func TestCallResolutionTerminalRequestCannotReopen(t *testing.T) {
	now := time.Date(2026, time.September, 23, 4, 0, 0, 0, time.UTC)
	store := newTestCallResolutionStore(t, now)
	callID := testCallID(t, now)
	openTestCall(t, store, callID)
	if _, err := store.resolve(
		context.Background(),
		"ptid:bob",
		"ptid:alice",
		"conversation-1",
		callID,
		"bob-mobile",
		"accept",
	); err != nil {
		t.Fatal(err)
	}

	result, err := store.open(
		context.Background(),
		"ptid:alice",
		"ptid:bob",
		"conversation-1",
		callID,
		callRequestDigest(
			"ptid:alice",
			"ptid:bob",
			"conversation-1",
			callID,
			[]byte("sealed-request"),
		),
	)
	if !errors.Is(err, errCallResolutionConflict) {
		t.Fatalf("terminal duplicate error = %v, want conflict", err)
	}
	if result.record.State != callStateAccepted {
		t.Fatalf("terminal duplicate changed state to %q", result.record.State)
	}
}

func TestCallResolutionExactRequestRetrySurvivesAdmissionWindow(t *testing.T) {
	now := time.Date(2026, time.September, 23, 4, 0, 0, 0, time.UTC)
	store := newTestCallResolutionStore(t, now)
	callID := testCallID(t, now)
	openTestCall(t, store, callID)
	store.now = func() time.Time {
		return now.Add(callIDPastSkew + time.Second)
	}

	result, err := store.open(
		context.Background(),
		"ptid:alice",
		"ptid:bob",
		"conversation-1",
		callID,
		callRequestDigest(
			"ptid:alice",
			"ptid:bob",
			"conversation-1",
			callID,
			[]byte("sealed-request"),
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	if !result.idempotent || result.record.State != callStateOpen {
		t.Fatalf("late exact retry = %#v", result)
	}
}

func TestCallResolutionRejectsConflictingRequestBinding(t *testing.T) {
	now := time.Date(2026, time.September, 23, 4, 0, 0, 0, time.UTC)
	store := newTestCallResolutionStore(t, now)
	callID := testCallID(t, now)
	openTestCall(t, store, callID)

	result, err := store.open(
		context.Background(),
		"ptid:mallory",
		"ptid:bob",
		"conversation-1",
		callID,
		callRequestDigest(
			"ptid:mallory",
			"ptid:bob",
			"conversation-1",
			callID,
			[]byte("different"),
		),
	)
	if !errors.Is(err, errCallResolutionConflict) {
		t.Fatalf("duplicate request error = %v, want conflict", err)
	}
	if result.record.CallerActorPTID != "ptid:alice" {
		t.Fatalf("stored caller = %q, want ptid:alice", result.record.CallerActorPTID)
	}

	if _, err := store.resolve(
		context.Background(),
		"ptid:bob",
		"ptid:mallory",
		"conversation-1",
		callID,
		"bob-mobile",
		"accept",
	); !errors.Is(err, errCallResolutionConflict) {
		t.Fatalf("mismatched terminal binding error = %v, want conflict", err)
	}
	persistedResult, err := store.getForActor(
		context.Background(),
		"ptid:bob",
		callID,
	)
	if err != nil {
		t.Fatal(err)
	}
	persisted := persistedResult.record
	if persisted.State != callStateOpen {
		t.Fatalf("mismatched terminal action changed state to %q", persisted.State)
	}
}

func TestCallResolutionExpiresOpenCallToNoAnswerAndRetainsIt(t *testing.T) {
	now := time.Date(2026, time.September, 23, 4, 0, 0, 0, time.UTC)
	store := newTestCallResolutionStore(t, now)
	callID := testCallID(t, now)
	openTestCall(t, store, callID)
	store.now = func() time.Time { return now.Add(callRingWindow + time.Second) }

	result, err := store.getForActor(context.Background(), "ptid:bob", callID)
	if err != nil {
		t.Fatal(err)
	}
	record := result.record
	if record.State != callStateNoAnswer || record.TerminalAction != "no_answer" {
		t.Fatalf("expired state = %#v, want NO_ANSWER", record)
	}
	if !result.becameNoAnswer {
		t.Fatal("deadline readback did not report the NO_ANSWER transition")
	}

	store.now = func() time.Time {
		return now.Add(callRingWindow + callResolutionRetention + time.Second)
	}
	expired, err := store.sweep(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(expired) != 0 {
		t.Fatalf("terminal retention sweep re-emitted %d transitions", len(expired))
	}
	if _, err := store.getForActor(context.Background(), "ptid:bob", callID); !errors.Is(err, errCallResolutionNotFound) {
		t.Fatalf("post-retention lookup error = %v, want not found", err)
	}
}

func TestCallResolutionSweepReturnsOnlyNewNoAnswerTransitions(t *testing.T) {
	now := time.Date(2026, time.September, 23, 4, 0, 0, 0, time.UTC)
	store := newTestCallResolutionStore(t, now)
	callID := testCallID(t, now)
	openTestCall(t, store, callID)
	store.now = func() time.Time {
		return now.Add(callRingWindow + time.Second)
	}

	first, err := store.sweep(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 1 ||
		first[0].CallID != callID ||
		first[0].State != callStateNoAnswer {
		t.Fatalf("first sweep transitions = %#v", first)
	}

	second, err := store.sweep(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(second) != 0 {
		t.Fatalf("second sweep transitions = %#v, want none", second)
	}
}

func TestCallResolutionRejectsMalformedAndOutOfWindowCallIDs(t *testing.T) {
	now := time.Date(2026, time.September, 23, 4, 0, 0, 0, time.UTC)
	store := newTestCallResolutionStore(t, now)
	for _, callID := range []string{
		"not-a-ulid",
		testCallID(t, now.Add(-callIDPastSkew-time.Second)),
		testCallID(t, now.Add(callIDFutureSkew+time.Second)),
	} {
		if _, err := store.open(
			context.Background(),
			"ptid:alice",
			"ptid:bob",
			"conversation-1",
			callID,
			make([]byte, 32),
		); err == nil {
			t.Fatalf("call id %q should be rejected", callID)
		}
	}
}

func openTestCall(t *testing.T, store *callResolutionStore, callID string) {
	t.Helper()
	digest := callRequestDigest(
		"ptid:alice",
		"ptid:bob",
		"conversation-1",
		callID,
		[]byte("sealed-request"),
	)
	result, err := store.open(
		context.Background(),
		"ptid:alice",
		"ptid:bob",
		"conversation-1",
		callID,
		digest,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !result.created || result.record.State != callStateOpen {
		t.Fatalf("open result = %#v", result)
	}
}

func newTestCallResolutionStore(
	t *testing.T,
	now time.Time,
) *callResolutionStore {
	t.Helper()
	store := newCallResolutionStore(openCallResolutionDatabase(t))
	store.now = func() time.Time { return now }
	if err := store.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	return store
}

func openCallResolutionDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := fmt.Sprintf(
		"file:%s-%d?mode=memory&cache=shared",
		t.Name(),
		time.Now().UnixNano(),
	)
	database, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	return database
}

func testCallID(t *testing.T, timestamp time.Time) string {
	t.Helper()
	id, err := ulid.New(
		ulid.Timestamp(timestamp),
		bytes.NewReader([]byte{0, 1, 2, 3, 4, 5, 6, 7, 8, 9}),
	)
	if err != nil {
		t.Fatal(err)
	}
	return id.String()
}
