package conversation

import (
	"fmt"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"

	publishingapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/publishing"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	notificationdomain "github.com/peers-labs/peers-touch/station/app/subserver/notification/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

const maxPublishingRequestBytes = 32 * 1024

var publishingEventTypePattern = regexp.MustCompile(
	`^[a-zA-Z0-9][a-zA-Z0-9_.-]*[.:/][a-zA-Z0-9_.:/-]+$`,
)

type productionPublishingMessage struct {
	content       *chat.MessageContent
	sourceContext *chat.MessageSourceContext
}

func normalizeProductionPublishingRequest(
	input *chat.PublishMessageRequest,
	idempotencyKey string,
) (publishingapp.Request, error) {
	if input == nil || input.Content == nil ||
		productionPublishingHasUnknownFields(input.ProtoReflect()) {
		return publishingapp.Request{}, invalidProductionPublishingRequest(
			"content",
			"a supported content body is required",
		)
	}
	request := proto.Clone(input).(*chat.PublishMessageRequest)
	request.CommandId = strings.TrimSpace(request.CommandId)
	key := strings.TrimSpace(idempotencyKey)
	if key != "" && request.CommandId != "" && key != request.CommandId {
		return publishingapp.Request{}, invalidProductionPublishingRequest(
			"command_id",
			"body and Idempotency-Key must agree",
		)
	}
	if request.CommandId == "" {
		request.CommandId = key
	}
	if request.CommandId != "" {
		if _, err := valueobject.NewCommandID(request.CommandId); err != nil {
			return publishingapp.Request{}, err
		}
	}
	request.Target = strings.TrimSpace(request.Target)
	var target valueobject.ConversationID
	if request.Target != "" {
		normalizedTarget, err := valueobject.NewConversationID(request.Target)
		if err != nil {
			return publishingapp.Request{}, err
		}
		target = normalizedTarget
	}
	if err := normalizeProductionPublishingContent(request.Content); err != nil {
		return publishingapp.Request{}, err
	}
	if context := request.SourceContext; context != nil {
		context.Program = strings.TrimSpace(context.Program)
		context.Workspace = strings.TrimSpace(context.Workspace)
		context.SessionId = strings.TrimSpace(context.SessionId)
		if len(context.Program) > 255 || len(context.Workspace) > 1024 ||
			len(context.SessionId) > 255 || len(context.Labels) > 16 {
			return publishingapp.Request{}, invalidProductionPublishingRequest(
				"source_context",
				"source context exceeds its bounds",
			)
		}
		for key, value := range context.Labels {
			if key == "" || len(key) > 64 || len(value) > 512 ||
				!utf8.ValidString(key+value) {
				return publishingapp.Request{}, invalidProductionPublishingRequest(
					"source_context.labels",
					"invalid label",
				)
			}
		}
		if context.Program == "" && context.Workspace == "" &&
			context.SessionId == "" && len(context.Labels) == 0 {
			request.SourceContext = nil
		}
	}
	hashInput := proto.Clone(request).(*chat.PublishMessageRequest)
	hashInput.CommandId = ""
	identityBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(hashInput)
	if err != nil {
		return publishingapp.Request{}, err
	}
	if proto.Size(request) > maxPublishingRequestBytes {
		return publishingapp.Request{}, invalidProductionPublishingRequest(
			"request",
			"publication exceeds the bounded size",
		)
	}
	return publishingapp.Request{
		CommandID:     request.CommandId,
		Target:        target,
		IdentityBytes: identityBytes,
		Message: &productionPublishingMessage{
			content:       request.Content,
			sourceContext: request.SourceContext,
		},
	}, nil
}

func (m *productionPublishingMessage) AttachmentObjectIDs() []string {
	result := make([]string, 0, len(m.content.Attachments))
	for _, attachment := range m.content.Attachments {
		result = append(result, attachment.ObjectId)
	}
	return result
}

func (m *productionPublishingMessage) Materialize(
	sourceNamespace string,
	attachments []publishingapp.Attachment,
) (publishingapp.MaterializedMessage, error) {
	content := proto.Clone(m.content).(*chat.MessageContent)
	if len(content.Attachments) != len(attachments) {
		return publishingapp.MaterializedMessage{}, fmt.Errorf(
			"publishing attachment resolution count mismatch",
		)
	}
	for index, attachment := range attachments {
		target := content.Attachments[index]
		if target.ObjectId != attachment.ObjectID {
			return publishingapp.MaterializedMessage{}, fmt.Errorf(
				"publishing attachment resolution identity mismatch",
			)
		}
		target.Filename = attachment.Filename
		target.MediaType = attachment.MediaType
		target.Size = attachment.Size
	}
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&chat.DirectServicePlaintextPayload{
			MessageContent:  content,
			SourceContext:   m.sourceContext,
			SourceNamespace: sourceNamespace,
		},
	)
	if err != nil {
		return publishingapp.MaterializedMessage{}, err
	}
	notificationType, category := productionPublishingNotificationClassification(content)
	return publishingapp.MaterializedMessage{
		Payload:              payload,
		FallbackText:         content.FallbackText,
		NotificationType:     notificationType,
		NotificationCategory: category,
		NotificationGroupKey: productionPublishingNotificationGroup(
			sourceNamespace,
			content,
		),
	}, nil
}

