package domain

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"strings"

	securecontentkernel "github.com/peers-labs/peers-touch/station/app/internal/securecontent"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	"google.golang.org/protobuf/proto"
)

type PrivateObjectBeginMaterial struct {
	CanonicalBytes            []byte
	CanonicalSHA256           [sha256.Size]byte
	UploadSpecBytes           []byte
	UploadSpecSHA256          [sha256.Size]byte
	DescriptorCommitmentBytes []byte
}

func CanonicalizePrivateObjectBegin(
	request *securecontentpb.BeginEncryptedObjectUploadRequest,
	policy securecontentkernel.Policy,
) (PrivateObjectBeginMaterial, error) {
	const operation = "social.private_object.begin"
	if err := validateKnownMessage(request, "request", operation); err != nil {
		return PrivateObjectBeginMaterial{}, err
	}
	if request.GetFormatVersion() != PrivateContentFormatVersion {
		return PrivateObjectBeginMaterial{}, NewPrivateContentError(
			PrivateContentUnsupported,
			operation,
			"format_version",
			"is not supported",
		)
	}
	for field, value := range map[string]string{
		"plan_id":    request.GetPlanId(),
		"object_id":  request.GetObjectId(),
		"command_id": request.GetCommandId(),
	} {
		if err := validateIdentifier(value, 128, field, operation); err != nil {
			return PrivateObjectBeginMaterial{}, err
		}
	}
	if err := ValidatePrivateObjectID(
		request.GetObjectId(),
		"object_id",
		operation,
	); err != nil {
		return PrivateObjectBeginMaterial{}, err
	}
	if err := securecontentkernel.ValidateEncryptedObjectUploadSpec(
		request.GetUploadSpec(),
		policy,
	); err != nil {
		return PrivateObjectBeginMaterial{}, mapKernelError(operation, err)
	}
	if err := securecontentkernel.ValidateResourceRef(request.GetResource()); err != nil {
		return PrivateObjectBeginMaterial{}, mapKernelError(operation, err)
	}
	if request.GetResource().GetOwnerDomain() !=
		securecontentpb.SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL ||
		request.GetObjectId() != request.GetUploadSpec().GetObjectId() ||
		!securecontentkernel.EqualResourceRef(
			request.GetResource(),
			request.GetUploadSpec().GetResource(),
		) {
		return PrivateObjectBeginMaterial{}, NewPrivateContentError(
			PrivateContentConflict,
			operation,
			"upload_spec",
			"does not match the Social resource and object identity",
		)
	}
	commitmentInput := &securecontentpb.EncryptedObjectDescriptorCommitmentInput{
		FormatVersion: PrivateContentFormatVersion,
		Resource:      request.GetResource(),
		ObjectId:      request.GetObjectId(),
		UploadSpec:    request.GetUploadSpec(),
	}
	commitmentBytes, err := CanonicalProtoBytes(commitmentInput)
	if err != nil {
		return PrivateObjectBeginMaterial{}, err
	}
	expectedCommitment := sha256.Sum256(commitmentBytes)
	if !bytes.Equal(
		expectedCommitment[:],
		request.GetDescriptorCommitmentSha256(),
	) {
		return PrivateObjectBeginMaterial{}, NewPrivateContentError(
			PrivateContentIntegrityFailed,
			operation,
			"descriptor_commitment_sha256",
			"does not match the canonical descriptor commitment input",
		)
	}
	uploadSpecBytes, err := CanonicalProtoBytes(request.GetUploadSpec())
	if err != nil {
		return PrivateObjectBeginMaterial{}, err
	}
	canonicalBytes, err := CanonicalProtoBytes(request)
	if err != nil {
		return PrivateObjectBeginMaterial{}, err
	}
	return PrivateObjectBeginMaterial{
		CanonicalBytes:            canonicalBytes,
		CanonicalSHA256:           sha256.Sum256(canonicalBytes),
		UploadSpecBytes:           uploadSpecBytes,
		UploadSpecSHA256:          sha256.Sum256(uploadSpecBytes),
		DescriptorCommitmentBytes: commitmentBytes,
	}, nil
}

