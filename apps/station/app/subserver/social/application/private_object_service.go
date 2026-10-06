package application

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	securecontentkernel "github.com/peers-labs/peers-touch/station/app/internal/securecontent"
	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	privateObjectStorageLease   = 2 * time.Minute
	privateObjectStorageTimeout = 90 * time.Second
	privateObjectCleanupLease   = 5 * time.Minute
	privateObjectCleanupBatch   = 16
	privateObjectRetryDelay     = time.Second
	privateObjectUploadVersion  = uint64(1)
)

var errPrivateObjectIntegrity = errors.New("social private object integrity mismatch")

type PrivateObjectBlobStore interface {
	Save(context.Context, string, io.Reader) error
	Open(context.Context, string, int64, int64) (io.ReadCloser, int64, error)
	Stat(context.Context, string) (int64, error)
	Delete(context.Context, string) error
}

type PrivateObjectEndpointDirectory interface {
	ValidateActiveEndpoint(context.Context, *actormodel.ActorDeviceRef) error
}

type PrivateObjectChunk struct {
	UploadID         string
	Generation       uint64
	ChunkIndex       uint32
	Offset           uint64
	Size             uint64
	CiphertextSHA256 []byte
	IdempotencyKey   string
	Body             []byte
}

type PrivateObjectDownload struct {
	Body             io.ReadCloser
	Start            int64
	End              int64
	TotalSize        uint64
	DescriptorSHA256 []byte
}

type PrivateObjectService struct {
	store         infrastructure.PrivateObjectStore
	blobs         PrivateObjectBlobStore
	endpoints     PrivateObjectEndpointDirectory
	stationSigner PrivateContentStationSigner
	clock         PrivateContentClock
	policy        securecontentkernel.Policy
	federated     *federatedPrivateObjectConfig
	streamMetrics federatedPrivateObjectStreamMetrics
}

func NewPrivateObjectService(
	store infrastructure.PrivateObjectStore,
	blobs PrivateObjectBlobStore,
	endpoints PrivateObjectEndpointDirectory,
	stationSigner PrivateContentStationSigner,
	clock PrivateContentClock,
) (*PrivateObjectService, error) {
	if store == nil ||
		blobs == nil ||
		endpoints == nil ||
		stationSigner == nil ||
		clock == nil {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			"social.private_object.new_service",
			"dependencies",
			"store, blob backend, endpoint directory, and clock are required",
		)
	}
	policy := securecontentkernel.DefaultPolicy()
	if err := policy.Validate(); err != nil {
		return nil, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentInternal,
			"social.private_object.new_service",
			err,
		)
	}
	return &PrivateObjectService{
		store:         store,
		blobs:         blobs,
		endpoints:     endpoints,
		stationSigner: stationSigner,
		clock:         clock,
		policy:        policy,
		streamMetrics: newFederatedPrivateObjectStreamMetrics(),
	}, nil
}

func (s *PrivateObjectService) Begin(
	ctx context.Context,
	uploader *actormodel.ActorDeviceRef,
	request *securecontentpb.BeginEncryptedObjectUploadRequest,
) (*securecontentpb.BeginEncryptedObjectUploadResponse, error) {
	const operation = "social.private_object.begin"
	if err := s.validateActiveEndpoint(ctx, uploader, operation); err != nil {
		return nil, err
	}
	material, err := socialdomain.CanonicalizePrivateObjectBegin(
		request,
		s.policy,
	)
	if err != nil {
		return nil, err
	}
	now := s.clock.Now().UTC()
	uploadID := deterministicPrivateID(
		"object-upload",
		uploader.GetActor().GetPtid(),
		request.GetCommandId(),
		request.GetPlanId(),
		request.GetObjectId(),
	)
	result, err := s.store.BeginPrivateObject(
		ctx,
		infrastructure.PrivateObjectBegin{
			Upload: dbmodel.SocialPrivateObjectUpload{
				UploadID:         uploadID,
				Generation:       privateObjectUploadVersion,
				PlanID:           request.GetPlanId(),
				ObjectID:         request.GetObjectId(),
				ContentID:        request.GetResource().GetContentId(),
				UploaderPTID:     uploader.GetActor().GetPtid(),
				UploaderDeviceID: uploader.GetDeviceId(),
				UploadSpecBytes:  material.UploadSpecBytes,
				UploadSpecSHA256: material.UploadSpecSHA256[:],
				DescriptorCommitmentSHA256: clonePrivateBytes(
					request.GetDescriptorCommitmentSha256(),
				),
				BeginCommandID:     request.GetCommandId(),
				BeginCommandBytes:  material.CanonicalBytes,
				BeginCommandSHA256: material.CanonicalSHA256[:],
				ReceivedChunkBitmap: make(
					[]byte,
					(request.GetUploadSpec().GetChunkCount()+7)/8,
				),
				State:     dbmodel.SocialPrivateObjectCreated,
				ExpiresAt: now.Add(s.policy.MaximumUploadTTL),
				CreatedAt: now,
				UpdatedAt: now,
			},
			Now: now,
		},
		func(
			ctx context.Context,
			transaction federationdelivery.Transaction,
			plan dbmodel.SocialPrivateContentPlan,
		) (*securecontentpb.ContentEncryptionPlan, error) {
			return decodeAndVerifyPrivateContentPlanInTransaction(
				ctx,
				transaction,
				s.stationSigner,
				plan,
			)
		},
	)
	if err != nil {
		return nil, mapPrivateObjectStoreError(operation, err)
	}
	return privateObjectBeginResponse(result.Upload, result.ExactReplay), nil
}

