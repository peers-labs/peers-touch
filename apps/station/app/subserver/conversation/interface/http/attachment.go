package http

import (
	"context"
	"io"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/attachment"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type AttachmentApplication interface {
	Begin(
		ctx context.Context,
		authenticated valueobject.Endpoint,
		request attachment.BeginRequest,
	) (attachment.BeginResult, error)
	Status(
		ctx context.Context,
		authenticated valueobject.Endpoint,
		request attachment.StatusRequest,
	) (attachment.Upload, error)
	PutChunk(
		ctx context.Context,
		authenticated valueobject.Endpoint,
		request attachment.PutChunkRequest,
		body []byte,
	) (attachment.PutChunkResult, error)
	Complete(
		ctx context.Context,
		authenticated valueobject.Endpoint,
		request attachment.CompleteRequest,
	) (attachment.CompleteResult, error)
	Cancel(
		ctx context.Context,
		authenticated valueobject.Endpoint,
		request attachment.CancelRequest,
	) (attachment.TransferState, error)
	Download(
		ctx context.Context,
		authenticated valueobject.Endpoint,
		request attachment.DownloadRequest,
	) (attachment.DownloadResult, error)
	DownloadFromVerifiedHome(
		ctx context.Context,
		authenticated valueobject.Endpoint,
		sourceHome valueobject.StationID,
		request attachment.DownloadRequest,
	) (attachment.DownloadResult, error)
}

// AttachmentHandler is a test-only canonical transport adapter. CA-W5 owns route registration.
type AttachmentHandler struct {
	service AttachmentApplication
}

type AttachmentDownload struct {
	Metadata *chat.GetAttachmentObjectResponse
	Body     io.ReadCloser
	Start    int64
	End      int64
}

func NewAttachmentHandler(service AttachmentApplication) (*AttachmentHandler, error) {
	if service == nil {
		return nil, attachment.NewError(
			attachment.ErrorCodeInvalidArgument,
			"attachment_handler.new",
			"service",
			"is required",
		)
	}

	return &AttachmentHandler{service: service}, nil
}

func (h *AttachmentHandler) Begin(
	ctx context.Context,
	authenticated AuthenticatedActor,
	request *chat.BeginAttachmentUploadRequest,
) (*chat.BeginAttachmentUploadResponse, error) {
	if request == nil || request.GetUploader() == nil || request.GetObject() == nil {
		return nil, invalidAttachmentRequest("attachment_handler.begin")
	}
	endpoint, err := bindAttachmentEndpoint(
		authenticated,
		request.GetUploader(),
		"attachment_handler.begin",
	)
	if err != nil {
		return nil, err
	}
	conversationID, err := valueobject.NewConversationID(request.GetConversationId())
	if err != nil {
		return nil, err
	}
	messageID, err := valueobject.NewMessageID(request.GetMessageId())
	if err != nil {
		return nil, err
	}
	authorityStation, err := valueobject.NewStationID(request.GetAuthorityStationId())
	if err != nil {
		return nil, err
	}
	commitment, err := valueobject.NewHash(request.GetDescriptorCommitmentSha256())
	if err != nil {
		return nil, invalidAttachmentRequest("attachment_handler.begin")
	}
	spec, err := uploadSpecFromProto(request.GetObject())
	if err != nil {
		return nil, err
	}
	specBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(request.GetObject())
	if err != nil {
		return nil, attachment.WrapError(
			attachment.ErrorCodeInvalidArgument,
			"attachment_handler.begin.encode_spec",
			err,
		)
	}
	result, err := h.service.Begin(ctx, endpoint, attachment.BeginRequest{
		ConversationID:       conversationID,
		MessageID:            messageID,
		AttachmentID:         request.GetAttachmentId(),
		Uploader:             endpoint,
		Spec:                 spec,
		CanonicalSpecBytes:   specBytes,
		DescriptorCommitment: commitment,
		IdempotencyKey:       request.GetIdempotencyKey(),
		AuthorityStation:     authorityStation,
	})
	if err != nil {
		return nil, err
	}

	return &chat.BeginAttachmentUploadResponse{
		UploadId:            result.Upload.UploadID,
		Generation:          result.Upload.Generation,
		AcceptedChunkSize:   result.Upload.Spec.ChunkSize,
		ReceivedChunkBitmap: append([]byte(nil), result.Upload.ReceivedChunkBitmap...),
		ExpiresAt:           timestamppb.New(result.Upload.ExpiresAt.UTC()),
		AuthorityStationId:  string(authorityStation),
	}, nil
}

