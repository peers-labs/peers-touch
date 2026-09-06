package conversation

import (
	"testing"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

func TestExtractDkxSendOpIncludesDirectConversation(t *testing.T) {
	operation := extractDkxSendOp([]byte(`{
		"recipient_ptid": "peer-b",
		"session_id": "direct-conversation"
	}`))

	if operation.TargetPtid != "peer-b" {
		t.Fatalf("target ptid = %q, want peer-b", operation.TargetPtid)
	}
	if operation.ConversationID != "direct-conversation" {
		t.Fatalf("conversation id = %q, want direct-conversation", operation.ConversationID)
	}
}

func TestCreateDirectGateExtractorReadsProtobufRequest(t *testing.T) {
	body, err := proto.Marshal(&chat.CreateMessagingDirectConversationRequest{
		PeerPtid: "ptid:bob",
	})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	operation := extractCreateDirectOp(body)
	if operation.TargetPtid != "ptid:bob" {
		t.Fatalf("unexpected target PTID %q", operation.TargetPtid)
	}
}
