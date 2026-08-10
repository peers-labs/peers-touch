package messaging

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"testing"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/application"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

func TestRemoteAttachmentUploadTraversesHomeAuthorityProxy(t *testing.T) {
	if os.Getenv("MESSAGING_ATTACHMENT_LIVE_E2E") != "true" {
		t.Skip("MESSAGING_ATTACHMENT_LIVE_E2E is not enabled")
	}
	homeURL := requiredAttachmentE2EEnv(t, "MESSAGING_ATTACHMENT_HOME_URL")
	authorityStationID := requiredAttachmentE2EEnv(
		t,
		"MESSAGING_ATTACHMENT_AUTHORITY_STATION_ID",
	)
	conversationID := requiredAttachmentE2EEnv(t, "MESSAGING_ATTACHMENT_CONVERSATION_ID")
	ptid := requiredAttachmentE2EEnv(t, "MESSAGING_ATTACHMENT_PTID")
	deviceID := requiredAttachmentE2EEnv(t, "MESSAGING_ATTACHMENT_DEVICE_ID")
	tokenFile := requiredAttachmentE2EEnv(t, "MESSAGING_ATTACHMENT_TOKEN_FILE")
	tokenBytes, err := os.ReadFile(tokenFile)
	if err != nil {
		t.Fatal(err)
	}
	var session struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(tokenBytes, &session); err != nil {
		t.Fatal(err)
	}
	if session.Token == "" {
		t.Fatal("native Desktop session token is unavailable")
	}

	ciphertext := bytes.Repeat([]byte("proxy-attachment-e2e:"), 4)
	ciphertextHash := sha256.Sum256(ciphertext)
	begin := &chat.BeginAttachmentUploadRequest{
		ConversationId: conversationID,
		MessageId:      uuid.NewString(),
		AttachmentId:   uuid.NewString(),
		Uploader:       &chat.CryptoEndpoint{Ptid: ptid, DeviceId: deviceID},
		Object: &chat.EncryptedObjectUploadSpec{
			CiphertextSize:        uint64(len(ciphertext)),
			CiphertextSha256:      ciphertextHash[:],
			MediaType:             "application/octet-stream",
			ChunkSize:             1024 * 1024,
			ChunkCount:            1,
			EncryptionSuite:       chat.AttachmentEncryptionSuite_ATTACHMENT_ENCRYPTION_SUITE_AES_256_GCM_CHUNKED,
			TagSize:               16,
			NonceStrategy:         chat.AttachmentNonceStrategy_ATTACHMENT_NONCE_STRATEGY_COUNTER32_BE,
			ChunkCiphertextSha256: [][]byte{ciphertextHash[:]},
		},
		IdempotencyKey:     uuid.NewString(),
		AuthorityStationId: authorityStationID,
	}
	begin.DescriptorCommitmentSha256, err = application.AttachmentUploadCommitment(begin)
	if err != nil {
		t.Fatal(err)
	}
	beginBody, err := proto.MarshalOptions{Deterministic: true}.Marshal(begin)
	if err != nil {
		t.Fatal(err)
	}
	beginResponse := &chat.BeginAttachmentUploadResponse{}
	attachmentE2EProtoRequest(
		t,
		session.Token,
		deviceID,
		http.MethodPost,
		homeURL+"/messaging/attachments/uploads:begin",
		nil,
		beginBody,
		beginResponse,
	)
	if beginResponse.AuthorityStationId != authorityStationID || beginResponse.UploadId == "" {
		t.Fatalf("begin response is not authority-bound: %+v", beginResponse)
	}

	part := &chat.PutAttachmentChunkRequest{
		UploadId:           beginResponse.UploadId,
		Generation:         beginResponse.Generation,
		ChunkIndex:         0,
		ByteOffset:         0,
		CiphertextSize:     uint64(len(ciphertext)),
		CiphertextSha256:   ciphertextHash[:],
		IdempotencyKey:     uuid.NewString(),
		AuthorityStationId: authorityStationID,
		ConversationId:     conversationID,
	}
	partBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(part)
	if err != nil {
		t.Fatal(err)
	}
	partResponse := &chat.PutAttachmentChunkResponse{}
	attachmentE2EProtoRequest(
		t,
		session.Token,
		deviceID,
		http.MethodPut,
		fmt.Sprintf(
			"%s/messaging/attachments/uploads/%s/chunks/0",
			homeURL,
			url.PathEscape(beginResponse.UploadId),
		),
		http.Header{
			"Content-Type": []string{"application/octet-stream"},
			"X-Peers-Attachment-Metadata-Bin": []string{
				base64.StdEncoding.EncodeToString(partBytes),
			},
		},
		ciphertext,
		partResponse,
	)
	if partResponse.ChunkIndex != 0 || len(partResponse.ReceivedChunkBitmap) != 1 {
		t.Fatalf("part response is incomplete: %+v", partResponse)
	}

	complete := &chat.CompleteAttachmentUploadRequest{
		UploadId:                   beginResponse.UploadId,
		Generation:                 beginResponse.Generation,
		DescriptorCommitmentSha256: begin.DescriptorCommitmentSha256,
		AuthorityStationId:         authorityStationID,
		ConversationId:             conversationID,
	}
	completeBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(complete)
	if err != nil {
		t.Fatal(err)
	}
	completeResponse := &chat.CompleteAttachmentUploadResponse{}
	attachmentE2EProtoRequest(
		t,
		session.Token,
		deviceID,
		http.MethodPost,
		fmt.Sprintf(
			"%s/messaging/attachments/uploads/%s/complete",
			homeURL,
			url.PathEscape(beginResponse.UploadId),
		),
		nil,
		completeBytes,
		completeResponse,
	)
	if completeResponse.Object == nil ||
		!bytes.Equal(completeResponse.Object.CiphertextSha256, ciphertextHash[:]) {
		t.Fatalf("complete response commitment mismatch: %+v", completeResponse)
	}

	statusResponse := &chat.GetAttachmentUploadResponse{}
	attachmentE2EProtoRequest(
		t,
		session.Token,
		deviceID,
		http.MethodGet,
		fmt.Sprintf(
			"%s/messaging/attachments/uploads/%s",
			homeURL,
			url.PathEscape(beginResponse.UploadId),
		),
		http.Header{
			"X-Peers-Attachment-Generation": []string{strconv.FormatUint(beginResponse.Generation, 10)},
			"X-Peers-Authority-Station-ID":  []string{authorityStationID},
			"X-Peers-Conversation-ID":       []string{conversationID},
		},
		nil,
		statusResponse,
	)
	if statusResponse.State != chat.AttachmentTransferState_ATTACHMENT_TRANSFER_STATE_COMPLETE ||
		statusResponse.Object == nil ||
		statusResponse.Object.ObjectId != completeResponse.Object.ObjectId {
		t.Fatalf("status did not replay completed object: %+v", statusResponse)
	}

	downloadURL := fmt.Sprintf(
		"%s/messaging/attachments/objects/%s?conversation_id=%s",
		homeURL,
		url.PathEscape(completeResponse.Object.ObjectId),
		url.QueryEscape(conversationID),
	)
	request, err := http.NewRequestWithContext(context.Background(), http.MethodGet, downloadURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+session.Token)
	request.Header.Set("X-Device-ID", deviceID)
	request.Header.Set("X-Peers-Authority-Station-ID", authorityStationID)
	request.Header.Set(
		"If-Match",
		`"`+hex.EncodeToString(completeResponse.Object.CiphertextSha256)+`"`,
	)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, response.Body)
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("uncommitted attachment download status = %d, want 403", response.StatusCode)
	}
	t.Logf(
		"proxy upload complete: upload=%s object=%s ciphertext_sha256=%x",
		beginResponse.UploadId,
		completeResponse.Object.ObjectId,
		ciphertextHash,
	)
}

func attachmentE2EProtoRequest(
	t *testing.T,
	token string,
	deviceID string,
	method string,
	endpoint string,
	headers http.Header,
	body []byte,
	output proto.Message,
) {
	t.Helper()
	request, err := http.NewRequestWithContext(
		context.Background(),
		method,
		endpoint,
		bytes.NewReader(body),
	)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("X-Device-ID", deviceID)
	request.Header.Set("Accept", "application/x-protobuf")
	if request.Header.Get("Content-Type") == "" {
		request.Header.Set("Content-Type", "application/x-protobuf")
	}
	for name, values := range headers {
		for _, value := range values {
			request.Header.Add(name, value)
		}
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		t.Fatalf(
			"%s %s status=%d body=%q",
			method,
			endpoint,
			response.StatusCode,
			responseBody,
		)
	}
	if err := proto.Unmarshal(responseBody, output); err != nil {
		t.Fatalf("decode %s %s: %v", method, endpoint, err)
	}
}

func requiredAttachmentE2EEnv(t *testing.T, name string) string {
	t.Helper()
	value := os.Getenv(name)
	if value == "" {
		t.Fatalf("%s is required", name)
	}
	return value
}