func (h *AttachmentHandler) Status(
	ctx context.Context,
	authenticated AuthenticatedActor,
	request *chat.GetAttachmentUploadRequest,
) (*chat.GetAttachmentUploadResponse, error) {
	if request == nil {
		return nil, invalidAttachmentRequest("attachment_handler.status")
	}
	endpoint, err := authenticatedAttachmentEndpoint(
		authenticated,
		"attachment_handler.status",
	)
	if err != nil {
		return nil, err
	}
	conversationID, authorityStation, err := attachmentScope(
		request.GetConversationId(),
		request.GetAuthorityStationId(),
	)
	if err != nil {
		return nil, err
	}
	upload, err := h.service.Status(ctx, endpoint, attachment.StatusRequest{
		UploadID:         request.GetUploadId(),
		Generation:       request.GetGeneration(),
		ConversationID:   conversationID,
		AuthorityStation: authorityStation,
	})
	if err != nil {
		return nil, err
	}
	response := &chat.GetAttachmentUploadResponse{
		UploadId:            upload.UploadID,
		Generation:          upload.Generation,
		State:               transferStateToProto(upload.State),
		ReceivedChunkBitmap: append([]byte(nil), upload.ReceivedChunkBitmap...),
		ExpiresAt:           timestamppb.New(upload.ExpiresAt.UTC()),
	}
	if upload.State == attachment.TransferStateComplete {
		response.Object = descriptorToProto(attachment.Object{
			ObjectID:       upload.ObjectID,
			StorageRef:     upload.StorageRef,
			ConversationID: upload.ConversationID,
			MessageID:      upload.MessageID,
			AttachmentID:   upload.AttachmentID,
			Uploader:       upload.Uploader.Actor,
			Spec:           upload.Spec,
		})
	}

	return response, nil
}

func (h *AttachmentHandler) PutChunk(
	ctx context.Context,
	authenticated AuthenticatedActor,
	request *chat.PutAttachmentChunkRequest,
	body []byte,
) (*chat.PutAttachmentChunkResponse, error) {
	if request == nil {
		return nil, invalidAttachmentRequest("attachment_handler.put_chunk")
	}
	endpoint, err := authenticatedAttachmentEndpoint(
		authenticated,
		"attachment_handler.put_chunk",
	)
	if err != nil {
		return nil, err
	}
	conversationID, authorityStation, err := attachmentScope(
		request.GetConversationId(),
		request.GetAuthorityStationId(),
	)
	if err != nil {
		return nil, err
	}
	hash, err := valueobject.NewHash(request.GetCiphertextSha256())
	if err != nil {
		return nil, invalidAttachmentRequest("attachment_handler.put_chunk")
	}
	result, err := h.service.PutChunk(ctx, endpoint, attachment.PutChunkRequest{
		UploadID:         request.GetUploadId(),
		Generation:       request.GetGeneration(),
		ConversationID:   conversationID,
		AuthorityStation: authorityStation,
		ChunkIndex:       request.GetChunkIndex(),
		ByteOffset:       request.GetByteOffset(),
		CiphertextSize:   request.GetCiphertextSize(),
		CiphertextHash:   hash,
		IdempotencyKey:   request.GetIdempotencyKey(),
	}, body)
	if err != nil {
		return nil, err
	}

	return &chat.PutAttachmentChunkResponse{
		ChunkIndex:          result.ChunkIndex,
		Duplicate:           result.Duplicate,
		ReceivedChunkBitmap: append([]byte(nil), result.ReceivedChunkBitmap...),
	}, nil
}

