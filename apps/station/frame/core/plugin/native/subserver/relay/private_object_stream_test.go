package relay

import (
	"context"
	"encoding/binary"
	"errors"
	"net"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/protocol"
)

const privateObjectTestPath = "/federation/social/private/objects/object-01/read"

type sendRequestResult struct {
	response  *protocol.ResponseFrame
	requestID uint32
	err       error
}

func sendPrivateObjectRequest(
	entry *streamEntry,
	ctx context.Context,
	drainTimeout time.Duration,
) sendRequestResult {
	response, requestID, err := entry.SendRequest(
		ctx,
		"POST",
		privateObjectTestPath,
		map[string]string{"X-Request-ID": "MDEyMzQ1Njc4OWFiY2RlZg"},
		[]byte{0x08, 0x01},
		protocol.MaxPrivateObjectResponsePayloadLen,
		drainTimeout,
	)
	return sendRequestResult{
		response:  response,
		requestID: requestID,
		err:       err,
	}
}

func newPrivateObjectTestEntry(
	t *testing.T,
	maxConcurrent int,
) (*streamEntry, net.Conn) {
	t.Helper()
	relayConn, stationConn := net.Pipe()
	entry := newStreamEntry(
		context.Background(),
		"target-peer",
		relayConn,
		maxConcurrent,
		nil,
	)
	t.Cleanup(func() {
		entry.Close()
		_ = stationConn.Close()
		entry.Wait()
	})
	return entry, stationConn
}

func readRequestFrame(conn net.Conn) (*protocol.RequestFrame, error) {
	frame, err := protocol.ReadFrame(conn)
	if err != nil {
		return nil, err
	}
	request, ok := frame.(*protocol.RequestFrame)
	if !ok {
		return nil, errors.New("expected request frame")
	}
	return request, nil
}

func readCancelFrame(conn net.Conn) (*protocol.CancelFrame, error) {
	frame, err := protocol.ReadFrame(conn)
	if err != nil {
		return nil, err
	}
	cancel, ok := frame.(*protocol.CancelFrame)
	if !ok {
		return nil, errors.New("expected cancel frame")
	}
	return cancel, nil
}

func waitForEntryIdle(t *testing.T, entry *streamEntry) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		entry.pendingMu.Lock()
		pending := len(entry.pending)
		entry.pendingMu.Unlock()
		if pending == 0 && len(entry.semaphore) == 0 {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf(
		"entry did not become idle: pending=%d admitted=%d",
		len(entry.pending),
		len(entry.semaphore),
	)
}

func TestFederatedPrivateObjectRelayBoundedResponseErrorRedactsStreamLog(
	t *testing.T,
) {
	capture := captureRelayLogs(t)
	entry, stationConn := newPrivateObjectTestEntry(t, 1)
	const (
		objectID  = "object-secret"
		query     = "private-query"
		requestID = "MDEyMzQ1Njc4OWFiY2RlZg"
	)
	path := protocol.SocialPrivateObjectReadRoutePrefix + objectID +
		"/read?cursor=" + query

	stationErr := make(chan error, 1)
	go func() {
		request, err := readRequestFrame(stationConn)
		if err != nil {
			stationErr <- err
			return
		}
		var envelope [protocol.HeaderLen]byte
		envelope[0] = protocol.FrameVersion
		envelope[1] = protocol.TypeResponse
		binary.BigEndian.PutUint32(envelope[2:6], request.RequestID)
		binary.BigEndian.PutUint32(
			envelope[6:10],
			protocol.MaxPrivateObjectResponsePayloadLen+1,
		)
		_, err = stationConn.Write(envelope[:])
		stationErr <- err
	}()

	_, numericRequestID, err := entry.SendRequest(
		context.Background(),
		"POST",
		path,
		map[string]string{protocol.PeerHopRequestIDHeader: requestID},
		[]byte("private-body"),
		protocol.MaxPrivateObjectResponsePayloadLen,
		time.Second,
	)
	if !errors.Is(err, ErrStreamDisconnected) {
		t.Fatalf("expected bounded response to disconnect the stream, got %v", err)
	}
	if err := <-stationErr; err != nil {
		t.Fatal(err)
	}
	<-entry.done

	assertPrivateObjectLog(
		t,
		capture.joined(),
		protocol.RouteLogOutcomeRejected,
		requestID,
		entry.peerID,
		objectID,
		query,
		"private-body",
		"req_id="+strconv.FormatUint(uint64(numericRequestID), 10),
		protocol.SocialPrivateObjectReadRoutePrefix,
	)
}

