package infrastructure

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
)

// ResolvedResetObjectTarget is retained only in Station control-plane storage.
// Durable exported artifacts contain its digests, never the raw owner or key.
type ResolvedResetObjectTarget struct {
	ResetID                 string
	OwnerDomain             ResetObjectDomain
	OwnerPTID               string
	Backend                 string
	StorageKey              string
	StorageKeyDigest        string
	ExpectedMetadataDigest  string
	ExpectedBlobDigest      string
	SourceRowDigest         string
	ReferenceClassification ResetReferenceClassification
}

// ResetObjectInspection is returned by the domain that owns object metadata.
type ResetObjectInspection struct {
	Backend                 string
	MetadataDigest          string
	BlobDigest              string
	ReferenceClassification ResetReferenceClassification
}

// ResetObjectOwner is the narrow owner-mediated object reset contract.
type ResetObjectOwner interface {
	InspectResetObject(
		context.Context,
		ResolvedResetObjectTarget,
	) (ResetObjectInspection, error)
	DeleteResetObject(context.Context, ResolvedResetObjectTarget) error
	VerifyResetObjectDeleted(context.Context, ResolvedResetObjectTarget) error
}

// SocialPrivateObjectResetOwner deletes only canonical Social-private bytes.
type SocialPrivateObjectResetOwner struct {
	backend storage.Backend
}

// NewSocialPrivateObjectResetOwner constructs the Social-owned object adapter.
func NewSocialPrivateObjectResetOwner(
	backend storage.Backend,
) (*SocialPrivateObjectResetOwner, error) {
	if backend == nil {
		return nil, resetError(
			ResetCodeInvalidInput,
			"Social private object backend is required",
		)
	}

	return &SocialPrivateObjectResetOwner{backend: backend}, nil
}

// InspectResetObject verifies and hashes one canonical private object.
func (o *SocialPrivateObjectResetOwner) InspectResetObject(
	ctx context.Context,
	target ResolvedResetObjectTarget,
) (ResetObjectInspection, error) {
	if target.OwnerDomain != ResetObjectDomainSocial ||
		target.OwnerPTID != "" ||
		target.StorageKey == "" {
		return ResetObjectInspection{}, resetError(
			ResetCodeObjectReferenceAmbiguous,
			"canonical Social object identity is invalid",
		)
	}

	blobDigest, err := digestBackendObject(ctx, o.backend, target.StorageKey)
	if err != nil {
		return ResetObjectInspection{}, resetError(
			ResetCodeObjectDigestMismatch,
			"inspect canonical Social object: %v",
			err,
		)
	}
	if target.ExpectedBlobDigest != "" &&
		!equalDigest(target.ExpectedBlobDigest, blobDigest) {
		return ResetObjectInspection{}, resetError(
			ResetCodeObjectDigestMismatch,
			"canonical Social object digest does not match its source row",
		)
	}

	return ResetObjectInspection{
		Backend:                 target.Backend,
		MetadataDigest:          target.ExpectedMetadataDigest,
		BlobDigest:              blobDigest,
		ReferenceClassification: ResetReferenceCanonicalPrivate,
	}, nil
}

// DeleteResetObject deletes one canonical Social-private object idempotently.
func (o *SocialPrivateObjectResetOwner) DeleteResetObject(
	ctx context.Context,
	target ResolvedResetObjectTarget,
) error {
	if target.OwnerDomain != ResetObjectDomainSocial ||
		target.OwnerPTID != "" ||
		target.StorageKey == "" {
		return resetError(
			ResetCodeObjectReferenceAmbiguous,
			"canonical Social object identity is invalid",
		)
	}
	if !isSHA256(target.ExpectedBlobDigest) {
		return resetError(
			ResetCodeObjectDigestMismatch,
			"canonical Social object is missing its frozen blob digest",
		)
	}
	blobDigest, err := digestBackendObject(ctx, o.backend, target.StorageKey)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return resetError(
			ResetCodeObjectDigestMismatch,
			"hash canonical Social object before deletion: %v",
			err,
		)
	}
	if !equalDigest(target.ExpectedBlobDigest, blobDigest) {
		return resetError(
			ResetCodeObjectDigestMismatch,
			"canonical Social object changed after manifest preparation",
		)
	}
	if err := o.backend.Delete(ctx, target.StorageKey); err != nil {
		return resetError(
			ResetCodePartialFailure,
			"delete canonical Social object: %v",
			err,
		)
	}

	return nil
}

// VerifyResetObjectDeleted proves one canonical Social-private object is absent.
func (o *SocialPrivateObjectResetOwner) VerifyResetObjectDeleted(
	ctx context.Context,
	target ResolvedResetObjectTarget,
) error {
	_, err := o.backend.Stat(ctx, target.StorageKey)
	if err == nil {
		return resetError(
			ResetCodePartialFailure,
			"canonical Social object remains after deletion",
		)
	}
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}

	return resetError(
		ResetCodePartialFailure,
		"verify canonical Social object deletion: %v",
		err,
	)
}

func digestBackendObject(
	ctx context.Context,
	backend storage.Backend,
	key string,
) (string, error) {
	reader, _, _, err := backend.Open(ctx, key, nil)
	if err != nil {
		return "", err
	}
	defer func() {
		_ = reader.Close()
	}()

	digest, err := digestReader(reader)
	if err != nil {
		return "", err
	}

	return digest, nil
}

func digestReader(reader io.Reader) (string, error) {
	hasher := sha256.New()
	if _, err := io.Copy(hasher, reader); err != nil {
		return "", fmt.Errorf("hash object bytes: %w", err)
	}

	return hex.EncodeToString(hasher.Sum(nil)), nil
}
