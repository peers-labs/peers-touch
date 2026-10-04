package application

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	securecontentkernel "github.com/peers-labs/peers-touch/station/app/internal/securecontent"
	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	federationdomain "github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"golang.org/x/crypto/curve25519"
	"golang.org/x/crypto/hkdf"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const (
	federatedPrivateTextPlaintext      = "cross-station exact text"
	federatedPrivateEndpointBindingHex = "08011225706c616e2d65383833613536316536643633386264663432353861663232386431356664621a20e114c5c4fa0fe277983dadd8f83e35f9f943c1d271635f9d1717bd3f2f0416d722200802121a30314d32464a41324d305134384443524256583352564848465918012a25736c6f742d626561616635623634303830373165643439613335383239656136633162666230013a0c7072656b65792d30312d30314220a4c389e85e9c37c799cd03a3d9c0c05010d51a9a954c32ba91530ddc287dbb014a20426ac3ef84cfaa18d262b9853928b96d07d2bf7c3ca2a42a26443d938e6f69aa5220e6f8fdbe78f561d4c8e27082769201c6d7a185f6a80c5f8223bbab1d72b530745a20e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855620608cc8d9fd5066a320a22120a707469643a616c6963651a12616c6963654073746174696f6e2e746573742001120c616c6963652d646576696365720a617574686f722d6b6579"
)