func TestFederatedPrivateObjectRelayOrphanLogsAreRedacted(t *testing.T) {
	capture := captureRelayLogs(t)
	entry, _ := newPrivateObjectTestEntry(t, 1)
	const requestID = "MDEyMzQ1Njc4OWFiY2RlZg"
	logContext, ok := protocol.PrivateObjectRouteLogContext(
		"POST",
		privateObjectTestPath,
		map[string]string{protocol.PeerHopRequestIDHeader: requestID},
	)
	if !ok {
		t.Fatal("private-object route was not classified")
	}

	entry.dispatchResponse(
		&protocol.ResponseFrame{RequestID: 41},
		logContext,
	)
	entry.dispatchCancelled(
		&protocol.CancelledFrame{RequestID: 42},
		logContext,
	)

	assertPrivateObjectLog(
		t,
		capture.joined(),
		protocol.RouteLogOutcomeRejected,
		requestID,
		entry.peerID,
		"req_id=41",
		"req_id=42",
		privateObjectTestPath,
	)
}

func TestFederatedPrivateObjectRelayCancellationAcknowledgementReleasesSlot(
	t *testing.T,
) {
	entry, stationConn := newPrivateObjectTestEntry(t, 1)
	firstRequest := make(chan uint32, 1)
	stationErr := make(chan error, 1)
	go func() {
		request, err := readRequestFrame(stationConn)
		if err != nil {
			stationErr <- err
			return
		}
		firstRequest <- request.RequestID
		cancel, err := readCancelFrame(stationConn)
		if err != nil {
			stationErr <- err
			return
		}
		if cancel.RequestID != request.RequestID {
			stationErr <- errors.New("cancel request ID mismatch")
			return
		}
		if err := protocol.WriteCancelled(stationConn, request.RequestID); err != nil {
			stationErr <- err
			return
		}
		second, err := readRequestFrame(stationConn)
		if err != nil {
			stationErr <- err
			return
		}
		stationErr <- protocol.WriteResponseFrame(
			stationConn,
			second.RequestID,
			404,
			map[string]string{"Content-Type": "application/json"},
			[]byte(`{"error":"not found"}`),
		)
	}()

	requestCtx, cancelRequest := context.WithCancel(context.Background())
	firstResult := make(chan sendRequestResult, 1)
	go func() {
		firstResult <- sendPrivateObjectRequest(entry, requestCtx, time.Second)
	}()
	<-firstRequest
	cancelRequest()
	if result := <-firstResult; !errors.Is(result.err, context.Canceled) {
		t.Fatalf("expected context cancellation, got %v", result.err)
	}

	waitForEntryIdle(t, entry)
	second := sendPrivateObjectRequest(entry, context.Background(), time.Second)
	if second.err != nil {
		t.Fatalf("second request failed: %v", second.err)
	}
	if second.response.StatusCode != 404 {
		t.Fatalf("unexpected second response status: %d", second.response.StatusCode)
	}
	if err := <-stationErr; err != nil {
		t.Fatal(err)
	}
}

