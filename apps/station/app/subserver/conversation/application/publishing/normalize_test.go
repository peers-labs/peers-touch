package publishing

import (
	"testing"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

func textRequest(target string) *chat.PublishMessageRequest {
	return &chat.PublishMessageRequest{
		Target: target,
		Content: &chat.MessageContent{
			Primary: &chat.MessageContent_Text{
				Text: &chat.MessageTextContent{Text: "build passed"},
			},
			FallbackText: "caller supplied",
		},
	}
}

func TestNormalizePreservesOmittedTargetIdentityAndDerivesFallback(t *testing.T) {
	omitted, err := Normalize(textRequest(""), "")
	if err != nil {
		t.Fatalf("normalize omitted target: %v", err)
	}
	explicit, err := Normalize(textRequest("conversation-a"), "")
	if err != nil {
		t.Fatalf("normalize explicit target: %v", err)
	}
	if omitted.Hash == explicit.Hash {
		t.Fatal("omitted and explicit targets must have different request identities")
	}
	if omitted.Request.Content.GetFallbackText() != "build passed" {
		t.Fatalf("fallback = %q", omitted.Request.Content.GetFallbackText())
	}
}

func TestNormalizeRejectsMismatchedIdempotencyKeys(t *testing.T) {
	request := textRequest("")
	request.CommandId = "body-command"
	if _, err := Normalize(request, "header-command"); err == nil {
		t.Fatal("mismatched command identities must be rejected")
	}
}

func TestNormalizeClearsUntrustedAttachmentMetadata(t *testing.T) {
	request := textRequest("")
	request.Content.Attachments = []*chat.MessageAttachmentReference{{
		ObjectId: "object-a",
		Filename: "claimed.txt",
		MediaType: "text/plain",
		Size:      999,
	}}
	normalized, err := Normalize(request, "")
	if err != nil {
		t.Fatalf("normalize attachment: %v", err)
	}
	attachment := normalized.Request.Content.Attachments[0]
	if attachment.Filename != "" || attachment.MediaType != "" || attachment.Size != 0 {
		t.Fatalf("untrusted object metadata was retained: %+v", attachment)
	}
}