func (h *AttachmentHandler) Complete(
	ctx context.Context,
	authenticated AuthenticatedActor,
	request *chat.CompleteAttachmentUploadRequest,
) (*chat.CompleteAttachmentUploadResponse, error) {
	if request == nil {
		return nil, invalidAttachmentRequest("attachment_handler.complete")
	}
	endpoint, err := authenticatedAttachmentEndpoint(
		authenticated,
		"attachment_handler.complete",
	)
	if err != nil {
		return nil, err
	}
	conversationID, authorityStation, err := attachmentScope(
		request.GetConversationId(),
		request.GetAuthorityStationId(),
	)
	if err != nil {
		return nil, err
	}
	commitment, err := valueobject.NewHash(request.GetDescriptorCommitmentSha256())
	if err != nil {
		return nil, invalidAttachmentRequest("attachment_handler.complete")
	}
	result, err := h.service.Complete(ctx, endpoint, attachment.CompleteRequest{
		UploadID:             request.GetUploadId(),
		Generation:           request.GetGeneration(),
		ConversationID:       conversationID,
		AuthorityStation:     authorityStation,
		DescriptorCommitment: commitment,
	})
	if err != nil {
		return nil, err
	}

	return &chat.CompleteAttachmentUploadResponse{
		Object:    descriptorToProto(result.Object),
		Duplicate: result.Duplicate,
	}, nil
}

func (h *AttachmentHandler) Cancel(
	ctx context.Context,
	authenticated AuthenticatedActor,
	request *chat.CancelAttachmentUploadRequest,
) (*chat.CancelAttachmentUploadResponse, error) {
	if request == nil {
		return nil, invalidAttachmentRequest("attachment_handler.cancel")
	}
	endpoint, err := authenticatedAttachmentEndpoint(
		authenticated,
		"attachment_handler.cancel",
	)
	if err != nil {
		return nil, err
	}
	conversationID, authorityStation, err := attachmentScope(
		request.GetConversationId(),
		request.GetAuthorityStationId(),
	)
	if err != nil {
		return nil, err
	}
	state, err := h.service.Cancel(ctx, endpoint, attachment.CancelRequest{
		UploadID:         request.GetUploadId(),
		Generation:       request.GetGeneration(),
		ConversationID:   conversationID,
		AuthorityStation: authorityStation,
	})
	if err != nil {
		return nil, err
	}

	return &chat.CancelAttachmentUploadResponse{State: transferStateToProto(state)}, nil
}

func (h *AttachmentHandler) Download(
	ctx context.Context,
	authenticated AuthenticatedActor,
	request *chat.GetAttachmentObjectRequest,
	start int64,
	end int64,
) (AttachmentDownload, error) {
	return h.download(ctx, authenticated, "", request, start, end)
}

func (h *AttachmentHandler) DownloadFromVerifiedHome(
	ctx context.Context,
	authenticated AuthenticatedActor,
	sourceHomeStationPeerID string,
	request *chat.GetAttachmentObjectRequest,
	start int64,
	end int64,
) (AttachmentDownload, error) {
	sourceHome, err := valueobject.NewStationID(sourceHomeStationPeerID)
	if err != nil {
		return AttachmentDownload{}, invalidAttachmentRequest(
			"attachment_handler.download_from_verified_home",
		)
	}

	return h.download(ctx, authenticated, sourceHome, request, start, end)
}