func TestFederatedPrivateObjectRelayLateCancelledResponseKeepsSharedStream(
	t *testing.T,
) {
	entry, stationConn := newPrivateObjectTestEntry(t, 1)
	firstRequest := make(chan uint32, 1)
	stationErr := make(chan error, 1)
	go func() {
		request, err := readRequestFrame(stationConn)
		if err != nil {
			stationErr <- err
			return
		}
		firstRequest <- request.RequestID
		if _, err := readCancelFrame(stationConn); err != nil {
			stationErr <- err
			return
		}
		if err := protocol.WriteResponseFrame(
			stationConn,
			request.RequestID,
			404,
			nil,
			[]byte("late"),
		); err != nil {
			stationErr <- err
			return
		}
		second, err := readRequestFrame(stationConn)
		if err != nil {
			stationErr <- err
			return
		}
		stationErr <- protocol.WriteResponseFrame(
			stationConn,
			second.RequestID,
			404,
			nil,
			nil,
		)
	}()

	requestCtx, cancelRequest := context.WithCancel(context.Background())
	firstResult := make(chan sendRequestResult, 1)
	go func() {
		firstResult <- sendPrivateObjectRequest(entry, requestCtx, time.Second)
	}()
	<-firstRequest
	cancelRequest()
	if result := <-firstResult; !errors.Is(result.err, context.Canceled) {
		t.Fatalf("expected context cancellation, got %v", result.err)
	}

	waitForEntryIdle(t, entry)
	if entry.closed.Load() {
		t.Fatal("late bounded response closed the shared stream")
	}
	if result := sendPrivateObjectRequest(entry, context.Background(), time.Second); result.err != nil {
		t.Fatalf("shared stream was not reusable: %v", result.err)
	}
	if err := <-stationErr; err != nil {
		t.Fatal(err)
	}
}

func TestFederatedPrivateObjectRelayCancellationSaturationRejectsWithoutDisconnect(
	t *testing.T,
) {
	entry, stationConn := newPrivateObjectTestEntry(t, 1)
	firstRequest := make(chan uint32, 1)
	cancelSeen := make(chan struct{})
	releaseDrain := make(chan struct{})
	stationErr := make(chan error, 1)
	go func() {
		request, err := readRequestFrame(stationConn)
		if err != nil {
			stationErr <- err
			return
		}
		firstRequest <- request.RequestID
		if _, err := readCancelFrame(stationConn); err != nil {
			stationErr <- err
			return
		}
		close(cancelSeen)
		<-releaseDrain
		if err := protocol.WriteCancelled(stationConn, request.RequestID); err != nil {
			stationErr <- err
			return
		}
		next, err := readRequestFrame(stationConn)
		if err != nil {
			stationErr <- err
			return
		}
		stationErr <- protocol.WriteResponseFrame(stationConn, next.RequestID, 404, nil, nil)
	}()

	requestCtx, cancelRequest := context.WithCancel(context.Background())
	firstResult := make(chan sendRequestResult, 1)
	go func() {
		firstResult <- sendPrivateObjectRequest(entry, requestCtx, time.Second)
	}()
	<-firstRequest
	cancelRequest()
	if result := <-firstResult; !errors.Is(result.err, context.Canceled) {
		t.Fatalf("expected context cancellation, got %v", result.err)
	}
	<-cancelSeen

	saturated := sendPrivateObjectRequest(entry, context.Background(), time.Second)
	if !errors.Is(saturated.err, ErrTooManyConcurrent) {
		t.Fatalf("expected concurrency rejection, got %v", saturated.err)
	}
	if entry.closed.Load() {
		t.Fatal("cancellation saturation closed a healthy stream")
	}

	close(releaseDrain)
	waitForEntryIdle(t, entry)
	if result := sendPrivateObjectRequest(entry, context.Background(), time.Second); result.err != nil {
		t.Fatalf("stream was not reusable after drain acknowledgement: %v", result.err)
	}
	if err := <-stationErr; err != nil {
		t.Fatal(err)
	}
}

