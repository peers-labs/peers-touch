package publishing

import (
	"testing"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/types/known/timestamppb"
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
		ObjectId:  "object-a",
		Filename:  "claimed.txt",
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

func TestNormalizeStructuredEventDerivesFallbackAndPreservesTaskIdentity(t *testing.T) {
	request := &chat.PublishMessageRequest{
		Content: &chat.MessageContent{
			Primary: &chat.MessageContent_Event{
				Event: &chat.StructuredEventContent{
					EventType: "ci.task.state",
					Title:     "  Build completed  ",
					Body:      "All checks passed",
					Severity:  chat.MessageEventSeverity_MESSAGE_EVENT_SEVERITY_INFO,
					Subject: &chat.EventSubject{
						Kind:        " task ",
						Id:          " build-42 ",
						ExecutionId: " run-7 ",
					},
					Detail: &chat.StructuredEventContent_TaskState{
						TaskState: &chat.TaskStateUpdate{
							Revision: 2,
							State:    chat.ReportedTaskState_REPORTED_TASK_STATE_COMPLETED,
						},
					},
					Actions: []*chat.MessageOpenUrlAction{{
						Label: " Open result ",
						Url:   "https://ci.example.test/build/42",
					}},
				},
			},
			FallbackText: "untrusted fallback",
		},
	}

	normalized, err := Normalize(request, "")
	if err != nil {
		t.Fatalf("normalize event: %v", err)
	}
	event := normalized.Request.Content.GetEvent()
	if normalized.Request.Content.FallbackText != "Build completed\nAll checks passed" {
		t.Fatalf("fallback = %q", normalized.Request.Content.FallbackText)
	}
	if event.Subject.Kind != "task" || event.Subject.Id != "build-42" ||
		event.Subject.ExecutionId != "run-7" ||
		event.Actions[0].Label != "Open result" {
		t.Fatalf("normalized event = %+v", event)
	}
}

func TestNormalizeCardDerivesFallbackAndAcceptsAbsoluteHTTPAction(t *testing.T) {
	request := &chat.PublishMessageRequest{
		Content: &chat.MessageContent{
			Primary: &chat.MessageContent_Card{
				Card: &chat.MessageCardContent{
					Title: "  Review ready ",
					Body:  "Change 123",
					Actions: []*chat.MessageOpenUrlAction{{
						Label: "Review",
						Url:   "http://review.example.test/123",
					}},
				},
			},
		},
	}
	normalized, err := Normalize(request, "")
	if err != nil {
		t.Fatalf("normalize card: %v", err)
	}
	if normalized.Request.Content.FallbackText != "Review ready\nChange 123" {
		t.Fatalf("fallback = %q", normalized.Request.Content.FallbackText)
	}
}

func TestNormalizeRejectsMalformedContentWithoutMutatingCaller(t *testing.T) {
	tests := []struct {
		name    string
		request *chat.PublishMessageRequest
	}{
		{
			name: "event type is not namespaced",
			request: &chat.PublishMessageRequest{Content: &chat.MessageContent{
				Primary: &chat.MessageContent_Event{
					Event: &chat.StructuredEventContent{
						EventType: "build",
						Title:     "Build",
					},
				},
			}},
		},
		{
			name: "task revision is zero",
			request: &chat.PublishMessageRequest{Content: &chat.MessageContent{
				Primary: &chat.MessageContent_Event{
					Event: &chat.StructuredEventContent{
						EventType: "ci.task",
						Title:     "Build",
						Detail: &chat.StructuredEventContent_TaskState{
							TaskState: &chat.TaskStateUpdate{
								State: chat.ReportedTaskState_REPORTED_TASK_STATE_RUNNING,
							},
						},
					},
				},
			}},
		},
		{
			name: "timestamp is invalid",
			request: &chat.PublishMessageRequest{Content: &chat.MessageContent{
				Primary: &chat.MessageContent_Event{
					Event: &chat.StructuredEventContent{
						EventType:  "ci.task",
						Title:      "Build",
						OccurredAt: &timestamppb.Timestamp{Seconds: 253402300800},
					},
				},
			}},
		},
		{
			name: "action contains credentials",
			request: &chat.PublishMessageRequest{Content: &chat.MessageContent{
				Primary: &chat.MessageContent_Card{
					Card: &chat.MessageCardContent{
						Title: "Review",
						Actions: []*chat.MessageOpenUrlAction{{
							Label: "Open",
							Url:   "https://user:password@example.test",
						}},
					},
				},
			}},
		},
		{
			name: "duplicate object reference",
			request: &chat.PublishMessageRequest{Content: &chat.MessageContent{
				Primary: &chat.MessageContent_Text{
					Text: &chat.MessageTextContent{Text: "attachments"},
				},
				Attachments: []*chat.MessageAttachmentReference{
					{ObjectId: "same-object"},
					{ObjectId: "same-object"},
				},
			}},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := Normalize(test.request, ""); err == nil {
				t.Fatal("malformed content was accepted")
			}
		})
	}

	request := textRequest("")
	request.Content.Attachments = []*chat.MessageAttachmentReference{{
		ObjectId:  "object-a",
		Filename:  "caller.txt",
		MediaType: "text/plain",
		Size:      99,
	}}
	if _, err := Normalize(request, ""); err != nil {
		t.Fatalf("normalize valid attachment: %v", err)
	}
	original := request.Content.Attachments[0]
	if original.Filename != "caller.txt" ||
		original.MediaType != "text/plain" ||
		original.Size != 99 {
		t.Fatalf("caller request was mutated: %+v", original)
	}
}

func TestNormalizeRejectsUnknownProtoFields(t *testing.T) {
	request := textRequest("")
	request.ProtoReflect().SetUnknown([]byte{0xA0, 0x06, 0x01})
	if _, err := Normalize(request, ""); err == nil {
		t.Fatal("request with unknown fields was accepted")
	}
}
