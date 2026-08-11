package application

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"io"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const attachmentCommitmentDomain = "peers-touch:attachment:upload-commitment:1"

type AttachmentPolicy struct {
	UploadTTL time.Duration
}

type AttachmentService struct {
	unitOfWork     messaging.AuthorityUnitOfWork
	blobs          messaging.AttachmentBlobStore
	localStationID string
	policy         AttachmentPolicy
	clock          func() time.Time
	partMu         sync.Mutex
	activeParts    map[string]int
}

func NewAttachmentService(
	unitOfWork messaging.AuthorityUnitOfWork,
	blobs messaging.AttachmentBlobStore,
	localStationID string,
	policy AttachmentPolicy,
	clock func() time.Time,
) (*AttachmentService, error) {
	if unitOfWork == nil ||
		blobs == nil ||
		strings.TrimSpace(localStationID) == "" ||
		clock == nil ||
		policy.UploadTTL <= 0 {
		return nil, fmt.Errorf("messaging: attachment service dependencies are invalid")
	}
	return &AttachmentService{
		unitOfWork:     unitOfWork,
		blobs:          blobs,
		localStationID: localStationID,
		policy:         policy,
		clock:          clock,
		activeParts:    make(map[string]int),
	}, nil
}

func (s *AttachmentService) Begin(
	ctx context.Context,
	authenticated *chat.CryptoEndpoint,
	request *chat.BeginAttachmentUploadRequest,
) (*chat.BeginAttachmentUploadResponse, error) {
	if authenticated == nil ||
		request == nil ||
		request.Uploader == nil ||
		request.Uploader.Ptid != authenticated.Ptid ||
		request.Uploader.DeviceId != authenticated.DeviceId ||
		strings.TrimSpace(request.ConversationId) == "" ||
		strings.TrimSpace(request.MessageId) == "" ||
		strings.TrimSpace(request.AttachmentId) == "" ||
		strings.TrimSpace(request.IdempotencyKey) == "" ||
		request.AuthorityStationId != s.localStationID ||
		len(request.DescriptorCommitmentSha256) != sha256.Size {
		return nil, messaging.ErrAttachmentDescriptor
	}
	if err := messaging.ValidateEncryptedObjectUploadSpec(request.Object); err != nil {
		return nil, err
	}
	expectedCommitment, err := AttachmentUploadCommitment(request)
	if err != nil {
		return nil, err
	}
	if !bytes.Equal(expectedCommitment, request.DescriptorCommitmentSha256) {
		return nil, messaging.ErrAttachmentDescriptor
	}
	now := s.clock().UTC()
	upload := &messaging.AttachmentUpload{
		UploadID:                   uuid.NewString(),
		Generation:                 1,
		ConversationID:             request.ConversationId,
		MessageID:                  request.MessageId,
		AttachmentID:               request.AttachmentId,
		Uploader:                   proto.Clone(request.Uploader).(*chat.CryptoEndpoint),
		Object:                     proto.Clone(request.Object).(*chat.EncryptedObjectUploadSpec),
		DescriptorCommitmentSHA256: append([]byte(nil), request.DescriptorCommitmentSha256...),
		IdempotencyKey:             request.IdempotencyKey,
		State:                      chat.AttachmentTransferState_ATTACHMENT_TRANSFER_STATE_QUEUED,
		ReceivedChunkBitmap:        make([]byte, (request.Object.ChunkCount+7)/8),
		ExpiresAt:                  now.Add(s.policy.UploadTTL),
		CreatedAt:                  now,
		UpdatedAt:                  now,
	}
	var persisted *messaging.AttachmentUpload
	err = s.unitOfWork.Execute(ctx, func(repositories messaging.AuthorityRepositories) error {
		conversation, err := repositories.Authority.LockConversation(ctx, request.ConversationId)
		if err != nil {
			return err
		}
		if !conversation.Active {
			return messaging.ErrConversationState
		}
		member, err := repositories.Authority.GetMember(ctx, request.ConversationId, authenticated.Ptid)
		if err != nil {
			return err
		}
		if !member.Active {
			return messaging.ErrSenderUnauthorized
		}
		active, err := repositories.Devices.IsActive(ctx, authenticated)
		if err != nil {
			return err
		}
		if !active {
			return messaging.ErrSenderUnauthorized
		}
		persisted, _, err = repositories.Attachments.CreateUpload(ctx, upload)
		return err
	})
	if err != nil {
		return nil, err
	}
	return beginUploadResponse(persisted, s.localStationID), nil
}

