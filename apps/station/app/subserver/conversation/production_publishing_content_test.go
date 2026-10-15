package conversation

import (
	"testing"

	publishingapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/publishing"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	notificationdomain "github.com/peers-labs/peers-touch/station/app/subserver/notification/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func productionPublishingTextRequest(target string) *chat.PublishMessageRequest {
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

func TestNormalizeProductionPublishingRequestPreservesOmittedTargetIdentityAndDerivesFallback(
	t *testing.T,
) {
	omitted, err := normalizeProductionPublishingRequest(
		productionPublishingTextRequest(""),
		"",
	)
	if err != nil {
		t.Fatalf("normalize omitted target: %v", err)
	}
	explicit, err := normalizeProductionPublishingRequest(
		productionPublishingTextRequest("conversation-a"),
		"",
	)
	if err != nil {
		t.Fatalf("normalize explicit target: %v", err)
	}
	if valueobject.HashBytes(omitted.IdentityBytes) ==
		valueobject.HashBytes(explicit.IdentityBytes) {
		t.Fatal("omitted and explicit targets must have different request identities")
	}
	message := omitted.Message.(*productionPublishingMessage)
	if message.content.GetFallbackText() != "build passed" {
		t.Fatalf("fallback = %q", message.content.GetFallbackText())
	}
}

func TestNormalizeProductionPublishingRequestRejectsMismatchedIdempotencyKeys(
	t *testing.T,
) {
	request := productionPublishingTextRequest("")
	request.CommandId = "body-command"
	if _, err := normalizeProductionPublishingRequest(
		request,
		"header-command",
	); err == nil {
		t.Fatal("mismatched command identities must be rejected")
	}
}

func TestNormalizeProductionPublishingRequestClearsUntrustedAttachmentMetadata(
	t *testing.T,
) {
	request := productionPublishingTextRequest("")
	request.Content.Attachments = []*chat.MessageAttachmentReference{{
		ObjectId:  "object-a",
		Filename:  "claimed.txt",
		MediaType: "text/plain",
		Size:      999,
	}}
	normalized, err := normalizeProductionPublishingRequest(request, "")
	if err != nil {
		t.Fatalf("normalize attachment: %v", err)
	}
	message := normalized.Message.(*productionPublishingMessage)
	attachment := message.content.Attachments[0]
	if attachment.Filename != "" || attachment.MediaType != "" || attachment.Size != 0 {
		t.Fatalf("untrusted object metadata was retained: %+v", attachment)
	}
}

func TestProductionPublishingMessageMaterializesAuthorizedAttachmentAndNotification(
	t *testing.T,
) {
	request := &chat.PublishMessageRequest{
		Content: &chat.MessageContent{
			Primary: &chat.MessageContent_Event{
				Event: &chat.StructuredEventContent{
					EventType: "ci.task.state",
					Title:     "Build completed",
					Subject: &chat.EventSubject{
						Kind:        "task",
						Id:          "build-42",
						ExecutionId: "run-7",
					},
					Detail: &chat.StructuredEventContent_TaskState{
						TaskState: &chat.TaskStateUpdate{
							Revision: 2,
							State:    chat.ReportedTaskState_REPORTED_TASK_STATE_COMPLETED,
						},
					},
				},
			},
			Attachments: []*chat.MessageAttachmentReference{{
				ObjectId:  "object-report",
				Filename:  "untrusted.txt",
				MediaType: "text/plain",
				Size:      1,
			}},
		},
	}
	normalized, err := normalizeProductionPublishingRequest(request, "")
	if err != nil {
		t.Fatalf("normalize publication: %v", err)
	}
	message, err := normalized.Message.Materialize(
		"ci.build",
		[]publishingapp.Attachment{{
			ObjectID:  "object-report",
			Filename:  "report.pdf",
			MediaType: "application/pdf",
			Size:      2048,
		}},
	)
	if err != nil {
		t.Fatalf("materialize publication: %v", err)
	}
	var payload chat.DirectServicePlaintextPayload
	if err := proto.Unmarshal(message.Payload, &payload); err != nil {
		t.Fatalf("decode service plaintext: %v", err)
	}
	attachment := payload.MessageContent.Attachments[0]
	if attachment.Filename != "report.pdf" ||
		attachment.MediaType != "application/pdf" ||
		attachment.Size != 2048 {
		t.Fatalf("materialized attachment = %+v", attachment)
	}
	if message.NotificationType != publishingapp.NotificationTypeTaskEvent ||
		message.NotificationCategory != notificationdomain.CategoryTask ||
		message.NotificationGroupKey == "" {
		t.Fatalf("materialized notification = %+v", message)
	}
}

func TestNormalizeProductionPublishingRequestStructuredEvent(
	t *testing.T,
) {
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

	normalized, err := normalizeProductionPublishingRequest(request, "")
	if err != nil {
		t.Fatalf("normalize event: %v", err)
	}
	message := normalized.Message.(*productionPublishingMessage)
	event := message.content.GetEvent()
	if message.content.FallbackText != "Build completed\nAll checks passed" {
		t.Fatalf("fallback = %q", message.content.FallbackText)
	}
	if event.Subject.Kind != "task" || event.Subject.Id != "build-42" ||
		event.Subject.ExecutionId != "run-7" ||
		event.Actions[0].Label != "Open result" {
		t.Fatalf("normalized event = %+v", event)
	}
}

func TestNormalizeProductionPublishingRequestCard(t *testing.T) {
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
	normalized, err := normalizeProductionPublishingRequest(request, "")
	if err != nil {
		t.Fatalf("normalize card: %v", err)
	}
	message := normalized.Message.(*productionPublishingMessage)
	if message.content.FallbackText != "Review ready\nChange 123" {
		t.Fatalf("fallback = %q", message.content.FallbackText)
	}
}

func TestNormalizeProductionPublishingRequestRejectsMalformedContentWithoutMutation(
	t *testing.T,
) {
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
			if _, err := normalizeProductionPublishingRequest(
				test.request,
				"",
			); err == nil {
				t.Fatal("malformed content was accepted")
			}
		})
	}

	request := productionPublishingTextRequest("")
	request.Content.Attachments = []*chat.MessageAttachmentReference{{
		ObjectId:  "object-a",
		Filename:  "caller.txt",
		MediaType: "text/plain",
		Size:      99,
	}}
	if _, err := normalizeProductionPublishingRequest(request, ""); err != nil {
		t.Fatalf("normalize valid attachment: %v", err)
	}
	original := request.Content.Attachments[0]
	if original.Filename != "caller.txt" ||
		original.MediaType != "text/plain" ||
		original.Size != 99 {
		t.Fatalf("caller request was mutated: %+v", original)
	}
}

func TestNormalizeProductionPublishingRequestRejectsUnknownProtoFields(t *testing.T) {
	request := productionPublishingTextRequest("")
	request.ProtoReflect().SetUnknown([]byte{0xA0, 0x06, 0x01})
	if _, err := normalizeProductionPublishingRequest(request, ""); err == nil {
		t.Fatal("request with unknown fields was accepted")
	}
}