func (s *PrivateObjectService) Status(
	ctx context.Context,
	uploader *actormodel.ActorDeviceRef,
	request *securecontentpb.GetEncryptedObjectUploadRequest,
) (*securecontentpb.GetEncryptedObjectUploadResponse, error) {
	const operation = "social.private_object.status"
	if err := s.validateActiveEndpoint(ctx, uploader, operation); err != nil {
		return nil, err
	}
	if request == nil ||
		strings.TrimSpace(request.GetUploadId()) == "" ||
		request.GetGeneration() == 0 ||
		len(request.ProtoReflect().GetUnknown()) != 0 {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			operation,
			"request",
			"requires a canonical upload ID and generation",
		)
	}
	upload, err := s.store.GetPrivateObjectUpload(
		ctx,
		request.GetUploadId(),
		request.GetGeneration(),
		uploader.GetActor().GetPtid(),
		uploader.GetDeviceId(),
		s.clock.Now().UTC(),
	)
	if err != nil {
		return nil, mapPrivateObjectStoreError(operation, err)
	}
	response := &securecontentpb.GetEncryptedObjectUploadResponse{
		UploadId:            upload.UploadID,
		Generation:          upload.Generation,
		ObjectId:            upload.ObjectID,
		State:               privateObjectTransferState(upload.State),
		ReceivedChunkBitmap: clonePrivateBytes(upload.ReceivedChunkBitmap),
		ExpiresAt:           timestamppb.New(upload.ExpiresAt),
	}
	if len(upload.CompleteResponseBytes) != 0 {
		var completed securecontentpb.CompleteEncryptedObjectUploadResponse
		if err := proto.Unmarshal(
			upload.CompleteResponseBytes,
			&completed,
		); err != nil {
			return nil, socialdomain.WrapPrivateContentError(
				socialdomain.PrivateContentIntegrityFailed,
				operation,
				err,
			)
		}
		response.Descriptor_ = completed.GetDescriptor_()
	}
	return response, nil
}

func (s *PrivateObjectService) PutChunk(
	ctx context.Context,
	uploader *actormodel.ActorDeviceRef,
	command PrivateObjectChunk,
) (*securecontentpb.PutEncryptedObjectChunkResponse, error) {
	const operation = "social.private_object.put_chunk"
	if err := s.validateActiveEndpoint(ctx, uploader, operation); err != nil {
		return nil, err
	}
	actualHash := sha256.Sum256(command.Body)
	if command.Size != uint64(len(command.Body)) ||
		!bytes.Equal(actualHash[:], command.CiphertextSHA256) {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"body",
			"does not match the declared size and SHA-256",
		)
	}
	commandHash, err := socialdomain.CanonicalPrivateObjectChunkCommand(
		command.UploadID,
		command.Generation,
		command.ChunkIndex,
		command.Offset,
		command.Size,
		command.CiphertextSHA256,
		command.IdempotencyKey,
	)
	if err != nil {
		return nil, err
	}
	now := s.clock.Now().UTC()
	leaseOwner := privateObjectOpaqueID(
		"part-lease",
		command.IdempotencyKey,
		strconv.FormatInt(now.UnixNano(), 10),
	)
	storageKey := privateObjectStorageKey(
		"parts",
		command.UploadID,
		strconv.FormatUint(command.Generation, 10),
		strconv.FormatUint(uint64(command.ChunkIndex), 10),
	)
	stage, err := s.store.StagePrivateObjectPart(
		ctx,
		infrastructure.PrivateObjectPartCommand{
			UploadID:              command.UploadID,
			Generation:            command.Generation,
			ChunkIndex:            command.ChunkIndex,
			UploaderPTID:          uploader.GetActor().GetPtid(),
			UploaderDeviceID:      uploader.GetDeviceId(),
			Offset:                command.Offset,
			Size:                  command.Size,
			CiphertextSHA256:      clonePrivateBytes(command.CiphertextSHA256),
			IdempotencyKey:        command.IdempotencyKey,
			CanonicalCommandHash:  commandHash[:],
			LeaseOwner:            leaseOwner,
			LeaseDuration:         privateObjectStorageLease,
			Now:                   now,
			DeterministicStoreKey: storageKey,
		},
	)
	if err != nil {
		return nil, mapPrivateObjectStoreError(operation, err)
	}
	if stage.ExactReplay {
		if stage.Upload.State != dbmodel.SocialPrivateObjectGarbageCollected {
			storageContext, cancel := context.WithTimeout(
				ctx,
				privateObjectStorageTimeout,
			)
			defer cancel()
			if err := s.verifyBlob(
				storageContext,
				stage.Part.StorageKey,
				stage.Part.Size,
				stage.Part.CiphertextSHA256,
			); err != nil {
				if errors.Is(err, errPrivateObjectIntegrity) {
					if transitionErr := s.store.MarkPrivateObjectCorrupt(
						ctx,
						stage.Upload.UploadID,
						stage.Upload.Generation,
						"",
						0,
						"STORED_PART_MISMATCH",
						now,
					); transitionErr != nil {
						return nil, privateObjectTransitionPersistenceError(
							operation,
							err,
							transitionErr,
						)
					}
				}
				return nil, objectStorageOrIntegrityError(operation, err)
			}
		}
		return privateObjectPartResponse(
			stage.Upload,
			command.ChunkIndex,
			true,
		), nil
	}
	storageContext, cancel := context.WithTimeout(
		ctx,
		privateObjectStorageTimeout,
	)
	defer cancel()
	if err := s.blobs.Save(
		storageContext,
		stage.Part.StorageKey,
		bytes.NewReader(command.Body),
	); err != nil {
		if transitionErr := s.store.ReleasePrivateObjectPartLease(
			ctx,
			stage.Part.UploadID,
			stage.Part.Generation,
			stage.Part.ChunkIndex,
			stage.Part.LeaseOwner,
			stage.Part.LeaseEpoch,
			s.clock.Now().UTC().Add(privateObjectRetryDelay),
		); transitionErr != nil {
			return nil, privateObjectTransitionPersistenceError(
				operation,
				err,
				transitionErr,
			)
		}
		return nil, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentDependency,
			operation,
			err,
		)
	}
	if err := s.verifyBlob(
		storageContext,
		stage.Part.StorageKey,
		stage.Part.Size,
		stage.Part.CiphertextSHA256,
	); err != nil {
		if errors.Is(err, errPrivateObjectIntegrity) {
			if transitionErr := s.store.MarkPrivateObjectCorrupt(
				ctx,
				stage.Upload.UploadID,
				stage.Upload.Generation,
				"",
				0,
				"PART_WRITE_MISMATCH",
				now,
			); transitionErr != nil {
				return nil, privateObjectTransitionPersistenceError(
					operation,
					err,
					transitionErr,
				)
			}
		} else {
			if transitionErr := s.store.ReleasePrivateObjectPartLease(
				ctx,
				stage.Part.UploadID,
				stage.Part.Generation,
				stage.Part.ChunkIndex,
				stage.Part.LeaseOwner,
				stage.Part.LeaseEpoch,
				s.clock.Now().UTC().Add(privateObjectRetryDelay),
			); transitionErr != nil {
				return nil, privateObjectTransitionPersistenceError(
					operation,
					err,
					transitionErr,
				)
			}
		}
		return nil, objectStorageOrIntegrityError(operation, err)
	}
	upload, err := s.store.MarkPrivateObjectPartStored(
		ctx,
		stage.Part.UploadID,
		stage.Part.Generation,
		stage.Part.ChunkIndex,
		stage.Part.LeaseOwner,
		stage.Part.LeaseEpoch,
		now,
	)
	if err != nil {
		return nil, mapPrivateObjectStoreError(operation, err)
	}
	return privateObjectPartResponse(upload, command.ChunkIndex, false), nil
}