func TestFederatedPrivateObjectRelayCancellationDrainTimeoutRecyclesStream(
	t *testing.T,
) {
	capture := captureRelayLogs(t)
	entry, stationConn := newPrivateObjectTestEntry(t, 1)
	requestSeen := make(chan struct{})
	go func() {
		if _, err := readRequestFrame(stationConn); err != nil {
			return
		}
		close(requestSeen)
		_, _ = readCancelFrame(stationConn)
	}()

	requestCtx, cancelRequest := context.WithCancel(context.Background())
	result := make(chan sendRequestResult, 1)
	go func() {
		result <- sendPrivateObjectRequest(entry, requestCtx, 25*time.Millisecond)
	}()
	<-requestSeen
	cancelRequest()
	if got := <-result; !errors.Is(got.err, context.Canceled) {
		t.Fatalf("expected context cancellation, got %v", got.err)
	}

	select {
	case <-entry.done:
	case <-time.After(time.Second):
		t.Fatal("draining request did not recycle the unhealthy stream")
	}
	if !entry.closed.Load() {
		t.Fatal("drain timeout did not mark the stream closed")
	}
	if len(entry.semaphore) != 0 {
		t.Fatal("stream close did not release draining admission")
	}
	assertPrivateObjectLog(
		t,
		capture.joined(),
		protocol.RouteLogOutcomeInterrupted,
		"MDEyMzQ1Njc4OWFiY2RlZg",
		entry.peerID,
		"req_id=1",
		privateObjectTestPath,
	)
}

func TestRelayUnrelatedCancellationDrainLogIsPreserved(t *testing.T) {
	capture := captureRelayLogs(t)
	entry, stationConn := newPrivateObjectTestEntry(t, 1)
	requestSeen := make(chan struct{})
	go func() {
		if _, err := readRequestFrame(stationConn); err != nil {
			return
		}
		close(requestSeen)
		_, _ = readCancelFrame(stationConn)
	}()

	requestCtx, cancelRequest := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		_, _, err := entry.SendRequest(
			requestCtx,
			"POST",
			"/conversation/command",
			nil,
			nil,
			protocol.MaxPayloadLen,
			25*time.Millisecond,
		)
		result <- err
	}()
	<-requestSeen
	cancelRequest()
	if err := <-result; !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation, got %v", err)
	}
	select {
	case <-entry.done:
	case <-time.After(time.Second):
		t.Fatal("unrelated draining request did not recycle the stream")
	}
	const legacyLog = "[stream] cancellation drain timeout req_id=1 for target-peer"
	if logs := capture.joined(); !strings.Contains(logs, legacyLog) {
		t.Fatalf("unrelated Relay logging changed; missing %q in %s", legacyLog, logs)
	}
}

func TestFederatedPrivateObjectRelayRequestIDWrapRequiresNewStream(t *testing.T) {
	entry, stationConn := newPrivateObjectTestEntry(t, 1)
	entry.pendingMu.Lock()
	entry.nextRequestID = ^uint32(0) - 1
	entry.pendingMu.Unlock()

	seenID := make(chan uint32, 1)
	go func() {
		request, err := readRequestFrame(stationConn)
		if err != nil {
			return
		}
		seenID <- request.RequestID
		_ = protocol.WriteResponseFrame(stationConn, request.RequestID, 404, nil, nil)
	}()
	result := sendPrivateObjectRequest(entry, context.Background(), time.Second)
	if result.err != nil {
		t.Fatalf("final request ID failed: %v", result.err)
	}
	if got := <-seenID; got != ^uint32(0) {
		t.Fatalf("unexpected final request ID: %d", got)
	}
	select {
	case <-entry.done:
	case <-time.After(time.Second):
		t.Fatal("exhausted stream did not retire after draining")
	}

	nextEntry, nextStationConn := newPrivateObjectTestEntry(t, 1)
	nextID := make(chan uint32, 1)
	go func() {
		request, err := readRequestFrame(nextStationConn)
		if err != nil {
			return
		}
		nextID <- request.RequestID
		_ = protocol.WriteResponseFrame(nextStationConn, request.RequestID, 404, nil, nil)
	}()
	if result := sendPrivateObjectRequest(nextEntry, context.Background(), time.Second); result.err != nil {
		t.Fatalf("fresh stream request failed: %v", result.err)
	}
	if got := <-nextID; got != 1 {
		t.Fatalf("fresh stream did not restart at request ID 1: %d", got)
	}
}