func (h *AttachmentHandler) download(
	ctx context.Context,
	authenticated AuthenticatedActor,
	sourceHome valueobject.StationID,
	request *chat.GetAttachmentObjectRequest,
	start int64,
	end int64,
) (AttachmentDownload, error) {
	if request == nil {
		return AttachmentDownload{}, invalidAttachmentRequest("attachment_handler.download")
	}
	endpoint, err := authenticatedAttachmentEndpoint(
		authenticated,
		"attachment_handler.download",
	)
	if err != nil {
		return AttachmentDownload{}, err
	}
	conversationID, authorityStation, err := attachmentScope(
		request.GetConversationId(),
		request.GetAuthorityStationId(),
	)
	if err != nil {
		return AttachmentDownload{}, err
	}
	objectID, err := valueobject.NewObjectID(request.GetObjectId())
	if err != nil {
		return AttachmentDownload{}, err
	}
	etag, err := valueobject.NewHash(request.GetExpectedEtagSha256())
	if err != nil {
		return AttachmentDownload{}, invalidAttachmentRequest("attachment_handler.download")
	}
	downloadRequest := attachment.DownloadRequest{
		ConversationID:   conversationID,
		ObjectID:         objectID,
		ExpectedETag:     etag,
		AuthorityStation: authorityStation,
		Start:            start,
		End:              end,
	}
	var result attachment.DownloadResult
	if sourceHome == "" {
		result, err = h.service.Download(ctx, endpoint, downloadRequest)
	} else {
		result, err = h.service.DownloadFromVerifiedHome(
			ctx,
			endpoint,
			sourceHome,
			downloadRequest,
		)
	}
	if err != nil {
		return AttachmentDownload{}, err
	}

	return AttachmentDownload{
		Metadata: &chat.GetAttachmentObjectResponse{
			Object:              descriptorToProto(result.Object),
			EtagSha256:          result.Object.Spec.CiphertextHash.Bytes(),
			TotalCiphertextSize: uint64(result.TotalSize),
		},
		Body:  result.Body,
		Start: result.Start,
		End:   result.End,
	}, nil
}

func AttachmentTransferError(err error) *chat.AttachmentTransferError {
	if err == nil {
		return nil
	}
	code := chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_RETRY_LATER
	switch attachment.CodeOf(err) {
	case attachment.ErrorCodeUploadExpired:
		code = chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_UPLOAD_EXPIRED
	case attachment.ErrorCodePartConflict:
		code = chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_PART_CONFLICT
	case attachment.ErrorCodeRangeInvalid:
		code = chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_RANGE_INVALID
	case attachment.ErrorCodeInvalidArgument, attachment.ErrorCodeInvalidState:
		code = chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_DESCRIPTOR_MISMATCH
	case attachment.ErrorCodeIntegrityFailed:
		code = chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_INTEGRITY_FAILED
	case attachment.ErrorCodeUnauthorized, attachment.ErrorCodeNotGranted:
		code = chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_NOT_GRANTED
	case attachment.ErrorCodeQuotaExceeded:
		code = chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_QUOTA_EXCEEDED
	case attachment.ErrorCodeRetryLater, attachment.ErrorCodePersistence, attachment.ErrorCodeNotFound:
		code = chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_RETRY_LATER
	}
	response := &chat.AttachmentTransferError{Code: code}
	retryAfter := attachment.RetryAfterOf(err)
	if code == chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_RETRY_LATER &&
		retryAfter == 0 {
		retryAfter = time.Second
	}
	if retryAfter > 0 {
		response.RetryAfter = durationpb.New(retryAfter)
	}

	return response
}

