package federation

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/scope"
)

type peerClientTestRelay struct {
	baseURL        string
	client         *http.Client
	expectedTarget string
}

func (r peerClientTestRelay) Available() bool {
	return r.baseURL != ""
}

func (r peerClientTestRelay) RoundTrip(
	ctx context.Context,
	targetStationPeerID string,
	request *http.Request,
) (*http.Response, error) {
	if targetStationPeerID != r.expectedTarget {
		return nil, errors.New("unexpected Relay tunnel target")
	}
	base, err := url.Parse(r.baseURL)
	if err != nil {
		return nil, err
	}
	outbound := request.Clone(ctx)
	target := *request.URL
	target.Scheme = base.Scheme
	target.Host = base.Host
	outbound.URL = &target
	outbound.RequestURI = ""
	return r.client.Do(outbound)
}

func TestPeerClientStreamsAuthenticatedDynamicRouteThroughOpaqueTunnel(t *testing.T) {
	scope.ResetForTest()
	if err := RegisterPeerScopes(); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(
		response http.ResponseWriter,
		request *http.Request,
	) {
		if request.Method != http.MethodPut {
			t.Errorf("method = %s, want PUT", request.Method)
		}
		if request.URL.Path !=
			"/federation/conversation/attachments/uploads/upload-1/chunks/7" {
			t.Errorf("path = %q", request.URL.Path)
		}
		if request.Header.Get("Authorization") == "" {
			t.Error("inner Federation authorization is missing")
		}
		if request.Header.Get("X-Test-Metadata") != "metadata" {
			t.Errorf(
				"metadata = %q",
				request.Header.Get("X-Test-Metadata"),
			)
		}
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Error(err)
		}
		if !bytes.Equal(body, []byte("ciphertext")) {
			t.Errorf("body = %q", body)
		}
		response.Header().Set("Content-Type", "application/octet-stream")
		response.Header().Set("Content-Range", "bytes 0-9/10")
		response.WriteHeader(http.StatusPartialContent)
		if _, err := response.Write([]byte("0123456789")); err != nil {
			t.Error(err)
		}
	}))
	defer server.Close()

	client, err := newPeerClient(
		server.Client(),
		authfed.NewKeyCache(
			authfed.NewInMemoryKeyStore(),
			authfed.WithRecheckTTL(0),
		),
		"station-source",
		nil,
		peerClientTestRelay{
			baseURL:        server.URL,
			client:         server.Client(),
			expectedTarget: "station-target",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.Open(context.Background(), PeerStreamCall{
		TargetStationPeerID: "station-target",
		Route:               PeerRouteConversationAttachmentChunk,
		Subject:             "ptid:alice",
		Claims: map[string]string{
			ClaimConversationID:       "conversation-1",
			ClaimActorPTID:            "ptid:alice",
			ClaimDeviceID:             "alice-device",
			ClaimAttachmentAction:     "chunk",
			ClaimAttachmentResourceID: "upload-1/chunks/7",
			ClaimSourceStationPeerID:  "station-source",
			ClaimTargetStationPeerID:  "station-target",
		},
		PathParameters: map[string]string{
			"upload_id":   "upload-1",
			"chunk_index": "7",
		},
		Headers: map[string]string{
			"Content-Type":    "application/octet-stream",
			"X-Test-Metadata": "metadata",
		},
		Body: bytes.NewReader([]byte("ciphertext")),
	})
	if err != nil {
		t.Fatal(err)
	}
	defer result.Body.Close()
	body, err := io.ReadAll(result.Body)
	if err != nil {
		t.Fatal(err)
	}
	if result.StatusCode != http.StatusPartialContent ||
		result.Headers.Get("Content-Range") != "bytes 0-9/10" ||
		!bytes.Equal(body, []byte("0123456789")) {
		t.Fatalf(
			"stream response status=%d headers=%v body=%q",
			result.StatusCode,
			result.Headers,
			body,
		)
	}
}

func TestBindPeerRoutePathRejectsMissingAndUnexpectedParameters(t *testing.T) {
	if _, err := bindPeerRoutePath(
		ConversationAttachmentChunkRoute,
		map[string]string{"upload_id": "upload-1"},
	); err == nil {
		t.Fatal("missing chunk index was accepted")
	}
	if _, err := bindPeerRoutePath(
		ConversationAttachmentUploadBeginRoute,
		map[string]string{"upload_id": "upload-1"},
	); err == nil {
		t.Fatal("unexpected path parameter was accepted")
	}
}