func (s *PrivateObjectService) Complete(
	ctx context.Context,
	uploader *actormodel.ActorDeviceRef,
	request *securecontentpb.CompleteEncryptedObjectUploadRequest,
) (*securecontentpb.CompleteEncryptedObjectUploadResponse, error) {
	const operation = "social.private_object.complete"
	if err := s.validateActiveEndpoint(ctx, uploader, operation); err != nil {
		return nil, err
	}
	material, err := socialdomain.CanonicalizePrivateObjectComplete(request)
	if err != nil {
		return nil, err
	}
	now := s.clock.Now().UTC()
	leaseOwner := privateObjectOpaqueID(
		"verify-lease",
		request.GetCommandId(),
		strconv.FormatInt(now.UnixNano(), 10),
	)
	finalStorageKey := privateObjectStorageKey(
		"objects",
		request.GetUploadId(),
		strconv.FormatUint(request.GetGeneration(), 10),
	)
	verification, err := s.store.StagePrivateObjectVerification(
		ctx,
		infrastructure.PrivateObjectCompleteCommand{
			UploadID:               request.GetUploadId(),
			Generation:             request.GetGeneration(),
			UploaderPTID:           uploader.GetActor().GetPtid(),
			UploaderDeviceID:       uploader.GetDeviceId(),
			CommandID:              request.GetCommandId(),
			CanonicalCommandBytes:  material.CanonicalBytes,
			CanonicalCommandSHA256: material.CanonicalSHA256[:],
			DescriptorCommitmentHash: clonePrivateBytes(
				request.GetDescriptorCommitmentSha256(),
			),
			LeaseOwner:                 leaseOwner,
			LeaseDuration:              privateObjectStorageLease,
			Now:                        now,
			DeterministicFinalStoreKey: finalStorageKey,
		},
	)
	if err != nil {
		return nil, mapPrivateObjectStoreError(operation, err)
	}
	if verification.ExactReplay {
		return decodePrivateObjectCompleteReplay(
			verification.Upload,
			operation,
		)
	}
	spec, err := decodePrivateObjectSpec(verification.Upload)
	if err != nil {
		return nil, err
	}
	storageContext, cancel := context.WithTimeout(
		ctx,
		privateObjectStorageTimeout,
	)
	defer cancel()
	if err := s.verifyPrivateObjectParts(
		storageContext,
		verification.Parts,
		spec,
	); err != nil {
		if errors.Is(err, errPrivateObjectIntegrity) {
			if transitionErr := s.store.MarkPrivateObjectCorrupt(
				ctx,
				verification.Upload.UploadID,
				verification.Upload.Generation,
				verification.Upload.VerificationLeaseOwner,
				verification.Upload.VerificationLeaseEpoch,
				"PART_SET_MISMATCH",
				now,
			); transitionErr != nil {
				return nil, privateObjectTransitionPersistenceError(
					operation,
					err,
					transitionErr,
				)
			}
			return privateObjectTerminalCompleteResponse(false), nil
		} else {
			if transitionErr := s.store.RetryPrivateObjectVerification(
				ctx,
				verification.Upload.UploadID,
				verification.Upload.Generation,
				verification.Upload.VerificationLeaseOwner,
				verification.Upload.VerificationLeaseEpoch,
				s.clock.Now().UTC().Add(privateObjectRetryDelay),
			); transitionErr != nil {
				return nil, privateObjectTransitionPersistenceError(
					operation,
					err,
					transitionErr,
				)
			}
		}
		return nil, objectStorageOrIntegrityError(operation, err)
	}
	if err := s.assemblePrivateObject(
		storageContext,
		verification.Upload.FinalStorageKey,
		verification.Parts,
	); err != nil {
		if errors.Is(err, errPrivateObjectIntegrity) {
			if transitionErr := s.store.MarkPrivateObjectCorrupt(
				ctx,
				verification.Upload.UploadID,
				verification.Upload.Generation,
				verification.Upload.VerificationLeaseOwner,
				verification.Upload.VerificationLeaseEpoch,
				"ASSEMBLED_PART_SET_MISMATCH",
				now,
			); transitionErr != nil {
				return nil, privateObjectTransitionPersistenceError(
					operation,
					err,
					transitionErr,
				)
			}
			return privateObjectTerminalCompleteResponse(false), nil
		}
		if transitionErr := s.store.RetryPrivateObjectVerification(
			ctx,
			verification.Upload.UploadID,
			verification.Upload.Generation,
			verification.Upload.VerificationLeaseOwner,
			verification.Upload.VerificationLeaseEpoch,
			s.clock.Now().UTC().Add(privateObjectRetryDelay),
		); transitionErr != nil {
			return nil, privateObjectTransitionPersistenceError(
				operation,
				err,
				transitionErr,
			)
		}
		return nil, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentDependency,
			operation,
			err,
		)
	}
	if err := s.verifyBlob(
		storageContext,
		verification.Upload.FinalStorageKey,
		spec.GetCiphertextSize(),
		spec.GetCiphertextSha256(),
	); err != nil {
		if errors.Is(err, errPrivateObjectIntegrity) {
			_ = s.blobs.Delete(ctx, verification.Upload.FinalStorageKey)
			if transitionErr := s.store.MarkPrivateObjectCorrupt(
				ctx,
				verification.Upload.UploadID,
				verification.Upload.Generation,
				verification.Upload.VerificationLeaseOwner,
				verification.Upload.VerificationLeaseEpoch,
				"ASSEMBLED_OBJECT_MISMATCH",
				now,
			); transitionErr != nil {
				return nil, privateObjectTransitionPersistenceError(
					operation,
					err,
					transitionErr,
				)
			}
			return privateObjectTerminalCompleteResponse(false), nil
		} else {
			if transitionErr := s.store.RetryPrivateObjectVerification(
				ctx,
				verification.Upload.UploadID,
				verification.Upload.Generation,
				verification.Upload.VerificationLeaseOwner,
				verification.Upload.VerificationLeaseEpoch,
				s.clock.Now().UTC().Add(privateObjectRetryDelay),
			); transitionErr != nil {
				return nil, privateObjectTransitionPersistenceError(
					operation,
					err,
					transitionErr,
				)
			}
		}
		return nil, objectStorageOrIntegrityError(operation, err)
	}

	storageRef := "social-object:" + privateObjectOpaqueID(
		"storage-ref",
		verification.Upload.ObjectID,
		verification.Upload.FinalStorageKey,
	)
	descriptor := &securecontentpb.EncryptedObjectDescriptor{
		Resource:   proto.Clone(spec.GetResource()).(*securecontentpb.SecureResourceRef),
		ObjectId:   verification.Upload.ObjectID,
		StorageRef: storageRef,
		Commitment: proto.Clone(spec).(*securecontentpb.EncryptedObjectUploadSpec),
	}
	descriptorBytes, err := securecontentkernel.CanonicalDescriptorBytes(
		descriptor,
		s.policy,
	)
	if err != nil {
		return nil, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	descriptorHash := sha256.Sum256(descriptorBytes)
	response := &securecontentpb.CompleteEncryptedObjectUploadResponse{
		Descriptor_: descriptor,
		State:       securecontentpb.EncryptedObjectTransferState_ENCRYPTED_OBJECT_TRANSFER_STATE_COMPLETE_UNATTACHED,
	}
	responseBytes, err := socialdomain.CanonicalProtoBytes(response)
	if err != nil {
		return nil, err
	}
	responseHash := sha256.Sum256(responseBytes)
	completedAt := s.clock.Now().UTC()
	unattachedExpiry := completedAt.Add(s.policy.MaximumUnattachedObjectTTL)
	err = s.store.CompletePrivateObject(
		ctx,
		infrastructure.PrivateObjectCompletion{
			Upload: verification.Upload,
			Object: dbmodel.SocialPrivateObjectAttachment{
				ObjectID:                 verification.Upload.ObjectID,
				UploadID:                 verification.Upload.UploadID,
				UploadGeneration:         verification.Upload.Generation,
				ContentID:                verification.Upload.ContentID,
				UploaderPTID:             verification.Upload.UploaderPTID,
				UploaderDeviceID:         verification.Upload.UploaderDeviceID,
				CanonicalDescriptorBytes: descriptorBytes,
				DescriptorSHA256:         descriptorHash[:],
				StorageKey:               verification.Upload.FinalStorageKey,
				TotalCiphertextSize:      spec.GetCiphertextSize(),
				CiphertextSHA256: clonePrivateBytes(
					spec.GetCiphertextSha256(),
				),
				State:     dbmodel.SocialPrivateObjectCompleteUnattached,
				CreatedAt: completedAt,
				UpdatedAt: completedAt,
				ExpiresAt: unattachedExpiry,
			},
			ResponseBytes:       responseBytes,
			ResponseSHA256:      responseHash[:],
			CompletedAt:         completedAt,
			UnattachedExpiresAt: unattachedExpiry,
		},
		verification.Upload.VerificationLeaseOwner,
		verification.Upload.VerificationLeaseEpoch,
	)
	if err != nil {
		return nil, mapPrivateObjectStoreError(operation, err)
	}
	return response, nil
}

