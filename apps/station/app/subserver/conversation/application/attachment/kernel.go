package attachment

import (
	"bytes"
	"errors"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/internal/securecontent"
)

func ValidateChatUploadSpec(spec UploadSpec) error {
	if strings.TrimSpace(spec.MediaType) != spec.MediaType ||
		spec.MediaType != "application/octet-stream" {
		return NewError(
			ErrorCodeInvalidArgument,
			"attachment.validate_upload_spec",
			"object",
			"does not satisfy the canonical encrypted-object profile",
		)
	}

	return mapKernelError(
		securecontent.ValidateObjectCommitment(
			spec.SecureContentCommitment(),
			securecontent.DefaultPolicy(),
		),
		"attachment.validate_upload_spec",
	)
}

func validatePartConformance(upload Upload, parts []Part) error {
	kernelParts := make([]securecontent.Part, len(parts))
	for index, part := range parts {
		if part.UploadID != upload.UploadID ||
			part.Generation != upload.Generation {
			return NewError(
				ErrorCodePartConflict,
				"attachment.complete",
				"parts",
				"do not belong to the immutable upload generation",
			)
		}
		kernelParts[index] = securecontent.Part{
			ChunkIndex:     part.ChunkIndex,
			ByteOffset:     part.ByteOffset,
			CiphertextSize: part.CiphertextSize,
			CiphertextHash: part.CiphertextHash.Bytes(),
		}
		if !validAttachmentStorageKey(part.StorageKey) {
			return NewError(
				ErrorCodePartConflict,
				"attachment.complete",
				"parts",
				"do not match the immutable chunk commitments",
			)
		}
	}

	return mapKernelError(
		securecontent.ValidateCompletePartSet(
			upload.Spec.SecureContentCommitment(),
			kernelParts,
			securecontent.DefaultPolicy(),
		),
		"attachment.complete",
	)
}

// SecureContentCommitment is the Conversation wire/domain adapter into the
// stateless kernel. It carries no Conversation authority or persistence.
func (spec UploadSpec) SecureContentCommitment() securecontent.ObjectCommitment {
	hashes := make([][]byte, len(spec.ChunkHashes))
	for index, hash := range spec.ChunkHashes {
		hashes[index] = hash.Bytes()
	}

	return securecontent.ObjectCommitment{
		CiphertextSize: spec.CiphertextSize,
		CiphertextHash: spec.CiphertextHash.Bytes(),
		ChunkSize:      spec.ChunkSize,
		ChunkCount:     spec.ChunkCount,
		Encryption:     spec.Encryption,
		TagSize:        spec.TagSize,
		NonceStrategy:  spec.NonceStrategy,
		ChunkHashes:    hashes,
	}
}

func validateChunkCommitment(spec UploadSpec, part securecontent.Part) error {
	offset, size, hash, err := securecontent.ExpectedChunk(
		spec.SecureContentCommitment(),
		part.ChunkIndex,
		securecontent.DefaultPolicy(),
	)
	if err != nil {
		return NewError(
			ErrorCodeInvalidArgument,
			"attachment.put_chunk",
			"chunk",
			"index, offset, or size does not match the immutable upload",
		)
	}
	if part.ByteOffset != offset || part.CiphertextSize != size {
		return NewError(
			ErrorCodeInvalidArgument,
			"attachment.put_chunk",
			"chunk",
			"index, offset, or size does not match the immutable upload",
		)
	}
	if !bytes.Equal(part.CiphertextHash, hash) {
		return NewError(
			ErrorCodePartConflict,
			"attachment.put_chunk",
			"ciphertext_sha256",
			"does not match the immutable chunk commitment",
		)
	}

	return nil
}

func mapKernelError(err error, operation string) error {
	if err == nil {
		return nil
	}

	var kernelError *securecontent.Error
	if !errors.As(err, &kernelError) {
		return WrapError(ErrorCodeIntegrityFailed, operation, err)
	}
	code := ErrorCodeIntegrityFailed
	switch kernelError.Code {
	case securecontent.ErrorCodeInvalidArgument,
		securecontent.ErrorCodeUnsupportedVersion:
		code = ErrorCodeInvalidArgument
	case securecontent.ErrorCodeBindingMismatch,
		securecontent.ErrorCodeConflict:
		code = ErrorCodePartConflict
	case securecontent.ErrorCodeInvalidState:
		code = ErrorCodeInvalidState
	case securecontent.ErrorCodeExpired:
		code = ErrorCodeUploadExpired
	case securecontent.ErrorCodeRangeInvalid:
		code = ErrorCodeRangeInvalid
	case securecontent.ErrorCodeQuotaExceeded:
		code = ErrorCodeQuotaExceeded
	case securecontent.ErrorCodeRetryLater:
		return &Error{
			Code:       ErrorCodeRetryLater,
			Operation:  operation,
			Field:      kernelError.Field,
			Message:    kernelError.Message,
			RetryAfter: kernelError.RetryAfter,
			Cause:      err,
		}
	}

	return &Error{
		Code:      code,
		Operation: operation,
		Field:     kernelError.Field,
		Message:   kernelError.Message,
		Cause:     err,
	}
}

// FromKernelError preserves the established Conversation attachment error
// codes while retaining the typed kernel failure as the cause.
func FromKernelError(err error, operation string) error {
	return mapKernelError(err, operation)
}
