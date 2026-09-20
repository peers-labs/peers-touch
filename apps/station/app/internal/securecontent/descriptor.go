package securecontent

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"strings"

	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	"google.golang.org/protobuf/proto"
)

type EncryptionSuite = securecontentpb.ObjectEncryptionSuite

const (
	EncryptionSuiteAES256GCMChunked = securecontentpb.ObjectEncryptionSuite_OBJECT_ENCRYPTION_SUITE_AES_256_GCM_CHUNKED
)

type NonceStrategy = securecontentpb.ObjectNonceStrategy

const (
	NonceStrategyCounter32BE = securecontentpb.ObjectNonceStrategy_OBJECT_NONCE_STRATEGY_COUNTER32_BE
)

// ObjectCommitment is the domain-neutral validation projection used by legacy
// wire adapters and generated Secure Content descriptors.
type ObjectCommitment struct {
	CiphertextSize uint64
	CiphertextHash []byte
	ChunkSize      uint32
	ChunkCount     uint32
	Encryption     EncryptionSuite
	TagSize        uint32
	NonceStrategy  NonceStrategy
	ChunkHashes    [][]byte
}

func ObjectCommitmentFromProto(
	spec *securecontentpb.EncryptedObjectUploadSpec,
) ObjectCommitment {
	if spec == nil {
		return ObjectCommitment{}
	}

	hashes := make([][]byte, len(spec.GetChunkCiphertextSha256()))
	for index, hash := range spec.GetChunkCiphertextSha256() {
		hashes[index] = append([]byte(nil), hash...)
	}

	return ObjectCommitment{
		CiphertextSize: spec.GetCiphertextSize(),
		CiphertextHash: append([]byte(nil), spec.GetCiphertextSha256()...),
		ChunkSize:      spec.GetChunkSize(),
		ChunkCount:     spec.GetChunkCount(),
		Encryption:     spec.GetEncryptionSuite(),
		TagSize:        spec.GetTagSize(),
		NonceStrategy:  spec.GetNonceStrategy(),
		ChunkHashes:    hashes,
	}
}

func ValidateObjectCommitment(commitment ObjectCommitment, policy Policy) error {
	if err := policy.Validate(); err != nil {
		return err
	}
	if commitment.ChunkSize != policy.ObjectChunkSize ||
		commitment.ChunkCount == 0 ||
		commitment.ChunkCount > policy.MaximumObjectChunkCount ||
		commitment.TagSize != policy.ObjectTagSize ||
		commitment.Encryption != EncryptionSuiteAES256GCMChunked ||
		commitment.NonceStrategy != NonceStrategyCounter32BE ||
		uint32(len(commitment.ChunkHashes)) != commitment.ChunkCount ||
		len(commitment.CiphertextHash) != SHA256Size {
		return NewError(
			ErrorCodeInvalidArgument,
			"securecontent.validate_object_commitment",
			"object",
			"does not satisfy the canonical encrypted-object profile",
		)
	}
	for _, hash := range commitment.ChunkHashes {
		if len(hash) != SHA256Size {
			return NewError(
				ErrorCodeInvalidArgument,
				"securecontent.validate_object_commitment",
				"chunk_ciphertext_sha256",
				"must contain one SHA-256 digest per chunk",
			)
		}
	}

	minimumSize := uint64(commitment.ChunkCount-1)*
		uint64(commitment.ChunkSize+commitment.TagSize) +
		uint64(commitment.TagSize) + 1
	maximumSize := uint64(commitment.ChunkCount) *
		uint64(commitment.ChunkSize+commitment.TagSize)
	if commitment.CiphertextSize < minimumSize ||
		commitment.CiphertextSize > maximumSize {
		return NewError(
			ErrorCodeInvalidArgument,
			"securecontent.validate_object_commitment",
			"ciphertext_size",
			"does not match the fixed chunk geometry",
		)
	}
	plaintextSize := commitment.CiphertextSize -
		uint64(commitment.ChunkCount)*uint64(commitment.TagSize)
	if plaintextSize > policy.MaximumObjectPlaintextSize {
		return NewError(
			ErrorCodeQuotaExceeded,
			"securecontent.validate_object_commitment",
			"ciphertext_size",
			"exceeds the encrypted-object size policy",
		)
	}

	return nil
}

func ValidateEncryptedObjectUploadSpec(
	spec *securecontentpb.EncryptedObjectUploadSpec,
	policy Policy,
) error {
	if spec == nil || hasUnknownFields(spec) {
		return NewError(
			ErrorCodeInvalidArgument,
			"securecontent.validate_upload_spec",
			"spec",
			"must be present and contain no unknown fields",
		)
	}
	if err := ValidateResourceRef(spec.GetResource()); err != nil {
		return err
	}
	if !validIdentifier(spec.GetObjectId(), MaximumIdentifierLength) {
		return NewError(
			ErrorCodeInvalidArgument,
			"securecontent.validate_upload_spec",
			"object_id",
			"must be a canonical non-empty identifier",
		)
	}

	return ValidateObjectCommitment(ObjectCommitmentFromProto(spec), policy)
}