func (s *PrivateObjectService) Cancel(
	ctx context.Context,
	uploader *actormodel.ActorDeviceRef,
	request *securecontentpb.CancelEncryptedObjectUploadRequest,
) (*securecontentpb.CancelEncryptedObjectUploadResponse, error) {
	const operation = "social.private_object.cancel"
	if err := s.validateActiveEndpoint(ctx, uploader, operation); err != nil {
		return nil, err
	}
	material, err := socialdomain.CanonicalizePrivateObjectCancel(request)
	if err != nil {
		return nil, err
	}
	result, err := s.store.CancelPrivateObject(
		ctx,
		infrastructure.PrivateObjectCancelCommand{
			UploadID:               request.GetUploadId(),
			Generation:             request.GetGeneration(),
			UploaderPTID:           uploader.GetActor().GetPtid(),
			UploaderDeviceID:       uploader.GetDeviceId(),
			CommandID:              request.GetCommandId(),
			CanonicalCommandBytes:  material.CanonicalBytes,
			CanonicalCommandSHA256: material.CanonicalSHA256[:],
			Now:                    s.clock.Now().UTC(),
		},
	)
	if err != nil {
		return nil, mapPrivateObjectStoreError(operation, err)
	}
	return &securecontentpb.CancelEncryptedObjectUploadResponse{
		UploadId:    result.Upload.UploadID,
		Generation:  result.Upload.Generation,
		State:       privateObjectTransferState(result.Upload.State),
		ExactReplay: result.ExactReplay,
	}, nil
}

