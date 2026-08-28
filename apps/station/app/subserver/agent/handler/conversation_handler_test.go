package handler

import (
	"encoding/json"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
)

func TestMessagesToJSONIncludesPersistedAttachments(t *testing.T) {
	attachments := json.RawMessage(`[{"attachment_id":"attachment-1","object_ref":"oss:cas/01/object","mime_type":"image/png","size_bytes":8,"checksum":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","filename":"image.png","authorization_scope":"conversation:conversation-1"}]`)
	items, err := messagesToJSON([]*domain.Message{{
		MessageID:       "message-1",
		ConversationID:  "conversation-1",
		Role:            domain.MessageRoleUser,
		AttachmentsJSON: attachments,
	}})
	if err != nil {
		t.Fatalf("messagesToJSON: %v", err)
	}
	encoded, err := json.Marshal(items)
	if err != nil {
		t.Fatalf("marshal message response: %v", err)
	}
	if string(encoded) == "" || !json.Valid(encoded) {
		t.Fatalf("invalid message response: %s", encoded)
	}
	var response []struct {
		Attachments []struct {
			AttachmentID string `json:"attachment_id"`
			ObjectRef    string `json:"object_ref"`
		} `json:"attachments"`
	}
	if err := json.Unmarshal(encoded, &response); err != nil {
		t.Fatalf("decode message response: %v", err)
	}
	if len(response) != 1 || len(response[0].Attachments) != 1 ||
		response[0].Attachments[0].AttachmentID != "attachment-1" ||
		response[0].Attachments[0].ObjectRef != "oss:cas/01/object" {
		t.Fatalf("attachments missing from message response: %s", encoded)
	}
}

func TestMessagesToJSONRejectsCorruptAttachmentMetadata(t *testing.T) {
	_, err := messagesToJSON([]*domain.Message{{
		MessageID:       "message-1",
		ConversationID:  "conversation-1",
		Role:            domain.MessageRoleUser,
		AttachmentsJSON: json.RawMessage(`{`),
	}})
	if err == nil {
		t.Fatal("expected corrupt attachment metadata to fail closed")
	}
}
