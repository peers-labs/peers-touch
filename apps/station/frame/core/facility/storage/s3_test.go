package storage

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

func TestS3OpenRangePreservesHeaderAndBoundsReader(t *testing.T) {
	const (
		bucket = "test-bucket"
		key    = "attachments/blob.bin"
	)
	body := []byte("0123456789")
	requests := make(chan *http.Request, 4)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests <- r.Clone(context.Background())
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("ETag", `"fixture-etag"`)
		w.Header().Set("Last-Modified", time.Unix(1, 0).UTC().Format(http.TimeFormat))

		switch r.Method {
		case http.MethodHead:
			w.Header().Set("Content-Length", strconv.Itoa(len(body)))
			w.WriteHeader(http.StatusOK)
		case http.MethodGet:
			if r.Header.Get("Range") == "bytes=2-5" {
				// Deliberately exceed the requested range. The backend must
				// enforce its own inclusive bound even when the store does not.
				payload := body[2:]
				w.Header().Set("Content-Range", "bytes 2-5/10")
				w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
				w.WriteHeader(http.StatusPartialContent)
				_, _ = w.Write(payload)
				return
			}
			w.Header().Set("Content-Length", strconv.Itoa(len(body)))
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(body)
		default:
			http.Error(w, "unexpected method", http.StatusMethodNotAllowed)
		}
	}))
	defer server.Close()

	backend, err := NewS3Backend(S3Config{
		Endpoint:        server.URL,
		Region:          "us-east-1",
		Bucket:          bucket,
		AccessKeyID:     "test-access-key",
		SecretAccessKey: "test-secret-key",
		ForcePathStyle:  true,
	})
	if err != nil {
		t.Fatalf("NewS3Backend: %v", err)
	}

	reader, total, mime, err := backend.Open(
		context.Background(),
		key,
		&Range{Start: 2, End: 5},
	)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer reader.Close()

	got, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("ReadAll: %v", err)
	}
	if string(got) != "2345" {
		t.Fatalf("body = %q, want %q", got, "2345")
	}
	if total != int64(len(body)) {
		t.Fatalf("total = %d, want %d", total, len(body))
	}
	if mime != "application/octet-stream" {
		t.Fatalf("mime = %q, want application/octet-stream", mime)
	}

	head := <-requests
	get := <-requests
	if head.Method != http.MethodHead || head.Header.Get("Range") != "" {
		t.Fatalf("metadata request = %s Range %q, want HEAD without Range", head.Method, head.Header.Get("Range"))
	}
	if get.Method != http.MethodGet || get.Header.Get("Range") != "bytes=2-5" {
		t.Fatalf("body request = %s Range %q, want GET Range bytes=2-5", get.Method, get.Header.Get("Range"))
	}
	if get.Header.Get("If-Match") != `"fixture-etag"` {
		t.Fatalf("body request If-Match = %q, want fixture ETag", get.Header.Get("If-Match"))
	}
}

func TestS3OpenRejectsRangePastEOFBeforeGet(t *testing.T) {
	body := []byte("0123456789")
	getRequests := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("ETag", `"fixture-etag"`)
		w.Header().Set("Last-Modified", time.Unix(1, 0).UTC().Format(http.TimeFormat))
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", strconv.Itoa(len(body)))
			w.WriteHeader(http.StatusOK)
			return
		}
		getRequests <- struct{}{}
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	backend, err := NewS3Backend(S3Config{
		Endpoint:        server.URL,
		Region:          "us-east-1",
		Bucket:          "test-bucket",
		AccessKeyID:     "test-access-key",
		SecretAccessKey: "test-secret-key",
		ForcePathStyle:  true,
	})
	if err != nil {
		t.Fatalf("NewS3Backend: %v", err)
	}

	_, _, _, err = backend.Open(
		context.Background(),
		"attachments/blob.bin",
		&Range{Start: int64(len(body)), End: int64(len(body) + 1)},
	)
	if !errors.Is(err, ErrRangeNotSatisfiable) {
		t.Fatalf("err = %v, want ErrRangeNotSatisfiable", err)
	}
	select {
	case <-getRequests:
		t.Fatal("range rejected after issuing GET")
	default:
	}
}