func ValidateEncryptedObjectDescriptor(
	descriptor *securecontentpb.EncryptedObjectDescriptor,
	policy Policy,
) error {
	if descriptor == nil || hasUnknownFields(descriptor) {
		return NewError(
			ErrorCodeInvalidArgument,
			"securecontent.validate_descriptor",
			"descriptor",
			"must be present and contain no unknown fields",
		)
	}
	if err := ValidateResourceRef(descriptor.GetResource()); err != nil {
		return err
	}
	if !validIdentifier(descriptor.GetObjectId(), MaximumIdentifierLength) ||
		!validStorageReference(descriptor.GetStorageRef()) ||
		descriptor.GetCommitment() == nil {
		return NewError(
			ErrorCodeInvalidArgument,
			"securecontent.validate_descriptor",
			"descriptor",
			"must contain canonical object and storage identities",
		)
	}
	if err := ValidateEncryptedObjectUploadSpec(descriptor.GetCommitment(), policy); err != nil {
		return err
	}
	if descriptor.GetObjectId() != descriptor.GetCommitment().GetObjectId() ||
		!EqualResourceRef(descriptor.GetResource(), descriptor.GetCommitment().GetResource()) {
		return NewError(
			ErrorCodeBindingMismatch,
			"securecontent.validate_descriptor",
			"commitment",
			"does not match the descriptor resource and object identity",
		)
	}

	return nil
}

func CanonicalDescriptorBytes(
	descriptor *securecontentpb.EncryptedObjectDescriptor,
	policy Policy,
) ([]byte, error) {
	if err := ValidateEncryptedObjectDescriptor(descriptor, policy); err != nil {
		return nil, err
	}
	return canonicalObjectDescriptor(descriptor), nil
}

func DescriptorSHA256(
	descriptor *securecontentpb.EncryptedObjectDescriptor,
	policy Policy,
) ([SHA256Size]byte, error) {
	encoded, err := CanonicalDescriptorBytes(descriptor, policy)
	if err != nil {
		return [SHA256Size]byte{}, err
	}

	return sha256.Sum256(encoded), nil
}

func PlaintextSize(commitment ObjectCommitment, policy Policy) (uint64, error) {
	if err := ValidateObjectCommitment(commitment, policy); err != nil {
		return 0, err
	}

	return commitment.CiphertextSize -
		uint64(commitment.ChunkCount)*uint64(commitment.TagSize), nil
}

func ExpectedChunk(
	commitment ObjectCommitment,
	index uint32,
	policy Policy,
) (offset uint64, ciphertextSize uint64, ciphertextHash []byte, err error) {
	if err = ValidateObjectCommitment(commitment, policy); err != nil {
		return 0, 0, nil, err
	}
	if index >= commitment.ChunkCount {
		return 0, 0, nil, NewError(
			ErrorCodeRangeInvalid,
			"securecontent.expected_chunk",
			"chunk_index",
			"is outside the immutable object commitment",
		)
	}

	offset = uint64(index) * uint64(commitment.ChunkSize+commitment.TagSize)
	ciphertextSize = uint64(commitment.ChunkSize + commitment.TagSize)
	if index == commitment.ChunkCount-1 {
		ciphertextSize = commitment.CiphertextSize - offset
	}
	ciphertextHash = append([]byte(nil), commitment.ChunkHashes[index]...)

	return offset, ciphertextSize, ciphertextHash, nil
}

func SameObjectCommitment(left ObjectCommitment, right ObjectCommitment) bool {
	if left.CiphertextSize != right.CiphertextSize ||
		!bytes.Equal(left.CiphertextHash, right.CiphertextHash) ||
		left.ChunkSize != right.ChunkSize ||
		left.ChunkCount != right.ChunkCount ||
		left.Encryption != right.Encryption ||
		left.TagSize != right.TagSize ||
		left.NonceStrategy != right.NonceStrategy ||
		len(left.ChunkHashes) != len(right.ChunkHashes) {
		return false
	}
	for index := range left.ChunkHashes {
		if !bytes.Equal(left.ChunkHashes[index], right.ChunkHashes[index]) {
			return false
		}
	}

	return true
}

func ValidateResourceRef(resource *securecontentpb.SecureResourceRef) error {
	if resource == nil || hasUnknownFields(resource) ||
		(resource.GetOwnerDomain() != securecontentpb.SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_CONVERSATION &&
			resource.GetOwnerDomain() != securecontentpb.SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL) ||
		!validIdentifier(resource.GetContentId(), MaximumIdentifierLength) ||
		resource.GetGeneration() == 0 {
		return NewError(
			ErrorCodeInvalidArgument,
			"securecontent.validate_resource_ref",
			"resource",
			"must contain a supported owner, content ID, and positive generation",
		)
	}

	return nil
}

func EqualResourceRef(
	left *securecontentpb.SecureResourceRef,
	right *securecontentpb.SecureResourceRef,
) bool {
	return left != nil &&
		right != nil &&
		left.GetOwnerDomain() == right.GetOwnerDomain() &&
		left.GetContentId() == right.GetContentId() &&
		left.GetGeneration() == right.GetGeneration()
}

func validIdentifier(value string, maximumLength int) bool {
	return value != "" &&
		len(value) <= maximumLength &&
		strings.TrimSpace(value) == value &&
		!strings.ContainsRune(value, '\x00')
}

func validStorageReference(value string) bool {
	return validIdentifier(value, MaximumStorageReferenceLength) &&
		!strings.HasPrefix(value, "/") &&
		!strings.Contains(value, `\`) &&
		!strings.Contains(value, "..")
}

func hasUnknownFields(message proto.Message) bool {
	return message == nil || len(message.ProtoReflect().GetUnknown()) != 0
}

func hashField(value []byte, field string, operation string) error {
	if len(value) != SHA256Size {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			field,
			fmt.Sprintf("must contain exactly %d bytes", SHA256Size),
		)
	}

	return nil
}
