package service

import (
	"strings"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

func TestOpenAIAttachmentUsesNativeImageContent(t *testing.T) {
	messages := []openAIMessage{{Role: "user", Content: "What is shown?"}}
	err := applyOpenAIAttachments(messages, []AdmittedAttachment{{
		Ref: &model.AgentAttachmentRef{
			Filename: "diagram.png", MimeType: "image/png",
		},
		Body: []byte{137, 80, 78, 71},
	}})
	if err != nil {
		t.Fatal(err)
	}
	blocks, ok := messages[0].Content.([]any)
	if !ok || len(blocks) != 2 {
		t.Fatalf("multimodal content = %#v", messages[0].Content)
	}
	image, _ := blocks[1].(map[string]any)
	imageURL, _ := image["image_url"].(map[string]any)
	if image["type"] != "image_url" ||
		!strings.HasPrefix(imageURL["url"].(string), "data:image/png;base64,") {
		t.Fatalf("image block = %#v", image)
	}
}

func TestAnthropicAttachmentUsesNativePDFDocument(t *testing.T) {
	messages := []map[string]any{{
		"role": "user",
		"content": []any{map[string]any{"type": "text", "text": "Summarize it."}},
	}}
	err := applyAnthropicAttachments(messages, []AdmittedAttachment{{
		Ref: &model.AgentAttachmentRef{
			Filename: "report.pdf", MimeType: "application/pdf",
		},
		Body: []byte("%PDF-test"),
	}})
	if err != nil {
		t.Fatal(err)
	}
	blocks := messages[0]["content"].([]any)
	document, _ := blocks[1].(map[string]any)
	source, _ := document["source"].(map[string]any)
	if document["type"] != "document" ||
		source["media_type"] != "application/pdf" ||
		source["data"] == "" {
		t.Fatalf("document block = %#v", document)
	}
}

func TestAttachmentAdapterFailsClosedOnUnsupportedMIME(t *testing.T) {
	messages := []openAIMessage{{Role: "user", Content: "Inspect it."}}
	err := applyOpenAIAttachments(messages, []AdmittedAttachment{{
		Ref:  &model.AgentAttachmentRef{Filename: "clip.mp4", MimeType: "video/mp4"},
		Body: []byte("video"),
	}})
	if err == nil {
		t.Fatal("unsupported MIME must fail instead of sending an attachment placeholder")
	}
}