func ValidatePrivateObjectID(
	value string,
	field string,
	operation string,
) error {
	const prefix = "object-"
	if !strings.HasPrefix(value, prefix) ||
		len(value) != len(prefix)+32 ||
		strings.ToLower(value) != value {
		return NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			field,
			"must be a deterministic Social object identifier",
		)
	}
	if _, err := hex.DecodeString(strings.TrimPrefix(value, prefix)); err != nil {
		return NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			field,
			"must be a deterministic Social object identifier",
		)
	}
	return nil
}

type PrivateObjectCommandMaterial struct {
	CanonicalBytes  []byte
	CanonicalSHA256 [sha256.Size]byte
}

func CanonicalizePrivateObjectComplete(
	request *securecontentpb.CompleteEncryptedObjectUploadRequest,
) (PrivateObjectCommandMaterial, error) {
	const operation = "social.private_object.complete"
	if err := validateKnownMessage(request, "request", operation); err != nil {
		return PrivateObjectCommandMaterial{}, err
	}
	if err := validateObjectControlIdentity(
		request.GetUploadId(),
		request.GetGeneration(),
		request.GetCommandId(),
		operation,
	); err != nil {
		return PrivateObjectCommandMaterial{}, err
	}
	if len(request.GetDescriptorCommitmentSha256()) != sha256.Size {
		return PrivateObjectCommandMaterial{}, NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			"descriptor_commitment_sha256",
			"must contain one SHA-256 digest",
		)
	}
	return canonicalObjectCommand(request)
}

func CanonicalizePrivateObjectCancel(
	request *securecontentpb.CancelEncryptedObjectUploadRequest,
) (PrivateObjectCommandMaterial, error) {
	const operation = "social.private_object.cancel"
	if err := validateKnownMessage(request, "request", operation); err != nil {
		return PrivateObjectCommandMaterial{}, err
	}
	if err := validateObjectControlIdentity(
		request.GetUploadId(),
		request.GetGeneration(),
		request.GetCommandId(),
		operation,
	); err != nil {
		return PrivateObjectCommandMaterial{}, err
	}
	return canonicalObjectCommand(request)
}

func CanonicalPrivateObjectChunkCommand(
	uploadID string,
	generation uint64,
	chunkIndex uint32,
	offset uint64,
	size uint64,
	ciphertextSHA256 []byte,
	idempotencyKey string,
) ([sha256.Size]byte, error) {
	const operation = "social.private_object.put_chunk"
	if err := validateObjectControlIdentity(
		uploadID,
		generation,
		idempotencyKey,
		operation,
	); err != nil {
		return [sha256.Size]byte{}, err
	}
	if size == 0 || len(ciphertextSHA256) != sha256.Size {
		return [sha256.Size]byte{}, NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			"chunk",
			"requires a positive size and one SHA-256 digest",
		)
	}
	canonical := appendStringField(nil, 1, uploadID)
	canonical = appendVarintField(canonical, 2, generation)
	canonical = appendVarintField(canonical, 3, uint64(chunkIndex))
	canonical = appendVarintField(canonical, 4, offset)
	canonical = appendVarintField(canonical, 5, size)
	canonical = appendBytesField(canonical, 6, ciphertextSHA256)
	canonical = appendStringField(canonical, 7, idempotencyKey)
	return sha256.Sum256(canonical), nil
}

func validateObjectControlIdentity(
	uploadID string,
	generation uint64,
	commandID string,
	operation string,
) error {
	if err := validateIdentifier(
		uploadID,
		128,
		"upload_id",
		operation,
	); err != nil {
		return err
	}
	if generation == 0 {
		return NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			"generation",
			"must be positive",
		)
	}
	return validateIdentifier(commandID, 128, "command_id", operation)
}

func canonicalObjectCommand(
	request proto.Message,
) (PrivateObjectCommandMaterial, error) {
	canonicalBytes, err := CanonicalProtoBytes(request)
	if err != nil {
		return PrivateObjectCommandMaterial{}, err
	}
	return PrivateObjectCommandMaterial{
		CanonicalBytes:  canonicalBytes,
		CanonicalSHA256: sha256.Sum256(canonicalBytes),
	}, nil
}
