package hertz

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

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

func TestHertzEngineStreamsRequestBodies(t *testing.T) {
	engine := newHertzEngine("127.0.0.1:0", 17*time.Second)
	if !engine.GetOptions().StreamRequestBody {
		t.Fatal("Hertz request-body streaming is disabled")
	}
	if engine.GetOptions().ReadTimeout != 17*time.Second {
		t.Fatalf(
			"Hertz read timeout = %s, want 17s",
			engine.GetOptions().ReadTimeout,
		)
	}
}

func TestResponseSetBodyStreamPreservesMetadataAndOwnership(t *testing.T) {
	ctx := &app.RequestContext{}
	response := &hertzResponse{ctx: ctx}
	response.SetHeader("Content-Type", "application/octet-stream")
	response.SetHeader("Content-Range", "bytes 1-3/5")
	response.WriteHeader(http.StatusPartialContent)
	reader := &trackingReadCloser{
		Reader: bytes.NewBufferString("bcd"),
	}

	if err := response.SetBodyStream(reader, 3); err != nil {
		t.Fatal(err)
	}
	if !ctx.Response.IsBodyStream() {
		t.Fatal("response body was buffered")
	}
	if ctx.Response.StatusCode() != http.StatusPartialContent {
		t.Fatalf(
			"status = %d, want %d",
			ctx.Response.StatusCode(),
			http.StatusPartialContent,
		)
	}
	if got := string(ctx.Response.Header.ContentType()); got !=
		"application/octet-stream" {
		t.Fatalf("content type = %q", got)
	}
	if got := string(ctx.Response.Header.Peek("Content-Range")); got !=
		"bytes 1-3/5" {
		t.Fatalf("content range = %q", got)
	}
	body, err := io.ReadAll(ctx.Response.BodyStream())
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "bcd" {
		t.Fatalf("body = %q", body)
	}
	if err := ctx.Response.CloseBodyStream(); err != nil {
		t.Fatal(err)
	}
	if !reader.closed {
		t.Fatal("stream reader was not closed")
	}
}

func TestRequestHeaderExposesContentLength(t *testing.T) {
	ctx := &app.RequestContext{}
	ctx.Request.SetBodyStream(bytes.NewBufferString("body"), 4)
	request := &hertzRequest{ctx: ctx}

	if got := request.Header()["Content-Length"]; got != "4" {
		t.Fatalf("content length = %q, want 4", got)
	}
}

type trackingReadCloser struct {
	io.Reader
	closed bool
}

func (r *trackingReadCloser) Close() error {
	r.closed = true
	return nil
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
