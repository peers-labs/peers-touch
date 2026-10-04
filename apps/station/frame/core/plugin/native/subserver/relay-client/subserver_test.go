package relayclient

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	streamclient "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/client"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/protocol"
)

func TestMakeDispatcherMapsForwardAuthorizationToLocalAuthorization(t *testing.T) {
	const metadata = "CAESBAgBEAIYAg"
	var sawAuthorization string
	var sawForwardAuthorization string
	local := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawAuthorization = r.Header.Get("Authorization")
		sawForwardAuthorization = r.Header.Get(federation.ForwardAuthorizationHeader)
		w.Header().Set(protocol.PrivateObjectMetadataHeader, metadata)
		_, _ = io.WriteString(w, `{"ok":true}`)
	}))
	defer local.Close()

	_, portValue, err := net.SplitHostPort(local.Listener.Addr().String())
	if err != nil {
		t.Fatalf("split local server addr: %v", err)
	}
	port, err := strconv.Atoi(portValue)
	if err != nil {
		t.Fatalf("parse local server port: %v", err)
	}
	sub := &SubServer{
		opts: &Options{
			LocalHTTPPort:       port,
			LocalHTTPTimeoutSec: 5,
		},
	}
	status, headers, body, err := sub.makeDispatcher()(context.Background(), &protocol.RequestFrame{
		Method: http.MethodPost,
		Path:   "/conversation/command",
		Headers: map[string]string{
			"Authorization":                       "Bearer relay-token",
			federation.ForwardAuthorizationHeader: "Bearer peer-jwt",
		},
		Body: []byte(`{}`),
	})
	if err != nil {
		t.Fatalf("dispatch request: %v", err)
	}
	if status != http.StatusOK {
		t.Fatalf("unexpected status=%d body=%s", status, string(body))
	}
	if sawAuthorization != "Bearer peer-jwt" {
		t.Fatalf("expected local Authorization to be peer jwt, got %q", sawAuthorization)
	}
	if sawForwardAuthorization != "" {
		t.Fatalf("expected forward auth header to be stripped before local dispatch, got %q", sawForwardAuthorization)
	}
	if headers[protocol.PrivateObjectMetadataHeader] != metadata {
		t.Fatalf("descriptor metadata was not preserved: %#v", headers)
	}
	if headers["Content-Length"] != strconv.Itoa(len(body)) {
		t.Fatalf("content length was not preserved: %#v", headers)
	}
}

func TestFederatedPrivateObjectRelayRejectsOversizedResponse(t *testing.T) {
	local := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(bytes.Repeat(
			[]byte{0x42},
			protocol.MaxPrivateObjectResponseBodyLen+1,
		))
	}))
	defer local.Close()

	_, portValue, err := net.SplitHostPort(local.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portValue)
	if err != nil {
		t.Fatal(err)
	}
	sub := &SubServer{opts: &Options{
		LocalHTTPPort:       port,
		LocalHTTPTimeoutSec: 5,
	}}
	_, _, body, err := sub.makeDispatcher()(
		context.Background(),
		&protocol.RequestFrame{
			Method: http.MethodPost,
			Path:   "/federation/social/private/objects/object-01/read",
		},
	)
	if !errors.Is(err, streamclient.ErrResponseLimit) {
		t.Fatalf("expected response limit error, got %v", err)
	}
	if body != nil {
		t.Fatalf("oversized response returned %d buffered bytes", len(body))
	}
}

func TestFederatedPrivateObjectRelaySlowConsumerCancellation(t *testing.T) {
	started := make(chan struct{})
	local := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusPartialContent)
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		close(started)
		<-r.Context().Done()
	}))
	defer local.Close()

	_, portValue, err := net.SplitHostPort(local.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portValue)
	if err != nil {
		t.Fatal(err)
	}
	sub := &SubServer{opts: &Options{
		LocalHTTPPort:       port,
		LocalHTTPTimeoutSec: 5,
	}}
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan struct{}, 1)
	go func() {
		_, _, _, _ = sub.makeDispatcher()(ctx, &protocol.RequestFrame{
			Method: http.MethodPost,
			Path:   "/federation/social/private/objects/object-01/read",
		})
		result <- struct{}{}
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("local response did not start")
	}
	cancel()
	select {
	case <-result:
	case <-time.After(time.Second):
		t.Fatal("dispatcher did not propagate cancellation to the slow response")
	}
}
