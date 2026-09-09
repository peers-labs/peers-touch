package domain

import (
	"bytes"
	"crypto/sha256"
	"strings"
	"time"
)

const (
	MaxRevisionIDBytes = 128
	MaxPTIDBytes       = 255
	MaxDeviceIDBytes   = 255
)

type ArchivePolicy struct {
	maxEncryptedArchiveBytes int
}

func NewArchivePolicy(maxEncryptedArchiveBytes int) (ArchivePolicy, error) {
	if maxEncryptedArchiveBytes <= 0 {
		return ArchivePolicy{}, NewError(
			ErrorCodeInvalidArgument,
			"new_archive_policy",
			"max_encrypted_archive_bytes",
			"must be positive",
		)
	}
	return ArchivePolicy{maxEncryptedArchiveBytes: maxEncryptedArchiveBytes}, nil
}

func (p ArchivePolicy) Validate(revision Revision) error {
	if err := validateIdentifier(
		"validate_revision",
		"revision_id",
		revision.RevisionID,
		MaxRevisionIDBytes,
	); err != nil {
		return err
	}
	if err := validateIdentifier(
		"validate_revision",
		"ptid",
		revision.PTID,
		MaxPTIDBytes,
	); err != nil {
		return err
	}
	if err := validateIdentifier(
		"validate_revision",
		"created_by_device_id",
		revision.CreatedByDeviceID,
		MaxDeviceIDBytes,
	); err != nil {
		return err
	}
	if revision.FormatVersion == 0 {
		return NewError(
			ErrorCodeInvalidArgument,
			"validate_revision",
			"format_version",
			"must be positive",
		)
	}
	if len(revision.EncryptedArchive) == 0 {
		return NewError(
			ErrorCodeArchiveIntegrity,
			"validate_revision",
			"encrypted_archive",
			"must not be empty",
		)
	}
	if len(revision.EncryptedArchive) > p.maxEncryptedArchiveBytes {
		return NewError(
			ErrorCodeArchiveTooLarge,
			"validate_revision",
			"encrypted_archive",
			"exceeds the configured byte limit",
		)
	}
	if len(revision.EncryptedArchiveSHA256) != sha256.Size {
		return NewError(
			ErrorCodeArchiveIntegrity,
			"validate_revision",
			"encrypted_archive_sha256",
			"must be a SHA-256 digest",
		)
	}
	actualHash := sha256.Sum256(revision.EncryptedArchive)
	if !bytes.Equal(actualHash[:], revision.EncryptedArchiveSHA256) {
		return NewError(
			ErrorCodeArchiveIntegrity,
			"validate_revision",
			"encrypted_archive_sha256",
			"does not match the opaque archive",
		)
	}
	if revision.CreatedAt.IsZero() {
		return NewError(
			ErrorCodeInvalidArgument,
			"validate_revision",
			"created_at",
			"must be set",
		)
	}
	return nil
}

type Revision struct {
	RevisionID             string
	PTID                   string
	FormatVersion          uint32
	EncryptedArchive       []byte
	EncryptedArchiveSHA256 []byte
	CreatedByDeviceID      string
	CreatedAt              time.Time
}

func NewRevision(
	revisionID string,
	ptid string,
	formatVersion uint32,
	encryptedArchive []byte,
	encryptedArchiveSHA256 []byte,
	createdByDeviceID string,
	createdAt time.Time,
	policy ArchivePolicy,
) (Revision, error) {
	revision := Revision{
		RevisionID:             revisionID,
		PTID:                   ptid,
		FormatVersion:          formatVersion,
		EncryptedArchive:       append([]byte(nil), encryptedArchive...),
		EncryptedArchiveSHA256: append([]byte(nil), encryptedArchiveSHA256...),
		CreatedByDeviceID:      createdByDeviceID,
		CreatedAt:              createdAt.UTC().Truncate(time.Microsecond),
	}
	if err := policy.Validate(revision); err != nil {
		return Revision{}, err
	}
	return revision, nil
}

func (r Revision) Clone() Revision {
	r.EncryptedArchive = append([]byte(nil), r.EncryptedArchive...)
	r.EncryptedArchiveSHA256 = append([]byte(nil), r.EncryptedArchiveSHA256...)
	return r
}

func (r Revision) SameImmutableContent(other Revision) bool {
	// CreatedAt is Station-assigned and therefore cannot participate in
	// client retry identity; an exact replay returns the first stored value.
	return r.RevisionID == other.RevisionID &&
		r.PTID == other.PTID &&
		r.FormatVersion == other.FormatVersion &&
		r.CreatedByDeviceID == other.CreatedByDeviceID &&
		bytes.Equal(r.EncryptedArchive, other.EncryptedArchive) &&
		bytes.Equal(r.EncryptedArchiveSHA256, other.EncryptedArchiveSHA256)
}

func ValidatePTID(operation string, ptid string) error {
	return validateIdentifier(operation, "ptid", ptid, MaxPTIDBytes)
}

func ValidateDeviceID(operation string, deviceID string) error {
	return validateIdentifier(operation, "device_id", deviceID, MaxDeviceIDBytes)
}

func validateIdentifier(
	operation string,
	field string,
	value string,
	maxBytes int,
) error {
	if strings.TrimSpace(value) == "" {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			field,
			"must not be empty",
		)
	}
	if len(value) > maxBytes {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			field,
			"exceeds the storage limit",
		)
	}
	return nil
}
