package wrapper

import (
	"context"
	"net/http"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type deviceIDTestRequest struct {
	headers map[string]string
}

func (r deviceIDTestRequest) Context() context.Context  { return context.Background() }
func (r deviceIDTestRequest) Header() map[string]string { return r.headers }
func (r deviceIDTestRequest) Method() server.Method     { return server.POST }
func (r deviceIDTestRequest) Path() string              { return "/conversation/group" }
func (r deviceIDTestRequest) Body() []byte              { return nil }

func TestDeviceIDAcceptsCanonicalizedHTTPHeaderName(t *testing.T) {
	const want = "device-01"
	var got string
	handler := DeviceID()(func(ctx context.Context, _ server.Request, _ server.Response) error {
		got = GetDeviceID(ctx)
		return nil
	})

	err := handler(context.Background(), deviceIDTestRequest{
		headers: map[string]string{"X-Device-Id": want},
	}, nil)
	if err != nil {
		t.Fatalf("wrapped handler returned error: %v", err)
	}
	if got != want {
		t.Fatalf("device id = %q, want %q", got, want)
	}
}

func TestRequireStructuredDeviceIDPropagatesMissingHeader(t *testing.T) {
	var failure server.RouteError
	var found bool
	handler := RequireStructuredDeviceID(20001)(func(
		ctx context.Context,
		_ server.Request,
		_ server.Response,
	) error {
		failure, found = server.RouteFailureFromContext(ctx)
		return nil
	})

	if err := handler(
		context.Background(),
		deviceIDTestRequest{headers: map[string]string{}},
		nil,
	); err != nil {
		t.Fatal(err)
	}
	if !found ||
		failure.Status != http.StatusUnauthorized ||
		failure.StableCode != 20001 {
		t.Fatalf("structured device failure = %+v, present=%t", failure, found)
	}
}