func (s *PrivateObjectService) Download(
	ctx context.Context,
	viewer *actormodel.ActorDeviceRef,
	objectID string,
	expectedDescriptorSHA256 []byte,
	start int64,
	end int64,
) (PrivateObjectDownload, error) {
	const operation = "social.private_object.download"
	if err := s.validateActiveEndpoint(ctx, viewer, operation); err != nil {
		if socialdomain.IsPrivateContentCode(
			err,
			socialdomain.PrivateContentUnauthorized,
		) {
			return PrivateObjectDownload{}, socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentNotFound,
				operation,
				"object_id",
				"was not found",
			)
		}
		return PrivateObjectDownload{}, err
	}
	if err := socialdomain.ValidatePrivateObjectID(
		objectID,
		"object_id",
		operation,
	); err != nil ||
		len(expectedDescriptorSHA256) != sha256.Size {
		return PrivateObjectDownload{}, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentNotFound,
			operation,
			"object_id",
			"was not found",
		)
	}
	authorized, err := s.store.AuthorizePrivateObjectDownload(
		ctx,
		objectID,
		viewer.GetActor().GetPtid(),
		viewer.GetDeviceId(),
		expectedDescriptorSHA256,
	)
	if err != nil {
		if errors.Is(err, infrastructure.ErrPrivateContentNotFound) &&
			s.federated != nil {
			return s.downloadFederatedPrivateObject(
				ctx,
				viewer,
				objectID,
				expectedDescriptorSHA256,
				start,
				end,
			)
		}
		return PrivateObjectDownload{}, mapPrivateObjectStoreError(
			operation,
			err,
		)
	}
	object := authorized.Object
	storageContext, cancel := context.WithTimeout(
		ctx,
		privateObjectStorageTimeout,
	)
	size, err := s.blobs.Stat(storageContext, object.StorageKey)
	if err != nil {
		cancel()
		return PrivateObjectDownload{},
			socialdomain.WrapPrivateContentError(
				socialdomain.PrivateContentDependency,
				operation,
				err,
			)
	}
	if size != int64(object.TotalCiphertextSize) {
		cancel()
		return PrivateObjectDownload{},
			socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentIntegrityFailed,
				operation,
				"storage",
				"reported a different object size",
			)
	}
	normalizedStart, normalizedEnd, err := normalizePrivateObjectRange(
		start,
		end,
		object.TotalCiphertextSize,
	)
	if err != nil {
		cancel()
		return PrivateObjectDownload{}, err
	}
	reader, totalSize, err := s.blobs.Open(
		storageContext,
		object.StorageKey,
		normalizedStart,
		normalizedEnd,
	)
	if err != nil {
		cancel()
		return PrivateObjectDownload{}, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentDependency,
			operation,
			err,
		)
	}
	if uint64(totalSize) != object.TotalCiphertextSize {
		_ = reader.Close()
		cancel()
		return PrivateObjectDownload{}, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"storage",
			"reported a different object size",
		)
	}
	return PrivateObjectDownload{
		Body: &cancelOnCloseReadCloser{
			ReadCloser: reader,
			cancel:     cancel,
		},
		Start:            normalizedStart,
		End:              normalizedEnd,
		TotalSize:        object.TotalCiphertextSize,
		DescriptorSHA256: clonePrivateBytes(object.DescriptorSHA256),
	}, nil
}

