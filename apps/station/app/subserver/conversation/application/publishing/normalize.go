package publishing

import (
	"fmt"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"

	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

const MaxRequestBytes = 32 * 1024

var eventTypePattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]*[.:/][a-zA-Z0-9_.:/-]+$`)

type NormalizedRequest struct {
	Request *chat.PublishMessageRequest
	Hash    valueobject.Hash
}

// Normalize hashes only caller-supplied meaning. It never resolves a target
// default or incorporates a generated command ID into request identity.
func Normalize(input *chat.PublishMessageRequest, idempotencyKey string) (NormalizedRequest, error) {
	if input == nil || input.Content == nil || hasUnknownFields(input.ProtoReflect()) {
		return NormalizedRequest{}, invalid("content", "a supported content body is required")
	}
	req := proto.Clone(input).(*chat.PublishMessageRequest)
	req.CommandId = strings.TrimSpace(req.CommandId)
	key := strings.TrimSpace(idempotencyKey)
	if key != "" && req.CommandId != "" && key != req.CommandId {
		return NormalizedRequest{}, invalid("command_id", "body and Idempotency-Key must agree")
	}
	if req.CommandId == "" {
		req.CommandId = key
	}
	if req.CommandId != "" {
		if _, err := valueobject.NewCommandID(req.CommandId); err != nil {
			return NormalizedRequest{}, err
		}
	}
	req.Target = strings.TrimSpace(req.Target)
	if req.Target != "" {
		if _, err := valueobject.NewConversationID(req.Target); err != nil {
			return NormalizedRequest{}, err
		}
	}
	if err := normalizeContent(req.Content); err != nil {
		return NormalizedRequest{}, err
	}
	if ctx := req.SourceContext; ctx != nil {
		ctx.Program = strings.TrimSpace(ctx.Program)
		ctx.Workspace = strings.TrimSpace(ctx.Workspace)
		ctx.SessionId = strings.TrimSpace(ctx.SessionId)
		if len(ctx.Program) > 255 || len(ctx.Workspace) > 1024 || len(ctx.SessionId) > 255 || len(ctx.Labels) > 16 {
			return NormalizedRequest{}, invalid("source_context", "source context exceeds its bounds")
		}
		for k, v := range ctx.Labels {
			if k == "" || len(k) > 64 || len(v) > 512 || !utf8.ValidString(k+v) {
				return NormalizedRequest{}, invalid("source_context.labels", "invalid label")
			}
		}
		if ctx.Program == "" && ctx.Workspace == "" && ctx.SessionId == "" && len(ctx.Labels) == 0 {
			req.SourceContext = nil
		}
	}
	hashInput := proto.Clone(req).(*chat.PublishMessageRequest)
	hashInput.CommandId = ""
	exact, err := proto.MarshalOptions{Deterministic: true}.Marshal(hashInput)
	if err != nil {
		return NormalizedRequest{}, err
	}
	if proto.Size(req) > MaxRequestBytes {
		return NormalizedRequest{}, invalid("request", "publication exceeds the bounded size")
	}
	return NormalizedRequest{Request: req, Hash: valueobject.HashBytes(exact)}, nil
}

func normalizeContent(content *chat.MessageContent) error {
	var fallback string
	switch primary := content.Primary.(type) {
	case *chat.MessageContent_Text:
		if primary.Text == nil || strings.TrimSpace(primary.Text.Text) == "" || !utf8.ValidString(primary.Text.Text) {
			return invalid("text", "nonempty UTF-8 text is required")
		}
		fallback = primary.Text.Text
	case *chat.MessageContent_Event:
		event := primary.Event
		if event == nil || !eventTypePattern.MatchString(event.EventType) || len(event.EventType) > 255 {
			return invalid("event_type", "a namespaced event type is required")
		}
		if len(event.SourceEventId) > 255 {
			return invalid("source_event_id", "event ID exceeds its bound")
		}
		event.Title = strings.TrimSpace(event.Title)
		if event.Title == "" || len(event.Title) > 1024 || !utf8.ValidString(event.Title+event.Body) {
			return invalid("event", "a bounded UTF-8 title is required")
		}
		if event.Severity < chat.MessageEventSeverity_MESSAGE_EVENT_SEVERITY_UNSPECIFIED ||
			event.Severity > chat.MessageEventSeverity_MESSAGE_EVENT_SEVERITY_ERROR {
			return invalid("severity", "unsupported severity")
		}
		if event.OccurredAt != nil && event.OccurredAt.CheckValid() != nil {
			return invalid("occurred_at", "invalid timestamp")
		}
		if subject := event.Subject; subject != nil {
			subject.Kind = strings.TrimSpace(subject.Kind)
			subject.Id = strings.TrimSpace(subject.Id)
			subject.ExecutionId = strings.TrimSpace(subject.ExecutionId)
			if len(subject.Kind) > 128 || len(subject.Id) > 255 || len(subject.ExecutionId) > 255 {
				return invalid("subject", "subject identity exceeds its bounds")
			}
			if subject.Kind == "" && subject.Id == "" && subject.ExecutionId == "" {
				event.Subject = nil
			} else if subject.Kind == "" || subject.Id == "" {
				return invalid("subject", "subject kind and ID must be supplied together")
			}
		}
		if state := event.GetTaskState(); state != nil {
			if state.Revision == 0 || state.State < chat.ReportedTaskState_REPORTED_TASK_STATE_QUEUED ||
				state.State > chat.ReportedTaskState_REPORTED_TASK_STATE_CANCELLED {
				return invalid("task_state", "a positive revision and supported state are required")
			}
		}
		if err := normalizeActions(event.Actions); err != nil {
			return err
		}
		fallback = event.Title
		if event.Body != "" {
			fallback += "\n" + event.Body
		}
	case *chat.MessageContent_Card:
		card := primary.Card
		if card == nil {
			return invalid("card", "card is required")
		}
		card.Title = strings.TrimSpace(card.Title)
		if card.Title == "" || len(card.Title) > 1024 || !utf8.ValidString(card.Title+card.Body) {
			return invalid("card", "a bounded UTF-8 title is required")
		}
		if err := normalizeActions(card.Actions); err != nil {
			return err
		}
		fallback = card.Title
		if card.Body != "" {
			fallback += "\n" + card.Body
		}
	default:
		return invalid("primary", "one text, event, or supported card is required")
	}
	if len(content.Attachments) > 16 {
		return invalid("attachments", "at most 16 attachment references are allowed")
	}
	seen := make(map[string]bool, len(content.Attachments))
	for _, attachment := range content.Attachments {
		if attachment == nil || attachment.ObjectId == "" || len(attachment.ObjectId) > 255 ||
			seen[attachment.ObjectId] || strings.ContainsAny(attachment.ObjectId, "\r\n\x00") {
			return invalid("attachments", "invalid or duplicate object reference")
		}
		seen[attachment.ObjectId] = true
		if attachment.Filename != "" &&
			(filepath.Base(attachment.Filename) != attachment.Filename ||
				strings.ContainsAny(attachment.Filename, "\\\r\n\x00") || len(attachment.Filename) > 255) {
			return invalid("attachments.filename", "a bounded filename is required")
		}
		if len(attachment.MediaType) > 100 {
			return invalid("attachments.media_type", "media type exceeds its bound")
		}
		// Object metadata is resolved from the authorized object plane.
		attachment.Filename = ""
		attachment.MediaType = ""
		attachment.Size = 0
	}
	// The caller cannot smuggle a second business-state source via fallback.
	content.FallbackText = fallback
	return nil
}

func normalizeActions(actions []*chat.MessageOpenUrlAction) error {
	if len(actions) > 8 {
		return invalid("actions", "at most eight actions are supported")
	}
	for _, action := range actions {
		if action == nil {
			return invalid("actions", "nil action")
		}
		action.Label = strings.TrimSpace(action.Label)
		parsed, err := url.Parse(action.Url)
		if action.Label == "" || len(action.Label) > 100 || len(action.Url) > 2048 ||
			err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") ||
			parsed.Hostname() == "" || parsed.User != nil || strings.ContainsAny(action.Url, "\r\n\x00") {
			return invalid("actions", "only labeled absolute HTTP(S) URL actions are supported")
		}
	}
	return nil
}

func hasUnknownFields(message protoreflect.Message) bool {
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
			for i := 0; i < list.Len(); i++ {
				unknown = unknown || hasUnknownFields(list.Get(i).Message())
			}
		} else if field.Message() != nil {
			unknown = unknown || hasUnknownFields(value.Message())
		}
		return !unknown
	})
	return unknown
}

func invalid(field, reason string) error {
	return conversationdomain.NewError(conversationdomain.ErrorCodeInvalidArgument,
		"publishing.normalize", field, fmt.Sprintf("%s", reason))
}
