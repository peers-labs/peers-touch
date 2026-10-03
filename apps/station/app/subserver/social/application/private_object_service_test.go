package application

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"

	securecontentkernel "github.com/peers-labs/peers-touch/station/app/internal/securecontent"
	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
)

func TestPrivateObjectServiceImageUploadAttachAndRead(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	objectService := newPrivateObjectTestService(t, fixture)
	ctx := context.Background()
	prepareRequest := privateMomentPrepareRequest(
		"prepare-image",
		"content-image",
	)
	prepareRequest.Kind =
		privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_IMAGE
	prepareRequest.ObjectCount = 1
	prepared, err := fixture.service.PreparePrivateMoment(
		ctx,
		fixture.author,
		prepareRequest,
	)
	if err != nil {
		t.Fatal(err)
	}

	body := bytes.Repeat([]byte{0x42}, 32)
	objectID := prepared.GetPlan().GetObjectIds()[0]
	beginRequest := privateObjectBeginRequest(
		t,
		prepared.GetPlan(),
		objectID,
		body,
		"begin-image",
	)
	begun, err := objectService.Begin(
		ctx,
		fixture.author.Endpoint,
		beginRequest,
	)
	if err != nil {
		t.Fatal(err)
	}
	if begun.GetExactReplay() ||
		begun.GetState() !=
			securecontentpb.EncryptedObjectTransferState_ENCRYPTED_OBJECT_TRANSFER_STATE_CREATED {
		t.Fatalf("unexpected begin response: %+v", begun)
	}
	replayedBegin, err := objectService.Begin(
		ctx,
		fixture.author.Endpoint,
		proto.Clone(beginRequest).(*securecontentpb.BeginEncryptedObjectUploadRequest),
	)
	if err != nil {
		t.Fatal(err)
	}
	if !replayedBegin.GetExactReplay() ||
		replayedBegin.GetUploadId() != begun.GetUploadId() {
		t.Fatalf("unexpected begin replay: %+v", replayedBegin)
	}

	bodyHash := sha256.Sum256(body)
	partCommand := PrivateObjectChunk{
		UploadID:         begun.GetUploadId(),
		Generation:       begun.GetGeneration(),
		ChunkIndex:       0,
		Offset:           0,
		Size:             uint64(len(body)),
		CiphertextSHA256: bodyHash[:],
		IdempotencyKey:   "chunk-image-0",
		Body:             body,
	}
	part, err := objectService.PutChunk(
		ctx,
		fixture.author.Endpoint,
		partCommand,
	)
	if err != nil {
		t.Fatal(err)
	}
	if part.GetExactReplay() ||
		len(part.GetReceivedChunkBitmap()) != 1 ||
		part.GetReceivedChunkBitmap()[0] != 1 {
		t.Fatalf("unexpected part response: %+v", part)
	}
	partReplay, err := objectService.PutChunk(
		ctx,
		fixture.author.Endpoint,
		partCommand,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !partReplay.GetExactReplay() {
		t.Fatal("identical object chunk replay was not exact")
	}
	status, err := objectService.Status(
		ctx,
		fixture.author.Endpoint,
		&securecontentpb.GetEncryptedObjectUploadRequest{
			UploadId:   begun.GetUploadId(),
			Generation: begun.GetGeneration(),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if status.GetReceivedChunkBitmap()[0] != 1 {
		t.Fatalf("status bitmap = %v", status.GetReceivedChunkBitmap())
	}

	completeRequest := &securecontentpb.CompleteEncryptedObjectUploadRequest{
		UploadId:   begun.GetUploadId(),
		Generation: begun.GetGeneration(),
		DescriptorCommitmentSha256: clonePrivateTestBytes(
			beginRequest.GetDescriptorCommitmentSha256(),
		),
		CommandId: "complete-image",
	}
	completed, err := objectService.Complete(
		ctx,
		fixture.author.Endpoint,
		completeRequest,
	)
	if err != nil {
		t.Fatal(err)
	}
	if completed.GetState() !=
		securecontentpb.EncryptedObjectTransferState_ENCRYPTED_OBJECT_TRANSFER_STATE_COMPLETE_UNATTACHED {
		t.Fatalf("unexpected complete response: %+v", completed)
	}
	completedReplay, err := objectService.Complete(
		ctx,
		fixture.author.Endpoint,
		proto.Clone(completeRequest).(*securecontentpb.CompleteEncryptedObjectUploadRequest),
	)
	if err != nil {
		t.Fatal(err)
	}
	if !completedReplay.GetExactReplay() ||
		!proto.Equal(
			completed.GetDescriptor_(),
			completedReplay.GetDescriptor_(),
		) {
		t.Fatalf("unexpected complete replay: %+v", completedReplay)
	}

	submit := privateImageSubmitRequest(
		t,
		prepared.GetPlan(),
		fixture.author.Endpoint,
		fixture.authorPrivateKey,
		"submit-image",
		"image-caption",
		completed.GetDescriptor_(),
	)
	created, err := fixture.service.SubmitPrivateMoment(
		ctx,
		fixture.author.Endpoint,
		submit,
	)
	if err != nil {
		t.Fatal(err)
	}
	if created.GetPost().GetPrivateContent() == nil {
		t.Fatalf("IMAGE submit response = %+v", created)
	}
	var persisted dbmodel.SocialPrivateObjectAttachment
	if err := fixture.database.First(
		&persisted,
		"object_id = ?",
		objectID,
	).Error; err != nil {
		t.Fatal(err)
	}
	if persisted.State != dbmodel.SocialPrivateObjectAttached ||
		persisted.DomainCommitID == "" {
		t.Fatalf("object was not attached in submit UOW: %+v", persisted)
	}
	var persistedUpload dbmodel.SocialPrivateObjectUpload
	if err := fixture.database.Where(
		"upload_id = ? AND generation = ?",
		begun.GetUploadId(),
		begun.GetGeneration(),
	).Take(&persistedUpload).Error; err != nil {
		t.Fatal(err)
	}
	if persistedUpload.State != dbmodel.SocialPrivateObjectAttached {
		t.Fatalf(
			"attached object upload remained active: %+v",
			persistedUpload,
		)
	}
	latePartReplay, err := objectService.PutChunk(
		ctx,
		fixture.author.Endpoint,
		partCommand,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !latePartReplay.GetExactReplay() ||
		latePartReplay.GetState() !=
			securecontentpb.EncryptedObjectTransferState_ENCRYPTED_OBJECT_TRANSFER_STATE_ATTACHED {
		t.Fatalf("late attached chunk replay = %+v", latePartReplay)
	}

	descriptorHash, err := securecontentkernel.DescriptorSHA256(
		completed.GetDescriptor_(),
		securecontentkernel.DefaultPolicy(),
	)
	if err != nil {
		t.Fatal(err)
	}
	bob := &actormodel.ActorDeviceRef{
		Actor: &actormodel.ActorRef{
			Ptid: "ptid:bob",
			Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
		},
		DeviceId: "bob-recovered-device",
	}
	full, err := objectService.Download(
		ctx,
		bob,
		objectID,
		descriptorHash[:],
		-1,
		-1,
	)
	if err != nil {
		t.Fatal(err)
	}
	fullBody, err := io.ReadAll(full.Body)
	if err != nil {
		t.Fatal(err)
	}
	if err := full.Body.Close(); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(fullBody, body) {
		t.Fatalf("full object body = %x", fullBody)
	}
	partial, err := objectService.Download(
		ctx,
		bob,
		objectID,
		descriptorHash[:],
		3,
		9,
	)
	if err != nil {
		t.Fatal(err)
	}
	partialBody, err := io.ReadAll(partial.Body)
	if err != nil {
		t.Fatal(err)
	}
	if err := partial.Body.Close(); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(partialBody, body[3:10]) {
		t.Fatalf("partial object body = %x", partialBody)
	}

	_, err = objectService.Download(
		ctx,
		&actormodel.ActorDeviceRef{
			Actor: &actormodel.ActorRef{
				Ptid: "ptid:eve",
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			},
			DeviceId: "eve-device",
		},
		objectID,
		descriptorHash[:],
		-1,
		-1,
	)
	if !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentNotFound,
	) {
		t.Fatalf("unauthorized object read error = %v", err)
	}
}

func TestPrivateObjectDownloadDistinguishesEndpointFailure(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	objectService := newPrivateObjectTestService(t, fixture)
	viewer := &actormodel.ActorDeviceRef{
		Actor: &actormodel.ActorRef{
			Ptid: "ptid:bob",
			Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
		},
		DeviceId: "bob-device",
	}
	tests := []struct {
		name       string
		validation error
		wantCode   socialdomain.PrivateContentErrorCode
	}{
		{
			name:       "proven inactive endpoint stays private",
			validation: ErrPrivateContentInactiveEndpoint,
			wantCode:   socialdomain.PrivateContentNotFound,
		},
		{
			name:       "directory outage remains dependency failure",
			validation: errors.New("endpoint directory unavailable"),
			wantCode:   socialdomain.PrivateContentDependency,
		},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			objectService.endpoints = privateObjectEndpointDirectoryFunc(
				func(
					context.Context,
					*actormodel.ActorDeviceRef,
				) error {
					return testCase.validation
				},
			)
			download, err := objectService.Download(
				context.Background(),
				viewer,
				strings.Repeat("a", 64),
				bytes.Repeat([]byte{0x01}, sha256.Size),
				-1,
				-1,
			)
			if download.Body != nil {
				_ = download.Body.Close()
				t.Fatal("endpoint validation exposed an object body")
			}
			if !socialdomain.IsPrivateContentCode(err, testCase.wantCode) {
				t.Fatalf(
					"endpoint validation error = %v, want %s",
					err,
					testCase.wantCode,
				)
			}
		})
	}
}

func TestPrivateObjectServiceCompletesTenObjectPlanSequentially(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	objectService := newPrivateObjectTestService(t, fixture)
	ctx := context.Background()
	prepare := privateMomentPrepareRequest(
		"prepare-ten-images",
		"content-ten-images",
	)
	prepare.Kind = privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_IMAGE
	prepare.ObjectCount = securecontentkernel.MaximumObjectsPerResource
	prepared, err := fixture.service.PreparePrivateMoment(
		ctx,
		fixture.author,
		prepare,
	)
	if err != nil {
		t.Fatal(err)
	}

	for index, objectID := range prepared.GetPlan().GetObjectIds() {
		body := bytes.Repeat([]byte{byte(index + 1)}, 32)
		beginRequest := privateObjectBeginRequest(
			t,
			prepared.GetPlan(),
			objectID,
			body,
			fmt.Sprintf("begin-ten-images-%d", index),
		)
		begun, err := objectService.Begin(
			ctx,
			fixture.author.Endpoint,
			beginRequest,
		)
		if err != nil {
			t.Fatalf("begin object %d: %v", index, err)
		}
		bodyHash := sha256.Sum256(body)
		if _, err := objectService.PutChunk(
			ctx,
			fixture.author.Endpoint,
			PrivateObjectChunk{
				UploadID:         begun.GetUploadId(),
				Generation:       begun.GetGeneration(),
				ChunkIndex:       0,
				Offset:           0,
				Size:             uint64(len(body)),
				CiphertextSHA256: bodyHash[:],
				IdempotencyKey: fmt.Sprintf(
					"chunk-ten-images-%d",
					index,
				),
				Body: body,
			},
		); err != nil {
			t.Fatalf("put object %d: %v", index, err)
		}
		completed, err := objectService.Complete(
			ctx,
			fixture.author.Endpoint,
			&securecontentpb.CompleteEncryptedObjectUploadRequest{
				UploadId:   begun.GetUploadId(),
				Generation: begun.GetGeneration(),
				DescriptorCommitmentSha256: clonePrivateTestBytes(
					beginRequest.GetDescriptorCommitmentSha256(),
				),
				CommandId: fmt.Sprintf(
					"complete-ten-images-%d",
					index,
				),
			},
		)
		if err != nil {
			t.Fatalf("complete object %d: %v", index, err)
		}
		if completed.GetState() !=
			securecontentpb.EncryptedObjectTransferState_ENCRYPTED_OBJECT_TRANSFER_STATE_COMPLETE_UNATTACHED {
			t.Fatalf("complete object %d response = %+v", index, completed)
		}
	}
}

func TestPrivateObjectVerificationRespectsBackoffAndAttemptLimit(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	objectService := newPrivateObjectTestService(t, fixture)
	ctx := context.Background()
	prepare := privateMomentPrepareRequest(
		"prepare-verification-bound",
		"content-verification-bound",
	)
	prepare.Kind = privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_IMAGE
	prepare.ObjectCount = 1
	prepared, err := fixture.service.PreparePrivateMoment(
		ctx,
		fixture.author,
		prepare,
	)
	if err != nil {
		t.Fatal(err)
	}
	body := bytes.Repeat([]byte{0x29}, 32)
	beginRequest := privateObjectBeginRequest(
		t,
		prepared.GetPlan(),
		prepared.GetPlan().GetObjectIds()[0],
		body,
		"begin-verification-bound",
	)
	begun, err := objectService.Begin(
		ctx,
		fixture.author.Endpoint,
		beginRequest,
	)
	if err != nil {
		t.Fatal(err)
	}
	bodyHash := sha256.Sum256(body)
	if _, err := objectService.PutChunk(
		ctx,
		fixture.author.Endpoint,
		PrivateObjectChunk{
			UploadID:         begun.GetUploadId(),
			Generation:       begun.GetGeneration(),
			ChunkIndex:       0,
			Offset:           0,
			Size:             uint64(len(body)),
			CiphertextSHA256: bodyHash[:],
			IdempotencyKey:   "chunk-verification-bound",
			Body:             body,
		},
	); err != nil {
		t.Fatal(err)
	}
	complete := &securecontentpb.CompleteEncryptedObjectUploadRequest{
		UploadId:   begun.GetUploadId(),
		Generation: begun.GetGeneration(),
		DescriptorCommitmentSha256: clonePrivateTestBytes(
			beginRequest.GetDescriptorCommitmentSha256(),
		),
		CommandId: "complete-verification-bound",
	}
	nextAttempt := fixture.clock.now.Add(time.Minute)
	if err := fixture.database.Model(
		&dbmodel.SocialPrivateObjectUpload{},
	).Where(
		"upload_id = ? AND generation = ?",
		begun.GetUploadId(),
		begun.GetGeneration(),
	).Updates(map[string]any{
		"verification_attempts":        1,
		"verification_next_attempt_at": nextAttempt,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := objectService.Complete(
		ctx,
		fixture.author.Endpoint,
		complete,
	); !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentDependency,
	) {
		t.Fatalf("verification backoff error = %v", err)
	}
	if err := fixture.database.Model(
		&dbmodel.SocialPrivateObjectUpload{},
	).Where(
		"upload_id = ? AND generation = ?",
		begun.GetUploadId(),
		begun.GetGeneration(),
	).Updates(map[string]any{
		"verification_attempts":        securecontentkernel.MaximumVerificationAttemptCount,
		"verification_next_attempt_at": nil,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := objectService.Complete(
		ctx,
		fixture.author.Endpoint,
		complete,
	); !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentConflict,
	) {
		t.Fatalf("verification attempt limit error = %v", err)
	}
}

func TestPrivateObjectCompleteSurfacesRetryTransitionFailure(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	objectService := newPrivateObjectTestService(t, fixture)
	ctx := context.Background()
	prepare := privateMomentPrepareRequest(
		"prepare-transition-failure",
		"content-transition-failure",
	)
	prepare.Kind = privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_IMAGE
	prepare.ObjectCount = 1
	prepared, err := fixture.service.PreparePrivateMoment(
		ctx,
		fixture.author,
		prepare,
	)
	if err != nil {
		t.Fatal(err)
	}
	body := bytes.Repeat([]byte{0x67}, 32)
	beginRequest := privateObjectBeginRequest(
		t,
		prepared.GetPlan(),
		prepared.GetPlan().GetObjectIds()[0],
		body,
		"begin-transition-failure",
	)
	begun, err := objectService.Begin(
		ctx,
		fixture.author.Endpoint,
		beginRequest,
	)
	if err != nil {
		t.Fatal(err)
	}
	bodyHash := sha256.Sum256(body)
	if _, err := objectService.PutChunk(
		ctx,
		fixture.author.Endpoint,
		PrivateObjectChunk{
			UploadID:         begun.GetUploadId(),
			Generation:       begun.GetGeneration(),
			ChunkIndex:       0,
			Offset:           0,
			Size:             uint64(len(body)),
			CiphertextSHA256: bodyHash[:],
			IdempotencyKey:   "chunk-transition-failure",
			Body:             body,
		},
	); err != nil {
		t.Fatal(err)
	}
	transitionFailure := errors.New("persist retry transition")
	objectService.store = &privateObjectTransitionFailureStore{
		PrivateObjectStore: fixture.store,
		retryError:         transitionFailure,
	}
	objectService.blobs = &privateObjectOpenFailureStore{
		PrivateObjectBlobStore: objectService.blobs,
		openError:              errors.New("storage unavailable"),
	}

	_, err = objectService.Complete(
		ctx,
		fixture.author.Endpoint,
		&securecontentpb.CompleteEncryptedObjectUploadRequest{
			UploadId:   begun.GetUploadId(),
			Generation: begun.GetGeneration(),
			DescriptorCommitmentSha256: clonePrivateTestBytes(
				beginRequest.GetDescriptorCommitmentSha256(),
			),
			CommandId: "complete-transition-failure",
		},
	)
	if !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentDependency,
	) || !errors.Is(err, transitionFailure) {
		t.Fatalf("transition persistence error = %v", err)
	}
}

func TestPrivateObjectCorruptCompleteReplaysDurableTerminalOutcome(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	objectService := newPrivateObjectTestService(t, fixture)
	ctx := context.Background()
	prepare := privateMomentPrepareRequest(
		"prepare-corrupt-complete",
		"content-corrupt-complete",
	)
	prepare.Kind = privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_IMAGE
	prepare.ObjectCount = 1
	prepared, err := fixture.service.PreparePrivateMoment(
		ctx,
		fixture.author,
		prepare,
	)
	if err != nil {
		t.Fatal(err)
	}
	body := bytes.Repeat([]byte{0x71}, 32)
	beginRequest := privateObjectBeginRequest(
		t,
		prepared.GetPlan(),
		prepared.GetPlan().GetObjectIds()[0],
		body,
		"begin-corrupt-complete",
	)
	begun, err := objectService.Begin(
		ctx,
		fixture.author.Endpoint,
		beginRequest,
	)
	if err != nil {
		t.Fatal(err)
	}
	bodyHash := sha256.Sum256(body)
	if _, err := objectService.PutChunk(
		ctx,
		fixture.author.Endpoint,
		PrivateObjectChunk{
			UploadID:         begun.GetUploadId(),
			Generation:       begun.GetGeneration(),
			ChunkIndex:       0,
			Offset:           0,
			Size:             uint64(len(body)),
			CiphertextSHA256: bodyHash[:],
			IdempotencyKey:   "chunk-corrupt-complete",
			Body:             body,
		},
	); err != nil {
		t.Fatal(err)
	}
	objectService.blobs = &privateObjectCorruptOpenStore{
		PrivateObjectBlobStore: objectService.blobs,
	}
	complete := &securecontentpb.CompleteEncryptedObjectUploadRequest{
		UploadId:   begun.GetUploadId(),
		Generation: begun.GetGeneration(),
		DescriptorCommitmentSha256: clonePrivateTestBytes(
			beginRequest.GetDescriptorCommitmentSha256(),
		),
		CommandId: "complete-corrupt-complete",
	}
	terminal, err := objectService.Complete(
		ctx,
		fixture.author.Endpoint,
		complete,
	)
	if err != nil {
		t.Fatal(err)
	}
	if terminal.GetExactReplay() ||
		terminal.GetState() !=
			securecontentpb.EncryptedObjectTransferState_ENCRYPTED_OBJECT_TRANSFER_STATE_TERMINAL_CORRUPT {
		t.Fatalf("terminal response = %+v", terminal)
	}
	replay, err := objectService.Complete(
		ctx,
		fixture.author.Endpoint,
		proto.Clone(complete).(*securecontentpb.CompleteEncryptedObjectUploadRequest),
	)
	if err != nil {
		t.Fatal(err)
	}
	if !replay.GetExactReplay() ||
		replay.GetState() !=
			securecontentpb.EncryptedObjectTransferState_ENCRYPTED_OBJECT_TRANSFER_STATE_TERMINAL_CORRUPT {
		t.Fatalf("terminal replay = %+v", replay)
	}
	if cleaned, err := objectService.CleanupUnattached(ctx); err != nil {
		t.Fatal(err)
	} else if cleaned != 1 {
		t.Fatalf("terminal cleanup count = %d, want 1", cleaned)
	}
	replay, err = objectService.Complete(
		ctx,
		fixture.author.Endpoint,
		proto.Clone(complete).(*securecontentpb.CompleteEncryptedObjectUploadRequest),
	)
	if err != nil {
		t.Fatal(err)
	}
	if !replay.GetExactReplay() ||
		replay.GetState() !=
			securecontentpb.EncryptedObjectTransferState_ENCRYPTED_OBJECT_TRANSFER_STATE_GARBAGE_COLLECTED {
		t.Fatalf("terminal tombstone replay = %+v", replay)
	}
}

func TestPrivateObjectBeginRejectsForgedPersistedPlan(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	objectService := newPrivateObjectTestService(t, fixture)
	ctx := context.Background()
	prepare := privateMomentPrepareRequest(
		"prepare-forged-object-plan",
		"content-forged-object-plan",
	)
	prepare.Kind = privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_IMAGE
	prepare.ObjectCount = 1
	prepared, err := fixture.service.PreparePrivateMoment(
		ctx,
		fixture.author,
		prepare,
	)
	if err != nil {
		t.Fatal(err)
	}

	forgedPlan := proto.Clone(
		prepared.GetPlan(),
	).(*securecontentpb.ContentEncryptionPlan)
	forgedObjectID := deterministicPrivateID(
		"object",
		forgedPlan.GetPlanId(),
		"forged",
	)
	forgedPlan.ObjectIds = []string{forgedObjectID}
	planHash, err := socialdomain.CanonicalEncryptionPlanHash(forgedPlan)
	if err != nil {
		t.Fatal(err)
	}
	forgedPlan.CanonicalPlanSha256 = planHash[:]
	forgedBytes, err := socialdomain.CanonicalProtoBytes(forgedPlan)
	if err != nil {
		t.Fatal(err)
	}
	forgedBytesHash := sha256.Sum256(forgedBytes)
	if err := fixture.database.Model(
		&dbmodel.SocialPrivateContentPlan{},
	).Where(
		"plan_id = ?",
		forgedPlan.GetPlanId(),
	).Updates(map[string]any{
		"signed_plan_bytes":     forgedBytes,
		"signed_plan_sha256":    forgedBytesHash[:],
		"canonical_plan_sha256": planHash[:],
	}).Error; err != nil {
		t.Fatal(err)
	}

	_, err = objectService.Begin(
		ctx,
		fixture.author.Endpoint,
		privateObjectBeginRequest(
			t,
			forgedPlan,
			forgedObjectID,
			bytes.Repeat([]byte{0x71}, 32),
			"begin-forged-object-plan",
		),
	)
	if !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentIntegrityFailed,
	) {
		t.Fatalf("forged persisted plan begin error = %v", err)
	}
	assertPrivateContentCount(
		t,
		fixture.database,
		&dbmodel.SocialPrivateObjectUpload{},
		0,
	)
}

func TestPrivateObjectServiceCancelReplayAndCleanupTombstone(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	objectService := newPrivateObjectTestService(t, fixture)
	ctx := context.Background()
	prepareRequest := privateMomentPrepareRequest(
		"prepare-cancel-image",
		"content-cancel-image",
	)
	prepareRequest.Kind =
		privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_IMAGE
	prepareRequest.ObjectCount = 1
	prepared, err := fixture.service.PreparePrivateMoment(
		ctx,
		fixture.author,
		prepareRequest,
	)
	if err != nil {
		t.Fatal(err)
	}
	body := bytes.Repeat([]byte{0x31}, 32)
	beginRequest := privateObjectBeginRequest(
		t,
		prepared.GetPlan(),
		prepared.GetPlan().GetObjectIds()[0],
		body,
		"begin-cancel-image",
	)
	begun, err := objectService.Begin(
		ctx,
		fixture.author.Endpoint,
		beginRequest,
	)
	if err != nil {
		t.Fatal(err)
	}
	cancel := &securecontentpb.CancelEncryptedObjectUploadRequest{
		UploadId:   begun.GetUploadId(),
		Generation: begun.GetGeneration(),
		CommandId:  "cancel-image",
	}
	cancelled, err := objectService.Cancel(
		ctx,
		fixture.author.Endpoint,
		cancel,
	)
	if err != nil {
		t.Fatal(err)
	}
	if cancelled.GetState() !=
		securecontentpb.EncryptedObjectTransferState_ENCRYPTED_OBJECT_TRANSFER_STATE_CANCELLED {
		t.Fatalf("cancel response = %+v", cancelled)
	}
	if cleaned, err := objectService.CleanupUnattached(ctx); err != nil {
		t.Fatal(err)
	} else if cleaned != 1 {
		t.Fatalf("cleanup count = %d, want 1", cleaned)
	}
	replayed, err := objectService.Cancel(
		ctx,
		fixture.author.Endpoint,
		proto.Clone(cancel).(*securecontentpb.CancelEncryptedObjectUploadRequest),
	)
	if err != nil {
		t.Fatal(err)
	}
	if !replayed.GetExactReplay() ||
		replayed.GetState() !=
			securecontentpb.EncryptedObjectTransferState_ENCRYPTED_OBJECT_TRANSFER_STATE_GARBAGE_COLLECTED {
		t.Fatalf("cancel tombstone replay = %+v", replayed)
	}
	conflict := proto.Clone(cancel).(*securecontentpb.CancelEncryptedObjectUploadRequest)
	conflict.CommandId = "cancel-image-conflict"
	_, err = objectService.Cancel(
		ctx,
		fixture.author.Endpoint,
		conflict,
	)
	if !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentConflict,
	) {
		t.Fatalf("cancel conflict error = %v", err)
	}
}

