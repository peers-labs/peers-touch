package conversation

import (
	"bytes"
	"context"
	"io"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type publishingStreamingRequest struct {
	body []byte
}

func (r publishingStreamingRequest) Context() context.Context  { return context.Background() }
func (r publishingStreamingRequest) Header() map[string]string { return nil }
func (r publishingStreamingRequest) Method() server.Method     { return server.POST }
func (r publishingStreamingRequest) Path() string              { return "/message-ingress/id" }
func (r publishingStreamingRequest) Body() []byte {
	panic("streaming publication must not buffer Request.Body")
}
func (r publishingStreamingRequest) BodyStream() io.Reader {
	return bytes.NewReader(r.body)
}

func TestReadBoundedPublishingBodyUsesStreamingReader(t *testing.T) {
	body, err := readBoundedPublishingBody(publishingStreamingRequest{
		body: []byte(`{"content":{"text":{"text":"hello"}}}`),
	})
	if err != nil {
		t.Fatalf("read publication: %v", err)
	}
	if len(body) == 0 {
		t.Fatal("publication body is empty")
	}
}

func TestReadBoundedPublishingBodyRejectsOversize(t *testing.T) {
	_, err := readBoundedPublishingBody(publishingStreamingRequest{
		body: bytes.Repeat([]byte("x"), 64*1024+1),
	})
	if err == nil {
		t.Fatal("oversized publication body must be rejected")
	}
}
