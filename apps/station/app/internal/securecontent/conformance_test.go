package securecontent_test

import (
	"encoding/hex"
	"errors"
	"strings"
	"testing"
	"time"

	kernel "github.com/peers-labs/peers-touch/station/app/internal/securecontent"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestDefaultPolicyAndTypedErrors(t *testing.T) {
	t.Parallel()

	policy := kernel.DefaultPolicy()
	if err := policy.Validate(); err != nil {
		t.Fatalf("default policy: %v", err)
	}
	policy.MaximumRecipientSlots++
	if err := policy.Validate(); !kernel.IsCode(err, kernel.ErrorCodeInvalidArgument) {
		t.Fatalf("widened policy error = %v", err)
	}

	cause := errors.New("storage unavailable")
	err := kernel.WrapError(kernel.ErrorCodeIntegrityFailed, "test.wrap", cause)
	if !errors.Is(err, cause) || !kernel.IsCode(err, kernel.ErrorCodeIntegrityFailed) {
		t.Fatalf("wrapped error = %v", err)
	}
	retry := kernel.NewRetryError("test.retry", 3*time.Second, "retry")
	if got := kernel.RetryAfterOf(retry); got != 3*time.Second {
		t.Fatalf("retry after = %s", got)
	}
}

func TestDescriptorValidationAndCanonicalHash(t *testing.T) {
	t.Parallel()

	spec := validUploadSpec()
	if err := kernel.ValidateEncryptedObjectUploadSpec(spec, kernel.DefaultPolicy()); err != nil {
		t.Fatalf("valid upload spec: %v", err)
	}
	descriptor := &securecontentpb.EncryptedObjectDescriptor{
		Resource:   cloneResource(spec.GetResource()),
		ObjectId:   spec.GetObjectId(),
		StorageRef: "opaque-storage-ref",
		Commitment: spec,
	}
	first, err := kernel.DescriptorSHA256(descriptor, kernel.DefaultPolicy())
	if err != nil {
		t.Fatalf("first descriptor hash: %v", err)
	}
	second, err := kernel.DescriptorSHA256(descriptor, kernel.DefaultPolicy())
	if err != nil {
		t.Fatalf("second descriptor hash: %v", err)
	}
	if first != second {
		t.Fatal("deterministic descriptor hashes differ")
	}

	tampered := proto.Clone(descriptor).(*securecontentpb.EncryptedObjectDescriptor)
	tampered.ObjectId = "different-object"
	if err := kernel.ValidateEncryptedObjectDescriptor(
		tampered,
		kernel.DefaultPolicy(),
	); !kernel.IsCode(err, kernel.ErrorCodeBindingMismatch) {
		t.Fatalf("descriptor mismatch error = %v", err)
	}

	oversized := proto.Clone(spec).(*securecontentpb.EncryptedObjectUploadSpec)
	oversized.ChunkCount = kernel.MaximumObjectChunkCount + 1
	if err := kernel.ValidateEncryptedObjectUploadSpec(
		oversized,
		kernel.DefaultPolicy(),
	); !kernel.IsCode(err, kernel.ErrorCodeInvalidArgument) {
		t.Fatalf("oversized descriptor error = %v", err)
	}
}

func TestEnvelopeValidationFailsClosedOnBindingTamper(t *testing.T) {
	t.Parallel()

	binding := validBinding()
	bindingHash, err := kernel.EnvelopeBindingSHA256(binding)
	if err != nil {
		t.Fatalf("binding hash: %v", err)
	}
	envelope := &securecontentpb.PreparedContentKeyEnvelope{
		Binding:             binding,
		BindingSha256:       bindingHash[:],
		HpkeEncapsulatedKey: repeatedByte(0x31, kernel.X25519PublicKeySize),
		HpkeCiphertext:      repeatedByte(0x32, 48),
		SenderSignature:     repeatedByte(0x33, kernel.Ed25519SignatureSize),
	}
	if err := kernel.ValidatePreparedContentKeyEnvelope(
		envelope,
		kernel.DefaultPolicy(),
	); err != nil {
		t.Fatalf("valid prepared envelope: %v", err)
	}

	tampered := proto.Clone(envelope).(*securecontentpb.PreparedContentKeyEnvelope)
	tampered.BindingSha256 = repeatedByte(0x44, kernel.SHA256Size)
	if err := kernel.ValidatePreparedContentKeyEnvelope(
		tampered,
		kernel.DefaultPolicy(),
	); !kernel.IsCode(err, kernel.ErrorCodeBindingMismatch) {
		t.Fatalf("tampered binding error = %v", err)
	}

	expected := proto.Clone(binding).(*securecontentpb.ContentKeyEnvelopeBinding)
	expected.RecipientSlotId = "slot-2"
	if err := kernel.ValidateEnvelopeBindingMatch(
		binding,
		expected,
	); !kernel.IsCode(err, kernel.ErrorCodeBindingMismatch) {
		t.Fatalf("exact binding mismatch error = %v", err)
	}
}

func TestCanonicalEnvelopeBindingUsesAscendingFieldOrder(t *testing.T) {
	t.Parallel()

	encoded, err := kernel.CanonicalEnvelopeBindingBytes(validBinding())
	if err != nil {
		t.Fatal(err)
	}
	var fields []protowire.Number
	for len(encoded) > 0 {
		number, wireType, tagLength := protowire.ConsumeTag(encoded)
		if tagLength < 0 {
			t.Fatalf("consume tag: %v", protowire.ParseError(tagLength))
		}
		valueLength := protowire.ConsumeFieldValue(number, wireType, encoded[tagLength:])
		if valueLength < 0 {
			t.Fatalf("consume field %d: %v", number, protowire.ParseError(valueLength))
		}
		fields = append(fields, number)
		encoded = encoded[tagLength+valueLength:]
	}
	for index, number := range fields {
		expected := protowire.Number(index + 1)
		if number != expected {
			t.Fatalf("field order = %v, want ascending 1..14", fields)
		}
	}
	if len(fields) != 14 {
		t.Fatalf("field count = %d, want 14", len(fields))
	}
}

func TestContentPreKeySigningBytesCanonicalVector(t *testing.T) {
	input := validContentPreKeySigningInput()
	signingBytes, err := kernel.ContentPreKeySigningBytes(input)
	if err != nil {
		t.Fatal(err)
	}
	const expectedHex = "70656572732d746f7563683a7365637572652d636f6e74656e743a7072656b65793a763100080110011a17636f6e74656e742d7072656b65792d766563746f722d3122200102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202a1c0a0c120a707469643a616c696365120c616c6963652d646576696365380740064a1c0a0c120a707469643a616c696365120c616c6963652d6465766963655211616c6963652d7369676e696e672d6b65795807"
	if actual := hex.EncodeToString(signingBytes); actual != expectedHex {
		t.Fatalf("signing vector = %s, want %s", actual, expectedHex)
	}
}

func TestContentPreKeySigningInputRejectsSemanticMismatch(t *testing.T) {
	tests := map[string]func(*securecontentpb.ContentPreKeySigningInput){
		"endpoint publisher": func(input *securecontentpb.ContentPreKeySigningInput) {
			input.GetEndpoint().DeviceId = "other-device"
		},
		"endpoint epoch": func(input *securecontentpb.ContentPreKeySigningInput) {
			input.PoolEpoch++
		},
		"recovery publisher": func(input *securecontentpb.ContentPreKeySigningInput) {
			input.Kind = securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY
			input.Principal = &securecontentpb.ContentPreKeySigningInput_RecoveryActor{
				RecoveryActor: &actormodel.ActorRef{Ptid: "ptid:bob"},
			}
		},
		"oversized key id": func(input *securecontentpb.ContentPreKeySigningInput) {
			input.KeyId = string(make([]byte, 129))
		},
		"nul key id": func(input *securecontentpb.ContentPreKeySigningInput) {
			input.KeyId = "content\x00prekey"
		},
		"oversized actor ptid": func(input *securecontentpb.ContentPreKeySigningInput) {
			ptid := strings.Repeat("a", 256)
			input.GetEndpoint().Actor.Ptid = ptid
			input.GetPublisher().Actor.Ptid = ptid
		},
		"persistence epoch": func(input *securecontentpb.ContentPreKeySigningInput) {
			input.PoolEpoch = uint64(1 << 63)
			input.PublisherProfileVersion = uint64(1 << 63)
		},
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			input := validContentPreKeySigningInput()
			mutate(input)
			if _, err := kernel.ContentPreKeySigningBytes(input); err == nil {
				t.Fatal("invalid signing input was accepted")
			}
		})
	}
}