func (s *PrivateObjectService) CleanupUnattached(
	ctx context.Context,
) (int, error) {
	now := s.clock.Now().UTC()
	leaseOwner := privateObjectOpaqueID(
		"cleanup-lease",
		strconv.FormatInt(now.UnixNano(), 10),
	)
	claims, err := s.store.ClaimPrivateObjectCleanup(
		ctx,
		leaseOwner,
		now,
		privateObjectCleanupLease,
		privateObjectCleanupBatch,
	)
	if err != nil {
		return 0, mapPrivateObjectStoreError(
			"social.private_object.cleanup",
			err,
		)
	}
	completed := 0
	for _, claim := range claims {
		deleteFailed := false
		for _, storageKey := range claim.StorageKeys {
			storageContext, cancel := context.WithTimeout(
				ctx,
				privateObjectStorageTimeout,
			)
			err := s.blobs.Delete(storageContext, storageKey)
			cancel()
			if err != nil {
				deleteFailed = true
				break
			}
		}
		if deleteFailed {
			if err := s.store.RetryPrivateObjectCleanup(
				ctx,
				claim,
				s.clock.Now().UTC(),
			); err != nil {
				return completed, mapPrivateObjectStoreError(
					"social.private_object.cleanup",
					err,
				)
			}
			continue
		}
		if err := s.store.FinishPrivateObjectCleanup(
			ctx,
			claim,
			s.clock.Now().UTC(),
		); err != nil {
			return completed, mapPrivateObjectStoreError(
				"social.private_object.cleanup",
				err,
			)
		}
		completed++
	}
	return completed, nil
}

type cancelOnCloseReadCloser struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (r *cancelOnCloseReadCloser) Close() error {
	err := r.ReadCloser.Close()
	r.cancel()
	return err
}

func (s *PrivateObjectService) validateActiveEndpoint(
	ctx context.Context,
	endpoint *actormodel.ActorDeviceRef,
	operation string,
) error {
	if endpoint == nil ||
		endpoint.GetActor() == nil ||
		strings.TrimSpace(endpoint.GetActor().GetPtid()) == "" ||
		strings.TrimSpace(endpoint.GetDeviceId()) == "" {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentUnauthorized,
			operation,
			"endpoint",
			"is required",
		)
	}
	if err := s.endpoints.ValidateActiveEndpoint(ctx, endpoint); err != nil {
		if errors.Is(err, ErrPrivateContentInactiveEndpoint) {
			return socialdomain.WrapPrivateContentError(
				socialdomain.PrivateContentUnauthorized,
				operation,
				err,
			)
		}
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentDependency,
			operation,
			err,
		)
	}
	return nil
}

func (s *PrivateObjectService) verifyPrivateObjectParts(
	ctx context.Context,
	parts []dbmodel.SocialPrivateObjectChunk,
	spec *securecontentpb.EncryptedObjectUploadSpec,
) error {
	if len(parts) != int(spec.GetChunkCount()) {
		return errPrivateObjectIntegrity
	}
	wholeHash := sha256.New()
	var total uint64
	for index, part := range parts {
		if part.ChunkIndex != uint32(index) ||
			part.State != dbmodel.SocialPrivateObjectPartStored {
			return errPrivateObjectIntegrity
		}
		reader, size, err := s.blobs.Open(
			ctx,
			part.StorageKey,
			-1,
			-1,
		)
		if err != nil {
			return err
		}
		partHash := sha256.New()
		written, copyErr := io.Copy(
			io.MultiWriter(partHash, wholeHash),
			io.LimitReader(reader, int64(part.Size)+1),
		)
		closeErr := reader.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		if size != int64(part.Size) ||
			written != int64(part.Size) ||
			!bytes.Equal(partHash.Sum(nil), part.CiphertextSHA256) {
			return errPrivateObjectIntegrity
		}
		total += part.Size
	}
	if total != spec.GetCiphertextSize() ||
		!bytes.Equal(wholeHash.Sum(nil), spec.GetCiphertextSha256()) {
		return errPrivateObjectIntegrity
	}
	return nil
}

