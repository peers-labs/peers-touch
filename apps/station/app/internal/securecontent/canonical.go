package securecontent

import (
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/types/known/timestamppb"
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
