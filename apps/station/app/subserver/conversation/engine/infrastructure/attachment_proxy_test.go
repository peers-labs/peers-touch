package infrastructure_test

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/infrastructure"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

type attachmentTokenMinter struct {
	target       string
	conversation string
	endpoint     *chat.CryptoEndpoint
	action       string
	resource     string
}

func (m *attachmentTokenMinter) MintAttachmentTransfer(
	_ context.Context,
	targetStationID string,
	conversationID string,
	endpoint *chat.CryptoEndpoint,
	action string,
	resourceID string,
) (string, error) {
	m.target = targetStationID
	m.conversation = conversationID
	m.endpoint = endpoint
	m.action = action
	m.resource = resourceID
	return "signed-peer-token", nil
}

func TestHTTPAttachmentProxyBindsPeerTokenAndStreamsHeaders(t *testing.T) {
	var receivedBody []byte
	server := httptest.NewServer(http.HandlerFunc(func(
		writer http.ResponseWriter,
		request *http.Request,
	) {
		if request.URL.Path != "/federation/conversation/attachments/uploads/upload-1/chunks/0" {
			t.Fatalf("path = %q", request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer signed-peer-token" {
			t.Fatalf("authorization = %q", request.Header.Get("Authorization"))
		}
		if request.Header.Get("X-Peers-Attachment-Metadata-Bin") != "metadata" {
			t.Fatalf("metadata header = %q", request.Header.Get("X-Peers-Attachment-Metadata-Bin"))
		}
		if request.Header.Get("X-Untrusted-Forward-Me") != "" {
			t.Fatal("proxy forwarded a non-allowlisted header")
		}
		var err error
		receivedBody, err = io.ReadAll(request.Body)
		if err != nil {
			t.Fatal(err)
		}
		writer.Header().Set("Content-Range", "bytes 0-3/4")
		writer.WriteHeader(http.StatusPartialContent)
		_, _ = writer.Write([]byte("done"))
	}))
	defer server.Close()

	minter := &attachmentTokenMinter{}
	proxy, err := infrastructure.NewHTTPAttachmentProxy(
		server.Client(),
		minter,
		compositionStationURLResolverForAttachment{url: server.URL},
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	response, err := proxy.Forward(context.Background(), infrastructure.AttachmentProxyRequest{
		TargetStationID: "station:authority",
		ConversationID:  "conversation-1",
		Endpoint:        &chat.CryptoEndpoint{Ptid: "alice", DeviceId: "alice-device"},
		Action:          "part",
		ResourceID:      "upload-1/0",
		Method:          http.MethodPut,
		Route:           "/federation/conversation/attachments/uploads/upload-1/chunks/0",
		Header: http.Header{
			"X-Peers-Attachment-Metadata-Bin": []string{"metadata"},
			"X-Untrusted-Forward-Me":          []string{"secret"},
		},
		Body: bytes.NewBufferString("part"),
	})
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusPartialContent ||
		string(responseBody) != "done" ||
		string(receivedBody) != "part" {
		t.Fatalf(
			"response=%d %q received=%q",
			response.StatusCode,
			responseBody,
			receivedBody,
		)
	}
	if minter.target != "station:authority" ||
		minter.conversation != "conversation-1" ||
		minter.endpoint.Ptid != "alice" ||
		minter.endpoint.DeviceId != "alice-device" ||
		minter.action != "part" ||
		minter.resource != "upload-1/0" {
		t.Fatalf("mint binding = %+v", minter)
	}
}

type compositionStationURLResolverForAttachment struct {
	url string
}

func (resolver compositionStationURLResolverForAttachment) ResolveActiveStationURL(
	context.Context,
	string,
) (string, error) {
	return resolver.url, nil
}
