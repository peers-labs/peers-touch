package domain

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"time"

	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	"google.golang.org/protobuf/proto"
)

const (
	ContentPreKeyPublishCapability     = "key_exchange.content_prekey.publish"
	ContentPreKeyInventoryCapability   = "key_exchange.content_prekey.inventory"
	ContentPreKeyClientFormatVersion   = 1
	ContentPreKeyClientNonceBytes      = 32
	ContentPreKeyClientClockSkew       = time.Minute
	contentPreKeyPublishCommandPrefix  = "cpk-pub-v1-"
	contentPreKeyClientSignaturePrefix = "peers-touch:secure-content:client-command:v1\x00"
)

type ContentPreKeyClientAuthorization struct {
	Publisher      Endpoint
	SigningKeyID   string
	ProfileVersion uint64
	RequestID      string
	RequestBytes   []byte
	RequestSHA256  [sha256.Size]byte
	SigningBytes   []byte
	Signature      []byte
}

type ContentPreKeyClientPublication struct {
	Publication   ContentPreKeyPublication
	Authorization ContentPreKeyClientAuthorization
	CommandID     string
}

func NormalizeContentPreKeyClientPublication(
	operation string,
	authenticatedPublisher Endpoint,
	stationPeerID string,
	sessionID string,
	request *securecontentpb.PublishContentPreKeysRequest,
	now time.Time,
) (ContentPreKeyClientPublication, error) {
	if request == nil {
		return ContentPreKeyClientPublication{}, NewError(
			ErrorCodeInvalidArgument,
			operation,
			"request",
			"is required",
		)
	}
	if !contentPreKeysAreStrictlyAscending(request.GetPrekeys()) {
		return ContentPreKeyClientPublication{}, NewError(
			ErrorCodeInvalidArgument,
			operation,
			"prekeys.key_id",
			"must be in ascending canonical order",
		)
	}
	if strings.ContainsRune(request.GetCommandId(), '\x00') {
		return ContentPreKeyClientPublication{}, NewError(
			ErrorCodeInvalidArgument,
			operation,
			"command_id",
			"must not contain NUL",
		)
	}
	commandID, err := ContentPreKeyPublicationCommandID(request)
	if err != nil {
		return ContentPreKeyClientPublication{}, err
	}
	if request.GetCommandId() != commandID {
		return ContentPreKeyClientPublication{}, NewError(
			ErrorCodeConflict,
			operation,
			"command_id",
			"does not match the canonical publication payload",
		)
	}
	publication, err := NormalizePublishContentPreKeysRequest(
		operation,
		authenticatedPublisher,
		request,
	)
	if err != nil {
		return ContentPreKeyClientPublication{}, err
	}
	proofFree := proto.Clone(request).(*securecontentpb.PublishContentPreKeysRequest)
	proofFree.Proof = nil
	authorization, err := normalizeContentPreKeyClientProof(
		operation,
		ContentPreKeyPublishCapability,
		authenticatedPublisher,
		stationPeerID,
		sessionID,
		commandID,
		proofFree,
		request.GetProof(),
		now,
	)
	if err != nil {
		return ContentPreKeyClientPublication{}, err
	}
	return ContentPreKeyClientPublication{
		Publication:   publication,
		Authorization: authorization,
		CommandID:     commandID,
	}, nil
}

func NormalizeContentPreKeyInventoryAuthorization(
	operation string,
	authenticatedPublisher Endpoint,
	stationPeerID string,
	sessionID string,
	request *securecontentpb.GetContentPreKeyInventoryRequest,
	now time.Time,
) (ContentPreKeyClientAuthorization, error) {
	if request == nil {
		return ContentPreKeyClientAuthorization{}, NewError(
			ErrorCodeInvalidArgument,
			operation,
			"request",
			"is required",
		)
	}
	proofFree := proto.Clone(request).(*securecontentpb.GetContentPreKeyInventoryRequest)
	proofFree.Proof = nil
	return normalizeContentPreKeyClientProof(
		operation,
		ContentPreKeyInventoryCapability,
		authenticatedPublisher,
		stationPeerID,
		sessionID,
		request.GetRequestId(),
		proofFree,
		request.GetProof(),
		now,
	)
}

func ContentPreKeyPublicationCommandID(
	request *securecontentpb.PublishContentPreKeysRequest,
) (string, error) {
	if request == nil {
		return "", NewError(
			ErrorCodeInvalidArgument,
			"key_exchange.content_prekey.command_id",
			"request",
			"is required",
		)
	}
	payload := proto.Clone(request).(*securecontentpb.PublishContentPreKeysRequest)
	payload.CommandId = ""
	payload.Proof = nil
	canonical, err := proto.MarshalOptions{Deterministic: true}.Marshal(payload)
	if err != nil {
		return "", WrapError(
			ErrorCodeInternal,
			"key_exchange.content_prekey.command_id",
			err,
		)
	}
	sum := sha256.Sum256(canonical)
	return contentPreKeyPublishCommandPrefix + hex.EncodeToString(sum[:]), nil
}