func (s *PrivateObjectService) assemblePrivateObject(
	ctx context.Context,
	storageKey string,
	parts []dbmodel.SocialPrivateObjectChunk,
) error {
	reader, writer := io.Pipe()
	copyResult := make(chan error, 1)
	go func() {
		var copyErr error
		defer func() {
			_ = writer.CloseWithError(copyErr)
			copyResult <- copyErr
		}()
		for _, part := range parts {
			var partReader io.ReadCloser
			partReader, _, copyErr = s.blobs.Open(
				ctx,
				part.StorageKey,
				-1,
				-1,
			)
			if copyErr != nil {
				return
			}
			var copied int64
			copied, copyErr = io.CopyN(writer, partReader, int64(part.Size))
			closeErr := partReader.Close()
			if copyErr == nil && closeErr != nil {
				copyErr = closeErr
			}
			if copyErr == nil && copied != int64(part.Size) {
				copyErr = errPrivateObjectIntegrity
			}
			if copyErr != nil {
				return
			}
		}
	}()
	saveErr := s.blobs.Save(ctx, storageKey, reader)
	if saveErr != nil {
		_ = reader.CloseWithError(saveErr)
	}
	copyErr := <-copyResult
	if saveErr != nil {
		return saveErr
	}
	return copyErr
}

func (s *PrivateObjectService) verifyBlob(
	ctx context.Context,
	storageKey string,
	expectedSize uint64,
	expectedSHA256 []byte,
) error {
	size, err := s.blobs.Stat(ctx, storageKey)
	if err != nil {
		return err
	}
	if size != int64(expectedSize) {
		return errPrivateObjectIntegrity
	}
	reader, totalSize, err := s.blobs.Open(ctx, storageKey, -1, -1)
	if err != nil {
		return err
	}
	hash := sha256.New()
	read, copyErr := io.Copy(
		hash,
		io.LimitReader(reader, int64(expectedSize)+1),
	)
	closeErr := reader.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if totalSize != int64(expectedSize) ||
		read != int64(expectedSize) ||
		!bytes.Equal(hash.Sum(nil), expectedSHA256) {
		return errPrivateObjectIntegrity
	}
	return nil
}

func decodePrivateObjectSpec(
	upload dbmodel.SocialPrivateObjectUpload,
) (*securecontentpb.EncryptedObjectUploadSpec, error) {
	actualHash := sha256.Sum256(upload.UploadSpecBytes)
	if !bytes.Equal(actualHash[:], upload.UploadSpecSHA256) {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			"social.private_object.decode_spec",
			"upload_spec",
			"hash does not match persisted bytes",
		)
	}
	var spec securecontentpb.EncryptedObjectUploadSpec
	if err := proto.Unmarshal(upload.UploadSpecBytes, &spec); err != nil {
		return nil, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			"social.private_object.decode_spec",
			err,
		)
	}
	return &spec, nil
}

func decodePrivateObjectCompleteReplay(
	upload dbmodel.SocialPrivateObjectUpload,
	operation string,
) (*securecontentpb.CompleteEncryptedObjectUploadResponse, error) {
	actualHash := sha256.Sum256(upload.CompleteResponseBytes)
	if len(upload.CompleteResponseBytes) == 0 ||
		!bytes.Equal(actualHash[:], upload.CompleteResponseSHA256) {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"complete_response",
			"does not match its durable hash",
		)
	}
	var response securecontentpb.CompleteEncryptedObjectUploadResponse
	if err := proto.Unmarshal(upload.CompleteResponseBytes, &response); err != nil {
		return nil, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	response.State = privateObjectTransferState(upload.State)
	response.ExactReplay = true
	return &response, nil
}

func privateObjectTerminalCompleteResponse(
	exactReplay bool,
) *securecontentpb.CompleteEncryptedObjectUploadResponse {
	return &securecontentpb.CompleteEncryptedObjectUploadResponse{
		State:       securecontentpb.EncryptedObjectTransferState_ENCRYPTED_OBJECT_TRANSFER_STATE_TERMINAL_CORRUPT,
		ExactReplay: exactReplay,
	}
}

func privateObjectBeginResponse(
	upload dbmodel.SocialPrivateObjectUpload,
	exactReplay bool,
) *securecontentpb.BeginEncryptedObjectUploadResponse {
	return &securecontentpb.BeginEncryptedObjectUploadResponse{
		UploadId:            upload.UploadID,
		Generation:          upload.Generation,
		State:               privateObjectTransferState(upload.State),
		ReceivedChunkBitmap: clonePrivateBytes(upload.ReceivedChunkBitmap),
		ExpiresAt:           timestamppb.New(upload.ExpiresAt),
		ExactReplay:         exactReplay,
	}
}

func privateObjectPartResponse(
	upload dbmodel.SocialPrivateObjectUpload,
	chunkIndex uint32,
	exactReplay bool,
) *securecontentpb.PutEncryptedObjectChunkResponse {
	return &securecontentpb.PutEncryptedObjectChunkResponse{
		UploadId:            upload.UploadID,
		Generation:          upload.Generation,
		ChunkIndex:          chunkIndex,
		State:               privateObjectTransferState(upload.State),
		ReceivedChunkBitmap: clonePrivateBytes(upload.ReceivedChunkBitmap),
		ExactReplay:         exactReplay,
	}
}

