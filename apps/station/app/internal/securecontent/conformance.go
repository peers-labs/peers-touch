package securecontent

import (
	"bytes"
	"sort"
	"time"
)

// Part is the domain-neutral projection required to prove repository chunk
// conformance against an immutable object commitment.
type Part struct {
	ChunkIndex     uint32
	ByteOffset     uint64
	CiphertextSize uint64
	CiphertextHash []byte
}

// UploadRecord is the pure projection a domain repository validates after
// decoding persisted upload state.
type UploadRecord struct {
	Commitment          ObjectCommitment
	State               TransferState
	ReceivedChunkBitmap []byte
	ExpiresAt           time.Time
}

// ObjectRecord is the pure projection a domain repository validates after
// decoding persisted object state.
type ObjectRecord struct {
	Commitment ObjectCommitment
	State      ObjectState
	CreatedAt  time.Time
	ExpiresAt  time.Time
}

func ValidatePart(
	commitment ObjectCommitment,
	part Part,
	policy Policy,
) error {
	offset, size, hash, err := ExpectedChunk(commitment, part.ChunkIndex, policy)
	if err != nil {
		return err
	}
	if part.ByteOffset != offset ||
		part.CiphertextSize != size ||
		!bytes.Equal(part.CiphertextHash, hash) {
		return NewError(
			ErrorCodeConflict,
			"securecontent.validate_part",
			"part",
			"does not match the immutable chunk commitment",
		)
	}

	return nil
}

func ValidateCompletePartSet(
	commitment ObjectCommitment,
	parts []Part,
	policy Policy,
) error {
	if err := ValidateObjectCommitment(commitment, policy); err != nil {
		return err
	}
	if len(parts) != int(commitment.ChunkCount) {
		return NewError(
			ErrorCodeInvalidState,
			"securecontent.validate_complete_part_set",
			"parts",
			"are incomplete",
		)
	}

	ordered := append([]Part(nil), parts...)
	sort.Slice(ordered, func(left int, right int) bool {
		return ordered[left].ChunkIndex < ordered[right].ChunkIndex
	})
	var totalSize uint64
	for index, part := range ordered {
		if part.ChunkIndex != uint32(index) {
			return NewError(
				ErrorCodeConflict,
				"securecontent.validate_complete_part_set",
				"parts",
				"contain a duplicate or missing chunk index",
			)
		}
		if err := ValidatePart(commitment, part, policy); err != nil {
			return err
		}
		totalSize += part.CiphertextSize
	}
	if totalSize != commitment.CiphertextSize {
		return NewError(
			ErrorCodeConflict,
			"securecontent.validate_complete_part_set",
			"ciphertext_size",
			"does not match the immutable object commitment",
		)
	}

	return nil
}

func ValidateReceivedChunkBitmap(bitmap []byte, chunkCount uint32) error {
	if chunkCount == 0 || chunkCount > MaximumObjectChunkCount ||
		len(bitmap) != int((chunkCount+7)/8) {
		return NewError(
			ErrorCodeIntegrityFailed,
			"securecontent.validate_received_chunk_bitmap",
			"received_chunk_bitmap",
			"does not match the bounded chunk count",
		)
	}
	unusedBits := uint32(len(bitmap))*8 - chunkCount
	if unusedBits > 0 {
		usedBitsInLastByte := uint8(8 - unusedBits)
		unusedMask := ^uint8((1 << usedBitsInLastByte) - 1)
		if bitmap[len(bitmap)-1]&unusedMask != 0 {
			return NewError(
				ErrorCodeIntegrityFailed,
				"securecontent.validate_received_chunk_bitmap",
				"received_chunk_bitmap",
				"sets bits outside the immutable chunk count",
			)
		}
	}

	return nil
}

func ValidateUploadRecord(record UploadRecord, policy Policy) error {
	if err := ValidateObjectCommitment(record.Commitment, policy); err != nil {
		return err
	}
	if !validTransferState(record.State) ||
		record.ExpiresAt.IsZero() ||
		len(record.ReceivedChunkBitmap) != int((record.Commitment.ChunkCount+7)/8) {
		return NewError(
			ErrorCodeIntegrityFailed,
			"securecontent.validate_upload_record",
			"upload",
			"does not satisfy the repository conformance contract",
		)
	}

	return ValidateReceivedChunkBitmap(
		record.ReceivedChunkBitmap,
		record.Commitment.ChunkCount,
	)
}

func ValidateObjectRecord(record ObjectRecord, policy Policy) error {
	if err := ValidateObjectCommitment(record.Commitment, policy); err != nil {
		return err
	}
	if !validObjectState(record.State) ||
		record.CreatedAt.IsZero() ||
		record.ExpiresAt.IsZero() ||
		record.ExpiresAt.Before(record.CreatedAt) ||
		record.ExpiresAt.Sub(record.CreatedAt) > policy.MaximumUnattachedObjectTTL {
		return NewError(
			ErrorCodeIntegrityFailed,
			"securecontent.validate_object_record",
			"object",
			"does not satisfy the repository conformance contract",
		)
	}

	return nil
}
