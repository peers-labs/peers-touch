package native

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestHTTPServerAppliesRequestReadTimeout(t *testing.T) {
	httpServer := newHTTPServer(
		"127.0.0.1:0",
		http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}),
		19*time.Second,
	)
	if httpServer.ReadTimeout != 19*time.Second {
		t.Fatalf("read timeout = %s, want 19s", httpServer.ReadTimeout)
	}
}

func TestRequestHeaderExposesContentLength(t *testing.T) {
	httpRequest := httptest.NewRequest(
		http.MethodPut,
		"/upload",
		bytes.NewBufferString("body"),
	)
	request := &request{r: httpRequest}

	if got := request.Header()["Content-Length"]; got != "4" {
		t.Fatalf("content length = %q, want 4", got)
	}
}

func TestResponseSetBodyStreamCommitsMetadataAndClosesReader(t *testing.T) {
	recorder := httptest.NewRecorder()
	response := &response{w: recorder}
	response.SetHeader("Content-Type", "application/octet-stream")
	response.SetHeader("Content-Range", "bytes 1-3/5")
	response.WriteHeader(http.StatusPartialContent)
	reader := &trackingReadCloser{
		Reader: bytes.NewBufferString("bcd"),
	}

	if err := response.SetBodyStream(reader, 3); err != nil {
		t.Fatal(err)
	}
	if recorder.Code != http.StatusPartialContent {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusPartialContent)
	}
	if got := recorder.Header().Get("Content-Type"); got != "application/octet-stream" {
		t.Fatalf("content type = %q", got)
	}
	if got := recorder.Header().Get("Content-Range"); got != "bytes 1-3/5" {
		t.Fatalf("content range = %q", got)
	}
	if got := recorder.Body.String(); got != "bcd" {
		t.Fatalf("body = %q", got)
	}
	if !reader.closed {
		t.Fatal("stream reader was not closed")
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
