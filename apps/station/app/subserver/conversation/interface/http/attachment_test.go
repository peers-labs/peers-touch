package http_test

import (
	"bytes"
	"context"
	"io"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/attachment"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	conversationhttp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/interface/http"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

type attachmentApplicationStub struct {
	beginRequest       attachment.BeginRequest
	downloadEndpoint   valueobject.Endpoint
	downloadRequest    attachment.DownloadRequest
	downloadSourceHome valueobject.StationID
}

func (s *attachmentApplicationStub) Begin(
	_ context.Context,
	_ valueobject.Endpoint,
	request attachment.BeginRequest,
) (attachment.BeginResult, error) {
	s.beginRequest = request

	return attachment.BeginResult{Upload: attachment.Upload{
		UploadID:             "upload-1",
		Generation:           1,
		ConversationID:       request.ConversationID,
		MessageID:            request.MessageID,
		AttachmentID:         request.AttachmentID,
		Uploader:             request.Uploader,
		Spec:                 request.Spec,
		DescriptorCommitment: request.DescriptorCommitment,
		State:                attachment.TransferStateQueued,
		ReceivedChunkBitmap:  []byte{0},
		ExpiresAt:            time.Date(2026, time.September, 6, 18, 0, 0, 0, time.UTC),
	}}, nil
}

func (s *attachmentApplicationStub) Status(
	context.Context,
	valueobject.Endpoint,
	attachment.StatusRequest,
) (attachment.Upload, error) {
	return attachment.Upload{}, nil
}

func (s *attachmentApplicationStub) PutChunk(
	context.Context,
	valueobject.Endpoint,
	attachment.PutChunkRequest,
	[]byte,
) (attachment.PutChunkResult, error) {
	return attachment.PutChunkResult{}, nil
}

func (s *attachmentApplicationStub) Complete(
	context.Context,
	valueobject.Endpoint,
	attachment.CompleteRequest,
) (attachment.CompleteResult, error) {
	return attachment.CompleteResult{}, nil
}

func (s *attachmentApplicationStub) Cancel(
	context.Context,
	valueobject.Endpoint,
	attachment.CancelRequest,
) (attachment.TransferState, error) {
	return attachment.TransferStateCancelled, nil
}

func (s *attachmentApplicationStub) Download(
	_ context.Context,
	authenticated valueobject.Endpoint,
	request attachment.DownloadRequest,
) (attachment.DownloadResult, error) {
	s.downloadEndpoint = authenticated
	s.downloadRequest = request
	return attachment.DownloadResult{
		Object: attachment.Object{
			ObjectID:   "object-1",
			StorageRef: "storage-1",
			Spec: attachment.UploadSpec{
				CiphertextSize: 4,
				CiphertextHash: valueobject.HashBytes([]byte("body")),
				MediaType:      "application/octet-stream",
				ChunkSize:      attachment.ChunkSize,
				ChunkCount:     1,
				Encryption:     attachment.EncryptionSuiteAES256GCMChunked,
				TagSize:        attachment.TagSize,
				NonceStrategy:  attachment.NonceStrategyCounter32BE,
				ChunkHashes:    []valueobject.Hash{valueobject.HashBytes([]byte("body"))},
			},
		},
		Body:      io.NopCloser(bytes.NewReader([]byte("body"))),
		TotalSize: 4,
		Start:     0,
		End:       3,
	}, nil
}

func (s *attachmentApplicationStub) DownloadFromVerifiedHome(
	ctx context.Context,
	authenticated valueobject.Endpoint,
	sourceHome valueobject.StationID,
	request attachment.DownloadRequest,
) (attachment.DownloadResult, error) {
	s.downloadSourceHome = sourceHome
	return s.Download(ctx, authenticated, request)
}

func TestAttachmentHandlerMapsCanonicalBeginContract(t *testing.T) {
	stub := &attachmentApplicationStub{}
	handler, err := conversationhttp.NewAttachmentHandler(stub)
	if err != nil {
		t.Fatal(err)
	}
	ciphertextHash := valueobject.HashBytes([]byte("ciphertext"))
	wireSpec := &chat.EncryptedObjectUploadSpec{
		CiphertextSize:   uint64(attachment.TagSize + 1),
		CiphertextSha256: ciphertextHash.Bytes(),
		MediaType:        "application/octet-stream",
		ChunkSize:        attachment.ChunkSize,
		ChunkCount:       1,
		EncryptionSuite:  chat.AttachmentEncryptionSuite_ATTACHMENT_ENCRYPTION_SUITE_AES_256_GCM_CHUNKED,
		TagSize:          attachment.TagSize,
		NonceStrategy:    chat.AttachmentNonceStrategy_ATTACHMENT_NONCE_STRATEGY_COUNTER32_BE,
		ChunkCiphertextSha256: [][]byte{
			ciphertextHash.Bytes(),
		},
	}
	specBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(wireSpec)
	if err != nil {
		t.Fatal(err)
	}
	commitment := attachment.UploadCommitment(
		"conversation-1",
		"message-1",
		"attachment-1",
		"station:local",
		specBytes,
	)
	response, err := handler.Begin(
		context.Background(),
		conversationhttp.AuthenticatedActor{
			PTID:     "ptid:alice",
			DeviceID: "alice-1",
		},
		&chat.BeginAttachmentUploadRequest{
			ConversationId: "conversation-1",
			MessageId:      "message-1",
			AttachmentId:   "attachment-1",
			Uploader: &chat.CryptoEndpoint{
				Ptid:     "ptid:alice",
				DeviceId: "alice-1",
			},
			Object:                     wireSpec,
			DescriptorCommitmentSha256: commitment.Bytes(),
			IdempotencyKey:             "begin-1",
			AuthorityStationId:         "station:local",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if response.GetUploadId() != "upload-1" ||
		stub.beginRequest.DescriptorCommitment != commitment ||
		!bytes.Equal(stub.beginRequest.CanonicalSpecBytes, specBytes) {
		t.Fatalf("response=%+v mapped=%+v", response, stub.beginRequest)
	}

	_, err = handler.Begin(
		context.Background(),
		conversationhttp.AuthenticatedActor{
			PTID:     "ptid:mallory",
			DeviceID: "mallory-1",
		},
		&chat.BeginAttachmentUploadRequest{
			Uploader: &chat.CryptoEndpoint{
				Ptid:     "ptid:alice",
				DeviceId: "alice-1",
			},
			Object: wireSpec,
		},
	)
	if !attachment.IsCode(err, attachment.ErrorCodeUnauthorized) {
		t.Fatalf("endpoint binding error = %v", err)
	}
}

func TestAttachmentHandlerMapsDownloadAndTypedErrors(t *testing.T) {
	stub := &attachmentApplicationStub{}
	handler, err := conversationhttp.NewAttachmentHandler(stub)
	if err != nil {
		t.Fatal(err)
	}
	expectedETag := valueobject.HashBytes([]byte("body"))
	download, err := handler.Download(
		context.Background(),
		conversationhttp.AuthenticatedActor{
			PTID:     "ptid:bob",
			DeviceID: "bob-1",
		},
		&chat.GetAttachmentObjectRequest{
			ConversationId:     "conversation-1",
			ObjectId:           "object-1",
			ExpectedEtagSha256: expectedETag.Bytes(),
			AuthorityStationId: "station:local",
		},
		0,
		3,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer download.Body.Close()
	if download.Metadata.GetObject().GetObjectId() != "object-1" ||
		!bytes.Equal(download.Metadata.GetEtagSha256(), expectedETag.Bytes()) ||
		download.Start != 0 ||
		download.End != 3 {
		t.Fatalf("download = %+v", download)
	}
	remoteDownload, err := handler.DownloadFromVerifiedHome(
		context.Background(),
		conversationhttp.AuthenticatedActor{
			PTID:     "ptid:bob",
			DeviceID: "bob-1",
		},
		"station:remote",
		&chat.GetAttachmentObjectRequest{
			ConversationId:     "conversation-1",
			ObjectId:           "object-1",
			ExpectedEtagSha256: expectedETag.Bytes(),
			AuthorityStationId: "station:local",
		},
		0,
		3,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer remoteDownload.Body.Close()
	if stub.downloadSourceHome != "station:remote" ||
		stub.downloadEndpoint !=
			(valueobject.Endpoint{Actor: "ptid:bob", Device: "bob-1"}) ||
		stub.downloadRequest.ConversationID != "conversation-1" {
		t.Fatalf(
			"verified remote download source=%q endpoint=%+v request=%+v",
			stub.downloadSourceHome,
			stub.downloadEndpoint,
			stub.downloadRequest,
		)
	}

	wireError := conversationhttp.AttachmentTransferError(
		attachment.NewRetryError("test", 2*time.Second, "retry"),
	)
	if wireError.GetCode() !=
		chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_RETRY_LATER ||
		wireError.GetRetryAfter().AsDuration() != 2*time.Second {
		t.Fatalf("typed error = %+v", wireError)
	}
}
