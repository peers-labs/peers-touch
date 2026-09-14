package securecontent

import (
	"bytes"

	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	contentPreKeySigningDomain       = "peers-touch:secure-content:prekey:v1\x00"
	maxContentPreKeyIdentifierLength = 128
	maxContentPreKeyActorPTIDLength  = 255
	maxContentPreKeyDeviceIDLength   = 128
	maxContentPreKeyPersistenceEpoch = uint64(1<<63 - 1)
)

func appendVarintField(output []byte, number protowire.Number, value uint64) []byte {
	if value == 0 {
		return output
	}
	output = protowire.AppendTag(output, number, protowire.VarintType)
	return protowire.AppendVarint(output, value)
}

func appendBytesField(output []byte, number protowire.Number, value []byte) []byte {
	if len(value) == 0 {
		return output
	}
	output = protowire.AppendTag(output, number, protowire.BytesType)
	return protowire.AppendBytes(output, value)
}

func appendStringField(output []byte, number protowire.Number, value string) []byte {
	return appendBytesField(output, number, []byte(value))
}

func appendMessageField(output []byte, number protowire.Number, value []byte) []byte {
	output = protowire.AppendTag(output, number, protowire.BytesType)
	return protowire.AppendBytes(output, value)
}

func canonicalResourceRef(resource *securecontentpb.SecureResourceRef) []byte {
	output := appendVarintField(nil, 1, uint64(resource.GetOwnerDomain()))
	output = appendStringField(output, 2, resource.GetContentId())
	return appendVarintField(output, 3, resource.GetGeneration())
}

func canonicalActorRef(actor *actormodel.ActorRef) []byte {
	output := appendStringField(nil, 2, actor.GetPtid())
	output = appendStringField(output, 3, actor.GetAcct())
	return appendVarintField(output, 4, uint64(actor.GetKind()))
}

func canonicalActorDeviceRef(device *actormodel.ActorDeviceRef) []byte {
	output := appendMessageField(nil, 1, canonicalActorRef(device.GetActor()))
	return appendStringField(output, 2, device.GetDeviceId())
}

// CanonicalContentPreKeySigningInputBytes encodes the dedicated SC-D15
// signature projection with ascending protobuf fields and omitted defaults.
func CanonicalContentPreKeySigningInputBytes(
	input *securecontentpb.ContentPreKeySigningInput,
) ([]byte, error) {
	if err := validateContentPreKeySigningInput(input); err != nil {
		return nil, err
	}

	output := appendVarintField(nil, 1, uint64(input.GetFormatVersion()))
	output = appendVarintField(output, 2, uint64(input.GetKind()))
	output = appendStringField(output, 3, input.GetKeyId())
	output = appendBytesField(output, 4, input.GetX25519PublicKey())
	switch input.GetKind() {
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT:
		output = appendMessageField(
			output,
			5,
			canonicalActorDeviceRef(input.GetEndpoint()),
		)
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY:
		output = appendMessageField(
			output,
			6,
			canonicalActorRef(input.GetRecoveryActor()),
		)
	}
	output = appendVarintField(output, 7, input.GetPoolEpoch())
	output = appendVarintField(output, 8, input.GetExpectedPoolEpoch())
	output = appendMessageField(
		output,
		9,
		canonicalActorDeviceRef(input.GetPublisher()),
	)
	output = appendStringField(output, 10, input.GetPublisherSigningKeyId())
	output = appendVarintField(output, 11, input.GetPublisherProfileVersion())
	return output, nil
}

// ContentPreKeySigningBytes returns the exact domain-separated bytes signed by
// an authorized Content PreKey publisher.
func ContentPreKeySigningBytes(
	input *securecontentpb.ContentPreKeySigningInput,
) ([]byte, error) {
	canonical, err := CanonicalContentPreKeySigningInputBytes(input)
	if err != nil {
		return nil, err
	}
	output := make([]byte, 0, len(contentPreKeySigningDomain)+len(canonical))
	output = append(output, contentPreKeySigningDomain...)
	return append(output, canonical...), nil
}