func validContentPreKeySigningInput() *securecontentpb.ContentPreKeySigningInput {
	publicKey := make([]byte, 32)
	for index := range publicKey {
		publicKey[index] = byte(index + 1)
	}
	endpoint := &actormodel.ActorDeviceRef{
		Actor:    &actormodel.ActorRef{Ptid: "ptid:alice"},
		DeviceId: "alice-device",
	}
	return &securecontentpb.ContentPreKeySigningInput{
		FormatVersion:   1,
		Kind:            securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT,
		KeyId:           "content-prekey-vector-1",
		X25519PublicKey: publicKey,
		Principal: &securecontentpb.ContentPreKeySigningInput_Endpoint{
			Endpoint: proto.Clone(endpoint).(*actormodel.ActorDeviceRef),
		},
		PoolEpoch:               7,
		ExpectedPoolEpoch:       6,
		Publisher:               endpoint,
		PublisherSigningKeyId:   "alice-signing-key",
		PublisherProfileVersion: 7,
	}
}

func TestViewerEnvelopeValidatesRecipientKind(t *testing.T) {
	t.Parallel()

	binding := validBinding()
	bindingHash, err := kernel.EnvelopeBindingSHA256(binding)
	if err != nil {
		t.Fatalf("binding hash: %v", err)
	}
	envelope := &securecontentpb.ViewerContentKeyEnvelope{
		Binding: binding,
		Recipient: &securecontentpb.ViewerContentKeyEnvelope_Endpoint{
			Endpoint: validEndpoint("recipient"),
		},
		BindingSha256:       bindingHash[:],
		HpkeEncapsulatedKey: repeatedByte(0x41, kernel.X25519PublicKeySize),
		HpkeCiphertext:      repeatedByte(0x42, 48),
		SenderSignature:     repeatedByte(0x43, kernel.Ed25519SignatureSize),
		PrincipalEpoch:      1,
	}
	if err := kernel.ValidateViewerContentKeyEnvelope(
		envelope,
		kernel.DefaultPolicy(),
	); err != nil {
		t.Fatalf("valid viewer envelope: %v", err)
	}

	envelope.Recipient = &securecontentpb.ViewerContentKeyEnvelope_RecoveryActor{
		RecoveryActor: validActor("recipient"),
	}
	if err := kernel.ValidateViewerContentKeyEnvelope(
		envelope,
		kernel.DefaultPolicy(),
	); !kernel.IsCode(err, kernel.ErrorCodeInvalidArgument) {
		t.Fatalf("recipient-kind mismatch error = %v", err)
	}
}

