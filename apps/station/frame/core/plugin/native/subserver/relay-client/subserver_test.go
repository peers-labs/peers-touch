package relayclient

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/protocol"
)

func TestMakeDispatcherMapsForwardAuthorizationToLocalAuthorization(t *testing.T) {
	var sawAuthorization string
	var sawForwardAuthorization string
	local := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawAuthorization = r.Header.Get("Authorization")
		sawForwardAuthorization = r.Header.Get(federation.ForwardAuthorizationHeader)
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
	status, _, body, err := sub.makeDispatcher()(context.Background(), &protocol.RequestFrame{
		Method: http.MethodPost,
		Path:   "/conversation/proposal/accept",
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
}
