package client

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/protocol"
)

type clientCaptureLogger struct {
	mu       sync.Mutex
	options  logger.Options
	messages []string
}

func (l *clientCaptureLogger) Init(_ context.Context, options ...logger.Option) error {
	for _, option := range options {
		option(&l.options)
	}
	return nil
}

func (l *clientCaptureLogger) Options() logger.Options { return l.options }

func (l *clientCaptureLogger) Fields(_ map[string]interface{}) logger.Logger {
	return l
}

func (l *clientCaptureLogger) Log(
	_ context.Context,
	_ logger.Level,
	values ...interface{},
) {
	l.mu.Lock()
	l.messages = append(l.messages, fmt.Sprint(values...))
	l.mu.Unlock()
}

func (l *clientCaptureLogger) Logf(
	_ context.Context,
	_ logger.Level,
	format string,
	values ...interface{},
) {
	l.mu.Lock()
	l.messages = append(l.messages, fmt.Sprintf(format, values...))
	l.mu.Unlock()
}

func (l *clientCaptureLogger) String() string { return "relay-client-capture" }

func (l *clientCaptureLogger) joined() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return strings.Join(l.messages, "\n")
}

func captureClientLogs(t *testing.T) *clientCaptureLogger {
	t.Helper()
	capture := &clientCaptureLogger{
		options: logger.Options{Level: logger.DebugLevel},
	}
	previous := logger.DefaultLogger
	logger.DefaultLogger = capture
	t.Cleanup(func() {
		logger.DefaultLogger = previous
	})
	return capture
}

func assertPrivateObjectClientLog(
	t *testing.T,
	logs string,
	outcome string,
	requestID string,
	forbidden ...string,
) {
	t.Helper()
	for _, value := range forbidden {
		if strings.Contains(logs, value) {
			t.Fatalf("private relay-client log leaked %q: %s", value, logs)
		}
	}
	for _, required := range []string{
		"route=" + protocol.SocialPrivateObjectReadRoute,
		"method=POST",
		"outcome=" + outcome,
		"request_id=" + requestID,
	} {
		if !strings.Contains(logs, required) {
			t.Fatalf("private relay-client log is missing %q: %s", required, logs)
		}
	}
}

func TestRelayClientBoundedResponseErrorRedactsLog(t *testing.T) {
	capture := captureClientLogs(t)
	relayConn, clientConn := net.Pipe()
	defer relayConn.Close()
	defer clientConn.Close()

	const (
		objectID  = "object-secret"
		query     = "private-query"
		requestID = "MDEyMzQ1Njc4OWFiY2RlZg"
	)
	path := protocol.SocialPrivateObjectReadRoutePrefix + objectID +
		"/read?cursor=" + query
	client := New(Config{
		Dispatcher: func(
			_ context.Context,
			_ *protocol.RequestFrame,
		) (uint32, map[string]string, []byte, error) {
			return 0, nil, nil, fmt.Errorf(
				"%w: target-peer-secret %s private-body",
				ErrResponseLimit,
				path,
			)
		},
	})
	readLoopDone := make(chan struct{})
	go func() {
		client.readLoop(
			context.Background(),
			bufio.NewReader(clientConn),
			clientConn,
		)
		close(readLoopDone)
	}()

	if err := protocol.WriteRequestFrame(
		relayConn,
		73,
		"POST",
		path,
		map[string]string{protocol.PeerHopRequestIDHeader: requestID},
		[]byte("private-body"),
	); err != nil {
		t.Fatal(err)
	}
	select {
	case <-readLoopDone:
	case <-time.After(time.Second):
		t.Fatal("relay-client did not close after bounded response rejection")
	}

	assertPrivateObjectClientLog(
		t,
		capture.joined(),
		protocol.RouteLogOutcomeRejected,
		requestID,
		"target-peer-secret",
		objectID,
		query,
		"private-body",
		"req_id=73",
		protocol.SocialPrivateObjectReadRoutePrefix,
	)
}

func TestRelayClientCancellationWriteErrorRedactsLog(t *testing.T) {
	capture := captureClientLogs(t)
	relayConn, clientConn := net.Pipe()
	_ = relayConn.Close()
	defer clientConn.Close()

	const (
		objectID  = "object-secret"
		query     = "private-query"
		requestID = "MDEyMzQ1Njc4OWFiY2RlZg"
	)
	requests := newInboundRequests()
	requestCtx, request := requests.add(context.Background(), 81)
	requests.cancel(81)
	client := New(Config{
		Dispatcher: func(
			_ context.Context,
			_ *protocol.RequestFrame,
		) (uint32, map[string]string, []byte, error) {
			return 206, nil, []byte("private-body"), nil
		},
	})
	client.handleRequest(
		requestCtx,
		clientConn,
		&protocol.RequestFrame{
			RequestID: 81,
			Method:    "POST",
			Path: protocol.SocialPrivateObjectReadRoutePrefix + objectID +
				"/read?cursor=" + query,
			Headers: map[string]string{
				protocol.PeerHopRequestIDHeader: requestID,
			},
			Body: []byte("private-body"),
		},
		request,
		requests,
	)

	assertPrivateObjectClientLog(
		t,
		capture.joined(),
		protocol.RouteLogOutcomeInterrupted,
		requestID,
		objectID,
		query,
		"private-body",
		"req_id=81",
		protocol.SocialPrivateObjectReadRoutePrefix,
	)
}