func validateContentPreKeySigningInput(
	input *securecontentpb.ContentPreKeySigningInput,
) error {
	const operation = "securecontent.canonical_content_prekey_signing_input"

	if input == nil || hasUnknownFields(input) {
		return invalidEnvelope(
			"canonical_content_prekey_signing_input",
			"signing_input",
		)
	}
	if input.GetFormatVersion() != FormatVersion {
		return NewError(
			ErrorCodeUnsupportedVersion,
			operation,
			"format_version",
			"is not supported",
		)
	}
	if !validIdentifier(
		input.GetKeyId(),
		maxContentPreKeyIdentifierLength,
	) ||
		len(input.GetX25519PublicKey()) != X25519PublicKeySize ||
		len(bytes.Trim(input.GetX25519PublicKey(), "\x00")) == 0 ||
		input.GetPoolEpoch() == 0 ||
		input.GetPoolEpoch() > maxContentPreKeyPersistenceEpoch ||
		input.GetExpectedPoolEpoch() > maxContentPreKeyPersistenceEpoch ||
		input.GetExpectedPoolEpoch() > input.GetPoolEpoch() ||
		!validIdentifier(
			input.GetPublisherSigningKeyId(),
			maxContentPreKeyIdentifierLength,
		) ||
		input.GetPublisherProfileVersion() == 0 ||
		input.GetPublisherProfileVersion() > maxContentPreKeyPersistenceEpoch {
		return invalidEnvelope(
			"canonical_content_prekey_signing_input",
			"signing_input",
		)
	}
	if err := validateSigningActorDeviceRef(
		input.GetPublisher(),
		"publisher",
	); err != nil {
		return err
	}

	switch input.GetKind() {
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT:
		if input.GetEndpoint() == nil || input.GetRecoveryActor() != nil {
			return invalidEnvelope(
				"canonical_content_prekey_signing_input",
				"principal",
			)
		}
		if err := validateSigningActorDeviceRef(
			input.GetEndpoint(),
			"endpoint",
		); err != nil {
			return err
		}
		if input.GetEndpoint().GetActor().GetPtid() !=
			input.GetPublisher().GetActor().GetPtid() ||
			input.GetEndpoint().GetDeviceId() !=
				input.GetPublisher().GetDeviceId() ||
			input.GetPoolEpoch() != input.GetPublisherProfileVersion() {
			return invalidEnvelope(
				"canonical_content_prekey_signing_input",
				"endpoint",
			)
		}
		return nil
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY:
		if input.GetRecoveryActor() == nil || input.GetEndpoint() != nil {
			return invalidEnvelope(
				"canonical_content_prekey_signing_input",
				"principal",
			)
		}
		if err := validateSigningActorRef(
			input.GetRecoveryActor(),
			"recovery_actor",
		); err != nil {
			return err
		}
		if input.GetRecoveryActor().GetPtid() !=
			input.GetPublisher().GetActor().GetPtid() {
			return invalidEnvelope(
				"canonical_content_prekey_signing_input",
				"recovery_actor",
			)
		}
		return nil
	default:
		return invalidEnvelope(
			"canonical_content_prekey_signing_input",
			"kind",
		)
	}
}

func validateSigningActorDeviceRef(
	ref *actormodel.ActorDeviceRef,
	field string,
) error {
	if ref == nil ||
		hasUnknownFields(ref) ||
		!validIdentifier(ref.GetDeviceId(), maxContentPreKeyDeviceIDLength) {
		return invalidEnvelope(
			"canonical_content_prekey_signing_input",
			field,
		)
	}
	return validateSigningActorRef(ref.GetActor(), field+".actor")
}

func validateSigningActorRef(ref *actormodel.ActorRef, field string) error {
	if ref == nil ||
		hasUnknownFields(ref) ||
		!validIdentifier(ref.GetPtid(), maxContentPreKeyActorPTIDLength) ||
		ref.GetAcct() != "" ||
		ref.GetKind() != actormodel.ActorKind_ACTOR_KIND_UNSPECIFIED {
		return invalidEnvelope(
			"canonical_content_prekey_signing_input",
			field,
		)
	}
	return nil
}

func canonicalTimestamp(timestamp *timestamppb.Timestamp) []byte {
	output := appendVarintField(nil, 1, uint64(timestamp.GetSeconds()))
	return appendVarintField(output, 2, uint64(timestamp.GetNanos()))
}

func canonicalObjectUploadSpec(spec *securecontentpb.EncryptedObjectUploadSpec) []byte {
	output := appendMessageField(nil, 1, canonicalResourceRef(spec.GetResource()))
	output = appendStringField(output, 2, spec.GetObjectId())
	output = appendVarintField(output, 3, spec.GetCiphertextSize())
	output = appendBytesField(output, 4, spec.GetCiphertextSha256())
	output = appendVarintField(output, 5, uint64(spec.GetChunkSize()))
	output = appendVarintField(output, 6, uint64(spec.GetChunkCount()))
	output = appendVarintField(output, 7, uint64(spec.GetEncryptionSuite()))
	output = appendVarintField(output, 8, uint64(spec.GetTagSize()))
	output = appendVarintField(output, 9, uint64(spec.GetNonceStrategy()))
	for _, hash := range spec.GetChunkCiphertextSha256() {
		output = appendBytesField(output, 10, hash)
	}
	return output
}

func canonicalObjectDescriptor(descriptor *securecontentpb.EncryptedObjectDescriptor) []byte {
	output := appendMessageField(nil, 1, canonicalResourceRef(descriptor.GetResource()))
	output = appendStringField(output, 2, descriptor.GetObjectId())
	output = appendStringField(output, 3, descriptor.GetStorageRef())
	return appendMessageField(
		output,
		4,
		canonicalObjectUploadSpec(descriptor.GetCommitment()),
	)
}

func canonicalEnvelopeBinding(binding *securecontentpb.ContentKeyEnvelopeBinding) []byte {
	output := appendVarintField(nil, 1, uint64(binding.GetFormatVersion()))
	output = appendStringField(output, 2, binding.GetPlanId())
	output = appendBytesField(output, 3, binding.GetCanonicalPlanSha256())
	output = appendMessageField(output, 4, canonicalResourceRef(binding.GetResource()))
	output = appendStringField(output, 5, binding.GetRecipientSlotId())
	output = appendVarintField(output, 6, uint64(binding.GetRecipientKeyKind()))
	output = appendStringField(output, 7, binding.GetRecipientKeyId())
	output = appendBytesField(output, 8, binding.GetPrincipalBindingSha256())
	output = appendBytesField(output, 9, binding.GetAuthorizationSnapshotSha256())
	output = appendBytesField(output, 10, binding.GetPayloadCiphertextSha256())
	output = appendBytesField(output, 11, binding.GetObjectDescriptorSetSha256())
	output = appendMessageField(output, 12, canonicalTimestamp(binding.GetPlanExpiresAt()))
	output = appendMessageField(output, 13, canonicalActorDeviceRef(binding.GetSender()))
	return appendStringField(output, 14, binding.GetSenderSigningKeyId())
}
