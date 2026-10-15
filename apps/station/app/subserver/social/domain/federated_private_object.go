package domain

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"errors"

	securecontentkernel "github.com/peers-labs/peers-touch/station/app/internal/securecontent"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
)

const (
	FederatedPrivateObjectRequestLimit               = 4 << 10
	FederatedPrivateObjectRangeLimit          uint64 = uint64(securecontentkernel.ObjectChunkSize)
	FederatedPrivateObjectMetadataLimit              = 69
	FederatedPrivateObjectMetadataHeaderLimit        = 92
)

// CanonicalFederatedPrivateObjectGrantBindingBytes validates and encodes the
// actor-scoped imported grant commitment defined by CSS-D11.
func CanonicalFederatedPrivateObjectGrantBindingBytes(
	binding *privatecontentpb.FederatedPrivateObjectGrantBinding,
) ([]byte, error) {
	const operation = "social.private_object.canonical_grant_binding"
	if err := validateKnownMessage(binding, "binding", operation); err != nil {
		return nil, err
	}
	if binding.GetFormatVersion() != PrivateContentFormatVersion {
		return nil, NewPrivateContentError(
			PrivateContentUnsupported,
			operation,
			"format_version",
			"is not supported",
		)
	}
	for _, identifier := range []struct {
		field   string
		value   string
		maximum int
	}{
		{"federation_id", binding.GetFederationId(), 255},
		{"delivery_id", binding.GetDeliveryId(), 128},
		{"source_station_peer_id", binding.GetSourceStationPeerId(), 255},
		{"target_station_peer_id", binding.GetTargetStationPeerId(), 255},
		{"target_actor_ptid", binding.GetTargetActorPtid(), 255},
		{"object_id", binding.GetObjectId(), 128},
	} {
		if err := validateIdentifier(
			identifier.value,
			identifier.maximum,
			identifier.field,
			operation,
		); err != nil {
			return nil, err
		}
	}
	if err := validateFederatedPrivateObjectResource(
		binding.GetResource(),
		operation,
	); err != nil {
		return nil, err
	}
	if binding.GetLifecycleRevision() == 0 {
		return nil, NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			"lifecycle_revision",
			"must be positive",
		)
	}
	if len(binding.GetDescriptorSha256()) != sha256.Size {
		return nil, NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			"descriptor_sha256",
			"must contain one SHA-256 digest",
		)
	}
	return CanonicalProtoBytes(binding)
}

// FederatedPrivateObjectGrantBindingSHA256 returns the canonical commitment.
func FederatedPrivateObjectGrantBindingSHA256(
	binding *privatecontentpb.FederatedPrivateObjectGrantBinding,
) ([sha256.Size]byte, error) {
	canonical, err := CanonicalFederatedPrivateObjectGrantBindingBytes(
		binding,
	)
	if err != nil {
		return [sha256.Size]byte{}, err
	}

	return sha256.Sum256(canonical), nil
}

// CanonicalFederatedPrivateObjectReadRequestBytes validates one bounded peer
// range request and encodes it with the Social canonical protobuf algorithm.
func CanonicalFederatedPrivateObjectReadRequestBytes(
	request *privatecontentpb.ReadFederatedPrivateObjectRequest,
) ([]byte, error) {
	const operation = "social.private_object.canonical_peer_request"
	if err := validateKnownMessage(request, "request", operation); err != nil {
		return nil, err
	}
	if request.GetFormatVersion() != PrivateContentFormatVersion {
		return nil, NewPrivateContentError(
			PrivateContentUnsupported,
			operation,
			"format_version",
			"is not supported",
		)
	}
	if err := validateIdentifier(
		request.GetFederationId(),
		255,
		"federation_id",
		operation,
	); err != nil {
		return nil, err
	}
	if err := validateActorDeviceRef(request.GetViewer(), "viewer", operation); err != nil {
		return nil, err
	}
	if err := validateFederatedPrivateObjectResource(
		request.GetResource(),
		operation,
	); err != nil {
		return nil, err
	}
	if err := validateIdentifier(
		request.GetObjectId(),
		128,
		"object_id",
		operation,
	); err != nil {
		return nil, err
	}
	if len(request.GetImportedGrantSha256()) != sha256.Size {
		return nil, NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			"imported_grant_sha256",
			"must contain one SHA-256 digest",
		)
	}
	if err := validateFederatedPrivateObjectRange(
		request.GetRange(),
		0,
		operation,
	); err != nil {
		return nil, err
	}

	canonical, err := CanonicalProtoBytes(request)
	if err != nil {
		return nil, err
	}
	if len(canonical) > FederatedPrivateObjectRequestLimit {
		return nil, errors.New(
			"federated private-object request exceeds its canonical size limit",
		)
	}

	return canonical, nil
}