func normalizeProductionPublishingContent(content *chat.MessageContent) error {
	var fallback string
	switch primary := content.Primary.(type) {
	case *chat.MessageContent_Text:
		if primary.Text == nil || strings.TrimSpace(primary.Text.Text) == "" ||
			!utf8.ValidString(primary.Text.Text) {
			return invalidProductionPublishingRequest(
				"text",
				"nonempty UTF-8 text is required",
			)
		}
		fallback = primary.Text.Text
	case *chat.MessageContent_Event:
		event := primary.Event
		if event == nil || !publishingEventTypePattern.MatchString(event.EventType) ||
			len(event.EventType) > 255 {
			return invalidProductionPublishingRequest(
				"event_type",
				"a namespaced event type is required",
			)
		}
		if len(event.SourceEventId) > 255 {
			return invalidProductionPublishingRequest(
				"source_event_id",
				"event ID exceeds its bound",
			)
		}
		event.Title = strings.TrimSpace(event.Title)
		if event.Title == "" || len(event.Title) > 1024 ||
			!utf8.ValidString(event.Title+event.Body) {
			return invalidProductionPublishingRequest(
				"event",
				"a bounded UTF-8 title is required",
			)
		}
		if event.Severity < chat.MessageEventSeverity_MESSAGE_EVENT_SEVERITY_UNSPECIFIED ||
			event.Severity > chat.MessageEventSeverity_MESSAGE_EVENT_SEVERITY_ERROR {
			return invalidProductionPublishingRequest("severity", "unsupported severity")
		}
		if event.OccurredAt != nil && event.OccurredAt.CheckValid() != nil {
			return invalidProductionPublishingRequest("occurred_at", "invalid timestamp")
		}
		if subject := event.Subject; subject != nil {
			subject.Kind = strings.TrimSpace(subject.Kind)
			subject.Id = strings.TrimSpace(subject.Id)
			subject.ExecutionId = strings.TrimSpace(subject.ExecutionId)
			if len(subject.Kind) > 128 || len(subject.Id) > 255 ||
				len(subject.ExecutionId) > 255 {
				return invalidProductionPublishingRequest(
					"subject",
					"subject identity exceeds its bounds",
				)
			}
			if subject.Kind == "" && subject.Id == "" && subject.ExecutionId == "" {
				event.Subject = nil
			} else if subject.Kind == "" || subject.Id == "" {
				return invalidProductionPublishingRequest(
					"subject",
					"subject kind and ID must be supplied together",
				)
			}
		}
		if state := event.GetTaskState(); state != nil {
			if state.Revision == 0 ||
				state.State < chat.ReportedTaskState_REPORTED_TASK_STATE_QUEUED ||
				state.State > chat.ReportedTaskState_REPORTED_TASK_STATE_CANCELLED {
				return invalidProductionPublishingRequest(
					"task_state",
					"a positive revision and supported state are required",
				)
			}
		}
		if err := normalizeProductionPublishingActions(event.Actions); err != nil {
			return err
		}
		fallback = event.Title
		if event.Body != "" {
			fallback += "\n" + event.Body
		}
	case *chat.MessageContent_Card:
		card := primary.Card
		if card == nil {
			return invalidProductionPublishingRequest("card", "card is required")
		}
		card.Title = strings.TrimSpace(card.Title)
		if card.Title == "" || len(card.Title) > 1024 ||
			!utf8.ValidString(card.Title+card.Body) {
			return invalidProductionPublishingRequest(
				"card",
				"a bounded UTF-8 title is required",
			)
		}
		if err := normalizeProductionPublishingActions(card.Actions); err != nil {
			return err
		}
		fallback = card.Title
		if card.Body != "" {
			fallback += "\n" + card.Body
		}
	default:
		return invalidProductionPublishingRequest(
			"primary",
			"one text, event, or supported card is required",
		)
	}
	if len(content.Attachments) > 16 {
		return invalidProductionPublishingRequest(
			"attachments",
			"at most 16 attachment references are allowed",
		)
	}
	seen := make(map[string]bool, len(content.Attachments))
	for _, attachment := range content.Attachments {
		if attachment == nil || attachment.ObjectId == "" ||
			len(attachment.ObjectId) > 255 || seen[attachment.ObjectId] ||
			strings.ContainsAny(attachment.ObjectId, "\r\n\x00") {
			return invalidProductionPublishingRequest(
				"attachments",
				"invalid or duplicate object reference",
			)
		}
		seen[attachment.ObjectId] = true
		if attachment.Filename != "" &&
			(filepath.Base(attachment.Filename) != attachment.Filename ||
				strings.ContainsAny(attachment.Filename, "\\\r\n\x00") ||
				len(attachment.Filename) > 255) {
			return invalidProductionPublishingRequest(
				"attachments.filename",
				"a bounded filename is required",
			)
		}
		if len(attachment.MediaType) > 100 {
			return invalidProductionPublishingRequest(
				"attachments.media_type",
				"media type exceeds its bound",
			)
		}
		attachment.Filename = ""
		attachment.MediaType = ""
		attachment.Size = 0
	}
	content.FallbackText = fallback
	return nil
}

