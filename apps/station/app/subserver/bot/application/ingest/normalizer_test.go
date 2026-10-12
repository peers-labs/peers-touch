package ingest

import (
	"strings"
	"testing"

	botmodel "github.com/peers-labs/peers-touch/station/app/subserver/bot/model"
)

func TestNormalizeAcceptsMinimalEvent(t *testing.T) {
	req := &botmodel.IngestWebhookEventRequest{
		SchemaVersion: "1",
		RequestId:     "req-1",
		EventType:     botmodel.BotEventType_BOT_EVENT_TYPE_CUSTOM,
		Severity:      botmodel.BotEventSeverity_BOT_EVENT_SEVERITY_UNSPECIFIED,
		Title:         "hello",
	}
	event, err := NormalizeRequest(req)
	if err != nil {
		t.Fatalf("NormalizeRequest() error = %v", err)
	}
	if event.RequestID != "req-1" || event.Kind != 5 || event.Severity != 1 {
		t.Fatalf("normalized = %+v, want custom kind/info default", event)
	}
	if event.FallbackText() != "通知: hello" {
		t.Fatalf("fallback = %q", event.FallbackText())
	}
}

func TestNormalizeRejectsBadShape(t *testing.T) {
	cases := map[string]*botmodel.IngestWebhookEventRequest{
		"bad schema": {
			SchemaVersion: "2",
			RequestId:     "r",
			EventType:     botmodel.BotEventType_BOT_EVENT_TYPE_CUSTOM,
			Title:         "x",
		},
		"missing request id": {
			SchemaVersion: "1",
			EventType:     botmodel.BotEventType_BOT_EVENT_TYPE_CUSTOM,
			Title:         "x",
		},
		"unspecified event type": {
			SchemaVersion: "1",
			RequestId:     "r",
			EventType:     botmodel.BotEventType_BOT_EVENT_TYPE_UNSPECIFIED,
			Title:         "x",
		},
		"empty content": {
			SchemaVersion: "1",
			RequestId:     "r",
			EventType:     botmodel.BotEventType_BOT_EVENT_TYPE_CUSTOM,
		},
		"oversized body": {
			SchemaVersion: "1",
			RequestId:     "r",
			EventType:     botmodel.BotEventType_BOT_EVENT_TYPE_CUSTOM,
			Body:          strings.Repeat("x", 4096),
		},
		"bad action url": {
			SchemaVersion: "1",
			RequestId:     "r",
			EventType:     botmodel.BotEventType_BOT_EVENT_TYPE_CUSTOM,
			Title:         "x",
			Source:        &botmodel.WebhookSource{ActionUrl: "javascript:alert(1)"},
		},
	}
	for name, req := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := NormalizeRequest(req); err == nil {
				t.Fatalf("%s: expected validation error", name)
			}
		})
	}
}

func TestNormalizeAcceptsHTTPLinksAndBoundsLabels(t *testing.T) {
	req := &botmodel.IngestWebhookEventRequest{
		SchemaVersion: "1",
		RequestId:     "r",
		EventType:     botmodel.BotEventType_BOT_EVENT_TYPE_TASK_FAILED,
		Severity:      botmodel.BotEventSeverity_BOT_EVENT_SEVERITY_ERROR,
		Body:          "failed",
		Source: &botmodel.WebhookSource{
			ActionUrl: "peers://conversation/evt-1",
			Labels:    map[string]string{"k": "v"},
		},
	}
	// Non-http custom scheme must be rejected by the v1 allow list.
	if _, err := NormalizeRequest(req); err == nil {
		t.Fatal("expected rejection of peers:// action url")
	}
	req.Source.ActionUrl = "https://example.local/x"
	event, err := NormalizeRequest(req)
	if err != nil {
		t.Fatalf("NormalizeRequest() error = %v", err)
	}
	if event.Source.ActionURL != "https://example.local/x" {
		t.Fatalf("action url = %q", event.Source.ActionURL)
	}
}

func TestNormalizeRedactsSecretLikeContent(t *testing.T) {
	req := &botmodel.IngestWebhookEventRequest{
		SchemaVersion: "1",
		RequestId:     "r",
		EventType:     botmodel.BotEventType_BOT_EVENT_TYPE_CUSTOM,
		Body:          "token: ptsec_0123456789abcdef0123456789abcdef leaked",
		Source: &botmodel.WebhookSource{
			Labels: map[string]string{"debug": "Authorization: Bearer abcdefghijklmnopqrst"},
		},
	}
	event, err := NormalizeRequest(req)
	if err != nil {
		t.Fatalf("NormalizeRequest() error = %v", err)
	}
	if strings.Contains(event.Body, "ptsec_") {
		t.Fatalf("secret survived in body: %q", event.Body)
	}
	if strings.Contains(event.Source.Labels["debug"], "abcdefghijklmnop") {
		t.Fatalf("bearer survived in label: %q", event.Source.Labels["debug"])
	}
}