// DecodeCanonicalFederatedPrivateObjectReadRequest rejects every alternate
// protobuf wire representation before Social authorization runs.
func DecodeCanonicalFederatedPrivateObjectReadRequest(
	body []byte,
) (*privatecontentpb.ReadFederatedPrivateObjectRequest, []byte, error) {
	if len(body) == 0 || len(body) > FederatedPrivateObjectRequestLimit {
		return nil, nil, errors.New(
			"federated private-object request body has an invalid size",
		)
	}
	request := &privatecontentpb.ReadFederatedPrivateObjectRequest{}
	if err := (proto.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(
		body,
		request,
	); err != nil {
		return nil, nil, err
	}
	canonical, err := CanonicalFederatedPrivateObjectReadRequestBytes(request)
	if err != nil {
		return nil, nil, err
	}
	if !bytes.Equal(body, canonical) {
		return nil, nil, errors.New(
			"federated private-object request is not canonically encoded",
		)
	}

	return request, canonical, nil
}

// CanonicalFederatedPrivateObjectResponseBytes validates bounded response
// metadata before encoding it for the response header.
func CanonicalFederatedPrivateObjectResponseBytes(
	response *privatecontentpb.ReadFederatedPrivateObjectResponse,
) ([]byte, error) {
	const operation = "social.private_object.canonical_peer_response"
	if err := validateKnownMessage(response, "response", operation); err != nil {
		return nil, err
	}
	if len(response.GetDescriptorSha256()) != sha256.Size {
		return nil, NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			"descriptor_sha256",
			"must contain one SHA-256 digest",
		)
	}
	if response.GetTotalCiphertextSize() == 0 {
		return nil, NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			"total_ciphertext_size",
			"must be positive",
		)
	}
	if err := validateFederatedPrivateObjectRange(
		response.GetRange(),
		response.GetTotalCiphertextSize(),
		operation,
	); err != nil {
		return nil, err
	}
	canonical, err := CanonicalProtoBytes(response)
	if err != nil {
		return nil, err
	}
	if len(canonical) > FederatedPrivateObjectMetadataLimit {
		return nil, errors.New(
			"federated private-object response metadata exceeds its limit",
		)
	}

	return canonical, nil
}

// EncodeFederatedPrivateObjectMetadataHeader encodes canonical metadata as
// strict unpadded base64url.
func EncodeFederatedPrivateObjectMetadataHeader(
	response *privatecontentpb.ReadFederatedPrivateObjectResponse,
) (string, error) {
	canonical, err := CanonicalFederatedPrivateObjectResponseBytes(response)
	if err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding.EncodeToString(canonical)
	if len(encoded) > FederatedPrivateObjectMetadataHeaderLimit {
		return "", errors.New(
			"federated private-object response metadata header exceeds its limit",
		)
	}

	return encoded, nil
}

// DecodeFederatedPrivateObjectMetadataHeader accepts only the exact unpadded
// base64url and canonical protobuf representation.
func DecodeFederatedPrivateObjectMetadataHeader(
	encoded string,
) (*privatecontentpb.ReadFederatedPrivateObjectResponse, error) {
	if encoded == "" || len(encoded) > FederatedPrivateObjectMetadataHeaderLimit {
		return nil, errors.New(
			"federated private-object response metadata header has an invalid size",
		)
	}
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(encoded)
	if err != nil ||
		len(decoded) > FederatedPrivateObjectMetadataLimit ||
		base64.RawURLEncoding.EncodeToString(decoded) != encoded {
		return nil, errors.New(
			"federated private-object response metadata header is not canonical base64url",
		)
	}
	response := &privatecontentpb.ReadFederatedPrivateObjectResponse{}
	if err := (proto.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(
		decoded,
		response,
	); err != nil {
		return nil, err
	}
	canonical, err := CanonicalFederatedPrivateObjectResponseBytes(response)
	if err != nil {
		return nil, err
	}
	if !bytes.Equal(decoded, canonical) {
		return nil, errors.New(
			"federated private-object response metadata is not canonical protobuf",
		)
	}

	return response, nil
}

func validateFederatedPrivateObjectResource(
	resource *securecontentpb.SecureResourceRef,
	operation string,
) error {
	if err := securecontentkernel.ValidateResourceRef(resource); err != nil {
		return mapKernelError(operation, err)
	}
	if resource.GetOwnerDomain() !=
		securecontentpb.SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL {
		return NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			"resource.owner_domain",
			"must be Social",
		)
	}

	return ValidatePrivateContentID(
		resource.GetContentId(),
		"resource.content_id",
		operation,
	)
}

func validateFederatedPrivateObjectRange(
	requested *privatecontentpb.FederatedPrivateObjectRange,
	total uint64,
	operation string,
) error {
	if requested == nil ||
		requested.GetStart() >= requested.GetEndExclusive() ||
		requested.GetEndExclusive()-requested.GetStart() >
			FederatedPrivateObjectRangeLimit ||
		(total > 0 && requested.GetEndExclusive() > total) {
		return NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			"range",
			"must be one bounded satisfiable half-open interval",
		)
	}

	return nil
}
