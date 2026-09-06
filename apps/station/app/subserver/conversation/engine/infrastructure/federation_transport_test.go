package infrastructure

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/worker"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/encoding/protojson"
)

type tokenMinterStub struct{}

func (tokenMinterStub) Mint(
	context.Context,
	string,
	*chat.MessagingFederationFrame,
) (string, error) {
	return "target-peer-jwt", nil
}

type stationURLStub struct {
	url string
}

func (s stationURLStub) ResolveActiveStationURL(context.Context, string) (string, error) {
	return s.url, nil
}

type relayStub struct {
	url   string
	token string
}

func (s relayStub) BaseURL() string { return s.url }
func (s relayStub) Token() string   { return s.token }

func transportFrame() *chat.MessagingFederationFrame {
	return &chat.MessagingFederationFrame{
		FrameId:         "frame-1",
		SourceStationId: "station-a",
		TargetStationId: "station-b",
		IdempotencyKey:  "idempotency-1",
	}
}

func TestHTTPFederationTransportDirectDeliveryRequiresAcceptedResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/federation/delivery" {
			t.Fatalf("path = %s", request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer target-peer-jwt" {
			t.Fatalf("authorization = %q", request.Header.Get("Authorization"))
		}
		var body chat.DeliverMessagingFederationFrameRequest
		raw, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatal(err)
		}
		if err := protojson.Unmarshal(raw, &body); err != nil {
			t.Fatal(err)
		}
		if body.Frame.GetFrameId() != "frame-1" {
			t.Fatalf("frame = %+v", body.Frame)
		}
		response, _ := protojson.Marshal(&chat.DeliverMessagingFederationFrameResponse{
			Accepted: true,
		})
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write(response)
	}))
	defer server.Close()
	transport, err := NewHTTPFederationTransport(
		server.Client(),
		tokenMinterStub{},
		stationURLStub{url: server.URL},
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	result := transport.Deliver(context.Background(), transportFrame())
	if !result.Delivered {
		t.Fatalf("delivery result = %+v", result)
	}
}

func TestHTTPFederationTransportUsesRelayBearerAndForwardJWT(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if !strings.HasSuffix(
			request.URL.Path,
			"/relay/forward/station-b/federation/delivery",
		) {
			t.Fatalf("path = %s", request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer relay-token" {
			t.Fatalf("relay authorization = %q", request.Header.Get("Authorization"))
		}
		if request.Header.Get(nativefed.ForwardAuthorizationHeader) !=
			"Bearer target-peer-jwt" {
			t.Fatalf(
				"forward authorization = %q",
				request.Header.Get(nativefed.ForwardAuthorizationHeader),
			)
		}
		response, _ := protojson.Marshal(&chat.DeliverMessagingFederationFrameResponse{
			Accepted:  true,
			Duplicate: true,
		})
		_, _ = writer.Write(response)
	}))
	defer server.Close()
	transport, err := NewHTTPFederationTransport(
		server.Client(),
		tokenMinterStub{},
		nil,
		relayStub{url: server.URL, token: "relay-token"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if result := transport.Deliver(context.Background(), transportFrame()); !result.Delivered {
		t.Fatalf("delivery result = %+v", result)
	}
}

func TestHTTPFederationTransportClassifiesRetryableAndTerminalResponses(t *testing.T) {
	for _, test := range []struct {
		status    int
		retryable bool
	}{
		{status: http.StatusTooManyRequests, retryable: true},
		{status: http.StatusServiceUnavailable, retryable: true},
		{status: http.StatusBadRequest, retryable: false},
		{status: http.StatusForbidden, retryable: false},
	} {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			writer.WriteHeader(test.status)
		}))
		transport, err := NewHTTPFederationTransport(
			server.Client(),
			tokenMinterStub{},
			stationURLStub{url: server.URL},
			nil,
		)
		if err != nil {
			t.Fatal(err)
		}
		result := transport.Deliver(context.Background(), transportFrame())
		server.Close()
		if result.Delivered ||
			result.Retryable != test.retryable ||
			result.ErrorCode == "" {
			t.Fatalf("status %d result = %+v", test.status, result)
		}
	}
}

var _ worker.FederationTransport = (*HTTPFederationTransport)(nil)