func TestRepositoryConformanceValidatesPartsAndRecords(t *testing.T) {
	t.Parallel()

	commitment := kernel.ObjectCommitmentFromProto(validUploadSpec())
	part := kernel.Part{
		ChunkIndex:     0,
		ByteOffset:     0,
		CiphertextSize: commitment.CiphertextSize,
		CiphertextHash: append([]byte(nil), commitment.ChunkHashes[0]...),
	}
	if err := kernel.ValidateCompletePartSet(
		commitment,
		[]kernel.Part{part},
		kernel.DefaultPolicy(),
	); err != nil {
		t.Fatalf("valid part set: %v", err)
	}
	part.ByteOffset = 1
	if err := kernel.ValidateCompletePartSet(
		commitment,
		[]kernel.Part{part},
		kernel.DefaultPolicy(),
	); !kernel.IsCode(err, kernel.ErrorCodeConflict) {
		t.Fatalf("invalid part error = %v", err)
	}

	now := time.Now().UTC()
	if err := kernel.ValidateUploadRecord(kernel.UploadRecord{
		Commitment:          commitment,
		State:               kernel.TransferStateQueued,
		ReceivedChunkBitmap: []byte{0},
		ExpiresAt:           now.Add(time.Hour),
	}, kernel.DefaultPolicy()); err != nil {
		t.Fatalf("valid upload record: %v", err)
	}
	if err := kernel.ValidateObjectRecord(kernel.ObjectRecord{
		Commitment: commitment,
		State:      kernel.ObjectStateCompleteUnattached,
		CreatedAt:  now,
		ExpiresAt:  now.Add(time.Hour),
	}, kernel.DefaultPolicy()); err != nil {
		t.Fatalf("valid object record: %v", err)
	}
}

func TestTransitionMatricesRejectSkippedStates(t *testing.T) {
	t.Parallel()

	if err := kernel.ValidateTransferTransition(
		kernel.TransferStateQueued,
		kernel.TransferStateTransferring,
	); err != nil {
		t.Fatalf("queued -> transferring: %v", err)
	}
	if err := kernel.ValidateTransferTransition(
		kernel.TransferStateQueued,
		kernel.TransferStateComplete,
	); !kernel.IsCode(err, kernel.ErrorCodeInvalidState) {
		t.Fatalf("skipped transfer state error = %v", err)
	}
	if err := kernel.ValidateObjectTransition(
		kernel.ObjectStateCompleteUnattached,
		kernel.ObjectStateAttached,
	); err != nil {
		t.Fatalf("complete-unattached -> attached: %v", err)
	}
	if err := kernel.ValidateObjectTransition(
		kernel.ObjectStateAttached,
		kernel.ObjectStateCleanupClaimed,
	); !kernel.IsCode(err, kernel.ErrorCodeInvalidState) {
		t.Fatalf("attached cleanup error = %v", err)
	}
}

