package conversation

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"testing"
)

func TestProductionWriteAttachmentBodyStreamsBoundedRange(t *testing.T) {
	body := &productionTrackingReadCloser{
		Reader: bytes.NewBufferString("0123456789"),
	}
	response := newProductionStreamingTestResponse()

	if err := productionWriteAttachmentBody(response, body, 4); err != nil {
		t.Fatalf("productionWriteAttachmentBody: %v", err)
	}
	if response.writeCalls != 0 {
		t.Fatalf("buffered write calls = %d, want 0", response.writeCalls)
	}
	if response.streamSize != 4 {
		t.Fatalf("stream size = %d, want 4", response.streamSize)
	}
	got, err := io.ReadAll(response.stream)
	if err != nil {
		t.Fatalf("read stream: %v", err)
	}
	if string(got) != "0123" {
		t.Fatalf("stream body = %q, want %q", got, "0123")
	}
	if body.closed {
		t.Fatal("stream body closed before transport ownership completed")
	}
	if err := response.stream.Close(); err != nil {
		t.Fatalf("close stream: %v", err)
	}
	if !body.closed {
		t.Fatal("stream body was not closed by transport owner")
	}
}

func TestProductionWriteAttachmentBodyFallbackIsBoundedAndExact(t *testing.T) {
	t.Run("bounds oversized reader", func(t *testing.T) {
		body := &productionTrackingReadCloser{
			Reader: bytes.NewBufferString("0123456789"),
		}
		response := newProductionResponseTestDouble()

		if err := productionWriteAttachmentBody(response, body, 4); err != nil {
			t.Fatalf("productionWriteAttachmentBody: %v", err)
		}
		if response.body.String() != "0123" {
			t.Fatalf("response body = %q, want %q", response.body.String(), "0123")
		}
		if !body.closed {
			t.Fatal("fallback body was not closed")
		}
	})

	t.Run("rejects short reader", func(t *testing.T) {
		body := &productionTrackingReadCloser{
			Reader: bytes.NewBufferString("012"),
		}
		response := newProductionResponseTestDouble()

		err := productionWriteAttachmentBody(response, body, 4)
		if !errors.Is(err, io.ErrUnexpectedEOF) {
			t.Fatalf("err = %v, want io.ErrUnexpectedEOF", err)
		}
		if !body.closed {
			t.Fatal("short fallback body was not closed")
		}
	})
}

func TestProductionAttachmentResponseBounds(t *testing.T) {
	cases := []struct {
		name             string
		rangeHeader      string
		totalSize        uint64
		wantStart        int64
		wantEnd          int64
		wantLength       int64
		wantStatus       int
		wantContentRange string
		wantError        bool
	}{
		{
			name:       "full",
			totalSize:  10,
			wantStart:  0,
			wantEnd:    9,
			wantLength: 10,
			wantStatus: http.StatusOK,
		},
		{
			name:             "closed range",
			rangeHeader:      "bytes=2-5",
			totalSize:        10,
			wantStart:        2,
			wantEnd:          5,
			wantLength:       4,
			wantStatus:       http.StatusPartialContent,
			wantContentRange: "bytes 2-5/10",
		},
		{
			name:             "open range",
			rangeHeader:      "bytes=7-",
			totalSize:        10,
			wantStart:        7,
			wantEnd:          9,
			wantLength:       3,
			wantStatus:       http.StatusPartialContent,
			wantContentRange: "bytes 7-9/10",
		},
		{
			name:        "past eof",
			rangeHeader: "bytes=10-11",
			totalSize:   10,
			wantError:   true,
		},
		{
			name:      "empty object",
			totalSize: 0,
			wantError: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			start, end, length, status, contentRange, err :=
				productionAttachmentResponseBounds(tc.rangeHeader, tc.totalSize)
			if tc.wantError {
				if err == nil {
					t.Fatal("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("productionAttachmentResponseBounds: %v", err)
			}
			if start != tc.wantStart ||
				end != tc.wantEnd ||
				length != tc.wantLength ||
				status != tc.wantStatus ||
				contentRange != tc.wantContentRange {
				t.Fatalf(
					"bounds = (%d,%d,%d,%d,%q), want (%d,%d,%d,%d,%q)",
					start,
					end,
					length,
					status,
					contentRange,
					tc.wantStart,
					tc.wantEnd,
					tc.wantLength,
					tc.wantStatus,
					tc.wantContentRange,
				)
			}
		})
	}
}

type productionTrackingReadCloser struct {
	io.Reader
	closed bool
}

func (r *productionTrackingReadCloser) Close() error {
	r.closed = true
	return nil
}

type productionResponseTestDouble struct {
	headers    map[string]string
	body       bytes.Buffer
	status     int
	writeCalls int
}

func newProductionResponseTestDouble() *productionResponseTestDouble {
	return &productionResponseTestDouble{headers: make(map[string]string)}
}

func (r *productionResponseTestDouble) Header() map[string]string {
	return r.headers
}

func (r *productionResponseTestDouble) SetHeader(key string, value string) {
	r.headers[key] = value
}

func (r *productionResponseTestDouble) Write(value []byte) (int, error) {
	r.writeCalls++
	return r.body.Write(value)
}

func (*productionResponseTestDouble) Flush() error {
	return nil
}

func (r *productionResponseTestDouble) WriteHeader(status int) {
	r.status = status
}

func (r *productionResponseTestDouble) Status() int {
	return r.status
}

type productionStreamingTestResponse struct {
	*productionResponseTestDouble
	stream     io.ReadCloser
	streamSize int64
}

func newProductionStreamingTestResponse() *productionStreamingTestResponse {
	return &productionStreamingTestResponse{
		productionResponseTestDouble: newProductionResponseTestDouble(),
	}
}

func (r *productionStreamingTestResponse) SetBodyStream(
	reader io.ReadCloser,
	size int64,
) error {
	r.stream = reader
	r.streamSize = size
	return nil
}