func (s *AttachmentService) Status(
	ctx context.Context,
	authenticated *chat.CryptoEndpoint,
	request *chat.GetAttachmentUploadRequest,
) (*chat.GetAttachmentUploadResponse, error) {
	if authenticated == nil ||
		request == nil ||
		request.UploadId == "" ||
		request.Generation == 0 ||
		request.ConversationId == "" ||
		request.AuthorityStationId != s.localStationID {
		return nil, messaging.ErrAttachmentDescriptor
	}
	var upload *messaging.AttachmentUpload
	var object *messaging.AttachmentObject
	err := s.unitOfWork.Execute(ctx, func(repositories messaging.AuthorityRepositories) error {
		var err error
		upload, err = repositories.Attachments.GetUpload(ctx, request.UploadId, request.Generation)
		if err != nil {
			return err
		}
		if !sameEndpoint(upload.Uploader, authenticated) {
			return messaging.ErrSenderUnauthorized
		}
		if upload.ConversationID != request.ConversationId {
			return messaging.ErrAttachmentConflict
		}
		if upload.ObjectID != "" {
			object, err = repositories.Attachments.GetObject(ctx, upload.ObjectID)
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	response := &chat.GetAttachmentUploadResponse{
		UploadId:            upload.UploadID,
		Generation:          upload.Generation,
		State:               upload.State,
		ReceivedChunkBitmap: append([]byte(nil), upload.ReceivedChunkBitmap...),
		ExpiresAt:           timestamppb.New(upload.ExpiresAt),
	}
	if object != nil {
		response.Object = proto.Clone(object.Descriptor).(*chat.EncryptedObjectDescriptor)
	}
	return response, nil
}

func (s *AttachmentService) PutChunk(
	ctx context.Context,
	authenticated *chat.CryptoEndpoint,
	request *chat.PutAttachmentChunkRequest,
	body []byte,
) (*chat.PutAttachmentChunkResponse, error) {
	if authenticated == nil ||
		request == nil ||
		request.UploadId == "" ||
		request.Generation == 0 ||
		request.IdempotencyKey == "" ||
		request.ConversationId == "" ||
		request.AuthorityStationId != s.localStationID ||
		len(request.CiphertextSha256) != sha256.Size {
		return nil, messaging.ErrAttachmentDescriptor
	}
	if !s.acquirePart(request.UploadId) {
		return nil, messaging.ErrAttachmentQuota
	}
	defer s.releasePart(request.UploadId)
	var upload *messaging.AttachmentUpload
	err := s.unitOfWork.Execute(ctx, func(repositories messaging.AuthorityRepositories) error {
		var err error
		upload, err = repositories.Attachments.LockUpload(ctx, request.UploadId, request.Generation)
		if err != nil {
			return err
		}
		return validateChunkRequest(upload, authenticated, request, body, s.clock().UTC())
	})
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(body)
	storageKey := fmt.Sprintf(
		"uploads/%s/%d/%d/%x",
		upload.UploadID,
		upload.Generation,
		request.ChunkIndex,
		sum[:],
	)
	if err := s.blobs.Save(ctx, storageKey, bytes.NewReader(body)); err != nil {
		return nil, err
	}
	var duplicate bool
	var bitmap []byte
	err = s.unitOfWork.Execute(ctx, func(repositories messaging.AuthorityRepositories) error {
		locked, err := repositories.Attachments.LockUpload(ctx, request.UploadId, request.Generation)
		if err != nil {
			return err
		}
		if err := validateChunkRequest(
			locked,
			authenticated,
			request,
			body,
			s.clock().UTC(),
		); err != nil {
			return err
		}
		duplicate, err = repositories.Attachments.PutPart(ctx, &messaging.AttachmentPart{
			UploadID:         request.UploadId,
			Generation:       request.Generation,
			ChunkIndex:       request.ChunkIndex,
			ByteOffset:       request.ByteOffset,
			CiphertextSize:   request.CiphertextSize,
			CiphertextSHA256: append([]byte(nil), request.CiphertextSha256...),
			StorageKey:       storageKey,
			CreatedAt:        s.clock().UTC(),
		})
		if err != nil {
			return err
		}
		bitmap = append([]byte(nil), locked.ReceivedChunkBitmap...)
		setChunkReceived(bitmap, request.ChunkIndex)
		return repositories.Attachments.SetUploadBitmap(
			ctx,
			request.UploadId,
			request.Generation,
			bitmap,
			s.clock().UTC(),
		)
	})
	if err != nil {
		_ = s.blobs.Delete(ctx, storageKey)
		return nil, err
	}
	return &chat.PutAttachmentChunkResponse{
		ChunkIndex:          request.ChunkIndex,
		Duplicate:           duplicate,
		ReceivedChunkBitmap: bitmap,
	}, nil
}

func (s *AttachmentService) Complete(
	ctx context.Context,
	authenticated *chat.CryptoEndpoint,
	request *chat.CompleteAttachmentUploadRequest,
) (*chat.CompleteAttachmentUploadResponse, error) {
	if authenticated == nil ||
		request == nil ||
		request.UploadId == "" ||
		request.Generation == 0 ||
		request.ConversationId == "" ||
		request.AuthorityStationId != s.localStationID ||
		len(request.DescriptorCommitmentSha256) != sha256.Size {
		return nil, messaging.ErrAttachmentDescriptor
	}
	var upload *messaging.AttachmentUpload
	var parts []messaging.AttachmentPart
	var existing *messaging.AttachmentObject
	err := s.unitOfWork.Execute(ctx, func(repositories messaging.AuthorityRepositories) error {
		var err error
		upload, err = repositories.Attachments.LockUpload(ctx, request.UploadId, request.Generation)
		if err != nil {
			return err
		}
		if !sameEndpoint(upload.Uploader, authenticated) {
			return messaging.ErrSenderUnauthorized
		}
		if upload.ConversationID != request.ConversationId {
			return messaging.ErrAttachmentConflict
		}
		if !bytes.Equal(upload.DescriptorCommitmentSHA256, request.DescriptorCommitmentSha256) {
			return messaging.ErrAttachmentConflict
		}
		if upload.State == chat.AttachmentTransferState_ATTACHMENT_TRANSFER_STATE_COMPLETE {
			existing, err = repositories.Attachments.GetObject(ctx, upload.ObjectID)
			return err
		}
		if upload.State != chat.AttachmentTransferState_ATTACHMENT_TRANSFER_STATE_TRANSFERRING {
			return messaging.ErrAttachmentState
		}
		if !upload.ExpiresAt.After(s.clock().UTC()) {
			return messaging.ErrAttachmentExpired
		}
		parts, err = repositories.Attachments.ListParts(ctx, upload.UploadID, upload.Generation)
		if err != nil {
			return err
		}
		return validateCompleteParts(upload, parts)
	})
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return &chat.CompleteAttachmentUploadResponse{
			Object:    proto.Clone(existing.Descriptor).(*chat.EncryptedObjectDescriptor),
			Duplicate: true,
		}, nil
	}

	objectID := uuid.NewSHA1(uuid.NameSpaceOID, []byte(upload.UploadID)).String()
	storageRef := uuid.NewSHA1(
		uuid.NameSpaceOID,
		append([]byte(upload.UploadID+"\x00"), upload.DescriptorCommitmentSHA256...),
	).String()
	storageKey := "objects/" + storageRef
	reader := &attachmentPartSequenceReader{ctx: ctx, blobs: s.blobs, parts: parts}
	defer reader.Close()
	wholeHash := sha256.New()
	counting := &countingReader{reader: io.TeeReader(reader, wholeHash)}
	if err := s.blobs.Save(ctx, storageKey, counting); err != nil {
		return nil, err
	}
	if counting.read != upload.Object.CiphertextSize ||
		!bytes.Equal(wholeHash.Sum(nil), upload.Object.CiphertextSha256) {
		_ = s.blobs.Delete(ctx, storageKey)
		return nil, messaging.ErrAttachmentConflict
	}
	descriptor := descriptorFromUpload(upload, objectID, storageRef)
	object := &messaging.AttachmentObject{
		Descriptor:     descriptor,
		StorageKey:     storageKey,
		UploaderPTID:   upload.Uploader.Ptid,
		ConversationID: upload.ConversationID,
		MessageID:      upload.MessageID,
		AttachmentID:   upload.AttachmentID,
		State:          messaging.AttachmentObjectStateCompleteUnattached,
		CreatedAt:      s.clock().UTC(),
	}
	err = s.unitOfWork.Execute(ctx, func(repositories messaging.AuthorityRepositories) error {
		locked, err := repositories.Attachments.LockUpload(ctx, upload.UploadID, upload.Generation)
		if err != nil {
			return err
		}
		if !bytes.Equal(locked.DescriptorCommitmentSHA256, upload.DescriptorCommitmentSHA256) {
			return messaging.ErrAttachmentConflict
		}
		return repositories.Attachments.CompleteUpload(
			ctx,
			upload.UploadID,
			upload.Generation,
			object,
			s.clock().UTC(),
		)
	})
	if err != nil {
		_ = s.blobs.Delete(ctx, storageKey)
		return nil, err
	}
	for _, part := range parts {
		_ = s.blobs.Delete(ctx, part.StorageKey)
	}
	return &chat.CompleteAttachmentUploadResponse{Object: descriptor}, nil
}

func (s *AttachmentService) Cancel(
	ctx context.Context,
	authenticated *chat.CryptoEndpoint,
	request *chat.CancelAttachmentUploadRequest,
) (*chat.CancelAttachmentUploadResponse, error) {
	if authenticated == nil ||
		request == nil ||
		request.UploadId == "" ||
		request.Generation == 0 ||
		request.ConversationId == "" ||
		request.AuthorityStationId != s.localStationID {
		return nil, messaging.ErrAttachmentDescriptor
	}
	err := s.unitOfWork.Execute(ctx, func(repositories messaging.AuthorityRepositories) error {
		upload, err := repositories.Attachments.LockUpload(ctx, request.UploadId, request.Generation)
		if err != nil {
			return err
		}
		if !sameEndpoint(upload.Uploader, authenticated) {
			return messaging.ErrSenderUnauthorized
		}
		if upload.ConversationID != request.ConversationId {
			return messaging.ErrAttachmentConflict
		}
		return repositories.Attachments.CancelUpload(
			ctx,
			request.UploadId,
			request.Generation,
			s.clock().UTC(),
		)
	})
	if err != nil {
		return nil, err
	}
	return &chat.CancelAttachmentUploadResponse{
		State: chat.AttachmentTransferState_ATTACHMENT_TRANSFER_STATE_CANCELLED,
	}, nil
}

func (s *AttachmentService) SweepExpiredUploads(
	ctx context.Context,
	limit int,
) (int, error) {
	var parts []messaging.AttachmentPart
	err := s.unitOfWork.Execute(ctx, func(repositories messaging.AuthorityRepositories) error {
		var err error
		parts, err = repositories.Attachments.ExpireUploads(ctx, s.clock().UTC(), limit)
		return err
	})
	if err != nil {
		return 0, err
	}
	deleted := 0
	for _, part := range parts {
		if err := s.blobs.Delete(ctx, part.StorageKey); err != nil {
			return deleted, err
		}
		deleted++
	}
	return deleted, nil
}

func (s *AttachmentService) OpenGrantedObject(
	ctx context.Context,
	recipient *chat.CryptoEndpoint,
	request *chat.GetAttachmentObjectRequest,
	start int64,
	end int64,
) (*messaging.AttachmentObject, io.ReadCloser, int64, error) {
	if recipient == nil ||
		strings.TrimSpace(recipient.Ptid) == "" ||
		strings.TrimSpace(recipient.DeviceId) == "" ||
		request == nil ||
		strings.TrimSpace(request.ConversationId) == "" ||
		strings.TrimSpace(request.ObjectId) == "" ||
		request.AuthorityStationId != s.localStationID ||
		len(request.ExpectedEtagSha256) != sha256.Size {
		return nil, nil, 0, messaging.ErrAttachmentDescriptor
	}
	var object *messaging.AttachmentObject
	err := s.unitOfWork.Execute(ctx, func(repositories messaging.AuthorityRepositories) error {
		active, err := repositories.Devices.IsActive(ctx, recipient)
		if err != nil {
			return err
		}
		if !active {
			return messaging.ErrSenderUnauthorized
		}
		object, err = repositories.Attachments.GetGrantedObject(
			ctx,
			request.ConversationId,
			request.ObjectId,
			recipient.Ptid,
		)
		return err
	})
	if err != nil {
		return nil, nil, 0, err
	}
	if !bytes.Equal(object.Descriptor.CiphertextSha256, request.ExpectedEtagSha256) {
		return nil, nil, 0, messaging.ErrAttachmentETag
	}
	if end == -1 {
		end = int64(object.Descriptor.CiphertextSize) - 1
	}
	if start < 0 || end < start || uint64(end) >= object.Descriptor.CiphertextSize {
		return nil, nil, 0, messaging.ErrAttachmentRange
	}
	reader, totalSize, err := s.blobs.Open(ctx, object.StorageKey, start, end)
	if err != nil {
		return nil, nil, 0, err
	}
	if uint64(totalSize) != object.Descriptor.CiphertextSize {
		_ = reader.Close()
		return nil, nil, 0, messaging.ErrAttachmentConflict
	}
	return object, reader, totalSize, nil
}

func AttachmentUploadCommitment(
	request *chat.BeginAttachmentUploadRequest,
) ([]byte, error) {
	if request == nil || request.Object == nil {
		return nil, messaging.ErrAttachmentDescriptor
	}
	objectBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(request.Object)
	if err != nil {
		return nil, err
	}
	hash := sha256.New()
	for _, value := range [][]byte{
		[]byte(attachmentCommitmentDomain),
		[]byte(request.ConversationId),
		[]byte(request.MessageId),
		[]byte(request.AttachmentId),
		[]byte(request.AuthorityStationId),
		objectBytes,
	} {
		var size [8]byte
		binary.BigEndian.PutUint64(size[:], uint64(len(value)))
		_, _ = hash.Write(size[:])
		_, _ = hash.Write(value)
	}
	return hash.Sum(nil), nil
}

func beginUploadResponse(
	upload *messaging.AttachmentUpload,
	authorityStationID string,
) *chat.BeginAttachmentUploadResponse {
	return &chat.BeginAttachmentUploadResponse{
		UploadId:            upload.UploadID,
		Generation:          upload.Generation,
		AcceptedChunkSize:   upload.Object.ChunkSize,
		ReceivedChunkBitmap: append([]byte(nil), upload.ReceivedChunkBitmap...),
		ExpiresAt:           timestamppb.New(upload.ExpiresAt),
		AuthorityStationId:  authorityStationID,
	}
}

func validateChunkRequest(
	upload *messaging.AttachmentUpload,
	authenticated *chat.CryptoEndpoint,
	request *chat.PutAttachmentChunkRequest,
	body []byte,
	now time.Time,
) error {
	if upload == nil || !sameEndpoint(upload.Uploader, authenticated) {
		return messaging.ErrSenderUnauthorized
	}
	if upload.ConversationID != request.ConversationId {
		return messaging.ErrAttachmentConflict
	}
	if upload.State != chat.AttachmentTransferState_ATTACHMENT_TRANSFER_STATE_QUEUED &&
		upload.State != chat.AttachmentTransferState_ATTACHMENT_TRANSFER_STATE_TRANSFERRING {
		return messaging.ErrAttachmentState
	}
	if !upload.ExpiresAt.After(now) {
		return messaging.ErrAttachmentExpired
	}
	if request.ChunkIndex >= upload.Object.ChunkCount ||
		request.CiphertextSize != uint64(len(body)) ||
		request.ByteOffset != uint64(request.ChunkIndex)*uint64(upload.Object.ChunkSize+upload.Object.TagSize) {
		return messaging.ErrAttachmentDescriptor
	}
	expectedSize := uint64(upload.Object.ChunkSize + upload.Object.TagSize)
	if request.ChunkIndex == upload.Object.ChunkCount-1 {
		expectedSize = upload.Object.CiphertextSize -
			uint64(upload.Object.ChunkCount-1)*uint64(upload.Object.ChunkSize+upload.Object.TagSize)
	}
	if request.CiphertextSize != expectedSize {
		return messaging.ErrAttachmentDescriptor
	}
	sum := sha256.Sum256(body)
	if !bytes.Equal(sum[:], request.CiphertextSha256) ||
		!bytes.Equal(
			request.CiphertextSha256,
			upload.Object.ChunkCiphertextSha256[request.ChunkIndex],
		) {
		return messaging.ErrAttachmentConflict
	}
	return nil
}

func validateCompleteParts(
	upload *messaging.AttachmentUpload,
	parts []messaging.AttachmentPart,
) error {
	if len(parts) != int(upload.Object.ChunkCount) {
		return messaging.ErrAttachmentState
	}
	sort.Slice(parts, func(left, right int) bool {
		return parts[left].ChunkIndex < parts[right].ChunkIndex
	})
	for index, part := range parts {
		if part.ChunkIndex != uint32(index) ||
			!bytes.Equal(part.CiphertextSHA256, upload.Object.ChunkCiphertextSha256[index]) {
			return messaging.ErrAttachmentConflict
		}
	}
	return nil
}

func descriptorFromUpload(
	upload *messaging.AttachmentUpload,
	objectID string,
	storageRef string,
) *chat.EncryptedObjectDescriptor {
	return &chat.EncryptedObjectDescriptor{
		ObjectId:              objectID,
		StorageRef:            storageRef,
		CiphertextSize:        upload.Object.CiphertextSize,
		CiphertextSha256:      append([]byte(nil), upload.Object.CiphertextSha256...),
		MediaType:             upload.Object.MediaType,
		ChunkSize:             upload.Object.ChunkSize,
		ChunkCount:            upload.Object.ChunkCount,
		EncryptionSuite:       upload.Object.EncryptionSuite,
		TagSize:               upload.Object.TagSize,
		NonceStrategy:         upload.Object.NonceStrategy,
		ChunkCiphertextSha256: cloneHashes(upload.Object.ChunkCiphertextSha256),
	}
}

func cloneHashes(values [][]byte) [][]byte {
	result := make([][]byte, len(values))
	for index, value := range values {
		result[index] = append([]byte(nil), value...)
	}
	return result
}

func sameEndpoint(left, right *chat.CryptoEndpoint) bool {
	return left != nil && right != nil &&
		left.Ptid == right.Ptid &&
		left.DeviceId == right.DeviceId
}

func setChunkReceived(bitmap []byte, chunkIndex uint32) {
	bitmap[chunkIndex/8] |= 1 << (chunkIndex % 8)
}

func (s *AttachmentService) acquirePart(uploadID string) bool {
	s.partMu.Lock()
	defer s.partMu.Unlock()
	if s.activeParts[uploadID] >= 4 {
		return false
	}
	s.activeParts[uploadID]++
	return true
}

func (s *AttachmentService) releasePart(uploadID string) {
	s.partMu.Lock()
	defer s.partMu.Unlock()
	if s.activeParts[uploadID] <= 1 {
		delete(s.activeParts, uploadID)
		return
	}
	s.activeParts[uploadID]--
}

type countingReader struct {
	reader io.Reader
	read   uint64
}

func (r *countingReader) Read(buffer []byte) (int, error) {
	count, err := r.reader.Read(buffer)
	r.read += uint64(count)
	return count, err
}

type attachmentPartSequenceReader struct {
	ctx     context.Context
	blobs   messaging.AttachmentBlobStore
	parts   []messaging.AttachmentPart
	index   int
	current io.ReadCloser
}

func (r *attachmentPartSequenceReader) Read(buffer []byte) (int, error) {
	for {
		if r.current == nil {
			if r.index >= len(r.parts) {
				return 0, io.EOF
			}
			reader, _, err := r.blobs.Open(r.ctx, r.parts[r.index].StorageKey, -1, -1)
			if err != nil {
				return 0, err
			}
			r.current = reader
		}
		count, err := r.current.Read(buffer)
		if err == io.EOF {
			_ = r.current.Close()
			r.current = nil
			r.index++
			if count > 0 {
				return count, nil
			}
			continue
		}
		return count, err
	}
}

func (r *attachmentPartSequenceReader) Close() error {
	if r.current != nil {
		return r.current.Close()
	}
	return nil
}
