package protocol

import (
	"bytes"
	"strings"
	"testing"
)

// frame_broadcast_test.go covers the Broadcast frame added in Tier C1.
// The other frame types (Request/Response/Ping/Pong) carry their own
// integration coverage via the relay package's e2e tests; this file
// exists because Broadcast is the first frame on this protocol that
// flows in BOTH directions over the same connection AND has the relay
// rewriting one of its fields (origin_peer_id) mid-flight, so the
// codec needs explicit happy-path + boundary coverage.

func TestBroadcastFrame_RoundTrip(t *testing.T) {
	cases := []struct {
		name   string
		topic  string
		origin string
		body   []byte
	}{
		{
			name:   "publish leg: empty origin",
			topic:  "fed.invalidate.v1",
			origin: "",
			body:   []byte{0x0a, 0x05, 'a', 'b', 'c', 'd', 'e'},
		},
		{
			name:   "broadcast leg: relay-stamped origin",
			topic:  "fed.invalidate.v1",
			origin: "12D3KooWAbCdEfGhIjK",
			body:   []byte("invalidation-proto-bytes"),
		},
		{
			name:   "empty body still legal",
			topic:  "test.event",
			origin: "peer1",
			body:   nil,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var buf bytes.Buffer
			if err := WriteBroadcastFrame(&buf, tc.topic, tc.origin, tc.body); err != nil {
				t.Fatalf("WriteBroadcastFrame: %v", err)
			}
			got, err := ReadFrame(&buf)
			if err != nil {
				t.Fatalf("ReadFrame: %v", err)
			}
			bf, ok := got.(*BroadcastFrame)
			if !ok {
				t.Fatalf("expected *BroadcastFrame, got %T", got)
			}
			if bf.Topic != tc.topic {
				t.Errorf("topic mismatch: got %q want %q", bf.Topic, tc.topic)
			}
			if bf.OriginPeerID != tc.origin {
				t.Errorf("origin mismatch: got %q want %q", bf.OriginPeerID, tc.origin)
			}
			if !bytes.Equal(bf.Body, tc.body) {
				t.Errorf("body mismatch: got %x want %x", bf.Body, tc.body)
			}
			if buf.Len() != 0 {
				t.Errorf("trailing bytes after frame: %d", buf.Len())
			}
		})
	}
}

func TestBroadcastFrame_RejectEmptyTopic(t *testing.T) {
	var buf bytes.Buffer
	if err := WriteBroadcastFrame(&buf, "", "peer", []byte("x")); err == nil {
		t.Fatal("expected error on empty topic")
	}
}

func TestBroadcastFrame_RejectOversizedTopic(t *testing.T) {
	var buf bytes.Buffer
	tooLong := strings.Repeat("a", MaxBroadcastTopicLen+1)
	if err := WriteBroadcastFrame(&buf, tooLong, "peer", nil); err == nil {
		t.Fatal("expected error on oversized topic")
	}
}

func TestBroadcastFrame_RejectOversizedBody(t *testing.T) {
	var buf bytes.Buffer
	body := make([]byte, MaxBroadcastBodyLen+1)
	if err := WriteBroadcastFrame(&buf, "topic", "peer", body); err == nil {
		t.Fatal("expected error on oversized body")
	}
}
