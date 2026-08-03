package conversation

import "testing"

func TestExtractDkxSendOpIncludesDirectConversation(t *testing.T) {
	op := extractDkxSendOp([]byte(`{
		"recipient_ptid": "peer-b",
		"session_id": "direct-conversation"
	}`))

	if op.TargetPtid != "peer-b" {
		t.Fatalf("target ptid = %q, want peer-b", op.TargetPtid)
	}
	if op.ConversationID != "direct-conversation" {
		t.Fatalf("conversation id = %q, want direct-conversation", op.ConversationID)
	}
}
