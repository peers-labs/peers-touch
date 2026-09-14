package hertz

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/cloudwego/hertz/pkg/app"
)

func TestRequestLogPathUsesMatchedRouteTemplate(t *testing.T) {
	ctx := &app.RequestContext{}
	ctx.Request.SetRequestURI(
		"/conversation/attachments/uploads/private-upload/chunks/7",
	)
	ctx.SetFullPath(
		"/conversation/attachments/uploads/:upload_id/chunks/:chunk_index",
	)

	if got := requestLogPath(ctx); got !=
		"/conversation/attachments/uploads/:upload_id/chunks/:chunk_index" {
		t.Fatalf("request log path = %q", got)
	}
}

func TestRequestLogPathFallsBackForUnmatchedRoute(t *testing.T) {
	ctx := &app.RequestContext{}
	ctx.Request.SetRequestURI("/missing")

	if got := requestLogPath(ctx); got != "/missing" {
		t.Fatalf("request log path = %q", got)
	}
}

func TestCORSMiddlewareAllowsCanonicalRealtimeHeaders(t *testing.T) {
	ctx := &app.RequestContext{}
	ctx.Request.Header.SetMethod(http.MethodOptions)
	ctx.Request.Header.Set("Origin", "http://tauri.localhost")
	ctx.Request.Header.Set(
		"Access-Control-Request-Headers",
		"authorization,x-device-id,last-event-id",
	)

	CORSMiddleware()(context.Background(), ctx)

	if got := ctx.Response.Header.Get("Access-Control-Allow-Origin"); got != "http://tauri.localhost" {
		t.Fatalf("allowed origin = %q", got)
	}
	allowedHeaders := ctx.Response.Header.Get("Access-Control-Allow-Headers")
	for _, header := range []string{"Authorization", "X-Device-ID", "Last-Event-ID"} {
		if !strings.Contains(allowedHeaders, header) {
			t.Fatalf("allowed headers %q do not include %q", allowedHeaders, header)
		}
	}
	if ctx.Response.StatusCode() != http.StatusNoContent || !ctx.IsAborted() {
		t.Fatalf(
			"preflight status=%d aborted=%t",
			ctx.Response.StatusCode(),
			ctx.IsAborted(),
		)
	}
}
