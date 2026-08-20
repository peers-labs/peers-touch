package application

import (
	"strings"
	"testing"
)

func TestReceiptQueueIdempotencyKeyIsBoundedAndTupleSafe(t *testing.T) {
	longPTID := "ptid:v1:actor:peers:p:alice:" + strings.Repeat("a", 192)
	first := receiptQueueIdempotencyKey(
		"read",
		"conversation-1",
		longPTID,
		"42",
		longPTID,
		"device-1",
	)
	secondRecipient := receiptQueueIdempotencyKey(
		"read",
		"conversation-1",
		longPTID,
		"42",
		longPTID,
		"device-2",
	)
	differentTuple := receiptQueueIdempotencyKey("read", "ab", "c")
	ambiguousWithoutLengths := receiptQueueIdempotencyKey("read", "a", "bc")

	if len(first) > 255 {
		t.Fatalf("idempotency key length = %d, want <= 255", len(first))
	}
	if first == secondRecipient {
		t.Fatal("recipient endpoint must change the idempotency key")
	}
	if differentTuple == ambiguousWithoutLengths {
		t.Fatal("length-prefixed tuples must not collide at field boundaries")
	}
}

func TestReceiptTupleDigestIsFixedLengthDeterministicAndTupleSafe(t *testing.T) {
	longPTID := "ptid:v1:actor:peers:p:alice:" + strings.Repeat("a", 192)
	first := receiptTupleDigest("read-event", "conversation-1", longPTID, "42")
	repeated := receiptTupleDigest("read-event", "conversation-1", longPTID, "42")
	differentTuple := receiptTupleDigest("read-event", "ab", "c")
	ambiguousWithoutLengths := receiptTupleDigest("read-event", "a", "bc")

	if len(first) != 64 {
		t.Fatalf("tuple digest length = %d, want 64", len(first))
	}
	if first != repeated {
		t.Fatal("same tuple must produce the same digest")
	}
	if differentTuple == ambiguousWithoutLengths {
		t.Fatal("length-prefixed tuples must not collide at field boundaries")
	}
}