func TestRelayClientUnrelatedErrorLogIsPreserved(t *testing.T) {
	capture := captureClientLogs(t)
	relayConn, clientConn := net.Pipe()
	defer relayConn.Close()
	defer clientConn.Close()

	requests := newInboundRequests()
	requestCtx, request := requests.add(context.Background(), 91)
	client := New(Config{
		Dispatcher: func(
			_ context.Context,
			_ *protocol.RequestFrame,
		) (uint32, map[string]string, []byte, error) {
			return 0, nil, nil, fmt.Errorf("%w: legacy-detail", ErrResponseLimit)
		},
	})
	client.handleRequest(
		requestCtx,
		clientConn,
		&protocol.RequestFrame{
			RequestID: 91,
			Method:    "POST",
			Path:      "/conversation/command",
		},
		request,
		requests,
	)

	const legacyLog = "[relay-client] bounded response rejected (req_id=91): " +
		"relay-client: response exceeds route limits: legacy-detail"
	if logs := capture.joined(); !strings.Contains(logs, legacyLog) {
		t.Fatalf("unrelated relay-client logging changed; missing %q in %s", legacyLog, logs)
	}
}

func TestRelayClientCancelAcknowledgesAfterDispatcherStops(t *testing.T) {
	relayConn, clientConn := net.Pipe()
	defer relayConn.Close()
	defer clientConn.Close()

	dispatchStarted := make(chan struct{})
	dispatchStopped := make(chan struct{})
	client := New(Config{
		Dispatcher: func(
			ctx context.Context,
			_ *protocol.RequestFrame,
		) (uint32, map[string]string, []byte, error) {
			close(dispatchStarted)
			<-ctx.Done()
			close(dispatchStopped)
			return 206, nil, []byte("must-not-be-sent"), nil
		},
	})
	readLoopDone := make(chan struct{})
	go func() {
		client.readLoop(
			context.Background(),
			bufio.NewReader(clientConn),
			clientConn,
		)
		close(readLoopDone)
	}()

	if err := protocol.WriteRequestFrame(
		relayConn,
		1,
		"POST",
		"/federation/social/private/objects/object-01/read",
		nil,
		nil,
	); err != nil {
		t.Fatal(err)
	}
	<-dispatchStarted
	if err := protocol.WriteCancel(relayConn, 1); err != nil {
		t.Fatal(err)
	}

	frame, err := protocol.ReadFrame(relayConn)
	if err != nil {
		t.Fatal(err)
	}
	cancelled, ok := frame.(*protocol.CancelledFrame)
	if !ok || cancelled.RequestID != 1 {
		t.Fatalf("unexpected cancellation acknowledgement: %#v", frame)
	}
	select {
	case <-dispatchStopped:
	default:
		t.Fatal("Cancelled was sent before the dispatcher stopped")
	}

	if err := relayConn.SetReadDeadline(time.Now().Add(25 * time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	if frame, err := protocol.ReadFrame(relayConn); err == nil {
		t.Fatalf("unexpected frame after Cancelled: %#v", frame)
	}
	_ = relayConn.SetReadDeadline(time.Time{})

	_ = clientConn.Close()
	select {
	case <-readLoopDone:
	case <-time.After(time.Second):
		t.Fatal("relay-client read loop did not stop")
	}
}

func TestRelayClientRejectsRequestIDReuseOnOneStream(t *testing.T) {
	relayConn, clientConn := net.Pipe()
	defer relayConn.Close()
	defer clientConn.Close()

	client := New(Config{
		Dispatcher: func(
			_ context.Context,
			_ *protocol.RequestFrame,
		) (uint32, map[string]string, []byte, error) {
			return 404, nil, nil, nil
		},
	})
	readLoopDone := make(chan struct{})
	go func() {
		client.readLoop(
			context.Background(),
			bufio.NewReader(clientConn),
			clientConn,
		)
		close(readLoopDone)
	}()

	for attempt := 0; attempt < 2; attempt++ {
		if err := protocol.WriteRequestFrame(
			relayConn,
			1,
			"POST",
			"/federation/social/private/objects/object-01/read",
			nil,
			nil,
		); err != nil {
			t.Fatal(err)
		}
		if attempt == 0 {
			frame, err := protocol.ReadFrame(relayConn)
			if err != nil {
				t.Fatal(err)
			}
			if _, ok := frame.(*protocol.ResponseFrame); !ok {
				t.Fatalf("unexpected first terminal frame: %#v", frame)
			}
		}
	}

	select {
	case <-readLoopDone:
	case <-time.After(time.Second):
		t.Fatal("relay-client accepted a reused request ID")
	}
}
