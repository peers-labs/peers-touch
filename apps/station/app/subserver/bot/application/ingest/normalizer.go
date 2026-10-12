package ingest

import (
	"net/url"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/bot/domain"
	botmodel "github.com/peers-labs/peers-touch/station/app/subserver/bot/model"
)

const schemaVersionV1 = "1"

// NormalizeRequest parses and validates the public proto-JSON webhook request
// into a domain event. It never trusts actor/recipient fields: only the
// authenticated registry record supplies attribution.
func NormalizeRequest(req *botmodel.IngestWebhookEventRequest) (domain.IncomingEvent, error) {
	if req == nil {
		return domain.IncomingEvent{}, domain.NewError(domain.CodeInvalidArgument, "request body is required")
	}
	if strings.TrimSpace(req.GetSchemaVersion()) != schemaVersionV1 {
		return domain.IncomingEvent{}, domain.NewError(
			domain.CodeInvalidArgument,
			"unsupported schema_version %q, want %q",
			req.GetSchemaVersion(), schemaVersionV1,
		)
	}
	requestID := strings.TrimSpace(req.GetRequestId())
	if requestID == "" || len(requestID) > domain.MaxFieldLen {
		return domain.IncomingEvent{}, domain.NewError(
			domain.CodeInvalidArgument, "request_id is required and must be <= %d bytes", domain.MaxFieldLen)
	}
	kind := mapEventKind(req.GetEventType())
	if kind == domain.KindUnspecified {
		return domain.IncomingEvent{}, domain.NewError(
			domain.CodeInvalidArgument, "event_type is required and must be a known enum value")
	}
	severity := mapSeverity(req.GetSeverity())
	if severity == domain.SeverityUnspecified {
		// Default info severity; explicit UNSPECIFIED in the wire enum is
		// normalized to INFO rather than rejected, matching the card design.
		severity = domain.SeverityInfo
	}
	title := strings.TrimSpace(RedactSecretLike("title", req.GetTitle()))
	body := strings.TrimSpace(RedactSecretLike("body", req.GetBody()))
	if title == "" && body == "" {
		return domain.IncomingEvent{}, domain.NewError(
			domain.CodeInvalidArgument, "title or body is required")
	}
	if len(title) > domain.MaxFieldLen || len(body) > domain.MaxFieldLen {
		return domain.IncomingEvent{}, domain.NewError(
			domain.CodeInvalidArgument, "title and body must each be <= %d bytes", domain.MaxFieldLen)
	}
	groupKey := strings.TrimSpace(req.GetGroupKey())
	dedupeKey := strings.TrimSpace(req.GetDedupeKey())
	if len(groupKey) > domain.MaxFieldLen || len(dedupeKey) > domain.MaxFieldLen {
		return domain.IncomingEvent{}, domain.NewError(
			domain.CodeInvalidArgument, "group_key and dedupe_key must be <= %d bytes", domain.MaxFieldLen)
	}

	source, err := normalizeSource(req.GetSource())
	if err != nil {
		return domain.IncomingEvent{}, err
	}
	return domain.IncomingEvent{
		RequestID: requestID,
		Kind:      kind,
		Severity:  severity,
		Title:     title,
		Body:      body,
		GroupKey:  groupKey,
		DedupeKey: dedupeKey,
		Source:    source,
	}, nil
}

func normalizeSource(ws *botmodel.WebhookSource) (domain.Source, error) {
	if ws == nil {
		return domain.Source{}, nil
	}
	agent := strings.TrimSpace(ws.GetAgent())
	workspace := strings.TrimSpace(ws.GetWorkspace())
	sessionID := strings.TrimSpace(ws.GetSessionId())
	actionURL := strings.TrimSpace(ws.GetActionUrl())
	if len(agent) > domain.MaxFieldLen ||
		len(workspace) > domain.MaxFieldLen ||
		len(sessionID) > domain.MaxFieldLen ||
		len(actionURL) > domain.MaxFieldLen {
		return domain.Source{}, domain.NewError(
			domain.CodeInvalidArgument, "source fields must each be <= %d bytes", domain.MaxFieldLen)
	}
	if actionURL != "" {
		parsed, err := url.Parse(actionURL)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return domain.Source{}, domain.NewError(
				domain.CodeInvalidArgument, "source.action_url must be a valid http(s) URL")
		}
	}
	labels := ws.GetLabels()
	if len(labels) > domain.MaxLabels {
		return domain.Source{}, domain.NewError(
			domain.CodeInvalidArgument, "source supports at most %d labels", domain.MaxLabels)
	}
	cleaned := make(map[string]string, len(labels))
	for key, value := range labels {
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(RedactSecretLike(key, value))
		if key == "" || len(key) > domain.MaxLabelKeyLen || len(value) > domain.MaxLabelValueLen {
			return domain.Source{}, domain.NewError(
				domain.CodeInvalidArgument, "label keys/values exceed the bounded size")
		}
		cleaned[key] = value
	}
	return domain.Source{
		Agent:     agent,
		Workspace: workspace,
		SessionID: sessionID,
		ActionURL: actionURL,
		Labels:    cleaned,
	}, nil
}

func mapEventKind(kind botmodel.BotEventType) domain.EventKind {
	switch kind {
	case botmodel.BotEventType_BOT_EVENT_TYPE_TASK_COMPLETED:
		return domain.KindTaskCompleted
	case botmodel.BotEventType_BOT_EVENT_TYPE_WAITING_INPUT:
		return domain.KindWaitingInput
	case botmodel.BotEventType_BOT_EVENT_TYPE_TASK_FAILED:
		return domain.KindTaskFailed
	case botmodel.BotEventType_BOT_EVENT_TYPE_IDLE:
		return domain.KindIdle
	case botmodel.BotEventType_BOT_EVENT_TYPE_CUSTOM:
		return domain.KindCustom
	default:
		return domain.KindUnspecified
	}
}

func mapSeverity(severity botmodel.BotEventSeverity) domain.Severity {
	switch severity {
	case botmodel.BotEventSeverity_BOT_EVENT_SEVERITY_INFO:
		return domain.SeverityInfo
	case botmodel.BotEventSeverity_BOT_EVENT_SEVERITY_ATTENTION:
		return domain.SeverityAttention
	case botmodel.BotEventSeverity_BOT_EVENT_SEVERITY_ERROR:
		return domain.SeverityError
	default:
		return domain.SeverityUnspecified
	}
}