func privateObjectTransferState(
	state string,
) securecontentpb.EncryptedObjectTransferState {
	switch state {
	case dbmodel.SocialPrivateObjectCreated:
		return securecontentpb.EncryptedObjectTransferState_ENCRYPTED_OBJECT_TRANSFER_STATE_CREATED
	case dbmodel.SocialPrivateObjectReceivingParts:
		return securecontentpb.EncryptedObjectTransferState_ENCRYPTED_OBJECT_TRANSFER_STATE_RECEIVING_PARTS
	case dbmodel.SocialPrivateObjectVerifying:
		return securecontentpb.EncryptedObjectTransferState_ENCRYPTED_OBJECT_TRANSFER_STATE_VERIFYING
	case dbmodel.SocialPrivateObjectCompleteUnattached:
		return securecontentpb.EncryptedObjectTransferState_ENCRYPTED_OBJECT_TRANSFER_STATE_COMPLETE_UNATTACHED
	case dbmodel.SocialPrivateObjectAttached:
		return securecontentpb.EncryptedObjectTransferState_ENCRYPTED_OBJECT_TRANSFER_STATE_ATTACHED
	case dbmodel.SocialPrivateObjectCancelled:
		return securecontentpb.EncryptedObjectTransferState_ENCRYPTED_OBJECT_TRANSFER_STATE_CANCELLED
	case dbmodel.SocialPrivateObjectExpired:
		return securecontentpb.EncryptedObjectTransferState_ENCRYPTED_OBJECT_TRANSFER_STATE_EXPIRED
	case dbmodel.SocialPrivateObjectTerminalCorrupt:
		return securecontentpb.EncryptedObjectTransferState_ENCRYPTED_OBJECT_TRANSFER_STATE_TERMINAL_CORRUPT
	case dbmodel.SocialPrivateObjectGCClaimed:
		return securecontentpb.EncryptedObjectTransferState_ENCRYPTED_OBJECT_TRANSFER_STATE_GC_CLAIMED
	case dbmodel.SocialPrivateObjectGarbageCollected:
		return securecontentpb.EncryptedObjectTransferState_ENCRYPTED_OBJECT_TRANSFER_STATE_GARBAGE_COLLECTED
	case dbmodel.SocialPrivateObjectRetryWait:
		return securecontentpb.EncryptedObjectTransferState_ENCRYPTED_OBJECT_TRANSFER_STATE_RETRY_WAIT
	case dbmodel.SocialPrivateObjectCleanupFailed:
		return securecontentpb.EncryptedObjectTransferState_ENCRYPTED_OBJECT_TRANSFER_STATE_CLEANUP_FAILED
	default:
		return securecontentpb.EncryptedObjectTransferState_ENCRYPTED_OBJECT_TRANSFER_STATE_UNSPECIFIED
	}
}

func normalizePrivateObjectRange(
	start int64,
	end int64,
	totalSize uint64,
) (int64, int64, error) {
	if start < 0 {
		return -1, -1, nil
	}
	if totalSize == 0 ||
		uint64(start) >= totalSize ||
		(end >= 0 && (end < start || uint64(end) >= totalSize)) {
		return 0, 0, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			"social.private_object.range",
			"range",
			"is not satisfiable",
		)
	}
	if end < 0 {
		end = int64(totalSize) - 1
	}
	return start, end, nil
}

func mapPrivateObjectStoreError(operation string, err error) error {
	if socialdomain.PrivateContentCodeOf(err) != "" {
		return err
	}
	switch {
	case errors.Is(err, infrastructure.ErrPrivateContentNotFound):
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentNotFound,
			operation,
			"object",
			"was not found",
		)
	case errors.Is(err, infrastructure.ErrPrivateContentConflict):
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentConflict,
			operation,
			err,
		)
	case errors.Is(err, infrastructure.ErrPrivateContentInvalid),
		errors.Is(err, infrastructure.ErrPrivateContentInvalidState):
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentConflict,
			operation,
			err,
		)
	case errors.Is(err, infrastructure.ErrPrivateObjectRetry):
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentDependency,
			operation,
			err,
		)
	default:
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentInternal,
			operation,
			err,
		)
	}
}

func objectStorageOrIntegrityError(operation string, err error) error {
	if errors.Is(err, errPrivateObjectIntegrity) {
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	return socialdomain.WrapPrivateContentError(
		socialdomain.PrivateContentDependency,
		operation,
		err,
	)
}

func privateObjectTransitionPersistenceError(
	operation string,
	primary error,
	transition error,
) error {
	return socialdomain.WrapPrivateContentError(
		socialdomain.PrivateContentDependency,
		operation,
		errors.Join(
			primary,
			fmt.Errorf("persist object state transition: %w", transition),
		),
	)
}

func privateObjectOpaqueID(domain string, values ...string) string {
	hash := sha256.New()
	_, _ = hash.Write([]byte("peers-touch:social-private-object:" + domain))
	for _, value := range values {
		_, _ = hash.Write([]byte{0})
		_, _ = hash.Write([]byte(value))
	}
	return hex.EncodeToString(hash.Sum(nil))
}

func privateObjectStorageKey(domain string, values ...string) string {
	opaque := privateObjectOpaqueID(domain, values...)
	return "social-private/" + domain + "/" + opaque[:2] + "/" + opaque
}

func clonePrivateBytes(value []byte) []byte {
	return append([]byte(nil), value...)
}
