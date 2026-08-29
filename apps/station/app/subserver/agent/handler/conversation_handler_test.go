package handler

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
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

func TestDecodeStreamTurnEventsRequestAcceptsProtoAndJSONFieldNames(t *testing.T) {
	for name, body := range map[string]string{
		"proto field name": `{
			"conversation_id":"conversation-1",
			"turn_id":"turn-1",
			"after_sequence":"17"
		}`,
		"JSON field name": `{
			"conversationId":"conversation-1",
			"turnId":"turn-1",
			"afterSequence":"17"
		}`,
	} {
		t.Run(name, func(t *testing.T) {
			var request model.StreamTurnEventsRequest
			if err := decodeStreamTurnEventsRequest([]byte(body), &request); err != nil {
				t.Fatalf("decode stream request: %v", err)
			}
			if request.GetConversationId() != "conversation-1" ||
				request.GetTurnId() != "turn-1" ||
				request.GetAfterSequence() != 17 {
				t.Fatalf("unexpected stream request: %+v", &request)
			}
		})
	}
}

func TestDecodeStreamTurnEventsRequestRejectsUnknownField(t *testing.T) {
	var request model.StreamTurnEventsRequest
	if err := decodeStreamTurnEventsRequest([]byte(`{"after_seq":"17"}`), &request); err == nil {
		t.Fatal("after_seq must be rejected instead of silently discarded")
	}
}

func TestInitialReplayUsesCurrentSnapshotToFenceHistoricalTerminalEvents(t *testing.T) {
	if shouldCloseInitialTurnReplay(false, string(domain.TurnStatusRunning)) {
		t.Fatal("running current attempt closed without a current terminal event")
	}
	if !shouldCloseInitialTurnReplay(true, string(domain.TurnStatusRunning)) {
		t.Fatal("current-attempt terminal event did not close replay")
	}
	if !shouldCloseInitialTurnReplay(false, string(domain.TurnStatusCompleted)) {
		t.Fatal("current terminal snapshot did not close initial replay")
	}
}

func TestTurnReplayFailureUsesRecoveryEventInsteadOfTurnError(t *testing.T) {
	resp := &fakeStreamResponse{}
	writeTurnReplayFailure(resp, "replay_failed", errors.New("database unavailable"))
	body := resp.body.String()
	if !strings.Contains(body, "event: recovery_failed\n") {
		t.Fatalf("missing recovery failure frame: %q", body)
	}
	if strings.Contains(body, "event: error\n") {
		t.Fatalf("replay infrastructure failure became authoritative Turn error: %q", body)
	}
}

func TestTerminalTurnEventClassification(t *testing.T) {
	if !isTerminalTurnEvent("done") ||
		!isTerminalTurnEvent("error") ||
		!isTerminalTurnEvent("cancelled") ||
		isTerminalTurnEvent("text") {
		t.Fatal("terminal event classification is incorrect")
	}
}