func TestEncryptionPlanRequiresCanonicalSlotAndObjectOrder(t *testing.T) {
	t.Parallel()

	plan := &securecontentpb.ContentEncryptionPlan{
		FormatVersion:               kernel.FormatVersion,
		PlanId:                      "plan-1",
		Resource:                    validResource(),
		Author:                      validEndpoint("author"),
		AuthorizationSnapshotSha256: repeatedByte(0x51, kernel.SHA256Size),
		RequiredSlots: []*securecontentpb.RequiredContentRecipientSlot{
			validSlot("slot-1", "key-1"),
			validSlot("slot-2", "key-2"),
		},
		ObjectIds:           []string{"object-1", "object-2"},
		ExpiresAt:           timestamppb.New(time.Now().UTC().Add(time.Minute)),
		CanonicalPlanSha256: repeatedByte(0x52, kernel.SHA256Size),
		StationSigningKeyId: "station-key-1",
		StationSignature:    repeatedByte(0x53, kernel.Ed25519SignatureSize),
		DomainBindingSha256: repeatedByte(0x54, kernel.SHA256Size),
	}
	if err := kernel.ValidateContentEncryptionPlan(plan, kernel.DefaultPolicy()); err != nil {
		t.Fatalf("valid plan: %v", err)
	}
	plan.RequiredSlots[0], plan.RequiredSlots[1] =
		plan.RequiredSlots[1], plan.RequiredSlots[0]
	if err := kernel.ValidateContentEncryptionPlan(
		plan,
		kernel.DefaultPolicy(),
	); !kernel.IsCode(err, kernel.ErrorCodeInvalidArgument) {
		t.Fatalf("non-canonical slot order error = %v", err)
	}
}

func validUploadSpec() *securecontentpb.EncryptedObjectUploadSpec {
	hash := repeatedByte(0x21, kernel.SHA256Size)
	return &securecontentpb.EncryptedObjectUploadSpec{
		Resource:              validResource(),
		ObjectId:              "object-1",
		CiphertextSize:        uint64(kernel.AES256GCMTagSize + 1),
		CiphertextSha256:      hash,
		ChunkSize:             kernel.ObjectChunkSize,
		ChunkCount:            1,
		EncryptionSuite:       kernel.EncryptionSuiteAES256GCMChunked,
		TagSize:               kernel.AES256GCMTagSize,
		NonceStrategy:         kernel.NonceStrategyCounter32BE,
		ChunkCiphertextSha256: [][]byte{append([]byte(nil), hash...)},
	}
}

func validBinding() *securecontentpb.ContentKeyEnvelopeBinding {
	return &securecontentpb.ContentKeyEnvelopeBinding{
		FormatVersion:               kernel.FormatVersion,
		PlanId:                      "plan-1",
		CanonicalPlanSha256:         repeatedByte(0x11, kernel.SHA256Size),
		Resource:                    validResource(),
		RecipientSlotId:             "slot-1",
		RecipientKeyKind:            securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT,
		RecipientKeyId:              "key-1",
		PrincipalBindingSha256:      repeatedByte(0x12, kernel.SHA256Size),
		AuthorizationSnapshotSha256: repeatedByte(0x13, kernel.SHA256Size),
		PayloadCiphertextSha256:     repeatedByte(0x14, kernel.SHA256Size),
		ObjectDescriptorSetSha256:   repeatedByte(0x15, kernel.SHA256Size),
		PlanExpiresAt:               timestamppb.New(time.Now().UTC().Add(time.Minute)),
		Sender:                      validEndpoint("sender"),
		SenderSigningKeyId:          "sender-key-1",
	}
}

func validResource() *securecontentpb.SecureResourceRef {
	return &securecontentpb.SecureResourceRef{
		OwnerDomain: securecontentpb.SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_CONVERSATION,
		ContentId:   "content-1",
		Generation:  1,
	}
}

func cloneResource(resource *securecontentpb.SecureResourceRef) *securecontentpb.SecureResourceRef {
	return &securecontentpb.SecureResourceRef{
		OwnerDomain: resource.GetOwnerDomain(),
		ContentId:   resource.GetContentId(),
		Generation:  resource.GetGeneration(),
	}
}

func validEndpoint(ptid string) *actormodel.ActorDeviceRef {
	return &actormodel.ActorDeviceRef{
		Actor:    validActor(ptid),
		DeviceId: "device-1",
	}
}

func validActor(ptid string) *actormodel.ActorRef {
	return &actormodel.ActorRef{
		Ptid: ptid,
		Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
	}
}

func validSlot(slotID string, keyID string) *securecontentpb.RequiredContentRecipientSlot {
	return &securecontentpb.RequiredContentRecipientSlot{
		RecipientSlotId:        slotID,
		KeyKind:                securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT,
		OneTimeKeyId:           keyID,
		OneTimePublicKey:       repeatedByte(0x61, kernel.X25519PublicKeySize),
		PrincipalBindingSha256: repeatedByte(0x62, kernel.SHA256Size),
	}
}

func repeatedByte(value byte, count int) []byte {
	result := make([]byte, count)
	for index := range result {
		result[index] = value
	}

	return result
}
