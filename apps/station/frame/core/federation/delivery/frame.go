package delivery

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"strings"
	"time"

	federationmodel "github.com/peers-labs/peers-touch/station/frame/core/federation/model"
	"google.golang.org/protobuf/proto"
)

const (
	// CurrentFormatVersion is the only frame format accepted by this v1 delivery core.
	CurrentFormatVersion uint32 = 1
)

type (
	// Frame is the canonical domain-neutral Federation delivery frame.
	Frame = federationmodel.FederatedDomainFrame
	// PayloadKind identifies the generated protobuf payload contract carried by a frame.
	PayloadKind = federationmodel.FederatedDomainPayloadKind
	// Disposition describes the durable receiver outcome returned to a sender.
	Disposition = federationmodel.FederatedDomainFrameDisposition
	// FrameErrorCode is the protocol-level failure classification.
	FrameErrorCode = federationmodel.FederatedDomainFrameErrorCode
)

// FramePolicy bounds accepted wire data and binds it to one receiving Station.
type FramePolicy struct {
	LocalStationPeerID string
	FormatVersion      uint32
	MaxIdentifierBytes int
	MaxPayloadBytes    int
	MaxSignatureBytes  int
	MaxLifetime        time.Duration
	MaxClockSkew       time.Duration
}

// DefaultFramePolicy returns conservative v1 bounds suitable for Station delivery.
func DefaultFramePolicy(localStationPeerID string) FramePolicy {
	return FramePolicy{
		LocalStationPeerID: localStationPeerID,
		FormatVersion:      CurrentFormatVersion,
		MaxIdentifierBytes: 512,
		MaxPayloadBytes:    8 << 20,
		MaxSignatureBytes:  512,
		MaxLifetime:        24 * time.Hour,
		MaxClockSkew:       30 * time.Second,
	}
}

// Signer signs canonical frame bytes using a Station-owned key.
type Signer interface {
	KeyID() string
	Sign(ctx context.Context, canonical []byte) ([]byte, error)
}

// Verifier resolves the claimed source Station and verifies its frame signature.
type Verifier interface {
	Verify(
		ctx context.Context,
		sourceStationPeerID string,
		signingKeyID string,
		canonical []byte,
		signature []byte,
	) error
}

// PayloadSHA256 returns a fresh SHA-256 byte slice for payload.
func PayloadSHA256(payload []byte) []byte {
	sum := sha256.Sum256(payload)
	return append([]byte(nil), sum[:]...)
}

// SigningBytes deterministically serializes the generated signing-input message.
func SigningBytes(frame *Frame) ([]byte, error) {
	if frame == nil {
		return nil, NewError(FailureInvalidFrame, "canonicalize frame", errorsText("frame is nil"))
	}
	if len(frame.ProtoReflect().GetUnknown()) != 0 {
		return nil, NewError(FailureInvalidFrame, "canonicalize frame", errorsText("unknown frame fields"))
	}
	input := &federationmodel.FederatedDomainFrameSigningInput{
		FormatVersion:       frame.FormatVersion,
		FrameId:             frame.FrameId,
		SourceStationPeerId: frame.SourceStationPeerId,
		TargetStationPeerId: frame.TargetStationPeerId,
		IdempotencyKey:      frame.IdempotencyKey,
		PayloadKind:         frame.PayloadKind,
		PayloadId:           frame.PayloadId,
		OrderingKey:         frame.OrderingKey,
		OrderingSequence:    frame.OrderingSequence,
		OpaquePayload:       append([]byte(nil), frame.OpaquePayload...),
		PayloadSha256:       append([]byte(nil), frame.PayloadSha256...),
		IssuedAt:            frame.IssuedAt,
		ExpiresAt:           frame.ExpiresAt,
		SigningKeyId:        frame.SigningKeyId,
		TraceId:             frame.TraceId,
	}
	canonical, err := proto.MarshalOptions{Deterministic: true}.Marshal(input)
	if err != nil {
		return nil, NewError(FailureInvalidFrame, "canonicalize frame", err)
	}
	return canonical, nil
}

// CanonicalFrameSHA256 hashes the exact bytes authenticated by the Station signature.
func CanonicalFrameSHA256(frame *Frame) ([]byte, error) {
	canonical, err := SigningBytes(frame)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(canonical)
	return append([]byte(nil), sum[:]...), nil
}