func normalizeContentPreKeyClientProof(
	operation string,
	capabilityID string,
	authenticatedPublisher Endpoint,
	stationPeerID string,
	sessionID string,
	requestID string,
	proofFree proto.Message,
	proof *securecontentpb.ContentPreKeyClientProof,
	now time.Time,
) (ContentPreKeyClientAuthorization, error) {
	if err := authenticatedPublisher.Validate(operation); err != nil {
		return ContentPreKeyClientAuthorization{}, err
	}
	if strings.ContainsRune(requestID, '\x00') {
		return ContentPreKeyClientAuthorization{}, NewError(
			ErrorCodeInvalidArgument,
			operation,
			"request_id",
			"must not contain NUL",
		)
	}
	if err := ValidateRequestID(operation, requestID); err != nil {
		return ContentPreKeyClientAuthorization{}, err
	}
	stationPeerID = strings.TrimSpace(stationPeerID)
	sessionID = strings.TrimSpace(sessionID)
	if err := validateBoundedString(
		operation,
		"station_peer_id",
		stationPeerID,
		MaxStationIDBytes,
	); err != nil {
		return ContentPreKeyClientAuthorization{}, err
	}
	if err := validateBoundedString(
		operation,
		"session_id",
		sessionID,
		MaxSessionIDBytes,
	); err != nil {
		return ContentPreKeyClientAuthorization{}, err
	}
	if proof == nil || proof.GetInput() == nil {
		return ContentPreKeyClientAuthorization{}, contentPreKeyForbidden(
			operation,
			"proof",
			"is required",
		)
	}
	input := proof.GetInput()
	proofPublisher, err := contentPreKeyEndpointFromRef(
		operation,
		"proof.input.publisher",
		input.GetPublisher(),
	)
	if err != nil {
		return ContentPreKeyClientAuthorization{}, contentPreKeyForbidden(
			operation,
			"proof.input.publisher",
			"is invalid",
		)
	}
	requestBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(proofFree)
	if err != nil {
		return ContentPreKeyClientAuthorization{}, WrapError(
			ErrorCodeInternal,
			operation,
			err,
		)
	}
	requestHash := sha256.Sum256(requestBytes)
	issuedAt := input.GetIssuedAt()
	if issuedAt == nil || issuedAt.CheckValid() != nil {
		return ContentPreKeyClientAuthorization{}, contentPreKeyForbidden(
			operation,
			"proof.input.issued_at",
			"is invalid",
		)
	}
	issuedTime := issuedAt.AsTime().UTC()
	if issuedTime.Before(now.UTC().Add(-ContentPreKeyClientClockSkew)) ||
		issuedTime.After(now.UTC().Add(ContentPreKeyClientClockSkew)) {
		return ContentPreKeyClientAuthorization{}, contentPreKeyForbidden(
			operation,
			"proof.input.issued_at",
			"is outside the allowed clock skew",
		)
	}
	signingKeyID := strings.TrimSpace(input.GetPublisherSigningKeyId())
	if input.GetFormatVersion() != ContentPreKeyClientFormatVersion ||
		input.GetCapabilityId() != capabilityID ||
		input.GetStationPeerId() != stationPeerID ||
		input.GetSessionId() != sessionID ||
		proofPublisher != authenticatedPublisher ||
		input.GetRequestId() != requestID ||
		!bytes.Equal(input.GetRequestSha256(), requestHash[:]) ||
		len(input.GetNonce()) != ContentPreKeyClientNonceBytes ||
		signingKeyID == "" ||
		signingKeyID != input.GetPublisherSigningKeyId() ||
		input.GetPublisherProfileVersion() == 0 ||
		input.GetPublisherProfileVersion() > MaxContentPreKeyEpoch {
		return ContentPreKeyClientAuthorization{}, contentPreKeyForbidden(
			operation,
			"proof.input",
			"does not match the authenticated request",
		)
	}
	if len(proof.GetSignature()) == 0 {
		return ContentPreKeyClientAuthorization{}, contentPreKeyForbidden(
			operation,
			"proof.signature",
			"is required",
		)
	}
	signingBytes, err := ContentPreKeyClientSigningBytes(input)
	if err != nil {
		return ContentPreKeyClientAuthorization{}, WrapError(
			ErrorCodeInternal,
			operation,
			err,
		)
	}
	return ContentPreKeyClientAuthorization{
		Publisher:      authenticatedPublisher,
		SigningKeyID:   signingKeyID,
		ProfileVersion: input.GetPublisherProfileVersion(),
		RequestID:      requestID,
		RequestBytes:   requestBytes,
		RequestSHA256:  requestHash,
		SigningBytes:   signingBytes,
		Signature:      append([]byte(nil), proof.GetSignature()...),
	}, nil
}

func ContentPreKeyClientSigningBytes(
	input *securecontentpb.ContentPreKeyClientSigningInput,
) ([]byte, error) {
	if input == nil {
		return nil, NewError(
			ErrorCodeInvalidArgument,
			"key_exchange.content_prekey.client_signing_bytes",
			"input",
			"is required",
		)
	}
	canonicalInput, err := proto.MarshalOptions{Deterministic: true}.Marshal(input)
	if err != nil {
		return nil, WrapError(
			ErrorCodeInternal,
			"key_exchange.content_prekey.client_signing_bytes",
			err,
		)
	}
	return append(
		[]byte(contentPreKeyClientSignaturePrefix),
		canonicalInput...,
	), nil
}

func contentPreKeysAreStrictlyAscending(
	prekeys []*securecontentpb.ContentOneTimePreKey,
) bool {
	for index := 1; index < len(prekeys); index++ {
		if prekeys[index-1].GetKeyId() >= prekeys[index].GetKeyId() {
			return false
		}
	}
	return true
}

func contentPreKeyForbidden(
	operation string,
	field string,
	message string,
) error {
	return NewError(ErrorCodeUnauthorized, operation, field, message)
}