func normalizeProductionPublishingActions(actions []*chat.MessageOpenUrlAction) error {
	if len(actions) > 8 {
		return invalidProductionPublishingRequest(
			"actions",
			"at most eight actions are supported",
		)
	}
	for _, action := range actions {
		if action == nil {
			return invalidProductionPublishingRequest("actions", "nil action")
		}
		action.Label = strings.TrimSpace(action.Label)
		parsed, err := url.Parse(action.Url)
		if action.Label == "" || len(action.Label) > 100 || len(action.Url) > 2048 ||
			err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") ||
			parsed.Hostname() == "" || parsed.User != nil ||
			strings.ContainsAny(action.Url, "\r\n\x00") {
			return invalidProductionPublishingRequest(
				"actions",
				"only labeled absolute HTTP(S) URL actions are supported",
			)
		}
	}
	return nil
}

func productionPublishingHasUnknownFields(message protoreflect.Message) bool {
	if len(message.GetUnknown()) != 0 {
		return true
	}
	unknown := false
	message.Range(func(field protoreflect.FieldDescriptor, value protoreflect.Value) bool {
		if field.IsMap() {
			return true
		}
		if field.IsList() && field.Message() != nil {
			list := value.List()
			for index := 0; index < list.Len(); index++ {
				unknown = unknown ||
					productionPublishingHasUnknownFields(list.Get(index).Message())
			}
		} else if field.Message() != nil {
			unknown = unknown || productionPublishingHasUnknownFields(value.Message())
		}
		return !unknown
	})
	return unknown
}

func productionPublishingNotificationClassification(
	content *chat.MessageContent,
) (int32, int32) {
	if event := content.GetEvent(); event != nil && event.GetTaskState() != nil {
		return publishingapp.NotificationTypeTaskEvent, notificationdomain.CategoryTask
	}
	return publishingapp.NotificationTypeServiceMessage, notificationdomain.CategoryChat
}

func productionPublishingNotificationGroup(
	namespace string,
	content *chat.MessageContent,
) string {
	event := content.GetEvent()
	if event == nil || event.GetTaskState() == nil || event.Subject == nil ||
		event.Subject.Kind == "" || event.Subject.Id == "" ||
		event.Subject.ExecutionId == "" {
		return ""
	}
	return valueobject.HashBytes(valueobject.CanonicalTuple(
		[]byte("publishing-notification-group"),
		[]byte(namespace),
		[]byte(event.Subject.Kind),
		[]byte(event.Subject.Id),
		[]byte(event.Subject.ExecutionId),
	)).String()
}

func invalidProductionPublishingRequest(field, reason string) error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeInvalidArgument,
		"publishing.normalize",
		field,
		fmt.Sprintf("%s", reason),
	)
}

var _ publishingapp.Message = (*productionPublishingMessage)(nil)
