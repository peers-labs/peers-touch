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