func uploadSpecFromProto(
	wire *chat.EncryptedObjectUploadSpec,
) (attachment.UploadSpec, error) {
	if wire == nil {
		return attachment.UploadSpec{}, invalidAttachmentRequest(
			"attachment_handler.map_upload_spec",
		)
	}
	wholeHash, err := valueobject.NewHash(wire.GetCiphertextSha256())
	if err != nil {
		return attachment.UploadSpec{}, invalidAttachmentRequest(
			"attachment_handler.map_upload_spec",
		)
	}
	chunkHashes := make([]valueobject.Hash, 0, len(wire.GetChunkCiphertextSha256()))
	for _, raw := range wire.GetChunkCiphertextSha256() {
		hash, err := valueobject.NewHash(raw)
		if err != nil {
			return attachment.UploadSpec{}, invalidAttachmentRequest(
				"attachment_handler.map_upload_spec",
			)
		}
		chunkHashes = append(chunkHashes, hash)
	}

	return attachment.UploadSpec{
		CiphertextSize: wire.GetCiphertextSize(),
		CiphertextHash: wholeHash,
		MediaType:      wire.GetMediaType(),
		ChunkSize:      wire.GetChunkSize(),
		ChunkCount:     wire.GetChunkCount(),
		Encryption:     attachment.EncryptionSuite(wire.GetEncryptionSuite()),
		TagSize:        wire.GetTagSize(),
		NonceStrategy:  attachment.NonceStrategy(wire.GetNonceStrategy()),
		ChunkHashes:    chunkHashes,
	}, nil
}

func descriptorToProto(object attachment.Object) *chat.EncryptedObjectDescriptor {
	hashes := make([][]byte, 0, len(object.Spec.ChunkHashes))
	for _, hash := range object.Spec.ChunkHashes {
		hashes = append(hashes, hash.Bytes())
	}

	return &chat.EncryptedObjectDescriptor{
		ObjectId:              string(object.ObjectID),
		StorageRef:            object.StorageRef,
		CiphertextSize:        object.Spec.CiphertextSize,
		CiphertextSha256:      object.Spec.CiphertextHash.Bytes(),
		MediaType:             object.Spec.MediaType,
		ChunkSize:             object.Spec.ChunkSize,
		ChunkCount:            object.Spec.ChunkCount,
		EncryptionSuite:       chat.AttachmentEncryptionSuite(object.Spec.Encryption),
		TagSize:               object.Spec.TagSize,
		NonceStrategy:         chat.AttachmentNonceStrategy(object.Spec.NonceStrategy),
		ChunkCiphertextSha256: hashes,
	}
}

func transferStateToProto(
	state attachment.TransferState,
) chat.AttachmentTransferState {
	return chat.AttachmentTransferState(state)
}

func bindAttachmentEndpoint(
	authenticated AuthenticatedActor,
	request *chat.CryptoEndpoint,
	operation string,
) (valueobject.Endpoint, error) {
	if request == nil ||
		request.GetPtid() != authenticated.PTID ||
		request.GetDeviceId() != authenticated.DeviceID {
		return valueobject.Endpoint{}, attachment.NewError(
			attachment.ErrorCodeUnauthorized,
			operation,
			"uploader",
			"does not match the authenticated endpoint",
		)
	}

	return authenticatedAttachmentEndpoint(authenticated, operation)
}

func authenticatedAttachmentEndpoint(
	authenticated AuthenticatedActor,
	operation string,
) (valueobject.Endpoint, error) {
	endpoint, err := valueobject.NewEndpoint(authenticated.PTID, authenticated.DeviceID)
	if err != nil {
		return valueobject.Endpoint{}, attachment.NewError(
			attachment.ErrorCodeUnauthorized,
			operation,
			"endpoint",
			"is not a complete authenticated endpoint",
		)
	}

	return endpoint, nil
}

func attachmentScope(
	conversation string,
	authority string,
) (valueobject.ConversationID, valueobject.StationID, error) {
	conversationID, err := valueobject.NewConversationID(conversation)
	if err != nil {
		return "", "", err
	}
	authorityStation, err := valueobject.NewStationID(authority)
	if err != nil {
		return "", "", err
	}

	return conversationID, authorityStation, nil
}

func invalidAttachmentRequest(operation string) error {
	return attachment.NewError(
		attachment.ErrorCodeInvalidArgument,
		operation,
		"request",
		"is incomplete or malformed",
	)
}

var _ AttachmentApplication = (*attachment.Service)(nil)
