package relay

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/protocol"
)

type relayCaptureLogger struct {
	mu       sync.Mutex
	options  logger.Options
	messages []string
}

func (l *relayCaptureLogger) Init(_ context.Context, options ...logger.Option) error {
	for _, option := range options {
		option(&l.options)
	}
	return nil
}

func (l *relayCaptureLogger) Options() logger.Options { return l.options }

func (l *relayCaptureLogger) Fields(_ map[string]interface{}) logger.Logger {
	return l
}

func (l *relayCaptureLogger) Log(
	_ context.Context,
	_ logger.Level,
	values ...interface{},
) {
	l.mu.Lock()
	l.messages = append(l.messages, fmt.Sprint(values...))
	l.mu.Unlock()
}

func (l *relayCaptureLogger) Logf(
	_ context.Context,
	_ logger.Level,
	format string,
	values ...interface{},
) {
	l.mu.Lock()
	l.messages = append(l.messages, fmt.Sprintf(format, values...))
	l.mu.Unlock()
}

func (l *relayCaptureLogger) String() string { return "relay-capture" }

func (l *relayCaptureLogger) joined() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return strings.Join(l.messages, "\n")
}

func captureRelayLogs(t *testing.T) *relayCaptureLogger {
	t.Helper()
	capture := &relayCaptureLogger{
		options: logger.Options{Level: logger.DebugLevel},
	}
	previous := logger.DefaultLogger
	logger.DefaultLogger = capture
	t.Cleanup(func() {
		logger.DefaultLogger = previous
	})
	return capture
}

func assertPrivateObjectLog(
	t *testing.T,
	logs string,
	outcome string,
	requestID string,
	forbidden ...string,
) {
	t.Helper()
	for _, value := range forbidden {
		if strings.Contains(logs, value) {
			t.Fatalf("private Relay log leaked %q: %s", value, logs)
		}
	}
	for _, required := range []string{
		"route=" + protocol.SocialPrivateObjectReadRoute,
		"method=POST",
		"outcome=" + outcome,
		"request_id=" + requestID,
	} {
		if !strings.Contains(logs, required) {
			t.Fatalf("private Relay log is missing %q: %s", required, logs)
		}
	}
}

func TestFederatedPrivateObjectRelayRedactsLogs(t *testing.T) {
	capture := captureRelayLogs(t)
	sub := &SubServer{
		opts: &Options{
			ForwardTimeout: 1,
			MaxBodySize:    1024,
		},
		streams: NewStreamManager(nil, 1),
	}
	handler := newRelayHandler(sub)
	const (
		targetPeer = "target-peer-secret"
		objectID   = "object-secret"
		query      = "private-query"
		requestID  = "MDEyMzQ1Njc4OWFiY2RlZg"
	)
	request := httptest.NewRequest(
		http.MethodPost,
		"/relay/forward/"+targetPeer+
			"/federation/social/private/objects/"+objectID+
			"/read?cursor="+query,
		strings.NewReader("private-body"),
	)
	request.Header.Set("X-Request-ID", requestID)
	response := httptest.NewRecorder()

	handler.handleForward(response, request)
	orphan := &streamEntry{
		ctx:       context.Background(),
		peerID:    targetPeer,
		pending:   make(map[uint32]*pendingRequest),
		semaphore: make(chan struct{}, 1),
	}
	orphan.dispatchResponse(
		&protocol.ResponseFrame{RequestID: 99},
		protocol.RouteLogContext{},
	)
	orphan.dispatchCancelled(
		&protocol.CancelledFrame{RequestID: 100},
		protocol.RouteLogContext{},
	)
	orphan.pendingMu.Lock()
	orphan.lastPrivateObjectLog = protocol.RouteLogContext{
		Category:  protocol.SocialPrivateObjectReadRoute,
		Method:    http.MethodPost,
		RequestID: requestID,
	}
	orphan.pendingMu.Unlock()
	logStreamDisconnected(context.Background(), orphan)
	orphan.logPrivacyAware(
		protocol.RouteLogContext{},
		protocol.RouteLogOutcomeInterrupted,
		"[stream] later unrelated failure for %s req_id=%d",
		targetPeer,
		101,
	)

	logs := capture.joined()
	assertPrivateObjectLog(
		t,
		logs,
		protocol.RouteLogOutcomeRetryable,
		requestID,
		targetPeer,
		objectID,
		query,
		"private-body",
		"req_id=99",
		"req_id=100",
		"req_id=101",
		"/federation/social/private/objects/",
	)
}

func TestRelayRequestIDLogValueRequiresStrictBase64URL(t *testing.T) {
	if got := protocol.SanitizePeerHopRequestID("MDEyMzQ1Njc4OWFiY2RlZg"); got == "invalid" {
		t.Fatal("canonical unpadded base64url request ID was rejected")
	}
	for _, value := range []string{
		"MDEyMzQ1Njc4OWFiY2RlZg==",
		"AB",
		"request\ninjection",
	} {
		if got := protocol.SanitizePeerHopRequestID(value); got != "invalid" {
			t.Fatalf("non-canonical request ID %q was logged as %q", value, got)
		}
	}
}
