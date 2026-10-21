package pluginlark_test

import (
	"encoding/json"
	"testing"

	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/pluginlark"
)

func TestNormalizePrivateTextMessage(t *testing.T) {
	var event larkim.P2MessageReceiveV1
	if err := json.Unmarshal([]byte(p2pTextEventJSON), &event); err != nil {
		t.Fatal(err)
	}
	got := pluginlark.NormalizeMessageForTest("binding-1", "lark", &event)
	if got == nil {
		t.Fatal("normalized event is nil")
	}
	if got.GetBindingId() != "binding-1" || got.GetEventId() != "evt-1" {
		t.Fatalf("identity mismatch: %+v", got)
	}
	if got.GetChatType() != "private" {
		t.Fatalf("chat type = %q, want private", got.GetChatType())
	}
	if got.GetText() != "hello world" {
		t.Fatalf("text = %q", got.GetText())
	}
	if got.GetMessageId() != "om_1" || got.GetChatId() != "oc_1" || got.GetSenderId() != "ou_1" {
		t.Fatalf("ids mismatch: %+v", got)
	}
	if got.GetMetadata()["thread_id"] != "th_1" {
		t.Fatalf("metadata mismatch: %+v", got.GetMetadata())
	}
}

func TestNormalizeImageCarriesTypedResource(t *testing.T) {
	var event larkim.P2MessageReceiveV1
	if err := json.Unmarshal([]byte(imageEventJSON), &event); err != nil {
		t.Fatal(err)
	}
	got := pluginlark.NormalizeMessageForTest("b", "lark", &event)
	if got == nil {
		t.Fatal("normalized event is nil")
	}
	if got.GetText() != "" {
		t.Fatalf("non-text message must yield empty text, got %q", got.GetText())
	}
	if len(got.GetResources()) != 1 ||
		got.GetResources()[0].GetKind() != "image" ||
		got.GetResources()[0].GetProviderKey() != "img_x" {
		t.Fatalf("image resource mismatch: %+v", got.GetResources())
	}
}

func TestNormalizeUnsupportedMediaFailsExplicitly(t *testing.T) {
	var event larkim.P2MessageReceiveV1
	if err := json.Unmarshal([]byte(audioEventJSON), &event); err != nil {
		t.Fatal(err)
	}
	got := pluginlark.NormalizeMessageForTest("b", "lark", &event)
	if got.GetText() != "[Unsupported Lark message type: audio]" {
		t.Fatalf("audio limitation = %q", got.GetText())
	}
	if len(got.GetResources()) != 0 {
		t.Fatalf("unsupported audio must not create fake attachments: %+v", got.GetResources())
	}
}

func TestSummarizeForwardedMessagesPreservesSourceIdentity(t *testing.T) {
	textContent := `{"text":"forwarded fact"}`
	imageContent := `{"image_key":"img_forwarded"}`
	textType := "text"
	imageType := "image"
	textID := "om_text"
	imageID := "om_image"
	senderName := "Alice"
	items := []*larkim.Message{
		{
			MessageId: &textID, MsgType: &textType,
			Body:   &larkim.MessageBody{Content: &textContent},
			Sender: &larkim.Sender{SenderName: &senderName},
		},
		{
			MessageId: &imageID, MsgType: &imageType,
			Body: &larkim.MessageBody{Content: &imageContent},
		},
	}

	text, resources := pluginlark.SummarizeReferencedMessagesForTest(items, "")

	if text != "Alice: forwarded fact\n[image]" {
		t.Fatalf("forward summary = %q", text)
	}
	if len(resources) != 1 ||
		resources[0].GetProviderKey() != "img_forwarded" ||
		resources[0].GetSourceMessageId() != imageID {
		t.Fatalf("forward resource identity mismatch: %+v", resources)
	}
}

const p2pTextEventJSON = `{
  "schema": "2.0",
  "header": {
    "event_id": "evt-1",
    "event_type": "im.message.receive_v1",
    "app_id": "cli_test",
    "tenant_key": "tk",
    "create_time": "1700000000000",
    "token": "v",
    "app_id_type": "tenant"
  },
  "event": {
    "sender": {"sender_id": {"open_id": "ou_1", "union_id": "un_1", "user_id": ""}, "sender_type": "user"},
    "message": {
      "message_id": "om_1",
      "root_id": "om_root",
      "parent_id": "om_parent",
      "thread_id": "th_1",
      "create_time": "1700000000000",
      "chat_id": "oc_1",
      "chat_type": "p2p",
      "message_type": "text",
      "content": "{\"text\":\"hello world\"}"
    }
  }
}`

const imageEventJSON = `{
  "schema": "2.0",
  "header": {"event_id": "evt-2", "event_type": "im.message.receive_v1", "app_id": "cli_test", "token": "v"},
  "event": {
    "sender": {"sender_id": {"open_id": "ou_2"}, "sender_type": "user"},
    "message": {
      "message_id": "om_2",
      "chat_id": "oc_2",
      "chat_type": "p2p",
      "message_type": "image",
      "content": "{\"image_key\":\"img_x\"}"
    }
  }
}`

const audioEventJSON = `{
  "schema": "2.0",
  "header": {"event_id": "evt-3", "event_type": "im.message.receive_v1", "app_id": "cli_test", "token": "v"},
  "event": {
    "sender": {"sender_id": {"open_id": "ou_3"}, "sender_type": "user"},
    "message": {
      "message_id": "om_3",
      "chat_id": "oc_3",
      "chat_type": "p2p",
      "message_type": "audio",
      "content": "{\"file_key\":\"file_audio\"}"
    }
  }
}`