// SignFrame computes the payload hash and Station signature without changing payload bytes.
func SignFrame(ctx context.Context, frame *Frame, policy FramePolicy, signer Signer) error {
	if frame == nil {
		return NewError(FailureInvalidFrame, "sign frame", errorsText("frame is nil"))
	}
	if isNil(signer) {
		return NewError(FailureInvalidArgument, "sign frame", errorsText("signer is nil"))
	}
	keyID := strings.TrimSpace(signer.KeyID())
	if keyID == "" {
		return NewError(FailureInvalidArgument, "sign frame", errorsText("signing key id is empty"))
	}
	frame.SigningKeyId = keyID
	frame.PayloadSha256 = PayloadSHA256(frame.OpaquePayload)
	frame.StationSignature = nil
	if err := validateFrame(frame, policy, time.Time{}, false, false); err != nil {
		return err
	}
	canonical, err := SigningBytes(frame)
	if err != nil {
		return err
	}
	signature, err := signer.Sign(ctx, canonical)
	if err != nil {
		return NewError(FailureUnauthenticated, "sign frame", err)
	}
	if len(signature) == 0 {
		return NewError(FailureUnauthenticated, "sign frame", errorsText("signer returned an empty signature"))
	}
	frame.StationSignature = append([]byte(nil), signature...)
	return validateFrame(frame, policy, time.Time{}, true, false)
}

// VerifyFrame validates frame bounds and verifies the source Station signature.
func VerifyFrame(
	ctx context.Context,
	frame *Frame,
	policy FramePolicy,
	now time.Time,
	verifier Verifier,
) error {
	if isNil(verifier) {
		return NewError(FailureInvalidArgument, "verify frame", errorsText("verifier is nil"))
	}
	if err := validateFrame(frame, policy, now, true, true); err != nil {
		return err
	}
	canonical, err := SigningBytes(frame)
	if err != nil {
		return err
	}
	if err := verifier.Verify(
		ctx,
		frame.SourceStationPeerId,
		frame.SigningKeyId,
		canonical,
		append([]byte(nil), frame.StationSignature...),
	); err != nil {
		return NewError(FailureUnauthenticated, "verify frame signature", err)
	}
	return nil
}

// ValidateFrame validates a complete signed frame without invoking a key verifier.
func ValidateFrame(frame *Frame, policy FramePolicy, now time.Time) error {
	return validateFrame(frame, policy, now, true, true)
}

