package domain

import (
	"strings"
	"time"
)

// Webhook event bounds enforced before any persistence or delivery work.
// The edge rejects bodies above MaxWebhookBodyBytes with HTTP 413 and never
// buffers them in the typed-handler path.
const (
	MaxWebhookBodyBytes = 32 * 1024
	MaxFieldLen         = 2 * 1024
	MaxLabels           = 32
	MaxLabelKeyLen      = 100
	MaxLabelValueLen    = 512
	// IdempotencyWindow is the replay window for the client request id.
	IdempotencyWindow = 24 * time.Hour
)

// EventKind is the normalized bot event classification.
type EventKind int32

const (
	KindUnspecified   EventKind = 0
	KindTaskCompleted EventKind = 1
	KindWaitingInput  EventKind = 2
	KindTaskFailed    EventKind = 3
	KindIdle          EventKind = 4
	KindCustom        EventKind = 5
)

// Severity is the normalized event severity.
type Severity int32

const (
	SeverityUnspecified Severity = 0
	SeverityInfo        Severity = 1
	SeverityAttention   Severity = 2
	SeverityError       Severity = 3
)

// Source carries optional provenance from the coding agent. It is never a
// trust signal: attribution derives from the authenticated webhook record.
type Source struct {
	Agent     string
	Workspace string
	SessionID string
	ActionURL string
	Labels    map[string]string
}

// IncomingEvent is the normalized, validated webhook event. Recipient/bot
// attribution is filled by the application layer from the registry, never
// from request fields.
type IncomingEvent struct {
	RequestID string
	Kind      EventKind
	Severity  Severity
	Title     string
	Body      string
	GroupKey  string
	DedupeKey string
	Source    Source
}

// FallbackText renders the human-readable one-line fallback shown in ordinary
// message history when a rich card is unavailable.
func (e IncomingEvent) FallbackText() string {
	parts := make([]string, 0, 3)
	if prefix := e.KindPrefix(); prefix != "" {
		parts = append(parts, prefix)
	}
	if e.Title != "" {
		parts = append(parts, e.Title)
	}
	if e.Body != "" {
		parts = append(parts, e.Body)
	}
	return strings.Join(parts, ": ")
}

// KindPrefix is the short human label used in the fallback line.
func (e IncomingEvent) KindPrefix() string {
	switch e.Kind {
	case KindTaskCompleted:
		return "任务完成"
	case KindWaitingInput:
		return "等待输入"
	case KindTaskFailed:
		return "任务失败"
	case KindIdle:
		return "空闲"
	case KindCustom:
		return "通知"
	default:
		return ""
	}
}