func TestFederatedPrivateReconcileCommitsSourceOutboxAndReceiverProjection(
	t *testing.T,
) {
	ctx := context.Background()
	source := newPrivateContentServiceFixture(t)
	source.audiences.snapshot.Audience = &actormodel.Audience{
		Kind: actormodel.Audience_FRIENDS,
	}
	source.service.recipients = &privateContentRemoteRecipientDirectory{
		delegate: privateContentTestRecipients{author: source.author.Endpoint},
		localities: []socialdomain.RecipientLocality{{
			ActorPTID:         "ptid:bob",
			HomeStationPeerID: "station-remote",
			FederationID:      "federation-one",
		}},
	}
	source.keyExchange.publicKeysByTarget = map[string][]byte{
		fmt.Sprintf(
			"%d:%s:%s",
			securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT,
			"ptid:bob",
			"bob-device",
		): federatedPrivateTestPreKeyPublic(t, 0x0b),
	}
	if err := source.service.ConfigureFederatedPrivateDelivery(
		"station-local",
		allowFederatedPrivateMembership{},
		NewMomentEventPublisher(),
	); err != nil {
		t.Fatal(err)
	}
	prepareRequest := privateMomentPrepareRequest(
		"prepare-federated-private-text",
		"content-federated-private-text",
	)
	prepareRequest.Audience = proto.Clone(
		source.audiences.snapshot.Audience,
	).(*actormodel.Audience)
	prepared, err := source.service.PreparePrivateMoment(
		ctx,
		source.author,
		prepareRequest,
	)
	if err != nil {
		t.Fatal(err)
	}
	submitted, err := source.service.SubmitPrivateMoment(
		ctx,
		source.author.Endpoint,
		federatedPrivateTextSubmitRequest(
			t,
			prepared.GetPlan(),
			source.author.Endpoint,
			source.authorPrivateKey,
			"submit-federated-private-text",
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	if submitted.GetPost().GetMetadata().GetPostId() == "" {
		t.Fatal("source submit returned no canonical Post")
	}
	assertPrivateContentCount(
		t,
		source.database,
		&dbmodel.SocialPrivateContentPost{},
		1,
	)
	var sourcePost dbmodel.SocialPrivateContentPost
	if err := source.database.First(&sourcePost).Error; err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(
		sourcePost.EncryptedPayloadBytes,
		[]byte(federatedPrivateTextPlaintext),
	) {
		t.Fatal("source Post persisted private text plaintext")
	}
	var outboxRows []federationdelivery.OutboxRecord
	if err := source.database.Find(&outboxRows).Error; err != nil {
		t.Fatal(err)
	}
	if len(outboxRows) != 1 {
		t.Fatalf("source outbox rows = %d, want 1", len(outboxRows))
	}
	if bytes.Contains(
		outboxRows[0].FrameBytes,
		[]byte(federatedPrivateTextPlaintext),
	) {
		t.Fatal("source outbox persisted private text plaintext")
	}
	frame := &federationdelivery.Frame{}
	if err := proto.Unmarshal(outboxRows[0].FrameBytes, frame); err != nil {
		t.Fatal(err)
	}
	if frame.GetPayloadKind() != federationdelivery.PayloadKindSocialPrivateResource ||
		frame.GetTargetStationPeerId() != "station-remote" ||
		frame.GetTraceId() == "" {
		t.Fatalf("source frame = %+v", frame)
	}
	sourceRead, err := source.service.GetPrivateMoment(
		ctx,
		source.author.Endpoint,
		submitted.GetPost().GetMetadata().GetPostId(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if sourceRead.GetRemoteDelivery().GetState() !=
		privatecontentpb.FederatedPrivateDeliveryState_FEDERATED_PRIVATE_DELIVERY_STATE_PENDING ||
		sourceRead.GetRemoteDelivery().GetTotalCount() != 1 {
		t.Fatalf(
			"source remote delivery status = %+v",
			sourceRead.GetRemoteDelivery(),
		)
	}
	if err := source.database.Model(&federationdelivery.OutboxRecord{}).
		Where("frame_id = ?", frame.GetFrameId()).
		Updates(map[string]any{
			"state":           federationdelivery.OutboxStateRetryWait,
			"attempt_count":   1,
			"next_attempt_at": source.clock.now.Add(time.Second),
		}).Error; err != nil {
		t.Fatal(err)
	}
	sourceRead, err = source.service.GetPrivateMoment(
		ctx,
		source.author.Endpoint,
		submitted.GetPost().GetMetadata().GetPostId(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if sourceRead.GetRemoteDelivery().GetState() !=
		privatecontentpb.FederatedPrivateDeliveryState_FEDERATED_PRIVATE_DELIVERY_STATE_RETRYING ||
		sourceRead.GetRemoteDelivery().GetRetryingCount() != 1 {
		t.Fatalf(
			"source retrying delivery status = %+v",
			sourceRead.GetRemoteDelivery(),
		)
	}
	wire := &privatecontentpb.FederatedPrivateResourceDelivery{}
	if err := proto.Unmarshal(frame.GetOpaquePayload(), wire); err != nil {
		t.Fatal(err)
	}
	if wire.GetTargetActor().GetPtid() != "ptid:bob" ||
		len(wire.GetTargetActorEnvelopes()) != 2 ||
		wire.GetVerification().GetReceiverVerifiedSenderSigningKey() != nil {
		t.Fatalf("viewer-scoped delivery = %+v", wire)
	}

	receiver := newFederatedPrivateReceiver(
		t,
		source.clock.now,
		source.authorPrivateKey.Public().(ed25519.PublicKey),
		source.stationSigner.privateKey.Public().(ed25519.PublicKey),
		source.stationSigner.keyID,
	)
	if err := receiver.service.validateFederatedPrivateResource(
		ctx,
		federatedPrivateTestTransaction{database: receiver.database},
		wire,
		frame,
	); err != nil {
		t.Fatalf("validate receiver delivery: %v", err)
	}
	receiverAudience := receiver.service.audiences.(*privateContentTestAudience)
	if receiverAudience.lastPostAuthorPTID != "ptid:bob" {
		t.Fatalf(
			"receiver FRIENDS owner = %q, want local target ptid:bob",
			receiverAudience.lastPostAuthorPTID,
		)
	}
	first, err := receiver.receiver.Receive(ctx, frame)
	if err != nil {
		t.Fatal(err)
	}
	if first.Disposition != federationdelivery.DispositionAccepted {
		t.Fatalf("first receiver disposition = %+v", first)
	}
	if err := source.database.Model(&federationdelivery.OutboxRecord{}).
		Where("frame_id = ?", frame.GetFrameId()).
		Update("state", federationdelivery.OutboxStateDelivered).Error; err != nil {
		t.Fatal(err)
	}
	sourceRead, err = source.service.GetPrivateMoment(
		ctx,
		source.author.Endpoint,
		submitted.GetPost().GetMetadata().GetPostId(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if sourceRead.GetRemoteDelivery().GetState() !=
		privatecontentpb.FederatedPrivateDeliveryState_FEDERATED_PRIVATE_DELIVERY_STATE_DELIVERED ||
		sourceRead.GetRemoteDelivery().GetDeliveredCount() != 1 {
		t.Fatalf(
			"source delivered status = %+v",
			sourceRead.GetRemoteDelivery(),
		)
	}
	references, err := receiver.service.ListRemotePrivateMomentReferences(
		ctx,
		"ptid:bob",
		&privatecontentpb.ListRemotePrivateMomentReferencesRequest{Limit: 100},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(references.GetMoments()) != 1 ||
		references.GetMoments()[0].GetPostId() !=
			wire.GetResource().GetContentId() {
		t.Fatalf("receiver remote Moment references = %+v", references)
	}
	assertTableCount(t, receiver.database, "realtime_events", 1)
	select {
	case event := <-receiver.subscription.Events:
		moment := event.GetMoment()
		if moment == nil ||
			moment.GetKind() != realtime.MomentEvent_CREATED ||
			moment.GetPostId() != wire.GetResource().GetContentId() ||
			moment.GetAuthorActorPtid() != "ptid:alice" ||
			moment.GetActorPtid() != "ptid:bob" {
			t.Fatalf("receiver Moment event = %+v", event)
		}
	case <-time.After(time.Second):
		t.Fatal("receiver emitted no committed Moment event")
	}

	var persisted struct {
		ViewerMetadataBytes   []byte `gorm:"column:viewer_metadata_bytes"`
		EncryptedPayloadBytes []byte `gorm:"column:encrypted_payload_bytes"`
		VerificationBytes     []byte `gorm:"column:verification_bytes"`
	}
	if err := receiver.database.Table("social_remote_private_resources").
		Select(
			"viewer_metadata_bytes",
			"encrypted_payload_bytes",
			"verification_bytes",
		).
		First(&persisted).Error; err != nil {
		t.Fatal(err)
	}
	storedVerification := &privatecontentpb.PrivateContentVerification{}
	if err := proto.Unmarshal(
		persisted.VerificationBytes,
		storedVerification,
	); err != nil {
		t.Fatal(err)
	}
	storedVerification.GetStationSigningKeyAttestation().
		ProofEd25519PublicKey = bytes.Repeat([]byte{0x7e}, ed25519.PublicKeySize)
	tamperedVerification, err := proto.MarshalOptions{
		Deterministic: true,
	}.Marshal(storedVerification)
	if err != nil {
		t.Fatal(err)
	}
	if err := receiver.database.Table("social_remote_private_resources").
		Where(
			"source_station_peer_id = ? AND content_id = ? AND generation = ? AND target_actor_ptid = ?",
			wire.GetSourceStationPeerId(),
			wire.GetResource().GetContentId(),
			wire.GetResource().GetGeneration(),
			wire.GetTargetActor().GetPtid(),
		).
		Update("verification_bytes", tamperedVerification).Error; err != nil {
		t.Fatal(err)
	}

	bobRead, err := receiver.service.GetPrivateMoment(
		ctx,
		receiver.bob,
		wire.GetResource().GetContentId(),
	)
	if err != nil {
		t.Fatal(err)
	}
	private := bobRead.GetResource().GetPrivateContent()
	if private == nil ||
		private.GetViewerEnvelope().GetEndpoint().GetActor().GetPtid() !=
			"ptid:bob" ||
		private.GetVerification().GetStationSigningKeyAttestation().
			GetStationPeerId() != "station-remote" ||
		!bytes.Equal(
			private.GetVerification().GetStationSigningKeyAttestation().
				GetProofEd25519PublicKey(),
			source.stationSigner.privateKey.Public().(ed25519.PublicKey),
		) ||
		private.GetVerification().GetReceiverVerifiedSenderSigningKey().
			GetActorPtid() != "ptid:alice" ||
		private.GetVerification().GetReceiverVerifiedSenderSigningKey().
			GetHomeStationPeerId() != "station-local" {
		t.Fatalf("Bob imported private projection = %+v", bobRead)
	}
	if bytes.Contains(bytes.Join([][]byte{
		persisted.ViewerMetadataBytes,
		persisted.EncryptedPayloadBytes,
		persisted.VerificationBytes,
	}, nil), []byte(federatedPrivateTextPlaintext)) {
		t.Fatal("receiver projection persisted private text plaintext")
	}
	assertFederatedPrivateTextReceiverFixture(t, bobRead)
	_, err = receiver.service.GetPrivateMoment(
		ctx,
		&actormodel.ActorDeviceRef{
			Actor: &actormodel.ActorRef{
				Ptid: "ptid:eve",
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			},
			DeviceId: "eve-device",
		},
		wire.GetResource().GetContentId(),
	)
	if !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentNotFound,
	) {
		t.Fatalf("Eve read error = %v", err)
	}
	_, err = receiver.service.GetPrivateMoment(
		ctx,
		&actormodel.ActorDeviceRef{
			Actor:    proto.Clone(receiver.bob.GetActor()).(*actormodel.ActorRef),
			DeviceId: "bob-unknown-device",
		},
		wire.GetResource().GetContentId(),
	)
	if !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentNotFound,
	) {
		t.Fatalf("unknown Bob device read error = %v", err)
	}

	replayed, err := receiver.receiver.Receive(
		ctx,
		proto.Clone(frame).(*federationdelivery.Frame),
	)
	if err != nil {
		t.Fatal(err)
	}
	if replayed.Disposition != federationdelivery.DispositionDuplicate {
		t.Fatalf("replay disposition = %+v", replayed)
	}
	select {
	case event := <-receiver.subscription.Events:
		t.Fatalf("exact replay emitted a second event: %+v", event)
	default:
	}
	assertTableCount(t, receiver.database, "realtime_events", 1)

	conflict := proto.Clone(frame).(*federationdelivery.Frame)
	conflict.OpaquePayload = append(
		append([]byte(nil), conflict.GetOpaquePayload()...),
		0x01,
	)
	conflict.PayloadSha256 = federationdelivery.PayloadSHA256(
		conflict.GetOpaquePayload(),
	)
	conflict.StationSignature = nil
	signingBytes, err := federationdelivery.SigningBytes(conflict)
	if err != nil {
		t.Fatal(err)
	}
	conflict.StationSignature, err = source.stationSigner.Sign(
		ctx,
		source.stationSigner.keyID,
		signingBytes,
	)
	if err != nil {
		t.Fatal(err)
	}
	conflicted, err := receiver.receiver.Receive(ctx, conflict)
	if err != nil {
		t.Fatal(err)
	}
	if conflicted.Disposition !=
		federationdelivery.DispositionPayloadHashConflict {
		t.Fatalf("conflict disposition = %+v", conflicted)
	}
	assertTableCount(t, receiver.database, "social_remote_private_resources", 1)
	assertTableCount(t, receiver.database, "social_remote_private_envelopes", 2)
}

func federatedPrivateTextSubmitRequest(
	t *testing.T,
	plan *securecontentpb.ContentEncryptionPlan,
	author *actormodel.ActorDeviceRef,
	authorPrivateKey ed25519.PrivateKey,
	commandID string,
) *privatecontentpb.SubmitPrivateMomentRequest {
	t.Helper()
	request := privateTextSubmitRequest(
		t,
		plan,
		author,
		authorPrivateKey,
		commandID,
		"deterministic-ciphertext-placeholder",
	)
	domainBinding, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&privatecontentpb.PrivateMomentDomainBinding{
			FormatVersion: socialdomain.PrivateContentFormatVersion,
			Kind: privatecontentpb.
				PrivateMomentKind_PRIVATE_MOMENT_KIND_TEXT,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	plaintext, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&privatecontentpb.PrivateMomentContent{
			FormatVersion: socialdomain.PrivateContentFormatVersion,
			Body: &privatecontentpb.PrivateMomentContent_Text{
				Text: &privatecontentpb.PrivateTextContent{
					Text: federatedPrivateTextPlaintext,
				},
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	info := make([]byte, 0, 4+4+4+len(plan.GetResource().GetContentId())+8+4)
	info = binary.BigEndian.AppendUint32(
		info,
		socialdomain.PrivateContentFormatVersion,
	)
	info = binary.BigEndian.AppendUint32(
		info,
		uint32(plan.GetResource().GetOwnerDomain()),
	)
	info = binary.BigEndian.AppendUint32(
		info,
		uint32(len(plan.GetResource().GetContentId())),
	)
	info = append(info, plan.GetResource().GetContentId()...)
	info = binary.BigEndian.AppendUint64(
		info,
		plan.GetResource().GetGeneration(),
	)
	info = binary.BigEndian.AppendUint32(
		info,
		uint32(privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_TEXT),
	)
	payloadKey := make([]byte, 32)
	if _, err := io.ReadFull(
		hkdf.New(
			sha256.New,
			bytes.Repeat([]byte{0x42}, 32),
			plan.GetAuthorizationSnapshotSha256(),
			info,
		),
		payloadKey,
	); err != nil {
		t.Fatal(err)
	}
	block, err := aes.NewCipher(payloadKey)
	if err != nil {
		t.Fatal(err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	nonce := bytes.Repeat([]byte{0x33}, aead.NonceSize())
	ciphertext := aead.Seal(nil, nonce, plaintext, domainBinding)
	ciphertextHash := sha256.Sum256(ciphertext)
	aadHash := sha256.Sum256(domainBinding)
	request.Payload = &securecontentpb.EncryptedPayload{
		FormatVersion: socialdomain.PrivateContentFormatVersion,
		Resource: proto.Clone(
			plan.GetResource(),
		).(*securecontentpb.SecureResourceRef),
		Suite: securecontentpb.
			PayloadEncryptionSuite_PAYLOAD_ENCRYPTION_SUITE_AES_256_GCM,
		Nonce:            nonce,
		Ciphertext:       ciphertext,
		CiphertextSha256: ciphertextHash[:],
		AadSha256:        aadHash[:],
	}
	for index, envelope := range request.GetEnvelopes() {
		envelope.Binding.PayloadCiphertextSha256 = ciphertextHash[:]
		bindingHash, err := securecontentkernel.EnvelopeBindingSHA256(
			envelope.GetBinding(),
		)
		if err != nil {
			t.Fatal(err)
		}
		signingBytes, err := securecontentkernel.CanonicalEnvelopeBindingBytes(
			envelope.GetBinding(),
		)
		if err != nil {
			t.Fatal(err)
		}
		envelope.BindingSha256 = bindingHash[:]
		if envelope.GetBinding().GetRecipientKeyKind() ==
			securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT &&
			envelope.GetBinding().GetRecipientKeyId() == "prekey-01-01" {
			if actual := hex.EncodeToString(signingBytes); actual !=
				federatedPrivateEndpointBindingHex {
				t.Fatalf(
					"federated private endpoint binding drift\nactual: %s",
					actual,
				)
			}
			envelope.HpkeEncapsulatedKey = mustDecodePrivateFixtureHex(
				t,
				"de4d01926f7c9bf80f087ed880c830ebaf588eb75cf7de1dcfe87311903e511a",
			)
			envelope.HpkeCiphertext = mustDecodePrivateFixtureHex(
				t,
				"47b4db9cfa557d873cde98244413e578d6a31857c905ce3a50f93aef79ff81eda67ab3953f75c39a68b7c364fa72ea69",
			)
		} else {
			envelope.HpkeCiphertext = bytes.Repeat(
				[]byte{byte(index + 31)},
				48,
			)
		}
		envelope.SenderSignature = ed25519.Sign(
			authorPrivateKey,
			signingBytes,
		)
	}
	return request
}

func federatedPrivateTestPreKeyPublic(
	t *testing.T,
	privateByte byte,
) []byte {
	t.Helper()
	publicKey, err := curve25519.X25519(
		bytes.Repeat([]byte{privateByte}, 32),
		curve25519.Basepoint,
	)
	if err != nil {
		t.Fatal(err)
	}
	return publicKey
}

func mustDecodePrivateFixtureHex(t *testing.T, value string) []byte {
	t.Helper()
	decoded, err := hex.DecodeString(value)
	if err != nil {
		t.Fatal(err)
	}
	return decoded
}

func assertFederatedPrivateTextReceiverFixture(
	t *testing.T,
	response *privatecontentpb.GetMomentResourceResponse,
) {
	t.Helper()
	responseBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		response,
	)
	if err != nil {
		t.Fatal(err)
	}
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve federated private text fixture source path")
	}
	fixturePath := filepath.Join(
		filepath.Dir(sourceFile),
		"../../../../../../model/domain/social/testdata/federated_private_text_receiver_response.hex",
	)
	fixture, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatal(err)
	}
	actual := hex.EncodeToString(responseBytes)
	if expected := strings.TrimSpace(string(fixture)); expected != actual {
		t.Fatalf(
			"federated private text receiver fixture mismatch\nactual: %s",
			actual,
		)
	}
}

func TestFederatedPrivateResourceIdentityConflictPrecedesProofKeyMutation(
	t *testing.T,
) {
	ctx := context.Background()
	source := newPrivateContentServiceFixture(t)
	frame := buildFederatedPrivateTextFrame(t, source)
	receiver := newFederatedPrivateReceiver(
		t,
		source.clock.now,
		source.authorPrivateKey.Public().(ed25519.PublicKey),
		source.stationSigner.privateKey.Public().(ed25519.PublicKey),
		source.stationSigner.keyID,
	)
	first, err := receiver.receiver.Receive(ctx, frame)
	if err != nil {
		t.Fatal(err)
	}
	if first.Disposition != federationdelivery.DispositionAccepted {
		t.Fatalf("first receiver disposition = %+v", first)
	}
	signer := receiver.service.stationSigner.(privateContentTestSigner)
	signer.trustImportedErr = authfed.ErrContentProofKeyConflict
	receiver.service.stationSigner = signer

	conflict := proto.Clone(frame).(*federationdelivery.Frame)
	delivery := &privatecontentpb.FederatedPrivateResourceDelivery{}
	if err := proto.Unmarshal(conflict.GetOpaquePayload(), delivery); err != nil {
		t.Fatal(err)
	}
	delivery.LifecycleRevision++
	payload, err := socialdomain.CanonicalProtoBytes(delivery)
	if err != nil {
		t.Fatal(err)
	}
	conflict.FrameId += "-conflict"
	conflict.IdempotencyKey += "-conflict"
	conflict.OpaquePayload = payload
	conflict.PayloadSha256 = federationdelivery.PayloadSHA256(payload)
	conflict.StationSignature = nil
	signingBytes, err := federationdelivery.SigningBytes(conflict)
	if err != nil {
		t.Fatal(err)
	}
	conflict.StationSignature, err = source.stationSigner.Sign(
		ctx,
		source.stationSigner.keyID,
		signingBytes,
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := receiver.service.validateFederatedPrivateResource(
		ctx,
		federatedPrivateTestTransaction{database: receiver.database},
		delivery,
		conflict,
	); err != nil {
		t.Fatalf("validate resource identity conflict: %v", err)
	}
	_, err = receiver.service.store.InspectRemotePrivateResource(
		ctx,
		federatedPrivateTestTransaction{database: receiver.database},
		delivery,
		payload,
	)
	if !errors.Is(err, infrastructure.ErrPrivateContentConflict) {
		t.Fatalf("inspect resource identity conflict error = %v", err)
	}

	result, err := receiver.receiver.Receive(ctx, conflict)
	if err != nil {
		t.Fatal(err)
	}
	if result.Disposition != federationdelivery.DispositionPayloadHashConflict {
		t.Fatalf("resource identity conflict disposition = %+v", result)
	}
	assertTableCount(t, receiver.database, "federation_delivery_inbox", 2)
	assertTableCount(t, receiver.database, "social_remote_private_resources", 1)
	assertTableCount(t, receiver.database, "social_remote_private_envelopes", 2)
	assertTableCount(t, receiver.database, "realtime_events", 1)
}

func TestFederatedPrivateDeliveryRejectsDuplicateEndpointBeforeMutation(
	t *testing.T,
) {
	ctx := context.Background()
	source := newPrivateContentServiceFixture(t)
	frame := buildFederatedPrivateTextFrame(t, source)
	delivery := &privatecontentpb.FederatedPrivateResourceDelivery{}
	if err := proto.Unmarshal(frame.GetOpaquePayload(), delivery); err != nil {
		t.Fatal(err)
	}
	var duplicate *securecontentpb.ViewerContentKeyEnvelope
	for _, envelope := range delivery.GetTargetActorEnvelopes() {
		if envelope.GetEndpoint() != nil {
			duplicate = proto.Clone(
				envelope,
			).(*securecontentpb.ViewerContentKeyEnvelope)
			break
		}
	}
	if duplicate == nil {
		t.Fatal("delivery has no endpoint envelope")
	}
	duplicate.Binding.RecipientSlotId += "-duplicate"
	duplicate.Binding.RecipientKeyId += "-duplicate"
	bindingBytes, err := securecontentkernel.CanonicalEnvelopeBindingBytes(
		duplicate.GetBinding(),
	)
	if err != nil {
		t.Fatal(err)
	}
	bindingHash := sha256.Sum256(bindingBytes)
	duplicate.BindingSha256 = bindingHash[:]
	duplicate.SenderSignature = ed25519.Sign(
		source.authorPrivateKey,
		bindingBytes,
	)
	delivery.TargetActorEnvelopes = append(
		delivery.TargetActorEnvelopes,
		duplicate,
	)
	payload, err := socialdomain.CanonicalProtoBytes(delivery)
	if err != nil {
		t.Fatal(err)
	}
	frame.OpaquePayload = payload
	frame.PayloadSha256 = federationdelivery.PayloadSHA256(payload)
	frame.StationSignature = nil
	frameSigningBytes, err := federationdelivery.SigningBytes(frame)
	if err != nil {
		t.Fatal(err)
	}
	frame.StationSignature, err = source.stationSigner.Sign(
		ctx,
		source.stationSigner.keyID,
		frameSigningBytes,
	)
	if err != nil {
		t.Fatal(err)
	}

	receiver := newFederatedPrivateReceiver(
		t,
		source.clock.now,
		source.authorPrivateKey.Public().(ed25519.PublicKey),
		source.stationSigner.privateKey.Public().(ed25519.PublicKey),
		source.stationSigner.keyID,
	)
	result, err := receiver.receiver.Receive(ctx, frame)
	if err != nil {
		t.Fatal(err)
	}
	if result.Disposition != federationdelivery.DispositionPayloadHashConflict {
		t.Fatalf("duplicate endpoint disposition = %+v", result)
	}
	signer := receiver.service.stationSigner.(privateContentTestSigner)
	if len(signer.importedProofKeys) != 0 {
		t.Fatalf(
			"duplicate endpoint imported proof keys = %d, want 0",
			len(signer.importedProofKeys),
		)
	}
	assertTableCount(t, receiver.database, "federation_delivery_inbox", 1)
	assertTableCount(t, receiver.database, "social_remote_private_resources", 0)
	assertTableCount(t, receiver.database, "social_remote_private_envelopes", 0)
	assertTableCount(t, receiver.database, "realtime_events", 0)
}

func TestFederatedPrivateDeliveryRejectsUnconvergedFriendship(
	t *testing.T,
) {
	ctx := context.Background()
	source := newPrivateContentServiceFixture(t)
	frame := buildFederatedPrivateTextFrame(t, source)
	receiver := newFederatedPrivateReceiver(
		t,
		source.clock.now,
		source.authorPrivateKey.Public().(ed25519.PublicKey),
		source.stationSigner.privateKey.Public().(ed25519.PublicKey),
		source.stationSigner.keyID,
	)
	receiver.service.audiences = &privateContentTestAudience{
		snapshot: socialdomain.FriendsSnapshot{
			Audience:         &actormodel.Audience{Kind: actormodel.Audience_FRIENDS},
			SourceRevision:   1,
			SourceHeadSHA256: privateDigest("receiver-stale-friends"),
			RecipientPTIDs:   []string{"ptid:eve"},
		},
	}

	result, err := receiver.receiver.Receive(ctx, frame)
	if err != nil {
		t.Fatal(err)
	}
	if result.Disposition != federationdelivery.DispositionTerminal {
		t.Fatalf("unconverged friendship disposition = %+v", result)
	}
	assertTableCount(t, receiver.database, "federation_delivery_inbox", 1)
	assertTableCount(t, receiver.database, "social_remote_private_resources", 0)
	assertTableCount(t, receiver.database, "social_remote_private_envelopes", 0)
	assertTableCount(t, receiver.database, "realtime_events", 0)
}

func TestFederatedPrivateDeliveryRetriesMembershipDependencyFailure(
	t *testing.T,
) {
	ctx := context.Background()
	source := newPrivateContentServiceFixture(t)
	frame := buildFederatedPrivateTextFrame(t, source)
	receiver := newFederatedPrivateReceiver(
		t,
		source.clock.now,
		source.authorPrivateKey.Public().(ed25519.PublicKey),
		source.stationSigner.privateKey.Public().(ed25519.PublicKey),
		source.stationSigner.keyID,
	)
	receiver.service.federationMembership =
		allowFederatedPrivateMembership{
			err: errors.New("temporary Federation repository failure"),
		}

	result, err := receiver.receiver.Receive(ctx, frame)
	if err != nil {
		t.Fatal(err)
	}
	if result.Disposition != federationdelivery.DispositionRetryable {
		t.Fatalf("membership dependency disposition = %+v", result)
	}
	assertTableCount(t, receiver.database, "federation_delivery_inbox", 0)
	assertTableCount(t, receiver.database, "social_remote_private_resources", 0)
	assertTableCount(t, receiver.database, "social_remote_private_envelopes", 0)
	assertTableCount(t, receiver.database, "realtime_events", 0)
}

func TestFederatedPrivateDeliveryRejectsInactiveStationPair(
	t *testing.T,
) {
	ctx := context.Background()
	source := newPrivateContentServiceFixture(t)
	frame := buildFederatedPrivateTextFrame(t, source)
	receiver := newFederatedPrivateReceiver(
		t,
		source.clock.now,
		source.authorPrivateKey.Public().(ed25519.PublicKey),
		source.stationSigner.privateKey.Public().(ed25519.PublicKey),
		source.stationSigner.keyID,
	)
	receiver.service.federationMembership =
		allowFederatedPrivateMembership{
			err: federationdomain.ErrInactiveStationPair,
		}

	result, err := receiver.receiver.Receive(ctx, frame)
	if err != nil {
		t.Fatal(err)
	}
	if result.Disposition != federationdelivery.DispositionTerminal {
		t.Fatalf("inactive membership disposition = %+v", result)
	}
	assertTableCount(t, receiver.database, "federation_delivery_inbox", 1)
	assertTableCount(t, receiver.database, "social_remote_private_resources", 0)
	assertTableCount(t, receiver.database, "social_remote_private_envelopes", 0)
	assertTableCount(t, receiver.database, "realtime_events", 0)
}

func TestFederatedPrivateDeliverySourceFailureRollsBackPostAndOutbox(
	t *testing.T,
) {
	source := newPrivateContentServiceFixtureWithStoreOptions(
		t,
		infrastructure.WithPrivateContentFailpoint(
			infrastructure.PrivateContentFailpointFunc(func(
				_ context.Context,
				boundary infrastructure.PrivateContentWriteBoundary,
			) error {
				if boundary ==
					infrastructure.PrivateContentBoundaryFederationOutbox {
					return errFederatedPrivateFailpoint
				}
				return nil
			}),
		),
	)
	source.audiences.snapshot.Audience = &actormodel.Audience{
		Kind: actormodel.Audience_FRIENDS,
	}
	source.audiences.snapshot.RecipientLocalities = nil
	source.service.recipients = &privateContentRemoteRecipientDirectory{
		delegate: privateContentTestRecipients{author: source.author.Endpoint},
		localities: []socialdomain.RecipientLocality{{
			ActorPTID:         "ptid:bob",
			HomeStationPeerID: "station-remote",
			FederationID:      "federation-one",
		}},
	}
	if err := source.service.ConfigureFederatedPrivateDelivery(
		"station-local",
		allowFederatedPrivateMembership{},
		NewMomentEventPublisher(),
	); err != nil {
		t.Fatal(err)
	}
	prepare := privateMomentPrepareRequest(
		"prepare-federated-source-rollback",
		"content-federated-source-rollback",
	)
	prepare.Audience = proto.Clone(
		source.audiences.snapshot.Audience,
	).(*actormodel.Audience)
	prepared, err := source.service.PreparePrivateMoment(
		context.Background(),
		source.author,
		prepare,
	)
	if err != nil {
		t.Fatal(err)
	}
	_, err = source.service.SubmitPrivateMoment(
		context.Background(),
		source.author.Endpoint,
		privateTextSubmitRequest(
			t,
			prepared.GetPlan(),
			source.author.Endpoint,
			source.authorPrivateKey,
			"submit-federated-source-rollback",
			"opaque-federated-source-rollback",
		),
	)
	if err == nil {
		t.Fatal("source outbox failpoint returned no error")
	}
	assertPrivateContentCount(
		t,
		source.database,
		&dbmodel.SocialPrivateContentPost{},
		0,
	)
	assertPrivateContentCount(
		t,
		source.database,
		&dbmodel.SocialPrivateCommandReceipt{},
		0,
	)
	assertTableCount(t, source.database, "federation_delivery_outbox", 0)
}

func TestFederatedPrivateDeliveryReceiverFailureRollsBackInboxAndProjection(
	t *testing.T,
) {
	for _, failAt := range []infrastructure.PrivateContentWriteBoundary{
		infrastructure.PrivateContentBoundaryRemoteResource,
		infrastructure.PrivateContentBoundaryRemoteEnvelopes,
	} {
		t.Run(string(failAt), func(t *testing.T) {
			ctx := context.Background()
			source := newPrivateContentServiceFixture(t)
			frame := buildFederatedPrivateTextFrame(t, source)
			receiver := newFederatedPrivateReceiverWithFailpoint(
				t,
				source.clock.now,
				source.authorPrivateKey.Public().(ed25519.PublicKey),
				source.stationSigner.privateKey.Public().(ed25519.PublicKey),
				source.stationSigner.keyID,
				failAt,
			)
			if _, err := receiver.receiver.Receive(ctx, frame); err == nil {
				t.Fatal("receiver failpoint returned no error")
			}
			assertTableCount(t, receiver.database, "federation_delivery_inbox", 0)
			assertTableCount(t, receiver.database, "social_remote_private_resources", 0)
			assertTableCount(t, receiver.database, "social_remote_private_envelopes", 0)
			assertTableCount(t, receiver.database, "realtime_events", 0)
		})
	}
}

func TestFederatedPrivateDeliveryEventFailureRollsBackReceiverTransaction(
	t *testing.T,
) {
	ctx := context.Background()
	source := newPrivateContentServiceFixture(t)
	frame := buildFederatedPrivateTextFrame(t, source)
	receiver := newFederatedPrivateReceiver(
		t,
		source.clock.now,
		source.authorPrivateKey.Public().(ed25519.PublicKey),
		source.stationSigner.privateKey.Public().(ed25519.PublicKey),
		source.stationSigner.keyID,
	)
	if err := receiver.database.Exec(`
CREATE TRIGGER fail_remote_private_event
BEFORE INSERT ON realtime_events
BEGIN
  SELECT RAISE(FAIL, 'remote private event failpoint');
END
`).Error; err != nil {
		t.Fatal(err)
	}

	if _, err := receiver.receiver.Receive(ctx, frame); err == nil {
		t.Fatal("receiver event persistence failpoint returned no error")
	}
	assertTableCount(t, receiver.database, "federation_delivery_inbox", 0)
	assertTableCount(t, receiver.database, "social_remote_private_resources", 0)
	assertTableCount(t, receiver.database, "social_remote_private_envelopes", 0)
	assertTableCount(t, receiver.database, "realtime_events", 0)
}

func TestFederatedPrivateDeliveryProofKeyConflictIsTerminal(
	t *testing.T,
) {
	ctx := context.Background()
	source := newPrivateContentServiceFixture(t)
	frame := buildFederatedPrivateTextFrame(t, source)
	receiver := newFederatedPrivateReceiver(
		t,
		source.clock.now,
		source.authorPrivateKey.Public().(ed25519.PublicKey),
		source.stationSigner.privateKey.Public().(ed25519.PublicKey),
		source.stationSigner.keyID,
	)
	signer := receiver.service.stationSigner.(privateContentTestSigner)
	signer.trustImportedErr = authfed.ErrContentProofKeyConflict
	receiver.service.stationSigner = signer

	result, err := receiver.receiver.Receive(ctx, frame)
	if err != nil {
		t.Fatal(err)
	}
	if result.Disposition != federationdelivery.DispositionTerminal {
		t.Fatalf("proof-key conflict disposition = %+v", result)
	}
	assertTableCount(t, receiver.database, "federation_delivery_inbox", 1)
	assertTableCount(t, receiver.database, "social_remote_private_resources", 0)
	assertTableCount(t, receiver.database, "social_remote_private_envelopes", 0)
	assertTableCount(t, receiver.database, "realtime_events", 0)
}

func buildFederatedPrivateTextFrame(
	t *testing.T,
	source *privateContentServiceFixture,
) *federationdelivery.Frame {
	t.Helper()
	source.audiences.snapshot.Audience = &actormodel.Audience{
		Kind: actormodel.Audience_FRIENDS,
	}
	source.audiences.snapshot.RecipientLocalities = nil
	source.service.recipients = &privateContentRemoteRecipientDirectory{
		delegate: privateContentTestRecipients{author: source.author.Endpoint},
		localities: []socialdomain.RecipientLocality{{
			ActorPTID:         "ptid:bob",
			HomeStationPeerID: "station-remote",
			FederationID:      "federation-one",
		}},
	}
	if err := source.service.ConfigureFederatedPrivateDelivery(
		"station-local",
		allowFederatedPrivateMembership{},
		NewMomentEventPublisher(),
	); err != nil {
		t.Fatal(err)
	}
	prepare := privateMomentPrepareRequest(
		"prepare-federated-private-delivery",
		"content-federated-private-delivery",
	)
	prepare.Audience = proto.Clone(
		source.audiences.snapshot.Audience,
	).(*actormodel.Audience)
	prepared, err := source.service.PreparePrivateMoment(
		context.Background(),
		source.author,
		prepare,
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := source.service.SubmitPrivateMoment(
		context.Background(),
		source.author.Endpoint,
		privateTextSubmitRequest(
			t,
			prepared.GetPlan(),
			source.author.Endpoint,
			source.authorPrivateKey,
			"submit-federated-private-delivery",
			"opaque-federated-delivery",
		),
	); err != nil {
		t.Fatal(err)
	}
	var row federationdelivery.OutboxRecord
	if err := source.database.First(&row).Error; err != nil {
		t.Fatal(err)
	}
	frame := &federationdelivery.Frame{}
	if err := proto.Unmarshal(row.FrameBytes, frame); err != nil {
		t.Fatal(err)
	}
	return frame
}

type federatedPrivateReceiverFixture struct {
	database     *gorm.DB
	service      *PrivateContentService
	receiver     *federationdelivery.DeliveryReceiver
	bob          *actormodel.ActorDeviceRef
	subscription *events.Subscription
}

func newFederatedPrivateReceiver(
	t *testing.T,
	now time.Time,
	authorPublicKey ed25519.PublicKey,
	sourceStationPublicKey ed25519.PublicKey,
	sourceStationKeyID string,
) *federatedPrivateReceiverFixture {
	return newFederatedPrivateReceiverWithFailpoint(
		t,
		now,
		authorPublicKey,
		sourceStationPublicKey,
		sourceStationKeyID,
		"",
	)
}

func newFederatedPrivateReceiverWithFailpoint(
	t *testing.T,
	now time.Time,
	authorPublicKey ed25519.PublicKey,
	sourceStationPublicKey ed25519.PublicKey,
	sourceStationKeyID string,
	failAt infrastructure.PrivateContentWriteBoundary,
) *federatedPrivateReceiverFixture {
	t.Helper()
	database, err := gorm.Open(
		sqlite.Open(
			"file:"+t.Name()+"-receiver?mode=memory&cache=shared&_busy_timeout=5000",
		),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)},
	)
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() {
		if closeErr := sqlDB.Close(); closeErr != nil {
			t.Errorf("close receiver database: %v", closeErr)
		}
	})
	storeOptions := []infrastructure.PrivateContentStoreOption{}
	if failAt != "" {
		storeOptions = append(
			storeOptions,
			infrastructure.WithPrivateContentFailpoint(
				infrastructure.PrivateContentFailpointFunc(func(
					_ context.Context,
					boundary infrastructure.PrivateContentWriteBoundary,
				) error {
					if boundary == failAt {
						return errFederatedPrivateFailpoint
					}
					return nil
				}),
			),
		)
	}
	store, err := infrastructure.NewGORMPrivateContentStore(
		database,
		storeOptions...,
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := infrastructure.MigrateIdentitySchema(database); err != nil {
		t.Fatal(err)
	}
	deliveryStore, err := federationdelivery.NewGORMRepository(
		database,
		&privateContentTestClock{now: now},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := deliveryStore.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	_, stationPrivateKey, err := ed25519.GenerateKey(
		bytes.NewReader(bytes.Repeat([]byte{0x62}, ed25519.SeedSize)),
	)
	if err != nil {
		t.Fatal(err)
	}
	stationPublicDER, err := x509.MarshalPKIXPublicKey(
		stationPrivateKey.Public(),
	)
	if err != nil {
		t.Fatal(err)
	}
	signer := privateContentTestSigner{
		stationID:         "station-remote",
		keyID:             authfed.KidFromPubDER(stationPublicDER),
		privateKey:        stationPrivateKey,
		importedProofKeys: make(map[string][]byte),
	}
	bob := &actormodel.ActorDeviceRef{
		Actor: &actormodel.ActorRef{
			Ptid: "ptid:bob",
			Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
		},
		DeviceId: "bob-device",
	}
	audiences := &privateContentTestAudience{
		snapshot: socialdomain.FriendsSnapshot{
			Audience:       &actormodel.Audience{Kind: actormodel.Audience_FRIENDS},
			SourceRevision: 1,
			SourceHeadSHA256: privateDigest(
				"receiver-federated-friends",
			),
			RecipientPTIDs: []string{"ptid:alice"},
		},
	}
	clock := &privateContentTestClock{now: now}
	service, err := NewPrivateContentService(
		store,
		audiences,
		audiences,
		privateContentTestGroups{},
		privateContentTestRecipients{author: bob},
		&privateContentTestKeyExchange{},
		signer,
		privateContentTestAuthorVerifier{publicKey: authorPublicKey},
		clock,
	)
	if err != nil {
		t.Fatal(err)
	}
	remoteEventSequence := 0
	bus, err := events.NewDurableEventBus(
		database,
		events.WithIDGenerator(func() string {
			remoteEventSequence++
			return fmt.Sprintf("remote-event-%d", remoteEventSequence)
		}),
		events.WithClock(func() time.Time { return now }),
	)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(bus.Close)
	subscription, cancel, err := bus.Subscribe(
		context.Background(),
		"ptid:bob",
		"bob-device",
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(cancel)
	publisher := NewMomentEventPublisher()
	publisher.bus = func() events.EventBus { return bus }
	publisher.now = func() time.Time { return now }
	if err := service.ConfigureFederatedPrivateDelivery(
		"station-remote",
		allowFederatedPrivateMembership{},
		publisher,
	); err != nil {
		t.Fatal(err)
	}
	registry := federationdelivery.NewRegistry()
	if err := infrastructure.RegisterFederatedPrivateResourceReceivers(
		registry,
		service,
	); err != nil {
		t.Fatal(err)
	}
	if err := infrastructure.RegisterFederatedPrivateInteractionReceivers(
		registry,
		service,
	); err != nil {
		t.Fatal(err)
	}
	receiver, err := federationdelivery.NewReceiver(
		federationdelivery.ReceiverConfig{
			Policy: federationdelivery.DefaultFramePolicy("station-remote"),
			Verifier: federatedPrivateFrameVerifier{
				sourceStationPeerID: "station-local",
				keyID:               sourceStationKeyID,
				publicKey:           sourceStationPublicKey,
			},
			Registry:   registry,
			UnitOfWork: deliveryStore,
			Clock:      clock,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	return &federatedPrivateReceiverFixture{
		database:     database,
		service:      service,
		receiver:     receiver,
		bob:          bob,
		subscription: subscription,
	}
}

type allowFederatedPrivateMembership struct {
	err error
}

func (m allowFederatedPrivateMembership) ValidateActiveStationPair(
	_ context.Context,
	federationID string,
	sourceStationPeerID string,
	targetStationPeerID string,
) error {
	if m.err != nil {
		return m.err
	}
	if federationID != "federation-one" ||
		sourceStationPeerID != "station-local" ||
		targetStationPeerID != "station-remote" {
		return fmt.Errorf("unexpected Federation scope")
	}
	return nil
}

type federatedPrivateFrameVerifier struct {
	sourceStationPeerID string
	keyID               string
	publicKey           ed25519.PublicKey
}

type federatedPrivateTestTransaction struct {
	database *gorm.DB
}

func (t federatedPrivateTestTransaction) DB() *gorm.DB {
	return t.database
}

func (federatedPrivateTestTransaction) Outbox() federationdelivery.OutboxWriter {
	return nil
}

func (v federatedPrivateFrameVerifier) Verify(
	_ context.Context,
	sourceStationPeerID string,
	signingKeyID string,
	canonical []byte,
	signature []byte,
) error {
	if sourceStationPeerID != v.sourceStationPeerID ||
		signingKeyID != v.keyID ||
		!ed25519.Verify(v.publicKey, canonical, signature) {
		return fmt.Errorf("invalid source Station signature")
	}
	return nil
}

func assertTableCount(
	t *testing.T,
	database *gorm.DB,
	table string,
	want int64,
) {
	t.Helper()
	var got int64
	if err := database.Table(table).Count(&got).Error; err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("%s rows = %d, want %d", table, got, want)
	}
}

var errFederatedPrivateFailpoint = fmt.Errorf(
	"federated private receiver failpoint",
)