func validateFrame(
	frame *Frame,
	policy FramePolicy,
	now time.Time,
	requireSignature bool,
	requireLocalTarget bool,
) error {
	if err := validateFramePolicy(policy, requireLocalTarget); err != nil {
		return err
	}
	if frame == nil {
		return NewError(FailureInvalidFrame, "validate frame", errorsText("frame is nil"))
	}
	if len(frame.ProtoReflect().GetUnknown()) != 0 {
		return NewError(FailureInvalidFrame, "validate frame", errorsText("unknown frame fields"))
	}
	if frame.FormatVersion != policy.FormatVersion {
		return NewError(
			FailureInvalidFrame,
			"validate frame",
			fmt.Errorf("format version %d does not match %d", frame.FormatVersion, policy.FormatVersion),
		)
	}
	identifiers := []struct {
		name  string
		value string
	}{
		{name: "frame_id", value: frame.FrameId},
		{name: "source_station_peer_id", value: frame.SourceStationPeerId},
		{name: "target_station_peer_id", value: frame.TargetStationPeerId},
		{name: "idempotency_key", value: frame.IdempotencyKey},
		{name: "payload_id", value: frame.PayloadId},
		{name: "ordering_key", value: frame.OrderingKey},
		{name: "signing_key_id", value: frame.SigningKeyId},
	}
	for _, identifier := range identifiers {
		if err := validateIdentifier(identifier.name, identifier.value, policy.MaxIdentifierBytes); err != nil {
			return err
		}
	}
	if frame.TraceId != "" {
		if err := validateIdentifier(
			"trace_id",
			frame.TraceId,
			policy.MaxIdentifierBytes,
		); err != nil {
			return err
		}
	}
	if requireLocalTarget && frame.TargetStationPeerId != policy.LocalStationPeerID {
		return NewError(
			FailureWrongTarget,
			"validate frame",
			fmt.Errorf("target station %q does not match local station", frame.TargetStationPeerId),
		)
	}
	if frame.PayloadKind == federationmodel.FederatedDomainPayloadKind_FEDERATED_DOMAIN_PAYLOAD_KIND_UNSPECIFIED {
		return NewError(FailureInvalidFrame, "validate frame", errorsText("payload kind is unspecified"))
	}
	if frame.OrderingSequence < 0 {
		return NewError(FailureInvalidFrame, "validate frame", errorsText("ordering sequence is negative"))
	}
	if len(frame.OpaquePayload) == 0 || len(frame.OpaquePayload) > policy.MaxPayloadBytes {
		return NewError(
			FailureInvalidFrame,
			"validate frame",
			fmt.Errorf("payload length %d is outside 1..%d", len(frame.OpaquePayload), policy.MaxPayloadBytes),
		)
	}
	if len(frame.PayloadSha256) != sha256.Size ||
		!bytes.Equal(frame.PayloadSha256, PayloadSHA256(frame.OpaquePayload)) {
		return NewError(FailureInvalidFrame, "validate frame", errorsText("payload SHA-256 mismatch"))
	}
	if frame.IssuedAt == nil || frame.ExpiresAt == nil {
		return NewError(FailureInvalidFrame, "validate frame", errorsText("issued_at and expires_at are required"))
	}
	if err := frame.IssuedAt.CheckValid(); err != nil {
		return NewError(FailureInvalidFrame, "validate issued_at", err)
	}
	if err := frame.ExpiresAt.CheckValid(); err != nil {
		return NewError(FailureInvalidFrame, "validate expires_at", err)
	}
	if len(frame.IssuedAt.ProtoReflect().GetUnknown()) != 0 ||
		len(frame.ExpiresAt.ProtoReflect().GetUnknown()) != 0 {
		return NewError(FailureInvalidFrame, "validate frame", errorsText("unknown timestamp fields"))
	}
	issuedAt := frame.IssuedAt.AsTime()
	expiresAt := frame.ExpiresAt.AsTime()
	if !expiresAt.After(issuedAt) {
		return NewError(FailureInvalidFrame, "validate frame", errorsText("expiry must follow issue time"))
	}
	if expiresAt.Sub(issuedAt) > policy.MaxLifetime {
		return NewError(FailureInvalidFrame, "validate frame", errorsText("frame lifetime exceeds policy"))
	}
	if !now.IsZero() {
		now = now.UTC()
		if issuedAt.After(now.Add(policy.MaxClockSkew)) {
			return NewError(FailureInvalidFrame, "validate frame", errorsText("issue time is in the future"))
		}
		if !expiresAt.After(now) {
			return NewError(FailureExpired, "validate frame", errorsText("immutable expiry reached"))
		}
	}
	if requireSignature &&
		(len(frame.StationSignature) == 0 || len(frame.StationSignature) > policy.MaxSignatureBytes) {
		return NewError(FailureUnauthenticated, "validate frame", errorsText("station signature length is invalid"))
	}
	return nil
}

func validateFramePolicy(policy FramePolicy, requireLocalTarget bool) error {
	if requireLocalTarget &&
		(strings.TrimSpace(policy.LocalStationPeerID) == "" ||
			policy.LocalStationPeerID != strings.TrimSpace(policy.LocalStationPeerID)) {
		return NewError(FailureInvalidArgument, "validate frame policy", errorsText("local station peer id is invalid"))
	}
	if policy.FormatVersion == 0 ||
		policy.MaxIdentifierBytes <= 0 ||
		policy.MaxPayloadBytes <= 0 ||
		policy.MaxSignatureBytes <= 0 ||
		policy.MaxLifetime <= 0 ||
		policy.MaxClockSkew < 0 {
		return NewError(FailureInvalidArgument, "validate frame policy", errorsText("frame policy bounds are invalid"))
	}
	return nil
}

func validateIdentifier(name string, value string, maximum int) error {
	if value == "" || value != strings.TrimSpace(value) {
		return NewError(FailureInvalidFrame, "validate frame", fmt.Errorf("%s is empty or not normalized", name))
	}
	if len(value) > maximum {
		return NewError(
			FailureInvalidFrame,
			"validate frame",
			fmt.Errorf("%s exceeds %d bytes", name, maximum),
		)
	}
	return nil
}

type errorsText string

func (e errorsText) Error() string {
	return string(e)
}
