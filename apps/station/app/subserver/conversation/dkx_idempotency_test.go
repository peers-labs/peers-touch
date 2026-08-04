package conversation

import (
	"testing"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

func TestDkxIdempotencyKeyDeduplicatesOnlyIdenticalHandshake(t *testing.T) {
	const sessionID = "direct-1"
	const senderPtid = "ptid:v1:actor:peers:p:alice"
	kind := chat.DirectKeyExchangeKind_DIRECT_KEY_EXCHANGE_KIND_INITIAL_MESSAGE

	first := dkxIdempotencyKey(sessionID, senderPtid, kind, []byte("handshake-a"))
	retry := dkxIdempotencyKey(sessionID, senderPtid, kind, []byte("handshake-a"))
	rekey := dkxIdempotencyKey(sessionID, senderPtid, kind, []byte("handshake-b"))

	if first != retry {
		t.Fatal("identical DKX retries must share an idempotency key")
	}
	if first == rekey {
		t.Fatal("distinct DKX material must produce a new idempotency key")
	}
}