func TestPrivateObjectStoredPartCannotResurrectCancelledUpload(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	objectService := newPrivateObjectTestService(t, fixture)
	ctx := context.Background()
	prepare := privateMomentPrepareRequest(
		"prepare-cancel-write-race",
		"content-cancel-write-race",
	)
	prepare.Kind = privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_IMAGE
	prepare.ObjectCount = 1
	prepared, err := fixture.service.PreparePrivateMoment(
		ctx,
		fixture.author,
		prepare,
	)
	if err != nil {
		t.Fatal(err)
	}
	body := bytes.Repeat([]byte{0x39}, 32)
	begun, err := objectService.Begin(
		ctx,
		fixture.author.Endpoint,
		privateObjectBeginRequest(
			t,
			prepared.GetPlan(),
			prepared.GetPlan().GetObjectIds()[0],
			body,
			"begin-cancel-write-race",
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	bodyHash := sha256.Sum256(body)
	commandHash, err := socialdomain.CanonicalPrivateObjectChunkCommand(
		begun.GetUploadId(),
		begun.GetGeneration(),
		0,
		0,
		uint64(len(body)),
		bodyHash[:],
		"chunk-cancel-write-race",
	)
	if err != nil {
		t.Fatal(err)
	}
	staged, err := fixture.store.StagePrivateObjectPart(
		ctx,
		infrastructure.PrivateObjectPartCommand{
			UploadID:             begun.GetUploadId(),
			Generation:           begun.GetGeneration(),
			ChunkIndex:           0,
			UploaderPTID:         fixture.author.Endpoint.GetActor().GetPtid(),
			UploaderDeviceID:     fixture.author.Endpoint.GetDeviceId(),
			Offset:               0,
			Size:                 uint64(len(body)),
			CiphertextSHA256:     bodyHash[:],
			IdempotencyKey:       "chunk-cancel-write-race",
			CanonicalCommandHash: commandHash[:],
			LeaseOwner:           "part-writer",
			LeaseDuration: securecontentkernel.MaximumUploadTTL +
				time.Minute,
			Now:                   fixture.clock.now,
			DeterministicStoreKey: "social-private/parts/race",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	cancelRequest := &securecontentpb.CancelEncryptedObjectUploadRequest{
		UploadId:   begun.GetUploadId(),
		Generation: begun.GetGeneration(),
		CommandId:  "cancel-write-race",
	}
	if _, err := objectService.Cancel(
		ctx,
		fixture.author.Endpoint,
		cancelRequest,
	); !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentDependency,
	) {
		t.Fatalf("cancel during active part lease error = %v", err)
	}
	fixture.clock.now = begun.GetExpiresAt().AsTime().Add(time.Second)
	if cleaned, err := objectService.CleanupUnattached(ctx); err != nil {
		t.Fatal(err)
	} else if cleaned != 0 {
		t.Fatalf(
			"cleanup claimed upload with active part writer: %d",
			cleaned,
		)
	}
	var expired dbmodel.SocialPrivateObjectUpload
	if err := fixture.database.Where(
		"upload_id = ? AND generation = ?",
		begun.GetUploadId(),
		begun.GetGeneration(),
	).Take(&expired).Error; err != nil {
		t.Fatal(err)
	}
	if expired.State != dbmodel.SocialPrivateObjectExpired {
		t.Fatalf("active-writer expiry state = %+v", expired)
	}
	fixture.clock.now = staged.Part.LeaseExpiresAt.Add(time.Second)
	if cleaned, err := objectService.CleanupUnattached(ctx); err != nil {
		t.Fatal(err)
	} else if cleaned != 1 {
		t.Fatalf("cleanup after part lease expiry = %d, want 1", cleaned)
	}
	if _, err := fixture.store.MarkPrivateObjectPartStored(
		ctx,
		begun.GetUploadId(),
		begun.GetGeneration(),
		0,
		staged.Part.LeaseOwner,
		staged.Part.LeaseEpoch,
		fixture.clock.now,
	); !errors.Is(err, infrastructure.ErrPrivateContentInvalidState) {
		t.Fatalf("late stored-part completion error = %v", err)
	}
	var upload dbmodel.SocialPrivateObjectUpload
	if err := fixture.database.Where(
		"upload_id = ? AND generation = ?",
		begun.GetUploadId(),
		begun.GetGeneration(),
	).Take(&upload).Error; err != nil {
		t.Fatal(err)
	}
	if upload.State != dbmodel.SocialPrivateObjectGarbageCollected {
		t.Fatalf("late stored-part completion resurrected upload: %+v", upload)
	}
}

func TestPrivateObjectServiceCleansCompleteUnattached(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	objectService := newPrivateObjectTestService(t, fixture)
	ctx := context.Background()
	prepareRequest := privateMomentPrepareRequest(
		"prepare-cleanup-image",
		"content-cleanup-image",
	)
	prepareRequest.Kind =
		privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_IMAGE
	prepareRequest.ObjectCount = 1
	prepared, err := fixture.service.PreparePrivateMoment(
		ctx,
		fixture.author,
		prepareRequest,
	)
	if err != nil {
		t.Fatal(err)
	}
	body := bytes.Repeat([]byte{0x27}, 32)
	objectID := prepared.GetPlan().GetObjectIds()[0]
	beginRequest := privateObjectBeginRequest(
		t,
		prepared.GetPlan(),
		objectID,
		body,
		"begin-cleanup-image",
	)
	begun, err := objectService.Begin(
		ctx,
		fixture.author.Endpoint,
		beginRequest,
	)
	if err != nil {
		t.Fatal(err)
	}
	bodyHash := sha256.Sum256(body)
	partCommand := PrivateObjectChunk{
		UploadID:         begun.GetUploadId(),
		Generation:       begun.GetGeneration(),
		ChunkIndex:       0,
		Offset:           0,
		Size:             uint64(len(body)),
		CiphertextSHA256: bodyHash[:],
		IdempotencyKey:   "chunk-cleanup-image-0",
		Body:             body,
	}
	if _, err := objectService.PutChunk(
		ctx,
		fixture.author.Endpoint,
		partCommand,
	); err != nil {
		t.Fatal(err)
	}
	completeRequest := &securecontentpb.CompleteEncryptedObjectUploadRequest{
		UploadId:   begun.GetUploadId(),
		Generation: begun.GetGeneration(),
		DescriptorCommitmentSha256: clonePrivateTestBytes(
			beginRequest.GetDescriptorCommitmentSha256(),
		),
		CommandId: "complete-cleanup-image",
	}
	completed, err := objectService.Complete(
		ctx,
		fixture.author.Endpoint,
		completeRequest,
	)
	if err != nil {
		t.Fatal(err)
	}
	fixture.clock.now = fixture.clock.now.Add(
		securecontentkernel.MaximumUnattachedObjectTTL + time.Second,
	)
	cleaned, err := objectService.CleanupUnattached(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if cleaned != 1 {
		t.Fatalf("complete-unattached cleanup count = %d, want 1", cleaned)
	}
	replayed, err := objectService.Complete(
		ctx,
		fixture.author.Endpoint,
		proto.Clone(completeRequest).(*securecontentpb.CompleteEncryptedObjectUploadRequest),
	)
	if err != nil {
		t.Fatal(err)
	}
	if !replayed.GetExactReplay() ||
		replayed.GetState() !=
			securecontentpb.EncryptedObjectTransferState_ENCRYPTED_OBJECT_TRANSFER_STATE_GARBAGE_COLLECTED {
		t.Fatalf("complete cleanup tombstone replay = %+v", replayed)
	}
	partReplay, err := objectService.PutChunk(
		ctx,
		fixture.author.Endpoint,
		partCommand,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !partReplay.GetExactReplay() ||
		partReplay.GetState() !=
			securecontentpb.EncryptedObjectTransferState_ENCRYPTED_OBJECT_TRANSFER_STATE_GARBAGE_COLLECTED {
		t.Fatalf("chunk cleanup tombstone replay = %+v", partReplay)
	}
	submit := privateImageSubmitRequest(
		t,
		prepared.GetPlan(),
		fixture.author.Endpoint,
		fixture.authorPrivateKey,
		"submit-cleaned-image",
		"cleaned-image-caption",
		completed.GetDescriptor_(),
	)
	_, err = fixture.service.SubmitPrivateMoment(
		ctx,
		fixture.author.Endpoint,
		submit,
	)
	if !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentExpiredPlan,
	) {
		t.Fatalf("cleaned object attach error = %v", err)
	}
	assertPrivateContentCount(
		t,
		fixture.database,
		&dbmodel.SocialPrivateContentPost{},
		0,
	)
}

func TestPrivateObjectServicePersistsExpiryBeforeRejectingChunk(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	objectService := newPrivateObjectTestService(t, fixture)
	ctx := context.Background()
	prepare := privateMomentPrepareRequest(
		"prepare-expired-image",
		"content-expired-image",
	)
	prepare.Kind = privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_IMAGE
	prepare.ObjectCount = 1
	prepared, err := fixture.service.PreparePrivateMoment(
		ctx,
		fixture.author,
		prepare,
	)
	if err != nil {
		t.Fatal(err)
	}
	body := bytes.Repeat([]byte{0x52}, 32)
	begun, err := objectService.Begin(
		ctx,
		fixture.author.Endpoint,
		privateObjectBeginRequest(
			t,
			prepared.GetPlan(),
			prepared.GetPlan().GetObjectIds()[0],
			body,
			"begin-expired-image",
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	fixture.clock.now = begun.GetExpiresAt().AsTime().Add(time.Second)
	bodyHash := sha256.Sum256(body)
	_, err = objectService.PutChunk(
		ctx,
		fixture.author.Endpoint,
		PrivateObjectChunk{
			UploadID:         begun.GetUploadId(),
			Generation:       begun.GetGeneration(),
			ChunkIndex:       0,
			Offset:           0,
			Size:             uint64(len(body)),
			CiphertextSHA256: bodyHash[:],
			IdempotencyKey:   "chunk-expired-image-0",
			Body:             body,
		},
	)
	if !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentConflict,
	) {
		t.Fatalf("expired chunk error = %v", err)
	}
	var upload dbmodel.SocialPrivateObjectUpload
	if err := fixture.database.Where(
		"upload_id = ? AND generation = ?",
		begun.GetUploadId(),
		begun.GetGeneration(),
	).Take(&upload).Error; err != nil {
		t.Fatal(err)
	}
	if upload.State != dbmodel.SocialPrivateObjectExpired ||
		upload.CleanupNextAttempt == nil {
		t.Fatalf("expired upload was not durably cleanup-ready: %+v", upload)
	}
	cleaned, err := objectService.CleanupUnattached(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if cleaned != 1 {
		t.Fatalf("expired upload cleanup count = %d, want 1", cleaned)
	}
}

func TestPrivateObjectCleanupPersistsBackgroundExpiryBeforeGC(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	objectService := newPrivateObjectTestService(t, fixture)
	ctx := context.Background()
	prepare := privateMomentPrepareRequest(
		"prepare-background-expiry",
		"content-background-expiry",
	)
	prepare.Kind = privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_IMAGE
	prepare.ObjectCount = 1
	prepared, err := fixture.service.PreparePrivateMoment(
		ctx,
		fixture.author,
		prepare,
	)
	if err != nil {
		t.Fatal(err)
	}
	begun, err := objectService.Begin(
		ctx,
		fixture.author.Endpoint,
		privateObjectBeginRequest(
			t,
			prepared.GetPlan(),
			prepared.GetPlan().GetObjectIds()[0],
			bytes.Repeat([]byte{0x37}, 32),
			"begin-background-expiry",
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	fixture.clock.now = begun.GetExpiresAt().AsTime().Add(time.Second)

	cleaned, err := objectService.CleanupUnattached(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if cleaned != 0 {
		t.Fatalf("first cleanup count = %d, want expiry-only transition", cleaned)
	}
	var expired dbmodel.SocialPrivateObjectUpload
	if err := fixture.database.Where(
		"upload_id = ? AND generation = ?",
		begun.GetUploadId(),
		begun.GetGeneration(),
	).Take(&expired).Error; err != nil {
		t.Fatal(err)
	}
	if expired.State != dbmodel.SocialPrivateObjectExpired ||
		expired.CleanupNextAttempt == nil {
		t.Fatalf("background expiry state = %+v", expired)
	}

	cleaned, err = objectService.CleanupUnattached(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if cleaned != 1 {
		t.Fatalf("second cleanup count = %d, want 1", cleaned)
	}
	var tombstone dbmodel.SocialPrivateObjectUpload
	if err := fixture.database.Where(
		"upload_id = ? AND generation = ?",
		begun.GetUploadId(),
		begun.GetGeneration(),
	).Take(&tombstone).Error; err != nil {
		t.Fatal(err)
	}
	if tombstone.State != dbmodel.SocialPrivateObjectGarbageCollected {
		t.Fatalf("background expiry tombstone = %+v", tombstone)
	}
}

func TestPrivateObjectCleanupReclaimsExpiredLease(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	objectService := newPrivateObjectTestService(t, fixture)
	ctx := context.Background()
	prepare := privateMomentPrepareRequest(
		"prepare-cleanup-lease",
		"content-cleanup-lease",
	)
	prepare.Kind = privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_IMAGE
	prepare.ObjectCount = 1
	prepared, err := fixture.service.PreparePrivateMoment(
		ctx,
		fixture.author,
		prepare,
	)
	if err != nil {
		t.Fatal(err)
	}
	begun, err := objectService.Begin(
		ctx,
		fixture.author.Endpoint,
		privateObjectBeginRequest(
			t,
			prepared.GetPlan(),
			prepared.GetPlan().GetObjectIds()[0],
			bytes.Repeat([]byte{0x63}, 32),
			"begin-cleanup-lease",
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := objectService.Cancel(
		ctx,
		fixture.author.Endpoint,
		&securecontentpb.CancelEncryptedObjectUploadRequest{
			UploadId:   begun.GetUploadId(),
			Generation: begun.GetGeneration(),
			CommandId:  "cancel-cleanup-lease",
		},
	); err != nil {
		t.Fatal(err)
	}
	first, err := fixture.store.ClaimPrivateObjectCleanup(
		ctx,
		"cleanup-worker-a",
		fixture.clock.now,
		time.Minute,
		1,
	)
	if err != nil || len(first) != 1 {
		t.Fatalf("first cleanup claim = %+v, %v", first, err)
	}
	second, err := fixture.store.ClaimPrivateObjectCleanup(
		ctx,
		"cleanup-worker-b",
		fixture.clock.now.Add(time.Minute+time.Second),
		time.Minute,
		1,
	)
	if err != nil || len(second) != 1 {
		t.Fatalf("reclaimed cleanup lease = %+v, %v", second, err)
	}
	if second[0].LeaseOwner != "cleanup-worker-b" ||
		second[0].LeaseEpoch <= first[0].LeaseEpoch {
		t.Fatalf("cleanup lease did not advance: first=%+v second=%+v", first[0], second[0])
	}
}

func TestPrivateContentSubmitChecksExpiryAfterSerializedLock(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	ctx := context.Background()
	prepared, err := fixture.service.PreparePrivateMoment(
		ctx,
		fixture.author,
		privateMomentPrepareRequest(
			"prepare-expiry-contention",
			"content-expiry-contention",
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	submit := privateTextSubmitRequest(
		t,
		prepared.GetPlan(),
		fixture.author.Endpoint,
		fixture.authorPrivateKey,
		"submit-expiry-contention",
		"expiry-contention",
	)
	fixture.clock.now = prepared.GetPlan().GetExpiresAt().
		AsTime().Add(-time.Second)
	preparation, err := fixture.store.LoadSubmitPreparation(
		ctx,
		prepared.GetPlan().GetPlanId(),
		fixture.author.Endpoint.GetActor().GetPtid(),
	)
	if err != nil {
		t.Fatal(err)
	}

	blockingTransaction := fixture.database.Begin()
	if blockingTransaction.Error != nil {
		t.Fatal(blockingTransaction.Error)
	}
	if err := blockingTransaction.Exec(
		"UPDATE social_private_content_plans SET updated_at = updated_at WHERE plan_id = ?",
		prepared.GetPlan().GetPlanId(),
	).Error; err != nil {
		t.Fatal(err)
	}
	entered := make(chan struct{})
	fixture.service.store = &submitEntryBarrierStore{
		PrivateContentStore: fixture.store,
		entered:             entered,
		preparation:         preparation,
	}
	result := make(chan error, 1)
	go func() {
		_, submitErr := fixture.service.SubmitPrivateMoment(
			ctx,
			fixture.author.Endpoint,
			submit,
		)
		result <- submitErr
	}()
	<-entered
	fixture.clock.now = prepared.GetPlan().GetExpiresAt().
		AsTime().Add(time.Second)
	if err := blockingTransaction.Commit().Error; err != nil {
		t.Fatal(err)
	}
	err = <-result
	if !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentExpiredPlan,
	) {
		t.Fatalf("post-lock expiry error = %v", err)
	}
	assertPrivateContentCount(
		t,
		fixture.database,
		&dbmodel.SocialPrivateContentPost{},
		0,
	)
	assertPrivateContentCount(
		t,
		fixture.database,
		&dbmodel.SocialPrivateCommandReceipt{},
		0,
	)
}

type submitEntryBarrierStore struct {
	infrastructure.PrivateContentStore
	entered     chan struct{}
	preparation infrastructure.SubmitPreparation
}

func (s *submitEntryBarrierStore) LoadSubmitPreparation(
	context.Context,
	string,
	string,
) (infrastructure.SubmitPreparation, error) {
	return s.preparation, nil
}

func (s *submitEntryBarrierStore) ExecuteSubmit(
	ctx context.Context,
	command infrastructure.SubmitCommand,
	mutation infrastructure.SubmitMutation,
) (infrastructure.SubmitResult, error) {
	close(s.entered)
	return s.PrivateContentStore.ExecuteSubmit(ctx, command, mutation)
}

type privateObjectTransitionFailureStore struct {
	infrastructure.PrivateObjectStore
	retryError error
}

func (s *privateObjectTransitionFailureStore) RetryPrivateObjectVerification(
	context.Context,
	string,
	uint64,
	string,
	uint64,
	time.Time,
) error {
	return s.retryError
}

type privateObjectOpenFailureStore struct {
	PrivateObjectBlobStore
	openError error
}

func (s *privateObjectOpenFailureStore) Open(
	context.Context,
	string,
	int64,
	int64,
) (io.ReadCloser, int64, error) {
	return nil, 0, s.openError
}

type privateObjectCorruptOpenStore struct {
	PrivateObjectBlobStore
}

type privateObjectEndpointDirectoryFunc func(
	context.Context,
	*actormodel.ActorDeviceRef,
) error

func (f privateObjectEndpointDirectoryFunc) ValidateActiveEndpoint(
	ctx context.Context,
	endpoint *actormodel.ActorDeviceRef,
) error {
	return f(ctx, endpoint)
}

func (s *privateObjectCorruptOpenStore) Open(
	ctx context.Context,
	storageKey string,
	start int64,
	end int64,
) (io.ReadCloser, int64, error) {
	reader, total, err := s.PrivateObjectBlobStore.Open(
		ctx,
		storageKey,
		start,
		end,
	)
	if err != nil {
		return nil, 0, err
	}
	body, err := io.ReadAll(reader)
	closeErr := reader.Close()
	if err != nil {
		return nil, 0, err
	}
	if closeErr != nil {
		return nil, 0, closeErr
	}
	if len(body) != 0 {
		body[0] ^= 0xff
	}
	return io.NopCloser(bytes.NewReader(body)), total, nil
}

func newPrivateObjectTestService(
	t *testing.T,
	fixture *privateContentServiceFixture,
) *PrivateObjectService {
	t.Helper()
	blobs, err := infrastructure.NewPrivateObjectBlobStore(
		storage.NewLocalBackend(t.TempDir()),
	)
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewPrivateObjectService(
		fixture.store,
		blobs,
		privateContentTestRecipients{author: fixture.author.Endpoint},
		fixture.service.stationSigner,
		fixture.clock,
	)
	if err != nil {
		t.Fatal(err)
	}
	return service
}

func privateObjectBeginRequest(
	t *testing.T,
	plan *securecontentpb.ContentEncryptionPlan,
	objectID string,
	body []byte,
	commandID string,
) *securecontentpb.BeginEncryptedObjectUploadRequest {
	t.Helper()
	bodyHash := sha256.Sum256(body)
	spec := &securecontentpb.EncryptedObjectUploadSpec{
		Resource: proto.Clone(
			plan.GetResource(),
		).(*securecontentpb.SecureResourceRef),
		ObjectId:              objectID,
		CiphertextSize:        uint64(len(body)),
		CiphertextSha256:      bodyHash[:],
		ChunkSize:             securecontentkernel.ObjectChunkSize,
		ChunkCount:            1,
		EncryptionSuite:       securecontentkernel.EncryptionSuiteAES256GCMChunked,
		TagSize:               securecontentkernel.AES256GCMTagSize,
		NonceStrategy:         securecontentkernel.NonceStrategyCounter32BE,
		ChunkCiphertextSha256: [][]byte{bodyHash[:]},
	}
	input := &securecontentpb.EncryptedObjectDescriptorCommitmentInput{
		FormatVersion: 1,
		Resource: proto.Clone(
			plan.GetResource(),
		).(*securecontentpb.SecureResourceRef),
		ObjectId:   objectID,
		UploadSpec: spec,
	}
	canonical, err := socialdomain.CanonicalProtoBytes(input)
	if err != nil {
		t.Fatal(err)
	}
	commitment := sha256.Sum256(canonical)
	return &securecontentpb.BeginEncryptedObjectUploadRequest{
		FormatVersion:              1,
		PlanId:                     plan.GetPlanId(),
		Resource:                   input.GetResource(),
		ObjectId:                   objectID,
		UploadSpec:                 spec,
		DescriptorCommitmentSha256: commitment[:],
		CommandId:                  commandID,
	}
}

var _ infrastructure.PrivateContentStore = (*submitEntryBarrierStore)(nil)
